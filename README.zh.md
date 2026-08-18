# @shuind/dsh-codex

[English](README.md) | 中文

面向不适配 DSH 原生接口的 GPT 模型，提供一个极简的 Codex harness。它保留 DSH 的运行时、profile、服务和插件生态，只把模型看到的提示词与核心工具切换为紧凑的 Codex 协议；现有 DSH 插件仍可继续使用，本包只替换模型面向的这一层。

## DSH 兼容性

本包是模型面向的兼容层，不是另一套运行时。会话、服务、profile 组合、provider 和插件生命周期仍由 DSH 管理。把它安装到现有 DSH profile 后，其他 DSH 插件仍可按原方式组合使用。

## 安装、启用和选择

这三件事是分开的：

1. 把插件安装到 Web 使用的 profile：

   ```sh
   dsh plugin --profile web add @shuind/dsh-codex
   ```

   本包仍是标准 DSH bundle，因此会显示在插件列表中；它的 DSH 依赖是 optional peer，不会因为本包产生 peer warning。

2. 启用插件：启动或重启该 profile。bundle 会在 `$DSH_HOME/.agent-presets/codex` 不存在时，把随包提供的 `codex` preset 安装到这里；已经存在的用户 preset 不会被覆盖。

3. 新建对话，在模式菜单中选择 `Codex 模式`。插件列表和 Agent preset 列表不是同一个界面。DSH 0.1.0-rc.6 会从 `$DSH_HOME/.agent-presets` 发现用户 preset；更新版 DSH 也可能自己提供 system `codex` preset。

如果之前手动创建的 `$DSH_HOME/.agent-presets/codex` 缺少有效的 `agent.cordis.yml`，请修复或删除该目录后重启 profile。安装器有意保留已有目录，不会强行覆盖。

preset 在会话创建时确定。选择 Codex 只影响新建对话，不会改写已有会话的提示词和工具目录。

## 功能

随包提供的 `codex` preset 会挂载本包，以及 dsh 的 Skill 文件系统和 Skill 工具。本包拥有 Codex 提示词区段，以及以下精确的模型工具名称和描述：

- `exec_command`：在 PTY 中运行命令，返回输出或用于后续交互的 session id。
- `write_stdin`：向已有的统一 exec 会话写入字符并返回最近输出。
- `apply_patch`：通过唯一必填的 `input` 字符串接收完整的自由格式 patch 文本。
- `update_plan`：接收可选 explanation，以及由 `step`／`status` 项组成的必填 plan。

完整 schema 以导出的工具注册为准。前两个工具返回 Codex 兼容的执行字段（`chunk_id`、`wall_time_seconds`、`exit_code`、`session_id`、`original_token_count` 和 `output`），并使用相同的 `Chunk ID`／`Wall time`／`Output` 响应信封。`apply_patch` 返回变更文件列表，并渲染熟悉的 `Success. Updated the following files:` 摘要。`update_plan` 写入持久化的 `todo/write` 事件，并返回 `Plan updated`。

## dsh 组合

`exec_command` 使用 dsh Shell 服务执行管道命令，并使用 dsh Terminal 服务执行可选的 PTY 会话。Codex 的 `shell`、`login`、`yield_time_ms` 和 `max_output_tokens` 参数仍然面向模型，并在服务接口处完成转换。`write_stdin` 通过每个 agent 的统一会话注册表寻址。

`apply_patch` 解析 Codex patch 语言，通过 dsh `fs` 解析目标，执行带版本检查的写入／删除，记录文件系统结果，并通过 `sandboxPolicy` 处理沙箱决策。它不引入第二套文件系统实现。新增、更新、删除和移动都使用 dsh 的标准文件系统错误和持久化观测事件。

`update_plan` 只追加会话中的 `todo/write` 事件，不依赖额外的运行时投影 helper，也不维护第二个 plan 存储；投影和回放仍由 DSH 负责。因此它同时兼容旧版和新版 `dsh-tool-todo`。Codex 包不会挂载 `todo_write`。

## 配置

本包接受 `defaultYieldTimeMs`、`pollYieldTimeMs`、`writeYieldTimeMs` 和 `maxOutputBytes`。它们控制执行时序和保留的输出大小；协议名称、参数名称、描述和结果字段是固定的。使用沙箱文件系统时，必须同时提供对应的 dsh `sandboxPolicy` 服务。

在 DSH 0.1.0-rc.6 中，`apply_patch` 使用普通 dsh 工具定义；它的 `input` 仍然接收完整的 Codex freeform patch，具体 provider 的工具序列化由 DSH 路由负责。

## Bundle 与 preset 组合

本包声明了 `dsh.bundle` patch，但这个 patch 只负责安装 preset 模板，不会把 `@shuind/dsh-codex` 全局挂载，也不会把 Codex 工具加入 standard、code、minimal 或其他 preset。随包的 `presets/codex/agent.cordis.yml` 只包含一个 `codex-tools` 行，因此 Codex 会话只挂载一次提示词和四个核心工具。

如果你自己编写 Codex preset，请把 `@shuind/dsh-codex` 放在该 preset 的 `agent.cordis.yml` 中，不要放到 profile 顶层 patch。这样也不会和新版 DSH 自带的 system Codex preset 重复。

preset 仍把 Skills、文件系统策略、shell provider、terminal provider 和 Web 展示留给 dsh 扩展点；可以通过其他 preset 或对应的 dsh 行扩展，而不改变 Codex 工具协议。

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
- provider 专用的 custom tool 或 grammar 序列化不属于本包；Codex patch 协议通过普通 dsh 工具定义即可使用。
- 本包实现 Codex 核心协议，并刻意通过 dsh 插件保留 Skills、文件系统策略、shell provider、terminal provider 和 Web 展示的可扩展性。
