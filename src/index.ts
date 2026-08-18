/** Codex-compatible prompt overlay and core tools for a dsh agent preset. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerTodosProjection } from '@deepseek-ai/dsh-tool-todo'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FsInfo, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-terminal'
import { applyPatchHunks, APPLY_PATCH_GRAMMAR, parsePatch } from './patch.ts'
import type { PatchFile } from './patch.ts'
import { renderExecResult, runExecCommand, runWriteStdin } from './exec.ts'
import type { ExecCommandArgs, ExecResult, WriteStdinArgs } from './exec.ts'

export const name = 'codex'
export const inject = ['tools', 'systemPrompt', 'shell', 'fs']

/** Configuration for the Codex shell result bridge. */
export interface Config {
  /** Default wait before a pipe-backed command yields a session id. */
  defaultYieldTimeMs?: number
  /** Default wait for an empty `write_stdin` poll. */
  pollYieldTimeMs?: number
  /** Default wait for a non-empty `write_stdin` send. */
  writeYieldTimeMs?: number
  /** Maximum output retained in one canonical result, in UTF-8 bytes. */
  maxOutputBytes?: number
}

/** Runtime configuration schema for the Codex tool bridge. */
export const Config: z<Config> = z.object({
  defaultYieldTimeMs: z.number().step(1).min(0).default(10_000),
  pollYieldTimeMs: z.number().step(1).min(0).default(5_000),
  writeYieldTimeMs: z.number().step(1).min(0).default(250),
  maxOutputBytes: z.number().step(1).min(1).default(64_000),
})

const CODEX_BASE_PROMPT = String.raw`You are Codex, based on {{model}}. You are running as a coding agent in dsh Web on a user's computer.

## General

- When searching for text or files, prefer using rg or rg --files respectively because rg is much faster than alternatives like grep. If rg is not available, use the next best alternative.

## Editing constraints

- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.
- Add succinct code comments that explain non-obvious code. Do not add comments that merely narrate assignments or control flow.
- Use apply_patch for single-file edits when practical. The apply_patch tool accepts its freeform patch language; do not wrap that patch in JSON.
- You may be in a dirty git worktree. Never revert existing changes you did not make unless the user explicitly requests it. If unrelated files are changed, leave them alone.

## Planning

- Use update_plan for work with multiple meaningful steps. Keep the plan current as the task progresses.
- Do not use a plan for a trivial one-step request.

## dsh session

- The user and you share one workspace. Inspect the repository and every applicable AGENTS.md before editing.
- This session's preset was selected when the session was created and stays fixed for its lifetime. Do not attempt to switch the preset or replace its tool catalog while the session is running.
- dsh provides the execution, filesystem, session, policy, and Skills capabilities behind these tools. Use those extension points as supplied; do not invent a second harness or bypass the filesystem service for file edits.
- The core Codex tool names, arguments, and result formats are fixed: use exec_command for terminal work, write_stdin for an existing interactive command, apply_patch for file changes, and update_plan for multi-step tasks.

## Task execution

- Keep the user informed with concise progress updates and lead with the result.
- Prefer existing functions and extension points over new machinery.
- Do not claim that a command, edit, or test succeeded unless it actually succeeded.
- Use the exact tool names and argument formats supplied by this session; do not invent replacement editing tools.

## Presenting your work

- Be concise, direct, friendly, and actionable.
- For substantial work, explain what changed and why, then mention relevant verification and next steps.
- Do not dump large files into the conversation; refer to their paths.
- Use plain text with short sections only when they improve scanability.
`

const EXEC_COMMAND_DESCRIPTION = 'Runs a command in a PTY, returning output or a session ID for ongoing interaction.'
const WRITE_STDIN_DESCRIPTION = 'Writes characters to an existing unified exec session and returns recent output.'
const APPLY_PATCH_DESCRIPTION = 'The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.'
const UPDATE_PLAN_DESCRIPTION =
  'Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.'

const PLAN_STATUSES = ['pending', 'in_progress', 'completed'] as const
type PlanStatus = typeof PLAN_STATUSES[number]

interface PlanArgumentItem {
  step: string
  status: PlanStatus
}

interface UpdatePlanArgs {
  explanation?: string
  plan: PlanArgumentItem[]
}

interface AppliedFile {
  path: string
  operation: 'created' | 'updated' | 'deleted' | 'moved'
  moveTo?: string
}

interface ApplyPatchResult {
  files: AppliedFile[]
}

function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}

function resolvePolicy(ctx: Context, exec: ToolExecution): SandboxExecutionPolicy | undefined {
  const policy = ctx.get('sandboxPolicy')
  return policy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
}

