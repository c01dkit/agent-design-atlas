---
title: "SwarmClaw"
aliases:
  - SwarmClaw
  - swarmclaw
  - "@swarmclawai/swarmclaw"
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/swarmclaw
  - lang/typescript
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/swarmclawai/swarmclaw
license: MIT
stars: ~未知（新仓库，npm 包 @swarmclawai/swarmclaw v1.9.37）
---

# SwarmClaw

> [!abstract] 一句话定位
> 一个**自托管的多 agent 编排运行时**：在一个 Next.js + Electron 应用里跑自治 agent 群（swarm），用 heartbeats（心跳自驱）、schedules（定时）、delegation（委派给 Claude Code/Codex/Gemini CLI 等外部 harness）、durable memory（分层持久记忆）与 runtime skills 把"agent 仪表盘 + 编排平台 + 桌面/CLI 本地 base"合为一体——定位为 Claude Code 与 LangChain 的实用替代品。

## 设计理念 / 顶层架构

SwarmClaw 的核心范式是 **multi-agent + platform**：它不是一个"写代码 import 的库"，而是一个**完整的产品运行时**——单一 npm 包 `@swarmclawai/swarmclaw`，既可 `npm i -g` 当 CLI 起服务，也可作为 Electron 桌面 app，内核是一个 Next.js 16 应用。设计取舍：

- **不是真 monorepo**：根目录只有一个 `package.json`（`package.json:2`），所有代码在 `src/` 下，按"功能域"切分而非按类型。重活全在 `src/lib/server/`（服务端运行时），UI 在 `src/app`/`src/components`/`src/views`/`src/features`。
- **单 LLM 内核 + LangGraph ReAct**：每个 agent 一次对话回合由 LangGraph 的 `createReactAgent`（`@langchain/langgraph/prebuilt`）驱动，配 `MemorySaver` checkpointer，外面再套一层自研的"迭代/续跑"循环。模型抽象只特判 Anthropic，其余全部走 OpenAI 兼容（`build-llm.ts`）。
- **自治靠 heartbeat 而非一次性 run**：agent 不是"调一次就结束"。一个 60s 心跳调度器（`heartbeat-service.ts`）周期性唤醒 session，注入 main-loop 状态（goal/plan/review/timeline），让 agent 自我推进长任务（Missions）。schedules 与 watch-jobs 也挂在同一调度链上。
- **委派 = 多后端编排**：`delegate` 工具把子任务派发给外部 coding agent CLI（claude/codex/opencode/gemini/copilot/droid/cursor/qwen），用子进程跑，并跨 OpenClaw gateway 调用——这是它"跨 OpenClaw/Claude Code/Codex/Gemini CLI"的实处。
- **单一入队点**：所有回合（用户聊天、连接器、心跳、调度）都必须经 `enqueueSessionRun()`（`runtime/session-run-manager.ts:67`）——做去重、collect-mode 合并、心跳抢占与每 session 单回合执行锁。
- **存储 = better-sqlite3 + 集合表**：本地 SQLite（`storage.ts:90`），每个集合一张 `(id, data)` 表，load-modify-save，自带"批量删除防误删"守卫。
- **术语**：代码已从 "plugins" 全面迁移到 **"extensions"**（CLAUDE.md），技能体系叫 **skills**（含 runtime skills 与 conversation→skill 学习）。

最小示例（取自 README，安装即起运行时，无 import 式 API）：

