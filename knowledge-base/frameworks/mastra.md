---
title: "Mastra"
aliases:
  - Mastra
  - mastra
  - "@mastra/core"
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/mastra
  - lang/typescript
  - paradigm/single
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/mastra-ai/mastra
license: Apache-2.0（`ee/` 目录为 Mastra Enterprise License 源码可见但需企业许可，见 LICENSE.md）
stars: ~16k
---

# Mastra

> [!abstract] 一句话定位
> 一个面向现代 TypeScript 全栈的 opinionated agent 框架（Y Combinator W25，Kepler Software 出品）：用 `Agent`（自主工具循环）+ **声明式 graph workflow**（`.then()/.branch()/.parallel()/.dowhile()/.foreach()`）两条互补的执行原语，配齐 40+ provider 的模型路由、三层 memory（对话历史/工作记忆/语义召回）、Zod 工具、suspend/resume 人在环、OTel 风格 AI tracing 与 evals，目标是"从原型一路到生产"并能内嵌进 React/Next/Node 或独立部署为服务。

## 设计理念 / 顶层架构

Mastra 是 **turborepo + pnpm workspace 的大型 TS monorepo**，骨架全在 `packages/core/src`，设计取舍如下：

- **两条执行原语，职责分离**：`Agent`（`agent/agent.ts`，7800+ 行的核心类）做"自主 reasoning + 工具迭代"，让 LLM 自己决定调哪些工具、何时停；`Workflow`（`workflows/workflow.ts`）做"显式可控的多步编排"，用链式声明 DSL 表达控制流。关键点是**二者同构**：agent 的 reasoning loop 本身就是用 workflow 引擎实现的（`loop/` 把一次 agent 运行编译成 `agentic-loop` workflow），workflow 的 step 又能直接包一个 agent 或 tool（`createStepFromAgent`/`createStepFromTool`，`workflows/workflow.ts:430,600`）。
- **中央编排器 + 依赖注入**：`Mastra` 类（`mastra/index.ts:524`）是配置 hub，注册 agents/workflows/storage/vectors/logger/observability，并把 storage、tracing 等横切能力注入给各组件（`agent.getMemory()` 会自动从 Mastra 注入 storage）。
- **包结构**：`agent/`（含 `durable/` 持久化执行、`message-list/`、`network`）、`workflows/`（声明式引擎 + step）、`tools/`、`memory/`、`llm/model/`（router + gateways）、`loop/`（agentic loop 编译）、`processors/`（输入/输出处理管线）、`observability/`（AI tracing span 体系）、`storage/`（可插拔 DB，domains 分库）、`mcp/`、`workspace/skills/`（SKILL.md）、`evals/`、`scorers`/`a2a`/`voice` 等。电池单独成包：`@mastra/memory`、`@mastra/rag`、`@mastra/evals`、`@mastra/mcp`、`@mastra/deployer`、`create-mastra` 脚手架、`playground` 调试 UI。
- **入口 API**：`import { Agent } from '@mastra/core/agent'`，`agent.stream()`/`agent.generate()` 跑自主循环，`agent.network()` 跑多 agent 路由。

最小示例（综合 README 与 `agent/agent.ts:387` 构造器 JSDoc）：