async function resolveTarget(ctx: Context, path: string, exec: ToolExecution): Promise<FsTarget> {
  const cwd = sessionCwd(exec)
  return ctx.fs.resolve(path, cwd === undefined ? { signal: exec.signal } : { cwd, signal: exec.signal })
}

async function observedTarget(ctx: Context, target: FsTarget, exec: ToolExecution): Promise<FsInfo> {
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) throw new Error(`apply_patch: file not found: ${target.displayPath}`)
  if (info.type !== 'file') throw new Error(`apply_patch: not a regular file: ${target.displayPath}`)
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return info
}

async function writePatchedFile(
  ctx: Context,
  target: FsTarget,
  content: string,
  fallback: FsWriteIntent,
  exec: ToolExecution,
  policy: SandboxExecutionPolicy | undefined,
): Promise<'created' | 'updated'> {
  const intent = await ctx.waterfall('fs/write-intent', target, exec, () => fallback)
  const outcome = await ctx.fs.writeText(target, content, intent, exec.signal, policy)
  ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
  return outcome.operation === 'create' ? 'created' : 'updated'
}

async function deletePatchedFile(
  ctx: Context,
  target: FsTarget,
  version: FsInfo['version'],
  exec: ToolExecution,
  policy: SandboxExecutionPolicy | undefined,
): Promise<void> {
  await ctx.fs.remove(target, { version }, exec.signal, policy)
  ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
}

async function applyOnePatch(
  ctx: Context,
  file: PatchFile,
  exec: ToolExecution,
  policy: SandboxExecutionPolicy | undefined,
): Promise<AppliedFile> {
  const target = await resolveTarget(ctx, file.path, exec)
  if (file.kind === 'add') {
    const existing = await ctx.fs.stat(target, exec.signal)
    if (existing !== undefined) throw new Error(`apply_patch: file already exists: ${target.displayPath}`)
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    await writePatchedFile(ctx, target, file.content, { kind: 'createIfAbsent' }, exec, policy)
    return { path: file.path, operation: 'created' }
  }

  const sourceInfo = await observedTarget(ctx, target, exec)
  const original = await ctx.fs.readText(target, exec.signal)
  const updated = file.kind === 'delete' ? undefined : applyPatchHunks(original, file.hunks)
  if (file.kind === 'delete') {
    await deletePatchedFile(ctx, target, sourceInfo.version, exec, policy)
    return { path: file.path, operation: 'deleted' }
  }
  if (file.moveTo === undefined) {
    await writePatchedFile(ctx, target, updated!, { kind: 'replaceIfVersion', version: sourceInfo.version }, exec, policy)
    return { path: file.path, operation: 'updated' }
  }

  const destination = await resolveTarget(ctx, file.moveTo, exec)
  if (destination.targetKey === target.targetKey) {
    await writePatchedFile(ctx, target, updated!, { kind: 'replaceIfVersion', version: sourceInfo.version }, exec, policy)
    return { path: file.path, operation: 'updated', moveTo: file.moveTo }
  }
  const destinationInfo = await ctx.fs.stat(destination, exec.signal)
  if (destinationInfo !== undefined) throw new Error(`apply_patch: move destination already exists: ${destination.displayPath}`)
  ctx.emit('fs/observed', destination, { kind: 'absent' }, exec)
  await writePatchedFile(ctx, destination, updated!, { kind: 'createIfAbsent' }, exec, policy)
  await deletePatchedFile(ctx, target, sourceInfo.version, exec, policy)
  return { path: file.path, operation: 'moved', moveTo: file.moveTo }
}

function patchSummary(value: ApplyPatchResult): string {
  const letter = (operation: AppliedFile['operation']): string => {
    switch (operation) {
      case 'created': return 'A'
      case 'updated': return 'M'
      case 'deleted': return 'D'
      case 'moved': return 'M'
      default: return operation satisfies never
    }
  }
  return `Success. Updated the following files:\n${value.files.map(file => `${letter(file.operation)} ${file.operation === 'moved' ? file.moveTo : file.path}`).join('\n')}\n`
}

function planTodos(args: UpdatePlanArgs): TodoItem[] {
  const seen = new Set<string>()
  let active = 0
  const todos: TodoItem[] = []
  for (const item of args.plan) {
    const content = item.step.trim()
    if (content.length === 0) throw new Error('update_plan: every step must be non-empty')
    if (seen.has(content)) throw new Error(`update_plan: duplicate step ${JSON.stringify(content)}`)
    seen.add(content)
    if (item.status === 'in_progress') active++
    todos.push({ content, status: item.status })
  }
  if (active > 1) throw new Error('update_plan: at most one step may be in_progress')
  return todos
}

