import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

function mount(): { definitions: ToolDefinition[]; promptSections: string[] } {
  const definitions: ToolDefinition[] = []
  const promptSections: string[] = []
  const ctx = {
    tools: { register: (definition: ToolDefinition) => { definitions.push(definition) } },
    systemPrompt: { section: (section: { name: string }) => { promptSections.push(section.name) } },
    fs: { sandboxMode: undefined },
    get: () => undefined,
    inject: () => {},
  } as unknown as Context
  apply(ctx)
  return { definitions, promptSections }
}

describe('Codex tool catalog', () => {
  it('registers only the four Codex core tools with exact descriptions', () => {
    const { definitions, promptSections } = mount()
    expect(definitions.map(definition => definition.name)).toEqual([
      'exec_command',
      'write_stdin',
      'apply_patch',
      'update_plan',
    ])
    expect(promptSections).toEqual(['codex:base'])
    expect(definitions.map(definition => definition.description)).toEqual([
      'Runs a command in a PTY, returning output or a session ID for ongoing interaction.',
      'Writes characters to an existing unified exec session and returns recent output.',
      'The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.',
      'Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.',
    ])
  })

  it('keeps apply_patch grammar metadata and Codex parameter names model-visible', () => {
    const { definitions } = mount()
    const exec = definitions.find(definition => definition.name === 'exec_command')
    const patch = definitions.find(definition => definition.name === 'apply_patch')
    expect(exec?.parameters).toEqual({
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to execute.' },
        workdir: { type: 'string', description: 'Working directory for the command. Defaults to the turn cwd.' },
        tty: { type: 'boolean', description: 'True allocates a PTY for the command; false or omitted uses plain pipes.' },
        yield_time_ms: { type: 'number', description: 'Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms.' },
        max_output_tokens: { type: 'number', description: 'Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.' },
        shell: { type: 'string', description: "Shell binary to launch. Defaults to the user's default shell." },
        login: { type: 'boolean', description: 'True runs the shell with -l/-i semantics; false disables them. Defaults to true.' },
      },
      required: ['cmd'],
    })
    expect(exec?.output.schema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        chunk_id: { type: 'string' },
        wall_time_seconds: { type: 'number' },
        exit_code: { type: 'number' },
        session_id: { type: 'number' },
        original_token_count: { type: 'number' },
        output: { type: 'string' },
      },
      required: ['wall_time_seconds', 'output'],
    })
    expect(patch?.parameters).toEqual({
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The complete patch text.' },
      },
      required: ['input'],
    })
    const stdin = definitions.find(definition => definition.name === 'write_stdin')
    expect(stdin?.parameters).toMatchObject({
      properties: {
        session_id: {
          type: 'number',
          description: 'Identifier of the running unified exec session.',
        },
      },
    })
    const plan = definitions.find(definition => definition.name === 'update_plan')
    expect(plan?.parameters).toEqual({
      type: 'object',
      properties: {
        explanation: { type: 'string', description: 'Optional explanation for this plan update.' },
        plan: {
          type: 'array',
          description: 'The list of steps',
          items: {
              type: 'object',
              additionalProperties: false,
              properties: {
              step: { type: 'string', description: 'Task step text.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Step status.' },
            },
            required: ['step', 'status'],
          },
        },
      },
      required: ['plan'],
    })
    expect(patch?.constrainedSampling?.type).toBe('grammar')
    expect(patch?.constrainedSampling?.type === 'grammar'
      ? patch.constrainedSampling.variants.openai_lark
      : undefined).toContain('start: begin_patch hunk+ end_patch')
  })

  it('renders Codex-compatible apply_patch and plan results', () => {
    const { definitions } = mount()
    const patch = definitions.find(definition => definition.name === 'apply_patch')!
    const plan = definitions.find(definition => definition.name === 'update_plan')!
    expect(patch.output.render({}, { files: [{ path: 'a.ts', operation: 'updated' }] } as never))
      .toEqual([{ type: 'text', text: 'Success. Updated the following files:\nM a.ts\n' }])
    expect(plan.output.render({}, {} as never)).toEqual([{ type: 'text', text: 'Plan updated' }])
  })

  it('renders both unified exec results in Codex response text format', () => {
    const { definitions } = mount()
    const exec = definitions.find(definition => definition.name === 'exec_command')!
    const stdin = definitions.find(definition => definition.name === 'write_stdin')!
    const value = {
      chunk_id: 'abc123',
      wall_time_seconds: 1.25,
      exit_code: 0,
      output: 'done\n',
    }
    const expected = 'Chunk ID: abc123\nWall time: 1.2500 seconds\nProcess exited with code 0\nOutput:\ndone\n'
    expect(exec.output.render({}, value as never)).toEqual([{ type: 'text', text: expected }])
    expect(stdin.output.render({}, value as never)).toEqual([{ type: 'text', text: expected }])
  })

  it('writes update_plan state to the session event stream', async () => {
    const { definitions } = mount()
    const plan = definitions.find(definition => definition.name === 'update_plan')!
    const events: unknown[] = []
    const execution = {
      agent: { session: { append: (type: string, data: unknown) => { events.push({ type, data }) } } },
      deferContext: () => {},
      concludeTurn: () => {},
    } as unknown as ToolRunContext
    await plan.execute({
      plan: [{ step: 'Inspect the repository', status: 'completed' }, { step: 'Implement the fix', status: 'in_progress' }],
    }, execution)
    expect(events).toEqual([{
      type: 'todo/write',
      data: { todos: [
        { content: 'Inspect the repository', status: 'completed' },
        { content: 'Implement the fix', status: 'in_progress' },
      ] },
    }])
  })
})
