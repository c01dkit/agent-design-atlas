---
title: "Dust"
aliases:
  - Dust
  - dust
  - dust-tt
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/dust
  - lang/typescript
  - lang/rust
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/dust-tt/dust
license: MIT
stars: ~1.4k
---

# Dust

> [!abstract] 一句话定位
> Dust 是一个**面向企业工作场景的 AI Agent 构建与运营平台**（不是库），采用 monorepo：`front`（Next.js + TypeScript，承载 agent/assistant 业务逻辑、MCP 工具生态、对话与编排）+ `core`（Rust 执行引擎，承载块式 Dust App 编排、数据源/RAG、tokenizer 与 provider 适配）。其设计目标是让团队"用配置而非写代码"搭出多工具、多数据源、可治理、可观测的工作型 agent，并跑在 Temporal 持久化工作流之上。

## 设计理念 / 顶层架构

Dust 是 **platform 范式**，核心取舍是"把 agent 拆成可配置的服务管道"，而非提供一个 `Agent` 类给开发者继承。理解它必须抓住 `front` 与 `core` 的分工：

- **core（Rust 执行引擎）**：定位是一个**块式 (block-based) 数据流编排器**——"Dust App = 一组带版本哈希的 Block 的有向序列"。`App`（`core/src/app.rs:29`）解析一份 DSL spec（pest 语法），实例化 14 种 `Block`（`core/src/blocks/block.rs:75` 的 `BlockType` 枚举：`Input/Data/DataSource/Code/LLM/Chat/Map/Reduce/Search/Curl/Browser/While/End/Database…`），然后 `App::run`（`core/src/app.rs:305`）按拓扑顺序执行，块之间通过 `Env.state`（`core/src/blocks/block.rs:41`）传值、用 Tera 模板 `${BLOCK.key}` 引用上游输出。core 还独占了**性能/隔离敏感的能力**：data_sources + Qdrant 向量检索（`core/src/data_sources/`）、tokenizer（tiktoken / sentencepiece，`core/src/providers/llm.rs:33`）、以及历史上的多 LLM provider 适配（`core/src/providers/{openai,anthropic,mistral,...}.rs`）。core 编译为多个二进制服务（`core-api`、`oauth`、`sqlite-worker`，见 `core/Cargo.toml`），front 通过 HTTP（`CoreAPI`，`front/types/core/core_api.ts:490` `createRun` / `:532` `createRunStream`）调用它。

- **front（TypeScript 业务层 / Web 应用）**：定位是**用户态的一切**——agent 配置、对话、工具编排、权限治理、可观测。这里有一个关键的架构演进：**真正的"agent 推理循环"已从 core 的 Dust App 上移到 front 的 Temporal 工作流**。`agentLoopWorkflow`（`front/temporal/agent_loop/workflows.ts:185`）是一个 step 循环（最多 `MAX_STEPS_USE_PER_RUN_LIMIT` 步）：每步 `runModelAndCreateActions`（调 LLM 决定下一动作）→ 若产出工具调用则 `runToolActivity` 执行 → 回灌结果 → 下一步。LLM 调用本身也在迁移：旧路径经 core 的 `assistant-v2-multi-actions-agent` Dust App（`front/lib/api/assistant/call_llm.ts:48` 的 `runMultiActionsAgent`，注释明说是"临时 wrapper，待 direct LLM router 就绪后移除"），新路径是 front 原生的 LLM router `getLLM`（`front/lib/api/llm/index.ts:50`，直连 Anthropic/OpenAI/Google/Mistral/xAI/Fireworks 客户端）。**工具 = MCP**：所有 agent 能力（含内置和第三方集成）统一抽象为 MCP server（`front/lib/actions/mcp_internal_actions/servers/index.ts` 注册了 60+ 个：notion/github/salesforce/gmail/jira/run_agent…）。

简言之：**core = 引擎（块编排 + RAG + tokenize + 旧 provider）；front = 大脑与外壳（agent loop on Temporal + MCP 工具 + 配置/治理/可观测）**，二者通过 CoreAPI HTTP 边界解耦。

平台用法（取自 README——它本身不提供 hello-world 代码，而是指向托管平台与文档）：

