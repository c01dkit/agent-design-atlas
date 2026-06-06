---
title: "OpenClaw"
aliases:
  - OpenClaw
  - openclaw
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/openclaw
  - lang/typescript
  - paradigm/platform
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/openclaw/openclaw
license: MIT
stars: ~10k
---

# OpenClaw

> [!abstract] 一句话定位
> 一个"跑在你自己设备上的个人自治 AI 助手"——以 **本地 Gateway 作为控制平面**，把同一个 agent 接入你已经在用的 20+ 消息渠道（WhatsApp/Telegram/Slack/Discord/Signal/iMessage…），并用 cron 调度、心跳唤醒、standing orders 让它在你不在场时自治运行；内核是一个 provider 无关的 ReAct 式工具循环，外挂记忆、MCP、技能、子 agent 派生、浏览器自动化与沙箱治理。

## 设计理念 / 顶层架构

OpenClaw 的核心范式是 **single-agent 的 ReAct 工具循环**，但它的真正卖点是把这个内核包装成一个 **always-on 的个人助手平台**——所以它本质上是 platform 气质压过 single。设计取舍：

- **Gateway 是控制平面，agent 才是产品**：README 反复强调 "The Gateway is just the control plane — the product is the assistant"。Gateway 是一个常驻 daemon（launchd/systemd），统一管理会话、渠道、工具、事件与调度；模型只在被唤醒时跑一轮。
- **薄 agent-core + 厚 host**：可复用内核在 `packages/agent-core/`（agent loop、harness、compaction、session、messages、tools/session 契约），是纯粹与宿主解耦的层；OpenClaw 自己的内置运行时（embedded runtime）在 `src/agents/embedded-agent-runner/` 里把 provider 流适配、compaction、模型选择、会话接线、沙箱缝合起来。docs/agent-runtime-architecture.md 明确划了这条边界：core 只经 `openclaw/plugin-sdk/*` barrel 调运行时，插件不许 import `src/**`。
- **provider 无关 + 渠道无关的双层抽象**：模型侧 `packages/llm-core`（`Model` 接口 + `StreamFn`）+ `packages/llm-runtime`（按 `model.api` 路由的 provider registry）覆盖 OpenAI/Anthropic/Google/Mistral/Bedrock/Vertex/Copilot 等，`src/llm/providers/` 是具体实现；渠道侧每个 IM 平台是 `extensions/<channel>/` 下的一个插件 extension。
- **monorepo + extension 化一切**：`packages/`（约 20 个可复用包）+ `extensions/`（渠道、记忆、浏览器、provider、媒体生成…全部是可装卸 extension）+ `src/`（gateway/cron/sessions/channels/auto-reply 等宿主逻辑）。npm 包名 `openclaw`，CLI 入口 `openclaw.mjs` → `src/entry.ts`。
- **入口形态**：用户不写代码，而是 `openclaw onboard` 起 Gateway，然后从任意渠道发消息即对话；也可 `openclaw agent --message "..."` 一次性跑。

最小示例（取自 README 的 Quick start）：

