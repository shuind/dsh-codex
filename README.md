# @shuind/dsh-codex

English | [中文](README.zh.md)

A minimal Codex harness for GPT models that do not fit DSH's native interface. It keeps the DSH runtime, profiles, services, and plugin ecosystem, while presenting the model with the compact Codex prompt and core tool protocol. Existing DSH plugins continue to work; this package only replaces the model-facing layer.

## DSH compatibility

This package is a model-facing compatibility layer, not a replacement runtime. DSH still owns the session, services, profile composition, providers, and plugin lifecycle. Install it into an existing DSH profile and continue composing other DSH plugins normally.

## Install, enable, and select

These are separate operations:

1. Install the plugin into the profile used by Web:

   ```sh
   dsh plugin --profile web add @shuind/dsh-codex
   ```

   The package remains a normal DSH bundle, so it appears in the plugin list and does not produce peer warnings from its DSH dependencies.

2. Enable it by starting or restarting that profile. The bundle installs the packaged `codex` preset into `$DSH_HOME/.agent-presets/codex` when that directory does not already exist. It never overwrites an existing user preset.

3. Create a new conversation and choose `Codex 模式` in the mode menu. The plugin list and the agent preset roster are different surfaces. DSH 0.1.0-rc.6 discovers user presets from `$DSH_HOME/.agent-presets`; newer DSH versions may provide a system `codex` preset themselves.

If an older manual copy left `$DSH_HOME/.agent-presets/codex` without a valid `agent.cordis.yml`, repair or remove that directory and restart the profile. The installer preserves existing directories by design.

The selected preset is fixed when a session is created. Selecting Codex affects new conversations; it does not rewrite the prompt or tool catalog of an existing session.

## What it does

The packaged `codex` preset mounts this package together with the dsh Skill filesystem and Skill tool. The package owns the Codex prompt section and these exact model-facing tool names and descriptions:

- `exec_command` — runs a command in a PTY, returning output or a session id for ongoing interaction.
- `write_stdin` — writes characters to an existing unified exec session and returns recent output.
- `apply_patch` — accepts the complete freeform patch text through one required `input` string.
- `update_plan` — accepts an optional explanation and a required plan of `step` / `status` items.

The exported tool registrations are authoritative for the complete schemas. The first two tools return the Codex-compatible execution fields (`chunk_id`, `wall_time_seconds`, `exit_code`, `session_id`, `original_token_count`, and `output`) and render the same `Chunk ID` / `Wall time` / `Output` response envelope. `apply_patch` returns the changed file list and renders the familiar `Success. Updated the following files:` summary. `update_plan` writes the durable `todo/write` event and returns `Plan updated`.

## dsh composition

`exec_command` uses the dsh Shell service for pipe-backed commands and the dsh Terminal service for optional PTY sessions. The Codex `shell`, `login`, `yield_time_ms`, and `max_output_tokens` arguments remain model-visible and are translated at the service seams. `write_stdin` addresses the per-agent unified session registry.

`apply_patch` parses the Codex patch language, resolves targets through dsh `fs`, applies version-checked writes/removes, observes the resulting filesystem state, and routes sandbox decisions through `sandboxPolicy`. It never writes through a second filesystem implementation. Add, update, delete, and move operations use dsh's normal filesystem errors and durable observations.

`update_plan` appends the session's `todo/write` event. It does not depend on an extra runtime projection helper or maintain a second plan store; DSH owns the projection and replay path. This keeps the package compatible with both the older and newer `dsh-tool-todo` packages. The Codex package does not mount `todo_write`.

## Configuration

The package accepts `defaultYieldTimeMs`, `pollYieldTimeMs`, `writeYieldTimeMs`, and `maxOutputBytes`. They control execution timing and retained output; protocol names, argument names, descriptions, and result fields are fixed. A sandboxing filesystem requires the corresponding dsh `sandboxPolicy` service.

`apply_patch` uses the ordinary dsh tool definition in DSH 0.1.0-rc.6. Its `input` value is still the complete Codex freeform patch, while provider-specific tool serialization remains owned by the DSH route.

## Bundle and preset composition

The package declares a `dsh.bundle` patch, but that patch only installs the preset template. It does not globally mount `@shuind/dsh-codex` or add Codex tools to standard, code, minimal, or other presets. The packaged `presets/codex/agent.cordis.yml` contains the single `codex-tools` row, so a Codex session mounts the prompt and four core tools exactly once.

If you author another Codex preset, add `@shuind/dsh-codex` inside that preset's `agent.cordis.yml`, not to the profile's top-level patch. This also avoids a duplicate when a newer DSH release already ships a system Codex preset.

The preset deliberately keeps Skills, filesystem policy, shell providers, terminal providers, and Web presentation on dsh extension points. They can be changed by composing a different preset or adding the corresponding dsh rows without changing the Codex tool protocol.

## Model Experience

### Prompt and tool catalog

#### What the model sees

The request contains the Codex base prompt, the four Codex core tools, and any explicitly mounted dsh extension such as `skill`. Tool names, descriptions, argument names, and result envelopes match the Codex harness protocol; dsh-specific implementation services stay behind the tools.

#### Token effect

The Codex prompt and core schemas add a fixed prefix cost to each request in this preset. Skill content and tool results remain data-dependent.

#### KV Cache effect

The fixed prompt and tool prefix remains reusable while the session's mounted composition is unchanged. Skill discovery or other explicitly mounted extensions change the suffix after the Codex prefix.

### Tool calls and results

#### What the model sees

Command calls return the Codex execution envelope, patch calls return the changed-file envelope and summary text, and plan calls return a durable plan acknowledgement. Filesystem and session events reconstruct the model-visible effects during replay.

#### Token effect

Tool results are data-dependent: command output and changed-file summaries are retained in the session, while a plan acknowledgement is small and fixed.

#### KV Cache effect

Tool results append to the conversation. A filesystem change or plan update affects later context through the normal dsh session log and projection rather than through hidden mutable state.

## Known Limitations and Deferred Work

- The preset is fixed for a session. Choosing `codex` affects new sessions; changing the selected preset in Web does not rewrite an existing session's prompt or tools.
- PTY behavior depends on the mounted dsh Terminal provider. The shipped Windows composition disables the optional bash terminal row; pipe execution remains available through the selected shell service.
- Pipe-backed `write_stdin` sessions do not accept non-empty stdin; interactive input requires a PTY-backed command.
- Provider-specific custom-tool or grammar serialization is outside this package; the Codex patch protocol remains usable through the ordinary dsh tool definition.
- The package implements the Codex core protocol and deliberately leaves Skills, filesystem policy, shell providers, terminal providers, and Web presentation extensible through dsh plugins.
