---
title: "hcom"
aliases:
  - hcom
  - hook-comm
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/hcom
  - lang/rust
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/aannoo/hcom
license: MIT
stars: <未取得（gh 不可用），约百级>
---

# hcom

> [!abstract] 一句话定位
> "Hook your coding agents together"——一个单文件 Rust CLI，通过给各家编码 agent（Claude Code / Gemini CLI / Codex / OpenCode / Kilo / Pi / Antigravity / Cursor / Kimi / Copilot）挂 hooks，让它们能跨终端**互相发消息、观察彼此屏幕/转录、订阅事件并互相 spawn/fork/kill**，本身不托管模型、无后台常驻服务，只用一个本地 SQLite 库当消息总线。

## 设计理念 / 顶层架构

hcom 不是"agent 框架"——它**不跑推理循环、不抽象模型、不管工具调用**，而是一个**寄生在已有编码 CLI 之上的 agent 间通信/编排侧信道（side-channel）**。核心信条与取舍：

- **单 Rust 二进制，零后台服务**（`Cargo.toml:1`，`src/main.rs:1`）。在 agent 命令前加 `hcom`（如 `hcom claude`）即接入；不用 hcom 时挂上的 hooks 什么都不做（`hooks/common.rs:80` `hook_gate_check`）。
- **数据流：`agent → hooks → db → hooks → other agent`**（README:84）。所有活动落到本地 SQLite，再由 hooks 把消息投递回 agent。消息可在 turn 中途（工具调用之间）注入，或立即唤醒空闲 agent（README:90）。
- **三个松耦合状态面共用一个 DB**（`db/mod.rs:3`）：`instances`（每个 agent 的实时状态/投递游标）、`events`（append-only 历史/消息日志/relay 复制源）、`process_bindings`+`session_bindings`+`notify_endpoints`+`kv`（路由与控制面）。
- **每个 agent 有可查询身份**：name（4 字母 CVCV 词）、status（active/blocked/listening）、inbox、实时终端屏幕、结构化转录、事件日志（README:92）。
- **接入有三档**：① `hcom <tool>` 自动装 hooks（10 个工具，自动投递）；② 任意 AI 工具内跑 `hcom start` 手动接入；③ 任意进程用 `hcom send` 唤醒 agent（README:105）。
- **模块组织**（`src/main.rs:7`）：`hooks/`（每个工具一个 hook 适配器，把 JSON stdin / argv 翻译成 hcom 动作）、`delivery.rs`（PTY 模式经 TCP 注入消息）、`db/`（SQLite 总线）、`commands/`（send/list/events/term/launch/fork/resume/kill/relay/run…）、`launcher.rs`+`terminal.rs`+`pty/`（spawn 真实终端/PTY）、`relay/`（MQTT 跨设备）、`tui/`（ratatui 看板）、`transcript/`（解析各家转录格式）、`integration_spec.rs`（每个工具的集成事实集中表）。

最小示例（取自 README，注意 hcom 是 shell 命令而非库 API）：