```bash
# 1) 安装并以守护进程方式起 Gateway（控制平面常驻）
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw gateway status

# 2) 从命令行直接和助手对话，可把结果投递回任意已连接渠道
openclaw agent --message "Ship checklist" --thinking high

# 3) 或向某个渠道目标发消息（助手在该渠道里应答）
openclaw message send --target +1234567890 --message "Hello from OpenClaw"

# 4) 设一个定时唤醒（Gateway 内的 cron，到点把 agent 叫醒并投递回 chat）
openclaw cron create "2026-02-01T16:00:00Z" \
  --name "Reminder" --session main \
  --system-event "Reminder: check the cron docs draft" \
  --wake now --delete-after-run
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 式双层 while 循环：内层 LLM→若有 toolCall 则执行(顺序/并行)→结果回灌→重复；外层处理 steering（运行中插话）与 follow-up 消息；`stopReason`/`shouldStopAfterTurn`/`terminate` 决定终止 | `packages/agent-core/src/agent-loop.ts:213` (`runLoop`), `:251` (`streamAssistantResponse`), `:447` (`executeToolCalls`) |
| [[planning\|规划/任务分解]] | 内核无显式 planner，规划交给 LLM 自身；提供 `thinking` 级别（`--thinking high`、`/think <level>`）与 reasoning 透传；自治侧靠 standing orders（写在 AGENTS.md 里的"程序"边界）而非结构化计划 | `docs/automation/standing-orders.md`, 思考级别透传见 `agent-loop.ts:300` (`prepareNextTurn` 改 `reasoning`) |
| [[memory\|记忆(短/长/向量)]] | 短期=session JSONL transcript（`harness/session/jsonl-storage.ts`）；中期=会话压缩摘要（compaction）；长期=`/new`·`/reset` 时把会话存为带日期 slug 的 markdown 记忆文件（session-memory hook）+ 工作区根 memory 文件；向量记忆=可选 `memory-lancedb` 插件（`memory_store`/`memory_recall`/`memory_forget`，LanceDB 向量+自动召回） | `src/hooks/bundled/session-memory/handler.ts:1`, `src/memory/root-memory-files.ts`, `extensions/memory-lancedb/README.md:16` |
| [[tool-use\|工具调用]] | 原生 function calling；`AgentTool` 契约带 `execute(id,args,signal,onPartial)`，支持 `executionMode: "sequential"` 与 `prepareArguments`；内置编码工具 bash/read/write/edit/process + web_search/web_fetch + browser/canvas/cron/nodes/sessions_* 等；参数经 `validateToolArguments` 校验，`beforeToolCall`/`afterToolCall` 钩子可拦截/改写 | `agent-loop.ts:665` (`prepareToolCall`), `:731` (`executePreparedToolCall`), `src/agents/agent-tools*.ts`, `src/tools/descriptors.ts` |
| [[model-abstraction\|模型抽象]] | 两层：`packages/llm-core` 定义统一 `Model` 接口(api/provider/cost/contextWindow/thinkingLevelMap) 与 `StreamFn`；`packages/llm-runtime/api-registry.ts` 按 `model.api` 注册/路由 provider 适配器；`src/llm/providers/` 实现 OpenAI(completions/responses/chatgpt)/Anthropic/Google(+Vertex)/Mistral/Azure/Copilot 等；OAuth 订阅(ChatGPT/Codex)走 `src/llm/oauth.ts`，支持 auth profile 轮换与 failover | `packages/llm-core/src/types.ts:574` (`Model`), `:633` (`StreamFn`), `packages/llm-runtime/src/api-registry.ts:50`, `src/llm/model-registry.ts:5` |
| [[multi-agent-orchestration\|多智能体编排]] | 两条路：①**多 agent 路由**——按渠道/账号/peer 把入站消息路由到隔离 agent（独立 workspace + per-agent session）；②**子 agent 派生**——`sessions_spawn` 工具派生 subagent / ACP 外部 CLI agent，受 `maxSpawnDepth`、`maxChildren`、`requireAgentId` 策略约束；`sessions_list`/`sessions_history`/`sessions_send` 做跨会话协作 | `src/agents/acp-spawn.ts:1` (spawn/binding/limits), `src/agents/agent-tools.policy.ts:70`, `src/routing/session-key.ts` |
| [[context-engineering\|上下文工程]] | system prompt 由 harness 组装（注入 AGENTS.md/工作区文件 + 可见 skills 元数据 XML 块）；`transformContext`/`convertToLlm` 在每轮把 AgentMessage[] 转 LLM Message[]；超窗自动 compaction（摘要旧消息、保留 file-ops 清单 readFiles/modifiedFiles），并有 compaction-safeguard / context-pruning 运行时 hook | `packages/agent-core/src/harness/system-prompt.ts:5`, `harness/compaction/compaction.ts:1`, `src/agents/agent-hooks/`, `agent-loop.ts:355` (`transformContext`) |
| [[skills-plugins\|技能/插件]] | **Skills**=带 YAML frontmatter 的 `SKILL.md`，递归发现、按 description 由模型自主选用、`disable-model-invocation` 可隐藏，**兼容 Claude-Code 风格**；**Plugins/Extensions**=`extensions/*` 包，经 manifest(`openclaw` 字段声明 extensions/skills/prompts/themes) 装卸；**Hooks**=生命周期钩子（bundled: session-memory、compaction-notifier、boot-md…） | `packages/agent-core/src/harness/skills.ts:57` (`loadSkills`), `:46` (`formatSkillInvocation`), `src/plugins/`, `src/hooks/bundled/` |
| [[observability-eval\|可观测/评估]] | agent loop 发射结构化事件流（agent_start/turn_start/message_*/tool_execution_*/turn_end/agent_end）供 UI/日志消费；每条消息带 `usage`(token+cost)；`/usage`、`/trace on`、`/verbose` chat 命令；cron run-log（JSONL）记录每次定时运行；trajectory/transcripts 子系统留存轨迹；qa/ 下有 e2e 与 QA lab extension | `agent-loop.ts:25` (`AgentEventSink`)+各 `emit({type:...})`, `src/cron/run-log-jsonl.ts`, `src/trajectory/`, `src/transcripts/` |
| [[runtime-execution\|运行时/部署]] | 常驻 **Gateway daemon**（launchd/systemd user service）作为单一控制平面；CLI `openclaw onboard/gateway/agent/message/cron/...`；Node 24(推荐)/22.19+；Docker / docker-compose / fly.toml / render.yaml 多种部署；companion apps（Windows Hub、macOS menu bar、iOS/Android node）；built-in runtime id=`openclaw`，`auto` 可切换到插件 harness | `openclaw.mjs`, `src/entry.ts`, `src/gateway/`, `src/daemon/`, `Dockerfile`, `docs/agent-runtime-architecture.md:42` |
| [[human-in-the-loop-governance\|人在环/治理]] | **DM pairing**：未知发信人默认收到配对码、消息不被处理，`openclaw pairing approve` 后加入 allowlist（`dmPolicy`/`allowFrom`）；**沙箱**：`agents.defaults.sandbox.mode:"non-main"` 让非 main 会话跑在 Docker/SSH/OpenShell 沙箱，默认 deny browser/canvas/nodes/cron/discord/gateway；`beforeToolCall` 钩子+ACP approval-classifier 对危险工具审批；`openclaw doctor` 体检风险配置 | `README.md:145` (DM access), `src/acp/approval-classifier.ts:27`, `src/security/`（audit-*），`agent-loop.ts:684` (`beforeToolCall` block) |
| [[state-persistence\|状态/持久化]] | 会话 transcript 持久化为 JSONL（`harness/session/jsonl-storage.ts`，另有 memory-storage 内存实现）；cron 作业/状态/run 历史持久化进 **共享 SQLite state DB**（旧 jobs.json 经 `doctor --fix` 迁移）；会话/绑定/记忆文件落在 state dir(`~/.openclaw/`)；session binding service 维护渠道↔会话映射 | `packages/agent-core/src/harness/session/jsonl-storage.ts`, `docs/automation/cron-jobs.md:43` (SQLite), `src/config/sessions/store.ts`, `src/infra/outbound/session-binding-service.ts` |

