---
title: "Agentset"
aliases:
  - Agentset
  - agentset
  - "@agentset/engine"
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agentset
  - lang/typescript
  - paradigm/rag
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/agentset-ai/agentset
license: MIT (LICENSE.md / README 一致声明)
stars: ~1k
---

# Agentset

> [!abstract] 一句话定位
> 一个 **开源、生产级、模型无关的 RAG 平台**（TS monorepo），把"摄取 → 切块 → 向量索引 → 混合检索 → 重排 → agentic 多轮检索/深度研究 → 带引用作答 → 托管/评估/计费"做成端到端流水线；核心不是"造一个 agent SDK"，而是用 **`generate-queries → search → can-answer? → loop`** 的 agentic RAG 循环把检索质量推到极致，并以多租户、Webhook、托管站点等能力支撑生产。

## 设计理念 / 顶层架构

Agentset 是一个 **Bun + Turborepo 的 TS monorepo**，不是一个发布到 npm 的库，而是一整套可自托管的 SaaS（`apps/web` 是 Next.js 主应用，`package.json:1` 名字直接叫 `app.agentset.ai`）。设计取舍：

- **范式 = RAG，而非通用 agent loop**：没有 ReAct/工具调用内核，没有"agent 持有一组 tools"的抽象。它的"agentic"特指 **检索侧的自我迭代**——LLM 反复生成检索 query、查库、自评"够不够答"，直到可答或耗尽预算（`apps/web/src/lib/agentic/search.ts:35`）。
- **引擎与编排分离**：纯 RAG 基础设施在 `packages/engine`（embedding / vector-store / rerank / chunk / partition / llm 抽象，全部经 AI SDK 统一），导出见 `packages/engine/src/index.ts:1`；而 **agentic 编排（普通/agentic/deepResearch 三种模式）写在 web 应用层** `apps/web/src/lib/{agentic,deep-research}/`，由 chat 路由分发（`apps/web/src/app/api/(internal-api)/chat/route.ts:57`）。
- **模型/向量库/重排全部可插拔**：`getNamespaceVectorStore`（Pinecone / Turbopuffer，`packages/engine/src/vector-store/index.ts:6`）、`getNamespaceEmbeddingModel`（Azure/OpenAI/Voyage/Google，`embedding/index.ts:22`）、`getRerankingModel`（Cohere / ZeroEntropy，`rerank/index.ts:11`）都按 namespace 配置在运行时 `await import()` 动态选择。
- **多租户是一等公民**：每次检索/摄取都带 `namespace + tenantId`，Turbopuffer 命名空间直接编码为 `as_{namespaceId}_{tenantId}`（`turbopuffer/index.ts:49`），实现物理级租户隔离。
- **重活交给外部 runtime**：解析(partition)走外部 `PARTITION_API`，编排走 **Trigger.dev** durable task（`packages/jobs`），状态落 Prisma/Postgres，缓存/批次走 Redis。

最小示例（取自 README，本质是"配 env + 跑 Next.js 应用"，没有"import 一个 Agent 类"的写法）：

```bash
# 1) 配置环境变量（模型 key、向量库、Partition API 等）
cp .env.example .env
# 2) 安装依赖（Bun）
bun install
# 3) 跑数据库迁移
bun db:deploy
# 4) 启动 Web 应用（含 RAG playground / chat API / 托管）
bun dev:web
```

