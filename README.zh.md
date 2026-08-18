# @shuind/dsh-codex

[English](README.md) | 中文

面向 dsh Web 会话的固定 Codex 模型层。它提供 Codex 的提示词约定和四个核心工具协议，同时把 shell 执行、终端、文件系统策略、可持久化会话状态和 Skills 交给 dsh 服务。preset 在创建会话时选择；本包不会替换运行中会话的 preset 或工具目录。

## 功能

`codex` preset 会挂载本包，以及 dsh 的 Skill 文件系统和 Skill 工具。本包拥有 Codex 提示词区段，以及以下精确的模型工具名称和描述：

- `exec_command`：在 PTY 中运行命令，返回输出或用于后续交互的 session id。
- `write_stdin`：向已有的统一 exec 会话写入字符并返回最近输出。
- `apply_patch`：通过唯一必填的 `input` 字符串接收完整的自由格式 patch 文本。
- `update_plan`：接收可选 explanation，以及由 `step`／`status` 项组成的必填 plan。

完整 schema 以导出的工具注册为准。前两个工具返回 Codex 兼容的执行字段（`chunk_id`、`wall_time_seconds`、`exit_code`、`session_id`、`original_token_count` 和 `output`），并使用相同的 `Chunk ID`／`Wall time`／`Output` 响应信封。`apply_patch` 返回变更文件列表，并渲染熟悉的 `Success. Updated the following files:` 摘要。`update_plan` 写入持久化的 `todo/write` 事件，并返回 `Plan updated`。

## dsh 组合

`exec_command` 使用 dsh Shell 服务执行管道命令，并使用 dsh Terminal 服务执行可选的 PTY 会话。Codex 的 `shell`、`login`、`yield_time_ms` 和 `max_output_tokens` 参数仍然面向模型，并在服务接口处完成转换。`write_stdin` 通过每个 agent 的统一会话注册表寻址。

`apply_patch` 解析 Codex patch 语言，通过 dsh `fs` 解析目标，执行带版本检查的写入／删除，记录文件系统结果，并通过 `sandboxPolicy` 处理沙箱决策。它不引入第二套文件系统实现。新增、更新、删除和移动都使用 dsh 的标准文件系统错误和持久化观测事件。

`update_plan` 追加会话中的 `todo/write` 事件，并复用 `dsh-tool-todo` 的 `registerTodosProjection` helper，因此 plan 可回放并由 Web 界面使用，不需要第二个 plan 存储或第二份投影定义。Codex 包不会挂载 `todo_write`。

## 配置

本包接受 `defaultYieldTimeMs`、`pollYieldTimeMs`、`writeYieldTimeMs` 和 `maxOutputBytes`。它们控制执行时序和保留的输出大小；协议名称、参数名称、描述和结果字段是固定的。使用沙箱文件系统时，必须同时提供对应的 dsh `sandboxPolicy` 服务。

OpenAI Responses custom grammar 由路由能力 `supportsOpenAIGrammarTools` 选择。路由声明该能力时，`apply_patch` 会使用 Codex patch grammar 序列化为 OpenAI `custom` grammar 工具；未声明时保留普通工具定义，不假定 provider 支持该能力。

## 作为 profile bundle 安装

本包声明了会挂载 Codex 核心工具的 `dsh.bundle` patch。请把它安装到已经提供 peer dependencies 中所列 dsh 服务的 profile：

```sh
dsh plugin add @shuind/dsh-codex
```

该 bundle 会加入 Codex 工具层。完整的 Codex preset 可以在自己的 profile patch 中另行加入 persona、Skills 与可选的 terminal 行。

## 模型体验

### 提示词和工具目录

#### 模型看到的内容

请求包含 Codex 基础提示词、四个 Codex 核心工具，以及显式挂载的 dsh 扩展（例如 `skill`）。工具名称、描述、参数名称和结果封装与 Codex harness 协议一致；dsh 的实现服务隐藏在工具之后。

#### Token 影响

该 preset 的每次请求都承担 Codex 提示词和核心 schema 的固定前缀成本。Skill 内容和工具结果取决于实际数据。

#### KV Cache 影响

会话挂载组合不变时，固定提示词和工具前缀可以复用。Skill 发现结果和其他显式挂载的扩展会从 Codex 前缀之后改变请求后缀。

### 工具调用和结果

#### 模型看到的内容

命令调用返回 Codex 执行封装，patch 调用返回变更文件封装和摘要文本，plan 调用返回持久化的计划确认。文件系统事件和会话事件会在回放时重建模型可见的效果。

#### Token 影响

工具结果取决于数据：命令输出和变更文件摘要会保留在会话中，而计划确认的大小固定且很小。

#### KV Cache 影响

工具结果追加到会话上下文。文件变更或计划更新通过标准 dsh 会话日志和投影影响后续上下文，而不是依赖隐藏的可变状态。

## 已知限制与暂缓事项

- preset 对一个会话固定不变。选择 `codex` 会影响新会话；在 Web 中改变选中的 preset 不会重写已有会话的提示词或工具。
- PTY 行为取决于挂载的 dsh Terminal provider。出厂的 Windows 组合禁用可选的 bash terminal 行；管道执行仍可通过选中的 shell 服务使用。
- 管道会话不接受非空的 `write_stdin` 输入；交互式输入需要 PTY 会话。
- OpenAI custom grammar 路径要求 provider 路由声明 `supportsOpenAIGrammarTools`；没有该 provider 能力时，普通协议仍然可用。
- 本包实现 Codex 核心协议，并刻意通过 dsh 插件保留 Skills、文件系统策略、shell provider、terminal provider 和 Web 展示的可扩展性。
