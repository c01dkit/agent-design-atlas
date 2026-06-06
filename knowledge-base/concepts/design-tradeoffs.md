---
title: "核心设计权衡"
aliases:
  - Design Tradeoffs
  - 设计取舍
tags:
  - knowledge-base
  - domain/agent-concepts
  - concept/tradeoff
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 核心设计权衡

> [!abstract] 一句话总结
> 不同框架之所以"长得不一样"，是因为它们在几条核心轴上做了不同取舍：**轻量 vs 全家桶、命令式 vs 声明式、低抽象 vs 高抽象、模型驱动 vs 框架驱动、通用 vs 垂直、可控 vs 自由**。看懂这些轴，就能预测一个框架的脾气，也能为自己的场景选型。

## 六条轴

### 1. 轻量库 ↔ 全家桶平台

- **轻量**：几百到几千行，聚焦核心循环，易读易改（[[smolagents]] ~几千行、[[nanobot]] ~4000 行、[[connectonion|ConnectOnion]] 2 行起手、[[llm-agents|LLM Agents]]）。
- **全家桶**：覆盖记忆/工具/编排/可观测/部署全链路（[[langchain|LangChain]]、[[llamaindex|LlamaIndex]]、[[dust|Dust]]、[[astron|Astron]]）。
- 取舍：上手与可控 vs 开箱即用与生态。

### 2. 命令式（代码编排）↔ 声明式（配置/图）

- **命令式**：用普通代码写控制流，灵活直观（[[swarm|Swarm]]、[[smolagents]]、[[crewai|CrewAI]]）。
- **声明式**：用图/配置描述流程，引擎来跑，利于可视化与可恢复（LangGraph、[[mastra|Mastra]] workflows、[[haystack|Haystack]] pipeline、[[botpress|Botpress]] flows）。
- 取舍：表达自由 vs 工具化（可视/恢复/校验）。

### 3. 低抽象（暴露 prompt）↔ 高抽象（隐藏细节）

- **低**：把 prompt、消息、循环都摊开给你改（适合研究/精调）。
- **高**：藏起 prompt，给你 `Agent(role=..., tools=[...])` 这种声明（适合快速产出，但难精调、易"魔法"）。
- 取舍：可控/可调 vs 简洁/快。

### 4. 模型驱动 ↔ 框架驱动

- **模型驱动**：框架尽量薄，相信模型自己决策（[[strands|Strands]]、[[smolagents]] CodeAct）。随模型变强而受益。
- **框架驱动**：框架用代码兜住模型的不确定性（状态机、强约束、校验）。更稳但有上限。
- 取舍：上限/前瞻 vs 当下稳定性。详见 [[agent-loop-paradigms]]。

### 5. 通用 ↔ 垂直

- **通用**：什么 agent 都能搭（多数框架）。
- **垂直**：为特定场景优化——RAG（[[agentset|Agentset]]、[[vectara-agentic|Vectara-agentic]]）、语音/多模态（[[pipecat|Pipecat]]）、记忆（[[cortex-mem|Cortex Memory]]）、治理（[[cordum|Cordum]]）、编程（[[metagpt|MetaGPT]]）。
- 取舍：广度 vs 深度/契合度。

### 6. 可控 ↔ 自由（贯穿全局）

这是上面几条的共同底色，也是 agent 工程的中心矛盾：**越自由越强大、越难保证；越可控越可靠、越受限。** 生产系统往往在关键路径加约束（[[human-in-the-loop-governance|人在环/治理]]、[[observability-eval|可观测]]），在探索路径放自由。

## 一些经验法则

- **从单 agent + 好工具开始**，确有收益再上多 agent（见 [[single-vs-multi-agent]]）。
- **选型先问场景**：通用探索选轻量命令式；生产关键流程选声明式可恢复；垂直需求直接选垂直框架。
- **抽象越高，越要能"掀开盖子"**——不能改 prompt 的高抽象框架在真实项目里常被弃用。
- 语言生态也是约束：Python 生态最厚（研究/数据），TypeScript 适合全栈/前端集成（[[mastra|Mastra]]、[[voltagent|VoltAgent]]），Go/Rust 偏基础设施（[[modus|Modus]]、[[pilotprotocol|Pilot Protocol]]）。见 [[language-ecosystem]]。

## 关键要点

- 框架差异 = 在这 6 条轴上的坐标，没有"最好"，只有"最适合某场景"。
- 看懂轴，就能在 [[component-matrix|对比矩阵]]里快速定位一个框架的脾气。

## 关联

- [[component-taxonomy]] · [[agent-loop-paradigms]] · [[single-vs-multi-agent]]
- [[language-ecosystem]] · [[paradigm-map]]