```bash
# 全局安装并启动自托管运行时（默认 http://localhost:3456）
npm i -g @swarmclawai/swarmclaw
swarmclaw            # 起 Next.js 服务，浏览器里创建 agent / 配 provider / 编排 swarm

# 或从仓库一键启动（装依赖 + 准备本地 config/runtime state + 启动）
git clone https://github.com/swarmclawai/swarmclaw.git
cd swarmclaw && nvm use && npm run quickstart
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | LangGraph `createReactAgent` + `MemorySaver` 跑单回合 ReAct（`streamEvents` v2 流式），外层自研 for 迭代循环做"续跑/早停/工具频控/idle watchdog"，受 `recursionLimit` 约束 | `chat-execution/stream-agent-chat.ts:910` (`createReactAgent`), `:953` (迭代循环), `:979` (`streamEvents`) |
| [[planning\|规划/任务分解]] | main-agent-loop 维护持久 `MainLoopState`（goal/goalContract/planSteps/completedPlanSteps/currentPlanStep/reviewNote），心跳每次回灌；plan/review 由 LLM 经 meta 标记产出后解析（`parseMainLoopPlan`/`parseMainLoopReview`） | `agents/main-agent-loop.ts:34` (`MainLoopState`), `agents/autonomy-contract.ts` (`parseMainLoopPlan/Review`) |
| [[memory\|记忆(短/长/向量)]] | 三层：working / durable / archive（按 category+metadata 分层）；SQLite memory-db + embeddings 向量检索 + MMR 重排；"dream cycles" 在 idle 时做记忆巩固/去重（supersededBy 标记） | `memory/memory-tiers.ts:3`, `memory/memory-db.ts`, `embeddings.ts`+`mmr.ts`, `memory/dream-service.ts`, `memory/memory-consolidation.ts` |
| [[tool-use\|工具调用]] | 工具 = LangChain `tool()` + zod schema，运行时按 session 策略动态装配（`buildSessionTools`）；含 shell/file/web/email/image/delegate/subagent/memory/schedule/task 等；`normalize-tool-args` 容错；终端工具（memory_write/durable_wait/context_compaction）强制结束回合 | `session-tools/index.ts` (`buildSessionTools`), `session-tools/skill-runtime.ts:2` (`tool()`), `chat-execution/chat-streaming-utils.ts` (`resolveSuccessfulTerminalToolBoundary`) |
| [[model-abstraction\|模型抽象]] | `buildChatModel`：Anthropic 用 `ChatAnthropic`，其余 23+ provider 全部 OpenAI 兼容（patch baseURL→`streamOpenAiChat`/`ChatOpenAI`）；含 DeepSeek reasoning bridge、Ollama local/cloud、OpenClaw endpoint、gateway profile | `build-llm.ts:67` (`buildChatModel`), `providers/openai.ts` (`streamOpenAiChat`), `providers/index.ts` (provider 注册表) |
| [[multi-agent-orchestration\|多智能体编排]] | ①进程内 subagent：`spawnSubagent` 派生隔离子 session，带 delegationDepth 限制（`DEFAULT_DELEGATION_MAX_DEPTH`）；②外部委派：`delegate` 工具 spawn claude/codex/opencode/gemini/copilot/droid/cursor/qwen CLI 子进程，回退链 + resume id；③跨 OpenClaw gateway 路由；org-chart/team 可视化编排 | `agents/subagent-runtime.ts:217` (`spawnSubagent`), `session-tools/delegate.ts:28` (后端回退链), `agents/delegation-jobs.ts:50`, `openclaw/gateway.ts:110` |
| [[context-engineering\|上下文工程]] | prompt 由众多 section 组合（identity/planning/thinking/runtime/workspace/agent-awareness/situational/project/credential/delegation/run-context…）；自动 compaction（context 阈值触发，可配 generation preference）；内部 meta 标记用"平衡括号+zod"剥离不外泄 | `chat-execution/prompt-sections.ts`, `chat-execution/prompt-builder.ts`, `chat-execution/compaction-generation-preference.ts`, `agents/main-agent-loop.ts:22` (`stripMainLoopMeta`) |
| [[skills-plugins\|技能/插件]] | Skills：YAML frontmatter 的 SKILL.md，三级发现（runtime-skill-resolver）+ prompt 预算（skill-prompt-budget）+ 资格过滤（skill-eligibility）；**conversation→skill 学习**：从成功回合提炼 learned skill 走审查上线；Extensions（前身 plugins）= 带 hooks 的能力单元；ClawHub 分发（`openclaw skills install swarmclaw`） | `skills/runtime-skill-resolver.ts`, `skills/learned-skills.ts:1`, `server/extensions.ts`, `skills/clawhub-client.ts`, 根 `swarmclaw/SKILL.md` |
| [[observability-eval\|可观测/评估]] | OpenTelemetry OTLP traces（`@opentelemetry/sdk-node`，env 配端点/headers）；自研 `logger`/`execution-log`/`activity-log`/`run-ledger`；usage/cost 计量；`eval/` 做 baseline+environment-plan 评估；autonomy supervisor 反思每次自治 run | `observability/otel-config.ts:1`, `logger.ts`+`execution-log.ts`, `runtime/run-ledger.ts`, `eval/baseline.test.ts`, `autonomy/supervisor-reflection.ts` |
| [[runtime-execution\|运行时/部署]] | Next.js 16 standalone server（`npm i -g`→CLI 起服务，端口 3456）；Electron 桌面 app 把 standalone server 当子进程 spawn（`ELECTRON_RUN_AS_NODE`）；心跳 60s tick + 调度器 60s tick；Docker / fly / railway / render 部署配置齐全；sandbox 浏览器走独立 Docker 镜像 | `bin/swarmclaw.js`, `electron/main.ts` (CLAUDE.md 述), `runtime/heartbeat-service.ts:592` (`tickHeartbeats`), `runtime/scheduler.ts:51` (`startScheduler`), `Dockerfile`+`fly.toml` |
| [[human-in-the-loop-governance\|人在环/治理]] | 审批门：`requestApproval`/`submitDecision`，危险工具走 `durable_wait` 终端边界挂起等人审，审批后 wake 续跑；E-Stop 急停（estop）；learned-skill 上线需人工审查；capability/tool 策略与权限预设（OpenClaw permission-presets）；mission budget 上限（USD/token/turn/wallclock） | `approvals.ts:83` (`requestApproval`), `:129` (`submitDecision`), `runtime/estop.ts`, `openclaw/permission-presets.ts`, `missions/mission-service.ts` (预算) |
| [[state-persistence\|状态/持久化]] | better-sqlite3 本地库，每集合一张 `(id,data)` 表，load-modify-save + 批量删除守卫（`saveCollection`）；session_messages 独立表（瘦身 transcript）；`storage-normalization` 加载时迁移旧记录补默认值；LangGraph checkpoint 持久化；main-loop / delegation / queue / run-ledger 各自 repository；模块级状态用 `hmrSingleton` 抗 Next.js HMR | `storage.ts:90` (`new Database`), `:290` (`saveCollection` 守卫), `:218` (session_messages), `storage-normalization.ts`, `langgraph-checkpoint.ts`, `shared-utils.ts` (`hmrSingleton`) |

## 设计权衡与特性

- **"运行时/平台"而非"库"**：与 [[connectonion\|ConnectOnion]]（Python 库，`Agent(...)` 起步）或 [[swarm\|Swarm]]（极简内核）不同，SwarmClaw 没有"两行起 agent"的 API——它的对外形态是**一个跑起来的产品**（Web 仪表盘 + 桌面 app + CLI server）。强项是开箱即用的多 agent 仪表盘、org-chart、连接器（Slack/Discord/Telegram/WhatsApp/Email/Matrix…）；代价是依赖极重（LangGraph、Electron、better-sqlite3、playwright、baileys、discord.js、googleapis 等几十个），不可嵌入到别的程序里当库用。
- **心跳驱动的自治** 是最大差异点：agent 用周期性 heartbeat + 持久 MainLoopState 自我推进长任务（Missions），配 supervisor 反思与多维预算上限——这是"autonomous swarm"而非"请求-响应 agent"的取向。
- **委派到外部 harness** 把闭源/开源 coding CLI（Claude Code/Codex/Gemini CLI/OpenCode/Copilot/Droid/Cursor/Qwen/Goose）当作可编排的 worker，通过子进程 + resume id + 回退链整合；跨 OpenClaw gateway 又能把 agent 暴露/调用为网络节点。它把自己定位成这些 CLI 的"编排 base"。
- **OpenAI 兼容优先的模型层**：除 Anthropic 单独走 LangChain 的 `ChatAnthropic`，其余全部 patch baseURL 复用 `streamOpenAiChat`（CLAUDE.md 明确"don't write a new streaming handler from scratch"），新增 provider 成本极低（注册表 + setup-defaults 两处）。
- **生产工程细节密集**：`hmrSingleton` 抗 HMR、`saveCollection` 防批量误删、内部 meta 标记用"平衡括号 walker + zod"而非裸 regex 剥离、`enqueueSessionRun` 单入口去重/合并/抢占——CLAUDE.md 把这些坑都列为硬规则，工程化程度高。
- **记忆做成系统而非附属**：working/durable/archive 三层 + 向量检索 + MMR + idle 期"dream cycles"巩固去重，并有 temporal-decay 与 memory-graph，是同类里少见的成体系记忆设计。
- **待确认/坑**：①stars 数未知（仓库较新，靠 npm 版本号 1.9.37 推断已迭代多版）；②桌面路径与 `./data` 路径需区分（Electron 写 `SWARMCLAW_HOME`，CLAUDE.md 警告勿从桌面路径写 `./data`）；③重度依赖 Node 22.6+ 与 better-sqlite3 的 ABI（Electron 打包前需 `@electron/rebuild`）。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi + platform)：[[connectonion]] · 源码：`agents-example/swarmclaw/`