调用形态是 HTTP：`POST /api/.../chat`，body 里用 `mode: "normal" | "agentic" | "deepResearch"` 切换检索策略（`chat/schema.ts:23`），返回 AI SDK 的 UI message stream，sources 作为 `data-agentset-sources` part 内联推送（`agentic/index.ts:93`）。

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **agentic RAG 循环**（非 ReAct）：`for i in maxEvals` → `generateQueries`(LLM 产出 keyword/semantic 查询) → 并行查库 → `evaluateQueries` 让 LLM 判 `canAnswer` → 可答或超 tokenBudget 则停，再用聚合 chunks 流式作答 | `apps/web/src/lib/agentic/search.ts:35`, `agentic/utils.ts:30,62`, `agentic/index.ts:29` |
| [[planning\|规划/任务分解]] | **deepResearch 模式**做查询规划：`generateInitialQueries`→`performSearch`→`conductIterativeResearch`(budget 轮，evaluateResearchCompleteness 产出补充 query)→filter→`generateResearchAnswer` 生成多页报告 | `apps/web/src/lib/deep-research/index.ts:469`, `deep-research/index.ts:407`, `deep-research/config.ts:14` |
| [[memory\|记忆(短/长/向量)]] | 短期=多轮 `messages`（>1 轮时 `CONDENSE_*` prompt 把历史压成独立 query，`chat/route.ts:87`）；长期=**向量库即记忆**（Pinecone/Turbopuffer，按 namespace/tenant 持久）；无对话级长期记忆模块 | `chat/route.ts:87`, `prompts.ts:26`, `vector-store/index.ts:6` |
| [[tool-use\|工具调用]] | N/A（无通用 function-calling/工具系统）。唯一"工具"是固化的向量检索 `queryVectorStore`，由编排代码直接调用而非 LLM 决策触发 | `packages/engine/src/vector-store/query.ts:17` |
| [[model-abstraction\|模型抽象]] | 全栈基于 **Vercel AI SDK**（`generateText/streamText/embed/generateObject`）；LLM 经 Azure 网关按名映射(`gpt-4.1/gpt-5*`)，embedding 工厂支持 Azure/OpenAI/Voyage/Google，按 namespace 配置动态 import | `engine/src/llm/index.ts:23`, `engine/src/embedding/index.ts:22`, `embedding/wrap-model.ts` |
| [[multi-agent-orchestration\|多智能体编排]] | N/A（无 multi-agent / 子 agent）。"多步"体现在同一 LLM 在检索循环中的多次调用与 deepResearch 的分阶段 model 角色(planning/json/summary/answer) | `deep-research/index.ts:23` (ModelConfig) |
| [[context-engineering\|上下文工程]] | 检索后用模板把 chunks 包成 `<source_n>...</source_n>` 注入(`utils.ts:13`)；强约束 system prompt 要求"仅基于来源作答 + 强制 [n] 引用"(`prompts.ts:3`)；多轮先 condense 历史为单 query 控上下文 | `apps/web/src/lib/prompts.ts:3,18`, `agentic/utils.ts:13`, `chat/route.ts:87` |
| [[skills-plugins\|技能/插件]] | N/A（无运行时插件/技能体系）。仓库内的 `.claude/`、`.agents/skills/` 是给编码 AI 用的开发期技能，非框架运行时能力 | `.agents/skills/` (开发期, 非运行时) |
| [[observability-eval\|可观测/评估]] | 检索流程经 stream 实时回传状态(`data-status`: generating-queries/searching/generating-answer，`agentic/index.ts:61`)与日志(`logs`)；用量计入 Postgres(`chat/route.ts:33`)；服务端事件分析(`logServerEvent`)；Tinybird 存 webhook 事件；README 列 evaluation/benchmarks 为平台特性 | `agentic/index.ts:61`, `apps/web/src/types/ai.ts:14`, `chat/route.ts:33`, `packages/tinybird/` |
| [[runtime-execution\|运行时/部署]] | Next.js 应用(`maxDuration=120`, region iad1，`chat/route.ts:54`)；摄取/删除经 **Trigger.dev** durable task(`processDocument` maxDuration 3h、并发 90，`jobs/tasks/process-document.ts:72`)，解析调外部 Partition API，批次经 Redis、向量化经 `embedMany` 后 upsert | `chat/route.ts:54`, `packages/jobs/src/tasks/process-document.ts:72`, `jobs/tasks/ingest.ts:33` |
| [[human-in-the-loop-governance\|人在环/治理]] | 治理=**多租户 + API key + 配额**：`withNamespaceApiHandler` 校验 org/namespace 归属(`handler/namespace.ts:50`)，`x-tenant-id` 头解析租户(`tenant.ts:6`)，Stripe 计费/`isFreePlan` 限额、Webhook 通知；无 LLM 动作审批/打断式 HITL | `apps/web/src/lib/api/handler/namespace.ts:50`, `api/tenant.ts:6`, `process-document.ts:394` |
| [[state-persistence\|状态/持久化]] | **Prisma + Postgres** 为权威状态（org/namespace/document/ingest-job/webhook 等 schema，`packages/db/prisma/schema/`，含 40+ 迁移）；向量数据在 Pinecone/Turbopuffer；批次/限流用 Redis；文件用 S3 兼容存储 | `packages/db/prisma/schema/`, `process-document.ts:130`, `engine/src/partition/index.ts:60` (S3 presign) |

