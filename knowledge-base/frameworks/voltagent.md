---
title: "VoltAgent"
aliases:
  - VoltAgent
  - voltagent
  - "@voltagent/core"
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/voltagent
  - lang/typescript
  - paradigm/general
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/VoltAgent/voltagent
license: MIT
stars: ~3k
---

# VoltAgent

> [!abstract] 一句话定位
> 一个开源 TypeScript **AI Agent 工程平台**：以 `@voltagent/core` 为内核，把 Agent、Tool(Zod)、Memory、RAG、Workflow、Guardrails、Voice、MCP/A2A 都建在 **Vercel AI SDK (`ai@6`)** 之上，**全栈原生基于 OpenTelemetry 做 LLM 可观测**——任何执行都生成 span/trace，配套自托管/云的 VoltOps Console 做实时追踪、评估与运维。卖点是"全代码可控的 agent + 生产级可见性"。

## 设计理念 / 顶层架构

VoltAgent 不自己造推理循环，而是**当 Vercel AI SDK 的"工程化外壳"**：Agent 把 `generateText/streamText/generateObject/streamObject` 包起来，注入 system prompt、tools、memory、guardrails、middleware、subagent、hooks 与 **OpenTelemetry trace context**，对外暴露统一的、可观测的 agent 运行时。设计取舍：

- **建在 AI SDK 之上而非重造**：`model: openai("gpt-4o-mini")` 直接是 AI SDK 的 `LanguageModel`；多步工具循环交给 AI SDK 的 `stopWhen: stepCountIs(maxSteps)`（`packages/core/src/agent/agent.ts:1383`）。VoltAgent 只在外层加 span、guardrail、middleware、memory 持久化。
- **monorepo + 适配器分包**：pnpm/lerna/nx workspace，~40 个包。`packages/core` 是骨架（agent/tool/memory/observability/workflow/mcp/retriever/voice/eval…），storage/vector/sandbox/provider/server 全部拆成独立适配器包（`libsql`/`postgres`/`supabase`/`cloudflare-d1`/`sandbox-e2b`/`sandbox-daytona`/`server-hono`/`server-elysia`/`anthropic-ai`/`google-ai`/`groq-ai`/`voice`/`scorers`/`evals`/`langfuse-exporter`…）。
- **观测是一等公民**：`@voltagent/core` 直接依赖一整套 `@opentelemetry/*`；observability 用 3 个自定义 SpanProcessor（WebSocket 实时、LocalStorage 本地存、LazyRemoteExport→OTLP/VoltOps）把每次 agent/tool/workflow 调用变成可检索的 trace（`packages/core/src/observability/node/volt-agent-observability.ts:124`）。
- **入口 API 双层**：`new Agent({...})` 定义单个 agent；`new VoltAgent({ agents, workflows, server, logger, observability })` 是顶层应用容器，负责注册表、全局 memory/observability、graceful shutdown 与起 HTTP server（`packages/core/src/voltagent.ts:33`）。

最小示例（取自 README，TypeScript）：

