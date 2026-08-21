# @shuind/dsh-codex-harness

给 DSH 接入 Codex 风格 GPT 模型的插件。

选择 `Codex 模式` 时，本包复用用户在 DSH 中已经配置的模型，只增加 Codex 体验层：

- 检测用户配置的 GPT 系列模型；
- 为未声明能力的 GPT 模型补充可选思考强度（`low`、`medium`、`high`、`xhigh`、`max`）；
- 为未声明能力的 GPT 模型默认补充文本和图片输入；
- 默认优先把 GPT Responses 请求中的 `web_search` 改为远程 hosted tool；失败时回退到保留的 DSH `web_search` function tool；
- 默认优先调用远程 `/responses/compact`，并把返回的原生 compaction item 在后续 Responses 请求中恢复；失败时回退到保留的 DSH 本地 compaction；
- 继续提供 Codex 的 `exec_command`、`write_stdin`、`apply_patch` 和 `update_plan`。

DSH 的通用 `@deepseek-ai/dsh-llm-pi-ai` 继续负责用户配置的 provider、Responses 中转地址、API key、实际模型请求和图片附件传输。本插件不会创建新的 `openai-codex` route，也不会覆盖用户的 endpoint 或凭据。

## 安装

```sh
dsh plugin --profile web add @shuind/dsh-codex-harness@0.1.10
```

重启 Web，创建新会话，在模式菜单中选择 `Codex 模式`。

## 中转站配置

请继续在 DSH 的 Models/`llm-pi-ai` 配置中填写你的 Responses 中转站地址、API key 和模型。例如 provider 下配置 `api: openai-responses`、`baseURL`、`apiKeyEnv`，并在 `models` 中填写中转站实际支持的 GPT 模型 id。Codex 模式不会替换这些配置。

插件只会把缺少 `input` 或 `reasoningEfforts` 的 GPT 模型配置补成图片和思考强度能力；如果用户已经显式配置了这些字段，则保持用户配置不变。不同中转站对 GPT 模型名、图片格式、reasoning 参数和 hosted `web_search`/`responses/compact` 的支持程度不同，远程请求失败时会回退到 DSH 本地实现。

如果之前安装过旧包，先移除旧包，并把旧的 Codex preset 目录备份后再重启：

```sh
dsh plugin --profile web remove @shuind/dsh-codex
mv "$DSH_HOME/.agent-presets/codex" "$DSH_HOME/.agent-presets/codex.old"
```

安装器会把随包提供的 preset 写入 `$DSH_HOME/.agent-presets/codex`，不会覆盖已有目录。升级已有安装时，请先备份并移除旧的 `codex` preset 目录，再重启 Web，让新版本安装包含压缩组的 preset。

## 提供的工具

- `exec_command`
- `write_stdin`
- `apply_patch`
- `update_plan`

工具名称、参数和结果格式兼容 Codex。模型、思考强度、图片和搜索能力通过 DSH 的 LLM、附件和 Web seam 提供，Skills、文件系统策略、Shell、Terminal 等能力仍通过 DSH 的可插拔扩展提供。

## 兼容性

- 兼容包含 `@deepseek-ai/dsh-llm-pi-ai` 和 `@deepseek-ai/dsh-tool-web` 的 DSH `0.1.0-rc.8` 及更新版本。
- 兼容旧版和新版 `dsh-tool-todo`。
- 不依赖 `registerTodosProjection`。
- Codex 工具只在 Codex preset 中挂载，不会污染 standard、code、minimal 或其他 preset。
- preset 在创建会话时确定；已有会话不会自动切换。

## 自定义 preset

如果要组合自己的 Codex preset，把下面这一行放进该 preset 的 `agent.cordis.yml`，不要放进 profile 顶层 patch：

```yaml
- id: codex-tools
  name: '@shuind/dsh-codex-harness'
```

配置项：`defaultYieldTimeMs`、`pollYieldTimeMs`、`writeYieldTimeMs`、`maxOutputBytes`、`hostedWebSearch`、`remoteCompact`。其中后两个默认开启，设为 `false` 可以直接使用保留的 DSH 本地 fallback。provider、Responses 中转地址、API key、模型和模型级能力继续由 DSH 的 `llm-pi-ai` 配置管理。

MIT License