function registerExecTools(ctx: Context, config: Required<Config>): void {
  ctx.tools.register(defineTool({
    name: 'exec_command',
    description: EXEC_COMMAND_DESCRIPTION,
    parameters: {
      cmd: { type: 'string', required: true, description: 'Shell command to execute.' },
      workdir: { type: 'string', description: 'Working directory for the command. Defaults to the turn cwd.' },
      tty: { type: 'boolean', description: 'True allocates a PTY for the command; false or omitted uses plain pipes.' },
      yield_time_ms: { type: 'number', description: 'Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms.' },
      max_output_tokens: { type: 'number', description: 'Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.' },
      shell: { type: 'string', description: "Shell binary to launch. Defaults to the user's default shell." },
      login: { type: 'boolean', description: 'True runs the shell with -l/-i semantics; false disables them. Defaults to true.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunk_id: { type: 'string' },
          wall_time_seconds: { type: 'number', required: true },
          exit_code: { type: 'number' },
          session_id: { type: 'number' },
          original_token_count: { type: 'number' },
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderExecResult(value) }],
    },
    async execute(args: ExecCommandArgs, exec): Promise<ExecResult> {
      return runExecCommand(ctx, args, exec, config)
    },
    presentCall: args => ({
      card: 'terminal',
      title: args.cmd,
      ...args.workdir === undefined ? {} : { cwd: args.workdir },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'write_stdin',
    description: WRITE_STDIN_DESCRIPTION,
    parameters: {
      session_id: { type: 'number', required: true, description: 'Identifier of the running unified exec session.' },
      chars: { type: 'string', description: 'Bytes to write to stdin. Defaults to empty, which polls without writing.' },
      yield_time_ms: { type: 'number', description: 'Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.' },
      max_output_tokens: { type: 'number', description: 'Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunk_id: { type: 'string' },
          wall_time_seconds: { type: 'number', required: true },
          exit_code: { type: 'number' },
          session_id: { type: 'number' },
          original_token_count: { type: 'number' },
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderExecResult(value) }],
    },
    async execute(args: WriteStdinArgs, exec): Promise<ExecResult> {
      return runWriteStdin(ctx, args, exec, config)
    },
  }))
}

function registerPatchTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'apply_patch',
    description: APPLY_PATCH_DESCRIPTION,
    parameters: {
      input: { type: 'string', required: true, description: 'The complete patch text.' },
    },
    constrainedSampling: {
      type: 'grammar',
      variants: { openai_lark: APPLY_PATCH_GRAMMAR },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                operation: { type: 'string', required: true, enum: ['created', 'updated', 'deleted', 'moved'] },
                moveTo: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: patchSummary(value) }],
    },
    async execute(args: { input: string }, exec): Promise<ApplyPatchResult> {
      const files = parsePatch(args.input)
      const policy = resolvePolicy(ctx, exec)
      const applied: AppliedFile[] = []
      for (const file of files) applied.push(await applyOnePatch(ctx, file, exec, policy))
      return { files: applied }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: 'Apply patch',
        kind: 'edit',
        rawInput: args.input,
      }
    },
  }))
}

function registerPlanTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'update_plan',
    description: UPDATE_PLAN_DESCRIPTION,
    parameters: {
      explanation: { type: 'string', description: 'Optional explanation for this plan update.' },
      plan: {
        type: 'array',
        required: true,
        description: 'The list of steps',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string', required: true, description: 'Task step text.' },
            status: { type: 'string', required: true, enum: [...PLAN_STATUSES], description: 'Step status.' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'Plan updated' }],
    },
    execute(args: UpdatePlanArgs, exec): Promise<Record<string, never>> {
      const agent = exec.agent
      if (agent === undefined) throw new Error('update_plan requires an owning agent session')
      agent.session.append('todo/write', { todos: planTodos(args) })
      return Promise.resolve({})
    },
  }))
}

/** Mount the Codex prompt/tool layer inside one fixed agent preset. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    defaultYieldTimeMs: config.defaultYieldTimeMs ?? 10_000,
    pollYieldTimeMs: config.pollYieldTimeMs ?? 5_000,
    writeYieldTimeMs: config.writeYieldTimeMs ?? 250,
    maxOutputBytes: config.maxOutputBytes ?? 64_000,
  }
  if (ctx.fs.sandboxMode !== undefined && ctx.get('sandboxPolicy') === undefined) {
    throw new Error('codex: a sandboxing filesystem requires ctx.sandboxPolicy')
  }
  ctx.systemPrompt.section({ name: 'codex:base', order: 10, text: CODEX_BASE_PROMPT })
  registerTodosProjection(ctx)
  registerExecTools(ctx, resolved)
  registerPatchTool(ctx)
  registerPlanTool(ctx)
}

export default { name, inject, Config, apply }
