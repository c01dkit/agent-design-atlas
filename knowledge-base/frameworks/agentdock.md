---
title: "AgentDock"
aliases:
  - AgentDock
  - agentdock
  - agentdock-core
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agentdock
  - lang/typescript
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/AgentDock/AgentDock
license: MIT
stars: ~4k
---

# AgentDock

> [!abstract] 一句话定位
> 一个 TypeScript 编写、后端优先（backend-first）的开源生产级 agent 与 workflow 构建平台，核心信条是 **configurable determinism（可配置确定性）**：用统一的 **node-based 架构**（`BaseNode` / `AgentNode` / Tools-as-Nodes）把 LLM 智能与确定性工作流缝合起来——既能让 agent 自由推理，又能用 orchestration step/sequence 把工具调用约束成可预测的执行路径。框架本体（`agentdock-core`）与一个完整的 Next.js 参考客户端分离，可独立嵌入任意 Node.js 后端。

## 设计理念 / 顶层架构

AgentDock 是 **monorepo**：`agentdock-core/`（provider-independent 的核心库，本笔记焦点）+ 根目录的 Next.js 开源客户端（`src/`，core 的消费者/参考实现）+ `agents/`（35+ JSON 模板）。核心设计取舍：

- **一切皆 Node**：`BaseNode`（`agentdock-core/src/nodes/base-node.ts:55`）是抽象基类，声明 `execute()`、输入/输出 ports（`NodePort`）、元数据、以及节点间的 `MessageBus` 通信。`AgentNode`（`nodes/agent-node.ts:107`，`type = 'core.agent'`）是编排 LLM+工具的专用核心节点；工具与自定义逻辑都被建模为扩展 `BaseNode` 的节点。
- **configurable determinism**：非确定性的 `AgentNode`（LLM 推理）可以触发确定性的 sub-workflow / tool 序列；通过 orchestration 配置控制"哪些部分走 LLM 推理"，从而在创造性与可预测性之间取舍（README §Configurable Determinism）。
- **声明式 Agent = JSON 模板**：agent 由 `AgentConfig`（`types/agent-config.ts:41`，Zod 校验）定义——`personality`（system prompt）、`nodes`（启用的能力/工具名）、`nodeConfigurations`（每个 provider/工具的配置）、`orchestration`（step/sequence/条件）、`chatSettings`（历史策略）。模板见 `agents/*/template.json`。
- **provider-independent**：`CoreLLM`（`llm/core-llm.ts:84`）在 Vercel AI SDK（`ai` 包）之上做统一封装，`createLLM` 工厂按 provider 路由到各 adapter（anthropic/openai/google/groq/deepseek/cerebras）。
- **入口 API**：`import { AgentNode, ... } from 'agentdock-core'`（`src/index.ts`）。`new AgentNode(id, { apiKey, agentConfig })` 后调用 `agentNode.handleMessage({ messages, sessionId, orchestrationManager })`，返回 Vercel AI SDK 的流式结果（`AgentDockStreamResult`），由调用方（API 路由/适配器）消费流并构造 HTTP 响应。

最小示例（基于 README 的 node-based / `handleMessage` 范式 + `AgentConfig` 形态）：