## 设计权衡与特性

- **"渠道即接口" 是核心差异**：与 [[connectonion\|ConnectOnion]]/Swarm 这类"库里写 agent"框架不同，OpenClaw 把交互面整体外移到真实 IM 渠道——你不打开终端，而是在 Telegram/微信里和它说话。代价是巨大的渠道矩阵（20+ extension）与对各平台协议/反垃圾策略的长期维护负担。
- **自治三件套：cron + heartbeat + standing orders**：cron 在 Gateway 内调度并能把输出投递回 chat 或 webhook（`cron-vs-heartbeat.md` 区分定时 vs 心跳唤醒）；standing orders 把"永久操作授权"写进 AGENTS.md 让 agent 在边界内无需逐次 prompt 即自治。这是它"个人自治 agent"定位的落点，而非临时一问一答。
- **薄 core / 厚 host 的清晰边界**：`packages/agent-core` 可被任意宿主复用且不依赖 OpenClaw 具体设施，宿主能力（渠道、沙箱、调度）全在 `src/` 与 `extensions/`，插件只经 plugin-sdk barrel 交互——可维护性强，但 monorepo 体量与抽象层级也很重。
- **provider/渠道双 registry**：模型按 `model.api` 路由、渠道按 extension 装卸，二者都是开放注册表，便于第三方接入新模型或新 IM，且支持 auth profile 轮换 + model failover。
- **安全默认偏保守**：把入站 DM 当作不可信输入（pairing 默认、non-main 会话沙箱、危险工具默认 deny + 审批 + `openclaw doctor` 体检），这是直面"真实消息面"必须付的代价；但 main 会话默认全权在宿主上跑工具——单用户便利与暴露风险的权衡需用户自己把控。
- **MCP 作为客户端一等公民**：经 stdio / http / OAuth 三种 transport 接入远端 MCP server，并把其工具 materialize 进 agent 工具集（`agent-bundle-mcp-*`），同时也能把 OpenClaw 自身工具/渠道 serve 成 MCP（`src/mcp/`）。
- **待确认/坑**：①stars 为粗估（README 未标注，需以仓库实际为准）；②内置 `main` 会话默认无沙箱、工具全权，群组/公开场景务必开 `sandbox.mode:"non-main"`；③渠道矩阵庞大，单个渠道的可用性/稳定性差异较大，需看各 `extensions/<channel>` 与 docs/channels。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(platform+电池/常驻服务)：[[connectonion]] · 源码：`agents-example/openclaw/`