```bash
# 终端 1：启动一个挂了 hcom 的 Claude Code
hcom claude

# 终端 2：启动一个 Codex
hcom codex

# 然后在任一终端用自然语言提示，agent 自己会调用 hcom CLI 协作：
#   "ask the other agent their favorite cake"
#   "spawn 3x gemini, split work, collect results"
#   "fork yourself to investigate the bug and report back"

# 打开 TUI 看板
hcom

# 任意 shell / 脚本也能直接往 agent 发消息
hcom send -b @luna -- hey
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | N/A——hcom 不跑推理循环。推理完全留给被挂载的底层 agent（Claude/Gemini/...）；hcom 只是它们之间的通信侧信道 | `src/main.rs:1` (模块定位说明) |
| [[planning\|规划/任务分解]] | N/A（内核无 planner）。任务拆分靠人/agent 自己；仅提供 `hcom run <script>` 跑预置多 agent 工作流脚本（debate/confess/fatcow）来编排协作 | `commands/run.rs`, README:356 |
| [[memory\|记忆(短/长/向量)]] | 无向量/语义记忆。"记忆"=可查询的历史：append-only `events` 表 + `kv` 控制面，agent 经 `transcript`/`events` 命令回读彼此对话与历史 | `db/mod.rs:180` (events 表), `db/kv.rs`, `commands/transcript.rs` |
| [[tool-use\|工具调用]] | 不抽象 LLM 工具调用；hcom 本身是 agent 通过 shell 调用的"工具"。bootstrap primer（~700 token）教 agent `hcom send/list/events/term/...` 用法；安全命令可免审批 | `bootstrap.rs:34` (UNIVERSAL primer), `hooks/common.rs:51` (`SAFE_HCOM_COMMANDS`) |
| [[model-abstraction\|模型抽象]] | N/A——不接 LLM、不托管 key、不路由 provider。模型由底层 CLI 自管 | — |
| [[multi-agent-orchestration\|多智能体编排]] | **核心**。①消息：`hcom send @name(s) [--intent request\|inform\|ack] [--reply-to] [--thread]`，按 @mention 定向或广播，写成 events 行（`commands/send.rs:1`, `messages.rs:13` scope 计算）。②投递：Claude 经 PostToolUse hook turn 中途注入、SessionStart/Stop 注入（`hooks/claude.rs:916` `handle_posttooluse`, `:421` `handle_sessionstart`）；PTY 模式经 TCP inject 端口投递（`delivery.rs:1`）。③spawn/fork/resume/kill：`hcom [N] <tool>` 起真实终端或 headless（`commands/launch.rs:1`, `launcher.rs:1`），`hcom f/r/kill`（`commands/fork.rs`, `resume.rs`, `kill.rs`）。④订阅/反应：`hcom events sub <filters>`，订阅存 `kv` 的 `events_sub:` 行，命中可自动 `on_hit_text` 回消息（`db/subscriptions.rs:1`）。⑤碰撞检测默认开：两 agent 30s 内改同一文件双方收通知（README:101） | `commands/send.rs`, `delivery.rs`, `hooks/claude.rs:916`, `commands/launch.rs`, `db/subscriptions.rs` |
| [[context-engineering\|上下文工程]] | bootstrap primer 注入身份+CLI 契约（`bootstrap.rs:34`）；`config` 的 `hints`（追加到每条收到的消息）与 `notes`（启动一次性追加）（README:309）；`hcom bundle prepare` 把事件/文件/转录片段打包成结构化 handoff 上下文（`commands/bundle.rs`, `send.rs:23`） | `bootstrap.rs:34`, `commands/bundle.rs` |
| [[skills-plugins\|技能/插件]] | 随仓库带 Claude Code skill `hcom-agent-messaging`（SKILL.md + references/scripts）与 plugin 清单（`.claude-plugin/plugin.json`）；用户脚本投到 `~/.hcom/scripts/` 自动发现、可覆盖内置（README:366） | `skills/hcom-agent-messaging/SKILL.md`, `plugin/hcom/.claude-plugin/plugin.json`, `commands/run.rs` |
| [[observability-eval\|可观测/评估]] | `hcom` TUI（ratatui）看板看全部 agent；`hcom list` 列活跃 agent；`hcom term [name]` 看/注入某 agent 实时 PTY 屏幕（经 TCP inject 端口 + vt100 解析，`commands/term.rs:1`, `:35`）；`hcom transcript` 读对方结构化转录；`hcom events --wait` 阻塞直到匹配（脚本化）；`hcom status` 诊断 | `tui/mod.rs`, `commands/term.rs:35`, `commands/transcript.rs`, `commands/events.rs`, `commands/status.rs` |
| [[runtime-execution\|运行时/部署]] | 单 Rust 二进制，无常驻服务。被挂 agent 跑在 PTY 包装里（`run_pty`，`src/main.rs:69`；`pty/mod.rs`），暴露 TCP inject/state 端口；spawn 用真实终端模拟器（kitty/wezterm/tmux/zellij/iterm…）或 `--headless` 后台（`terminal.rs`, `integration_spec.rs:82` `BackgroundMode`）。装机：brew / curl installer / `pip\|uv` | `src/main.rs:69` (`run_pty`), `pty/mod.rs`, `terminal.rs`, `launcher.rs` |
| [[human-in-the-loop-governance\|人在环/治理]] | 人始终在环：每个 agent 跑在可见、可滚动、可打断的真实终端。安全命令白名单免审批、危险命令（stop/kill/run/reset）需显式批准（`hooks/common.rs:51`）。relay 跨设备为"全有或全无"信任域：enroll 即等于给该设备 shell 权限，无分级角色/只读 peer（README:147,165） | `hooks/common.rs:51`, README:145 (relay security model) |
| [[state-persistence\|状态/持久化]] | 全部状态在单个 SQLite（WAL 模式，`db/mod.rs:106`），路径 `~/.hcom/hcom.db`（可经 `HCOM_DIR` 按项目隔离）。schema 版本化+迁移（`db/mod.rs:39`, `:41`）。`events` append-only 同时是 relay 复制源。session/process binding 表把 OS 进程/会话映射到稳定 agent 身份；reset 会归档替换 DB 文件，长连接经 inode 检测重连（`db/mod.rs:123`） | `db/mod.rs:39`, `:106`, `:180`, `db/sessions.rs`, `db/instances.rs` |

## 设计权衡与特性

- **"寄生侧信道" vs "agent 框架"**：与 [[connectonion]]、[[autogen]]、[[crewai]] 等"自己跑 agent"的框架根本不同——hcom **不拥有 agent**，只把现成的编码 CLI 用 hooks 连起来。卖点是"without changing how you use them"：你照常用 Claude/Gemini，只是多了跨终端协作能力。
- **跨工具异构编排是真正差异点**：支持把不同家 AI CLI 当彼此的 subagent（"run different AI CLIs as each other's subagents"，README:11）。10 个工具的接入差异被收敛进 `integration_spec.rs` 的 per-tool 规格表（hook 调用方式、PTY 默认、背景模式、初始 prompt 形态、resume 参数形状各不相同），但行为实现仍分散在各 `hooks/<tool>.rs`（spec 自己也注明它只是配置面，不是"一文件加一工具"，`integration_spec.rs:8`）。
- **消息投递的"mid-turn 注入"很巧**：对 Claude 用 PostToolUse hook 在工具调用之间塞 `additionalContext`（`hooks/claude.rs:916`），让消息在 agent 正在干活时就到达，而不是等它空闲；PTY 模式则直接往终端 TCP inject 端口写字节（`delivery.rs`, `commands/term.rs:35`）。bootstrap 还故意教 agent "end your turn to receive" 以免它傻等 `sleep`（`bootstrap.rs:103`）。
- **observe = 直接读终端**：`hcom term` 通过 vt100 解析对方 PTY 屏幕做"观察"，配合 transcript/events 让 agent 能真正"看见"彼此在做什么，而不只是收消息。
- **relay 跨设备的诚实安全模型**：MQTT broker + 共享 PSK XChaCha20-Poly1305 端到端加密、replay guard（`Cargo.toml:44` rumqttc/chacha20poly1305；README:148）。但作者明确写出局限：无前向保密、无 per-device 归属、enroll 即全权限、token 无过期无吊销（README:161）——是少见的把威胁模型讲透的设计。
- **待确认/坑**：① stars 未能取得（gh 在本环境不可用），需另行确认；② 强依赖 Unix（`db/mod.rs:67` 用 `std::os::unix::fs::MetadataExt`、`launcher.rs:10` `PermissionsExt`），Windows 仅经 WSL 支持（README:28）；③ 大量逻辑分散在超长文件（`hooks/gemini.rs` 3527 行、`hooks/claude.rs` 3513 行、`commands/resume.rs` 3195 行），远超常规 800 行上限——每加一个工具需要碰多个模块。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi / 跨工具编排与协作)：[[autogen]] · [[crewai]] · [[agency-swarm]] · 源码：`agents-example/hcom/`