```typescript
import { AgentNode, createOrchestrationManager } from 'agentdock-core';

// 1) 声明式 agent 配置（等价于 agents/*/template.json）
const agentConfig = {
  version: '1.0',
  agentId: 'assistant',
  name: 'Assistant',
  description: 'A helpful assistant',
  personality: 'You are a helpful assistant.',
  nodes: ['llm.anthropic', 'search', 'think'], // 启用的工具节点
  nodeConfigurations: {
    'llm.anthropic': { model: 'claude-sonnet-4-20250514', temperature: 0.7 }
  },
  chatSettings: { historyPolicy: 'all' },
  options: { maxSteps: 5 } // 多步工具调用上限
};

// 2) 构造 AgentNode（运行时依赖 OrchestrationManager 经方法注入）
const agent = new AgentNode('assistant', {
  apiKey: process.env.ANTHROPIC_API_KEY!,
  provider: 'anthropic',
  agentConfig
});

const orchestrationManager = createOrchestrationManager();

// 3) 处理一条消息，得到 Vercel AI SDK 流式结果
const result = await agent.handleMessage({
  sessionId: 'session-1',
  orchestrationManager,
  messages: [{ role: 'user', content: 'Search for TS agent frameworks' }]
});
// result 是 streamText 结果：调用方消费 result 流并返回给前端
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 非显式 ReAct 循环；委托给 Vercel AI SDK `streamText` 的 **multi-step tool calling**：`AgentNode.handleMessage` 备好工具与 prompt 后调 `LLMOrchestrationService.streamWithOrchestration`→`CoreLLM.streamText`，由 SDK 在 `maxSteps`(默认5) 内自动跑"LLM→tool→回灌→再 LLM"。每个 step 经 `onStepFinish` 回调追踪已用工具 | `nodes/agent-node.ts:414,557` (`maxSteps`), `llm/llm-orchestration-service.ts:157,216` |
| [[planning\|规划/任务分解]] | 内核无独立 planner；规划=人写的 **orchestration steps**（声明式状态机）+ LLM 自身推理。step 可设 `sequence`(强制工具顺序) 与 `conditions`(`tool_used`/`sequence_match`) 实现确定性多阶段流程；另有 `agent-planner` 模板做"设计其他 agent" | `types/orchestration.ts`, `orchestration/core.ts`, `agents/agent-planner/template.json` |
| [[memory\|记忆(短/长/向量)]] | 四层记忆：Working/Episodic/Semantic/Procedural（`memory/types/*`），由 `MemoryManager` 统管；写入经 **PRIME** 抽取器（LLM `generateObject` 按重要度分类落库，2-tier 选模）；召回 `RecallService` 支持 hybrid（关键词+向量）；含 LazyDecay 衰减、连接图谱、巩固 | `memory/MemoryManager.ts`, `memory/extraction/PRIMEExtractor.ts:39`, `memory/services/RecallService.ts`, `memory/index.ts` |
| [[tool-use\|工具调用]] | 工具=扩展 `BaseNode` 的节点；`createTool({name,description,parameters:zod,execute})` 创建（`nodes/tool/index.ts:190`）；全局 `DefaultToolRegistry` 单例注册，`getToolsForAgent(nodeNames)` 按 agent 的 `nodes` 取工具；运行时 `streamWithOrchestration` 包装 execute 注入 `llmContext`(CoreLLM 实例) | `nodes/tool/index.ts:69,190`, `nodes/tool-registry.ts:48,93`, `nodes/agent-node.ts:344,458` |
| [[model-abstraction\|模型抽象]] | `CoreLLM` 统一封装 Vercel AI SDK `LanguageModel`，暴露 `generateText/streamText/generateObject` 等；`createLLM` 工厂 + `ProviderRegistry` 按 provider 路由 adapter（anthropic/openai/google/groq/deepseek/cerebras）；支持 primary+fallback 双 LLM | `llm/core-llm.ts:84`, `llm/create-llm.ts`, `llm/provider-registry.ts`, `llm/providers/*-adapter.ts`, `nodes/agent-node.ts:152` (fallback) |
| [[multi-agent-orchestration\|多智能体编排]] | N/A（核心层）。无 agent-to-agent / 子 agent 派生运行时；"orchestration" 指**单 agent 内的工具/step 编排**而非多 agent。Multi-Agent Collaboration 在 README roadmap 标 **Planned**；节点间有 `MessageBus` 原语但未用于多 agent | `nodes/base-node.ts:107` (sendMessage), README §Roadmap |
| [[context-engineering\|上下文工程]] | `createSystemPrompt(agentConfig, dynamicState)` 由 personality+动态 orchestration 状态(activeStep/recentlyUsedTools)拼 system prompt，并注入当前日期/时区；`applyHistoryPolicy` 按 `none/lastN/all` 裁剪历史；模板级 `tokenOptimization`(compressToolOutputs/maxToolOutputTokens) | `utils/prompt-utils.ts:25,70` (`createSystemPrompt`/`addOrchestrationToPrompt`), `utils/message-utils.ts:89` (`applyHistoryPolicy`), `nodes/agent-node.ts:534` |
| [[skills-plugins\|技能/插件]] | 通过 **node 扩展**实现：自定义能力=继承 `BaseNode`/`BaseTool` 的节点，经 `NodeRegistry`/`ToolRegistry` 注册（`register-core-nodes.ts`）；agent 在 `nodes:[]` 中按名启用。无独立 "skill/plugin" 概念，统一收敛到 node 系统 | `nodes/node-registry.ts`, `nodes/register-core-nodes.ts`, `nodes/base-node.ts:55` |
| [[observability-eval\|可观测/评估]] | 内置 **Evaluation Framework**：`runEvaluation` runner + 多评估器（RuleBased/LLMJudge/NLPAccuracy/ToolUsage/LexicalSimilarity/KeywordCoverage/Sentiment/Toxicity），结果落 `JsonFileStorage`；结构化分类日志 `logger`(LogCategory)；token 用量经 `onFinish` 累积进 orchestration 状态（cumulativeTokenUsage） | `evaluation/runner/index.ts`, `evaluation/evaluators/*`, `logging/`, `llm/llm-orchestration-service.ts:421` |
| [[runtime-execution\|运行时/部署]] | 纯库（`agentdock-core`，`tsup` 打包，含 `.`+`/server` 两个 export，区分 edge/Node）；自身不起服务，由 Next.js 客户端（Vercel 一键部署）或宿主后端驱动；流式执行依赖 Vercel AI SDK，serverless 下用 `@vercel/functions` waitUntil 跑后台任务 | `agentdock-core/package.json:6`, `llm/llm-orchestration-service.ts:26,55`, README §Getting Started, `vercel.json` |
| [[human-in-the-loop-governance\|人在环/治理]] | N/A（核心层无一等 HITL 原语，无审批/打断 API）。治理体现为：BYOK（密钥本地加密，`memory/services/EncryptionService.ts`）、orchestration 对工具可用性的确定性约束、`SECURITY.md`；交互式审批留给宿主客户端实现 | `orchestration/core.ts` (getAllowedTools), `memory/services/EncryptionService.ts`, `SECURITY.md` |
| [[state-persistence\|状态/持久化]] | 会话隔离 `SessionManager<T>`（泛型，按 sessionId 存取，TTL）；orchestration 状态（activeStep/sequenceIndex/recentlyUsedTools/tokenUsage）经 `OrchestrationStateManager` 持久化；**Storage Abstraction**：统一 `StorageProvider` 接口 + 大量 KV/向量 adapter（Memory/Redis/Vercel KV/SQLite/Postgres/Mongo/DynamoDB/S3/Pinecone/Qdrant/Chroma…）+ 迁移工具 | `session/index.ts:33`, `orchestration/state.ts`, `storage/factory.ts`, `storage/adapters/*`, `storage/migration/index.ts` |

## 设计权衡与特性

- **configurable determinism 是核心卖点**：与多数"放手让 LLM 自主 ReAct"的框架不同，AgentDock 用声明式 orchestration step + `sequence`（强制工具顺序）+ `conditions`（`tool_used`/`sequence_match` 触发状态转移）把工具调用收束成可预测路径——`getAllowedTools`（`orchestration/core.ts:351`）每轮按当前 step 过滤 LLM 可见工具。即"非确定性 agent 包裹确定性 workflow"。
- **node-based 单一抽象**：agent、tool、自定义逻辑全部是 `BaseNode`，靠 registry 组装、靠 ports/MessageBus 连接。代价是抽象偏重、上手需理解 node/registry/orchestration 三件套；好处是统一可组合、为可视化 workflow builder（AgentDock Pro）铺路。
- **backend-first + provider-independent**：核心库刻意不绑死前端/服务形态，`streamText` 结果直接交给宿主（Next.js 客户端是参考实现，可一键 Vercel 部署）。LLM 全走 Vercel AI SDK，新增 provider 只需加 adapter。
- **记忆系统是重头戏**：四层记忆 + PRIME 智能抽取 + hybrid 召回 + LazyDecay 衰减 + 连接图谱 + 巩固，配套 SQLite-vec / pgvector / Pinecone / Qdrant / Chroma 等向量后端——比同类框架的"向量库 KV"成熟得多（虽然 README 仍标 memory/vector "In Progress"）。
- **存储抽象极广**：一个 `StorageProvider` 接口对接十余种后端（边缘 KV 到云数据库到多种向量库），并有 `StorageMigrator`，适合从本地 demo 平滑迁到生产。
- **明显短板/待确认**：①核心层**无多 agent 协作、无 MCP、无一等 HITL/审批**（均为 roadmap Planned），需自行在客户端实现；②`agentdock-core` 标 `private`、版本 `0.1.0-161-1`、Status Beta，尚未作为正式 npm 包发布（README roadmap 明确"developed locally, will be published…"）；③`AgentNode` 构造函数里残留 `console.log('AgentNode Constructor - Test Log...')`（`nodes/agent-node.ts:119`）等调试代码，工程成熟度仍在打磨。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式（platform / 电池齐全）：[[connectonion]] · [[mastra]] · [[botpress]] · [[dust]] · 源码：`agents-example/agentdock/`
