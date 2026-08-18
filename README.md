# @shuind/dsh-codex-harness

给 DSH 接入 Codex 风格 GPT 模型的轻量插件。

DSH 继续负责会话、文件系统、Shell、Skills 和插件扩展；本包只提供 Codex 的基础提示词与工具协议。

## 安装

```sh
dsh plugin --profile web add @shuind/dsh-codex-harness@0.1.10
```

重启 Web，创建新会话，在模式菜单中选择 `Codex 模式`。

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

工具名称、参数和结果格式兼容 Codex。Skills、文件系统策略、Shell、Terminal 等能力仍通过 DSH 的可插拔扩展提供。

## 兼容性

- 兼容 DSH `0.1.0-rc.6` 及更新版本。
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

配置项：`defaultYieldTimeMs`、`pollYieldTimeMs`、`writeYieldTimeMs`、`maxOutputBytes`。

MIT License