```text
# Dust 是平台，不是 pip/npm 库。典型用法是：
# 1. 在 dust.tt 创建 workspace，连接数据源 (Notion/Drive/Slack/GitHub...)
# 2. 在 Agent Builder 中配置一个 agent：选模型 + 挂工具(MCP server) + 挂数据源 + 写指令
# 3. 通过 Web/Slack/API 与 agent 对话；agent loop 在后台 Temporal 工作流中执行
# 参考: https://docs.dust.tt  (user guides and developer platform)
#
# 本地自托管: docker-compose.yml 启动 front(Next.js) + core(Rust) + Postgres + Qdrant + Elasticsearch
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **step 式 multi-actions 循环**（非经典 ReAct 文本）：Temporal 工作流逐步执行"调模型选动作 → 执行工具 → 回灌"，每步一次 LLM 调用，最多 `MAX_STEPS_USE_PER_RUN_LIMIT` 步；core 侧另有块式 App 顺序执行引擎 | `front/temporal/agent_loop/workflows.ts:185` (`agentLoopWorkflow`), `:243` (step 循环), `front/temporal/agent_loop/lib/run_model.ts:117` (`runModel`); core 引擎 `core/src/app.rs:305` (`App::run`) |
| [[planning\|规划/任务分解]] | 无独立 planner 模块；规划交给 LLM 自身在 step 循环中逐步决定。提供 `plan_mode` MCP server（让 agent 进入"先出计划"模式）与 `run_agent` 委派子任务 | `front/lib/api/assistant/plan_mode.ts`, `front/lib/api/actions/servers/plan_mode/`, `front/lib/api/actions/servers/run_agent/` |
| [[memory\|记忆(短/长/向量)]] | 短期=对话消息（Postgres 持久）+ 自动 compaction 摘要；长期=`agent_memory` MCP server（`AgentMemoryResource`）；向量记忆=core 的 data_sources + Qdrant（用于 RAG 而非 agent 自记忆） | `front/lib/api/actions/servers/agent_memory/`, `front/lib/resources/agent_memory_resource.ts`; 向量 `core/src/data_sources/qdrant.rs`, `core/src/data_sources/data_source.rs` |
| [[tool-use\|工具调用]] | **统一为 MCP**：内置工具与第三方集成都实现为 MCP server，原生 function calling；工具规格 `buildToolSpecification`，执行 `mcp_execution.ts`；60+ 内置 server 在 index 注册 | `front/lib/actions/mcp.ts`, `front/lib/actions/mcp_execution.ts`, `front/lib/actions/mcp_actions.ts`, `front/lib/actions/mcp_internal_actions/servers/index.ts` |
| [[model-abstraction\|模型抽象]] | 两层：**新** front 原生 LLM router `getLLM` 按 modelId 路由到各 provider 客户端（Anthropic/OpenAI/Google/Mistral/xAI/Fireworks/Noop）；**旧** core 的 `LLM` trait + provider 实现（迁移中） | `front/lib/api/llm/index.ts:50` (`getLLM`), `front/lib/api/llm/clients/*`; core `core/src/providers/llm.rs:217` (`trait LLM`), `:228` (`generate`), `core/src/providers/provider.rs` |
| [[multi-agent-orchestration\|多智能体编排]] | `run_agent` MCP server 实现"agent as tool"：两种模式 `run-agent`（子 agent 在后台子对话执行并回传结果）与 `handoff`（子 agent 直接接管对话）；可向子 agent 转发文件/toolset | `front/lib/api/actions/servers/run_agent/metadata.ts:18` (executionMode), `:106` (`RUN_AGENT_SERVER`), `front/lib/api/actions/servers/run_agent/conversation.ts` |
| [[context-engineering\|上下文工程]] | system prompt 由 `constructPromptMultiActions` 组装并注入 memory/toolsets/user/workspace 上下文；超长时 `compactionWorkflow` 用专门 prompt 把历史摘要为 compaction 消息，保留最近若干轮交互 | `front/lib/api/assistant/generation.ts` (`constructPromptMultiActions`), `front/temporal/agent_loop/lib/compaction.ts:28` (COMPACTION_PROMPT), `front/lib/api/assistant/conversation_rendering` (`PREVIOUS_INTERACTIONS_TO_PRESERVE`) |
| [[skills-plugins\|技能/插件]] | **Skills**=可复用的能力包（指令+数据源+工具集），挂到 agent 上；运行时 `getSkillServers` 把 skill 暴露为 MCP server（如 `skill_knowledge_file_system`），并把"已装备 skills"渲染进用户消息 | `front/lib/resources/skill/skill_resource.ts`, `front/lib/api/assistant/skill_actions.ts:22` (`getSkillServers`), `front/lib/api/assistant/skills_rendering.ts` |
| [[observability-eval\|可观测/评估]] | 多层：Langfuse LLM trace（`@langfuse/tracing` + `front/lib/api/llm/traces/`）、OpenTelemetry（Temporal 工作流拦截器 + `core/src/open_telemetry.rs`）、产品级 observability 指标（tool/skill/datasource 用量与延迟，含 Elasticsearch 分析）、用户 feedback | `front/lib/api/llm/traces/buffer.ts`, `front/temporal/agent_loop/workflows.ts:61` (OTel 拦截器), `front/lib/api/assistant/observability/*` (tool_latency/skill_usage/datasource_retrieval…) |
| [[runtime-execution\|运行时/部署]] | **服务化平台**：front=Next.js(Pages Router+SSR)，agent loop 跑在 **Temporal** 持久化工作流(可取消/中断/优雅停止)；core=Rust 多二进制(core-api/oauth/sqlite-worker)；docker-compose 编排 + Postgres/Qdrant/Elasticsearch；工具可在 E2B 沙箱内以非 root 执行 | `front/temporal/agent_loop/worker.ts`, `front/temporal/agent_loop/workflows.ts:202-220` (signal 处理), `core/Cargo.toml` (bins), `docker-compose.yml`, 沙箱规则见 `CODING_RULES.md` [SEC3] |
| [[human-in-the-loop-governance\|人在环/治理]] | 工具按 **stake 等级**（`never_ask`/`low`/`high`，`front/lib/actions/constants.ts:40`）决定是否需审批；需审批时 step 循环中断等待 `validateAction` 用户批准后恢复(`launchAgentLoopWorkflow`)；外加 RBAC、space/group 权限、publishing 限制、WorkOS 审计日志 | `front/lib/api/assistant/conversation/validate_actions.ts:27` (`validateAction`), `front/temporal/agent_loop/workflows.ts:430` (`needsApproval` 中断), `front/lib/actions/constants.ts:45` (`MCPToolStakeLevelType`), `front/lib/api/assistant/permissions.ts` |
| [[state-persistence\|状态/持久化]] | 全量 Postgres(Sequelize ORM + Resource 抽象层)持久化对话/agent/action；Temporal 持久化工作流状态(可断点续跑)；core 侧 Run/Block 结果存于 `stores`(Postgres)，文档/向量存 Qdrant，分析存 Elasticsearch；Redis 做流式事件 | `front/lib/resources/*` (Resource 抽象, 见 CODING_RULES [BACK3]), `core/src/run.rs` (`Run`/`BlockExecution`), `core/src/stores/`, `front/lib/api/assistant/streaming/` (Redis pubsub) |

## 设计权衡与特性

- **平台而非库**：与 [[connectonion\|ConnectOnion]]（"两行起一个 agent"的库）或 LangChain 式 SDK 截然不同——Dust 不暴露给开发者一个 `Agent` 类去 import，而是一整套服务(Next.js + Rust + Temporal + Postgres + Qdrant + Elasticsearch)。强项是企业级：RBAC/审计/数据源连接器/可观测/沙箱治理开箱即用；代价是重，几乎无法"嵌入"到别人的应用里，只能整体部署或用 SaaS。
- **TS/Rust 双语分工的清晰边界**：把"快变的业务逻辑、工具生态、对话/权限"放 TypeScript（迭代快），把"性能/隔离敏感的 tokenize、向量检索、块编排"放 Rust（稳、快），中间用 CoreAPI HTTP 解耦。这是该框架最有借鉴价值的架构决策。
- **正在进行的两处大迁移（看源码必须知道）**：① **agent loop 从 core 的 Dust App 上移到 front 的 Temporal 工作流**——core 的块式引擎正退化为"被调用的 LLM/RAG 执行器"而非 agent 大脑；② **LLM 调用从 core provider 迁到 front 原生 LLM router**（`call_llm.ts:48` 自述是临时 wrapper）。所以"core 是执行引擎、front 是 agent 层"这句话正确，但 agent 的**推理循环**如今在 front，不在 core。
- **一切皆 MCP**：工具调用统一收敛到 MCP 协议（内置 server 也按 MCP 实现），连子 agent (`run_agent`) 和 skills 都暴露为 MCP server。好处是工具/集成/委派/技能用同一套规格、审批、可观测；这是相对少见的"把 MCP 当内部统一总线"的设计。
- **Temporal 作为 agent 运行时**：用持久化工作流跑 agent loop，天然获得断点续跑、可取消/中断/优雅停止(`workflows.ts:202-220` 三种 signal)、HITL 审批暂停后恢复——比纯进程内 while 循环健壮得多，但也把 Temporal 变成硬依赖。
- **强工程规范**：`CODING_RULES.md` 极其详尽（禁 enum、禁参数突变、禁 `as`、禁 N+1、business 层不得返回 HTTP 错误码、沙箱 root 命令必须绝对路径防 PATH 劫持等），可作为大型 agent 平台工程治理的范本。
- **待确认**：① stars 数为约值，需以仓库实际为准；② core 中 provider/LLM 相关代码在迁移期可能与 front 新 router 并存，具体哪些模型走哪条路径依 feature flag 而定（`getFeatureFlags`），随版本变化。

## 关联

- [[component-taxonomy]] · [[multi-agent-orchestration]] · [[single-vs-multi-agent]]
- 同范式(platform)：[[connectonion]] · 源码：`agents-example/dust/`