```typescript
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const getWeather = createTool({
  id: 'get-weather',
  description: 'Get weather for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),  // city 已按 inputSchema 校验
});

const weatherAgent = new Agent({
  name: 'Weather Agent',
  instructions: 'You help users with weather information',
  model: 'openai/gpt-5',          // 字符串走内置模型路由，连接 40+ provider
  tools: { getWeather },
});

// 中央编排器统一注册（注入 storage / observability 等）
export const mastra = new Mastra({ agents: { weatherAgent } });

const res = await weatherAgent.generate('Weather in Tokyo?');
console.log(res.text);
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 自主工具循环，但**用 workflow 引擎实现**：一次运行编译成 `agentic-loop`，靠 `.dowhile(agenticExecution, …)` 反复执行 LLM 调用→工具调用步骤，直到 `stepResult.isContinued` 为 false；停止条件由 `stopWhen`（StopCondition 数组，如 step 计数）与 `maxSteps` 控制，每轮触发 `onIterationComplete` 钩子可注入反馈/继续/中止 | `loop/loop.ts:11`, `loop/workflows/agentic-loop/index.ts:80` (`.dowhile`), `loop/workflows/agentic-execution/index.ts` |
| [[planning\|规划/任务分解]] | 内核无显式 planner；自主规划交给 LLM。**显式规划走声明式 workflow**：开发者用 `.then/.branch/.parallel/.dowhile/.foreach/.map` 手工编排为 DAG；多 agent 场景由 routing agent 动态决定下一个 primitive（见多智能体编排） | `workflows/workflow.ts:1775` (`then`),`2142` (`branch`),`2294` (`foreach`); `loop/network/index.ts:224` (router 提示) |
| [[memory\|记忆(短/长/向量)]] | 抽象基类 `MastraMemory`（`@mastra/memory` 提供实现）：短期=线程对话历史（storage 持久化）；长期=**working memory**（tool-call 模式更新的结构化 markdown/schema）；向量=**semantic recall**（需配 `vector` store + `embedder`，相似度召回历史消息）；另有 observational memory | `memory/memory.ts:114` (`MastraMemory`),`124` (`vector`/`embedder`),`638` (`getWorkingMemory`),`170` (`semanticRecall` 校验) |
| [[tool-use\|工具调用]] | `createTool({ id, description, inputSchema, outputSchema, execute })`，Zod/Standard-Schema 定义入参出参，运行时自动校验输入输出（`validateToolInput`/`validateToolOutput`）；工具也可声明 `suspendSchema`/`resumeSchema` 支持 HITL；兼容 Vercel AI SDK tool 与 MCP 工具 | `tools/tool.ts:557` (`createTool`),`77` (`Tool` 类),`296` (execute 校验包装),`102` (suspend/resume schema) |
| [[model-abstraction\|模型抽象]] | 字符串 `provider/model` 经 `ModelRouterLanguageModel` 解析（`gateway-resolver` + `provider-registry.json`，覆盖 40+ provider），统一为 AI SDK v5/v6 `LanguageModelV2`；也接受直接传入 AI SDK model 实例；`resolveModelConfig` 兜底 v4 包装；支持 model fallbacks / retries | `llm/model/router.ts:108` (`ModelRouterLanguageModel`),`97` (`defaultGateways`); `llm/model/resolve-model.ts`; `llm/model/provider-registry.json` |
| [[multi-agent-orchestration\|多智能体编排]] | 三条路：①`agent.network(messages, opts)` 用一个 **routing agent** 在 sub-agents/workflows/tools 间动态路由迭代直至完成；②sub-agent：在 `agents:` 注册的 `SubAgent` 被包成工具供主 agent 调用（`getToolsForExecution`）；③workflow 内 `createStep(agent)` 把 agent 当步骤静态编排；另有 A2A 协议（`@mastra/core/a2a`） | `agent/agent.ts:6377` (`network`); `agent/subagent.ts:43` (`SubAgent`); `loop/network/index.ts:297` (routing); `workflows/workflow.ts:430` (`createStepFromAgent`) |
| [[context-engineering\|上下文工程]] | **processor 管线**：input/output/error processors（及可作 processor 的 workflow）在 LLM 调用前后改写消息/系统提示/工具集，内置 token-limiter、message-selection、system-prompt-scrubber、moderation、PII、prompt-injection、structured-output 等；system-reminders 注入；`instructions`/`model`/`tools` 均支持 `DynamicArgument`（按 requestContext 动态解析） | `processors/processors/` (token-limiter/message-selection/…), `processors/index.ts:52` (`ProcessorContext`), `memory/system-reminders.ts`, `agent/agent.ts:334` (动态 instructions) |
| [[skills-plugins\|技能/插件]] | **Skills**=`SKILL.md`（gray-matter frontmatter）文件，经 `workspace/skills/` 发现（local/versioned/composite source + glob），由 `SkillsProcessor` 注入（eager 或 on-demand 发现），并暴露为 skill 工具；**兼容 Claude Code `~/.claude/skills/`**（`workspace/filesystem/local-filesystem.ts:83`）。插件式扩展主要靠 processors + tools + storage domains，而非继承 | `workspace/skills/workspace-skills.ts`, `workspace/skills/tools.ts`, `processors/processors/skills.ts`, `agent/agent.ts:828` (`getSkillsProcessors`), `storage/domains/skills/` |
| [[observability-eval\|可观测/评估]] | **AI tracing**：`SpanType` 枚举（AGENT_RUN/WORKFLOW_RUN/MODEL_GENERATION/TOOL_CALL/MEMORY_OPERATION/RAG_* 等）构成结构化 span 树，经 `Observability` 入口（`@mastra/observability`，含 storage/platform/OTel exporter）导出；**evals/scorers**：`@mastra/evals` + `evals/scoreTraces` 对 trace 打分；`logger/` 分级日志 | `observability/types/tracing.ts:35` (`SpanType`), `mastra/index.ts:295,844` (`observability`/`registerExporter`), `evals/`, `loggers` 包 |
| [[runtime-execution\|运行时/部署]] | 库 + 服务双形态：`agent.stream()` 流式（基于 ReadableStream + `MastraModelOutput`）；嵌入 React/Next/Node 或经 `@mastra/deployer`/server-adapters 部署为独立 HTTP 服务；`create-mastra` 脚手架 + `playground` 本地调试 UI；`engines.node>=22.13`；工具默认本进程执行，可控并发（`toolCallConcurrency`） | `loop/loop.ts:139` (`MastraModelOutput`), `deployer/`, `server/`, `create-mastra` 包, `loop/workflows/agentic-execution/tool-call-concurrency.ts` |
| [[human-in-the-loop-governance\|人在环/治理]] | **suspend/resume**：workflow step 与 tool 均可声明 `suspendSchema`/`resumeSchema`，执行中 `suspend()` 暂停并把状态落 storage，之后 `resume()` 携用户输入恢复（可无限期暂停）；`requireToolApproval` 工具审批；**DurableAgent** 把整次 agent 运行包成可持久/可恢复的 workflow | `workflows/workflow.ts:389` (suspend/resume schema),`1799` (`canSuspend`); `tools/hitl.md`; `loop/loop.ts:24` (`requireToolApproval`); `agent/durable/durable-agent.ts:158` |
| [[state-persistence\|状态/持久化]] | 可插拔 storage（`MastraStorage` base + composite store + filesystem/in-memory/外部 DB 适配器），按 **domain 分库**（agents/skills/workspaces/mcp-clients/scorer-definitions…）持久化线程、消息、memory、workflow snapshot；workflow 快照支持 `resumeStream()`；`request-context`/`di` 管运行时上下文 | `storage/base.ts`, `storage/domains/` (skills/agents/…), `workflows/workflow.ts:66` (`shouldPersistSnapshot`), `agent/save-queue/`, `request-context/` |

## 设计权衡与特性

- **"agent 即 workflow" 的统一执行模型**：与多数框架把 ReAct 循环写死成 while 不同，Mastra 把一次 agent 运行**编译成内部 workflow**（`agentic-loop`），从而免费获得 workflow 的 suspend/resume、snapshot、tracing span、并发控制。代价是核心 `agent.ts` 体量巨大（7800+ 行）、调用链很深，阅读门槛高。
- **声明式 graph workflow 是一等公民**：`.then/.branch/.parallel/.dowhile/.dountil/.foreach/.map/.sleep` 链式 DSL（`workflows/workflow.ts`）给"需要确定性控制流"的场景一条不依赖 LLM 自主性的路径，且 step 可互嵌 agent/tool/processor——这是 Mastra 区别于纯 ReAct 框架的核心卖点。
- **TS 原生 + Zod 全程**：工具/工作流/结构化输出都用 Zod（或 Standard Schema）做边界校验并推导类型，类型安全是 opinionated 取向；peerDependency 同时支持 zod v3/v4，并维护 v4/v5/v6 多套 AI SDK provider 适配（dependencies 里大量 `@ai-sdk/*` alias）。
- **生产电池齐全**：模型路由（40+ provider/gateway）、三层 memory、processor 安全管线（moderation/PII/prompt-injection）、AI tracing + evals、deployer + playground、MCP server/client、A2A、voice/tts——对标"完整平台"而非极简库。
- **与 Claude Code 生态兼容**：Skills 用 `SKILL.md` + frontmatter，且显式允许 `~/.claude/skills/` 路径，可直接复用 Claude 技能。
- **双许可**：核心 Apache-2.0，但 `ee/` 目录（如 `auth/ee/`、`agent-builder/ee/`）是 Mastra Enterprise License，生产用需企业许可（README + LICENSE.md 明确，与 ConnectOnion 那种"声明不一致"不同，这里是有意为之）。
- **待确认**：stars 数为估计值（README 用动态 badge，未在源码固化）；`maxSteps` 的默认值未在已读文件中以常量形式定位（由调用方/`stopWhen` 传入，缺省时循环以 LLM `finishReason` 自然停止）——具体默认行为待确认。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式（TS + 声明式 workflow + 平台电池）：[[connectonion]]（Python 对照）· 源码：`agents-example/mastra/`