```typescript
import { VoltAgent, Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { openai } from "@ai-sdk/openai";
import { weatherTool } from "./tools";

const agent = new Agent({
  name: "my-agent",
  instructions: "A helpful assistant that can check weather",
  model: openai("gpt-4o-mini"),       // 直接是 Vercel AI SDK 的 LanguageModel
  tools: [weatherTool],               // Zod 定义的 createTool
  memory: new Memory({                // 可插拔存储适配器
    storage: new LibSQLMemoryAdapter({ url: "file:./.voltagent/memory.db" }),
  }),
});

// 顶层容器：注册 agent/workflow，起 server，自动接 OpenTelemetry 观测
new VoltAgent({
  agents: { agent },
  server: honoServer(),               // http://localhost:3141，可连 VoltOps Console
  logger: createPinoLogger({ name: "my-agent-app" }),
});
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 不自造循环：委托 Vercel AI SDK 的多步工具循环，`stopWhen: stepCountIs(maxSteps)` 控制步数（默认 maxSteps=5，启用 workspace 时=100）；每步 `onStepFinish` 回灌并写 trace。提供 generateText/streamText/generateObject/streamObject 四种入口 | `agent/agent.ts:1383` (`stepCountIs`), `agent/agent.ts:1081` (`defaultMaxSteps = workspace ? 100 : 5`), `agent/agent.ts:1190/1721/2756/3096` |
| [[planning\|规划/任务分解]] | 内核无强制 planner；规划交给 LLM。独立的 **PlanAgent**（Claude-Code 风格）内建 `write_todos` 规划工具箱 + filesystem + subagent，强制"多步任务先写 todo" | `planagent/plan-agent.ts:45` (PLANNING_SYSTEM_MESSAGE), `planagent/planning/` (`WRITE_TODOS_TOOL_NAME`/`createPlanningToolkit`) |
| [[memory\|记忆(短/长/向量)]] | `Memory` 门面三件套：StorageAdapter(消息/会话/working memory)、VectorAdapter+EmbeddingAdapter(向量语义检索)；`getMessagesWithSemanticSearch` 把最近消息+语义召回拼接；`searchSimilar` 做向量检索；WorkingMemory 做结构化长期记忆 | `memory/index.ts:76` (`class Memory`), `memory/index.ts:321` (`getMessagesWithSemanticSearch`), `memory/index.ts:487` (`searchSimilar`), `memory/index.ts:698` (`getWorkingMemory`) |
| [[tool-use\|工具调用]] | `createTool`/`tool()` 用 Zod schema 定义工具，编译为 AI SDK `Tool`；支持 lifecycle hooks(onStart/onEnd)、`needsApproval`(HITL 审批)、Toolkit 分组、tool routing(embedding 检索式选工具) | `tool/index.ts:311` (`createTool`), `tool/index.ts:198` (`class Tool`), `tool/toolkit.ts` (`createToolkit`), `tool/routing/` (`createEmbeddingToolSearchStrategy`) |
| [[model-abstraction\|模型抽象]] | 直接复用 Vercel AI SDK 的 `LanguageModel`/`EmbeddingModel`（OpenAI/Anthropic/Google/Groq/Mistral/xAI/Bedrock/Vertex/Ollama 等十余 provider 作 deps）；另有 `model-provider-registry` 把字符串模型名经 models.dev API 解析为 provider，按 env 自动选 + 本地缓存 | `registries/model-provider-registry.ts:12` (`ModelProvider`), `registries/model-provider-registry.ts:33` (models.dev), `core/package.json:5-49` (各 `@ai-sdk/*` deps) |
| [[multi-agent-orchestration\|多智能体编排]] | Supervisor/Sub-agent：`SubAgentManager` 经 `delegate_task` 工具把任务 `handoffTask` 给子 agent，`handoffToMultiple` 并行委派多个；另有 A2A server 协议跨进程协作 | `agent/subagent/index.ts:55` (`SubAgentManager`), `:319` (`handoffTask`), `:710` (`handoffToMultiple`), `:748` (`createDelegateTool`); `agent/types.ts` (`SupervisorConfig`); `packages/a2a-server/` |
| [[context-engineering\|上下文工程]] | system prompt(instructions 静态/动态)、conversation buffer、消息归一化(message-normalizer)、按 token 的上下文裁剪(`contextLimit`)与 `apply-summarization` 摘要旧消息；createPrompt 工具 | `agent/agent.ts:5166` (`getSystemMessage`), `agent/conversation-buffer.ts`, `agent/apply-summarization.ts`, `agent/message-normalizer.ts`, `utils/createPrompt/` |
| [[skills-plugins\|技能/插件]] | 扩展点为 hooks(onStart/onEnd/onToolStart…)、middleware(input/output 可重试)、guardrails、Toolkit、MCP/A2A 接入；Workspace 下有 SKILL（`workspace/skills/`，gray-matter 解析 SKILL.md frontmatter）；外部能力主要靠 MCP server | `agent/hooks/index.ts`, `agent/middleware.ts`, `workspace/skills/index.ts`, `mcp/` (`@modelcontextprotocol/sdk`) |
| [[observability-eval\|可观测/评估]] | **核心卖点**：全栈 OpenTelemetry，3 个自定义 SpanProcessor——WebSocket(实时推 VoltOps Console)、LocalStorage(本地 trace 存储+查询)、LazyRemoteExport(OTLP→VoltOps/任意后端)；零配置默认开启。评估：`eval`(create-scorer/LLM-judge) + 独立 `@voltagent/scorers`/`@voltagent/evals` + langfuse exporter | `observability/index.ts:1`, `observability/node/volt-agent-observability.ts:31/124`, `observability/processors/*`, `eval/create-scorer.ts`, `eval/llm/create-judge-scorer.ts` |
| [[runtime-execution\|运行时/部署]] | 库 + server provider 模式：`@voltagent/server-hono`/`server-elysia`/`serverless-hono`(Cloudflare/边缘) 把 agents/workflows 暴露为 HTTP(默认 :3141)；代码沙箱适配器 `sandbox-e2b`/`sandbox-daytona`/`sandbox-blaxel`；`create-voltagent-app` 脚手架、`@voltagent/cli` | `voltagent.ts:144` (server provider 装配), `packages/server-hono/`, `packages/serverless-hono/`, `packages/sandbox-*`, `packages/create-voltagent-app/` |
| [[human-in-the-loop-governance\|人在环/治理]] | 两条线：①Guardrails(input/output 方向，可设 severity/action 拦截校验 IO)；②工具 `needsApproval` + Workflow `suspend()/resume()`(带 resumeSchema) 做审批挂起恢复（README 报销审批示例） | `agent/guardrail.ts:28` (`GuardrailDirection`), `agent/guardrails/defaults.ts`, `tool/index.ts:138` (`needsApproval`), `workflow/suspend-controller.ts`, README:165-229 (suspend/resume) |
| [[state-persistence\|状态/持久化]] | Memory 经 StorageAdapter 持久化消息/会话/working memory；`memory-persist-queue` 异步落盘；Workflow 有 WorkflowStateStore/checkpoint(suspend 后可 restart)；observability 的 LocalStorage 持久化 trace；resumable-streams 支持断线续流 | `agent/memory-persist-queue.ts`, `memory/adapters/storage/`, `workflow/registry.ts` (`WorkflowStateStore`/checkpoint), `packages/resumable-streams/`, `packages/libsql`/`postgres`/`supabase` |

## 设计权衡与特性

- **"AI SDK 之上的工程平台" vs 自造内核**：与自己实现 ReAct 循环的框架（如 [[smolagents]]）不同，VoltAgent 把推理循环完全交给 Vercel AI SDK（`stepCountIs`），自己专注 span/trace、guardrail、memory、subagent、server。好处是模型/工具调用语义与 AI SDK 完全一致、provider 覆盖广；代价是与 `ai@6` 强绑定，升级要跟随其 breaking change。
- **可观测性是真正的差异点**：不是事后加 logging，而是 `@voltagent/core` 直接 hard-depend 一整套 `@opentelemetry/*`，每个 agent/tool/workflow 调用都是 OTel span，三路 processor（实时 WS / 本地存 / OTLP 远端）零配置开箱。这让它天然对接 VoltOps Console 与任意 OTLP 后端（Langfuse exporter 现成），是它相对多数 TS agent 框架最强的卖点。
- **平台 + 框架双形态**：开源 framework（本仓库）+ VoltOps Console（云/自托管，做 observability/evals/guardrails/prompt builder/deploy）。框架可独立用，但很多运维能力指向 Console。
- **与 [[mastra]] 高度同生态位**：同为 TS、同建于 Vercel AI SDK、同有 agent/workflow/memory/RAG/voice/eval 全家桶；差异在 VoltAgent 把 OpenTelemetry 观测做成内核一等公民并配 VoltOps，Mastra 则更偏 workflow-graph 与自带 playground。
- **PlanAgent 是 Claude-Code 风格的彩蛋**：`planagent/` 提供 write_todos 规划 + 内存文件系统 + 通用子 agent + 工具结果驱逐(context 控制)，启用 workspace 时默认 maxSteps 直接拉到 100，面向"长程多步自治任务"。
- **坑/注意**：①LICENSE 文件名为 `LICENCE`(英式拼写)，内容确为 MIT（README/各 package.json 一致）；②`peerDependencies` 要求 `ai@^6` 与 `zod ^3.25||^4`，与旧版 AI SDK 不兼容；③observability 默认会尝试连 VoltOps（serverless 下自动从 VoltOpsClient 推导 OTLP endpoint），离线/隐私场景需显式配置或关闭远端导出。

## 关联

- [[component-taxonomy]] · [[observability-eval]] · [[multi-agent-orchestration]] · [[model-abstraction]]
- 同生态位(TS + Vercel AI SDK 全家桶)：[[mastra]] · 源码：`agents-example/voltagent/`