## 设计权衡与特性

- **"RAG 平台" vs "Agent SDK"**：与 [[connectonion\|ConnectOnion]] 这类"函数即工具的通用 agent 内核"完全不同维度——Agentset 没有工具系统、没有 multi-agent、没有插件运行时。它把"agent"窄化为**检索侧的自迭代**，专注把 RAG 答案的准确性/可引用性做到生产水准（强制 `[n]` 引用、"无依据就说不知道"）。
- **三档检索策略**：`normal`(单次检索直接答) / `agentic`(多轮 generate→search→evaluate 循环) / `deepResearch`(规划+迭代+过滤+多页报告)，同一套引擎、同一组 prompt 风格，按成本/深度分层，是它最核心的产品化抽象（`chat/route.ts:109,142`）。
- **检索质量工程**：混合检索由向量库决定能力——Turbopuffer 用 `multiQuery` 取向量+BM25 两路结果再**应用层 RRF 融合**(`turbopuffer/index.ts:61,119`)，并对 cosine 距离归一化到 0~1；之后统一过 Cohere `rerank-v3.5`(`agentic/search.ts:67`)。重排失败时**静默回退原结果**(`rerank/index.ts:58`)，保证可用性。
- **彻底的可插拔 + 多租户**：embedding/vector-store/rerank/LLM 全按 namespace 配置在运行时动态 import，租户隔离下沉到向量库命名空间层(`as_{ns}_{tenant}`)，适合做 B2B 多客户 SaaS。
- **多模态主要在摄取侧**：解析支持图像抽取、合成图像描述(captions)、表/图理解(`chart_understanding`)、保留页眉页脚等(`partition/types.ts:1`)，把 PDF/图表转成可检索文本；检索/作答链路本身仍是文本 chunk，并非端到端多模态推理。
- **重运行时依赖**：解析依赖外部 Partition 服务、编排依赖 Trigger.dev、计费依赖 Stripe、缓存依赖 Redis、分析依赖 Tinybird/Posthog——自托管门槛偏高（README 指向专门的 prerequisites 指南）。
- **待确认/坑**：① deepResearch 代码注释自承 `// context length issue here!` 与 `// TODO: shrink chunks`，长上下文与 chunk 裁剪仍是已知短板(`deep-research/index.ts:297`, `agentic/index.ts:91`)；② 大量 `console.log` 着色日志留在 deepResearch 生产路径(`deep-research/index.ts:104`)；③ LLM 抽象目前硬编码走 Azure 网关并仅映射少数 GPT 模型(`llm/index.ts:14`)，"模型无关"在 LLM 侧实际比 embedding 侧窄。

## 关联

- [[component-taxonomy]] · 范式：[[paradigm/rag]] · agentic RAG 检索循环 vs 通用 agent loop
- 同范式参考（电池/平台气质）：[[connectonion]] · 源码：`agents-example/agentset/`
