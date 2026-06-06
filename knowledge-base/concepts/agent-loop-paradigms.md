---
title: "Agent 循环范式"
aliases:
  - Agent Loop Paradigms
  - 推理范式
  - ReAct
  - Plan-and-Execute
tags:
  - knowledge-base
  - domain/agent-concepts
  - concept/paradigm
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# Agent 循环范式

> [!abstract] 一句话总结
> Agent 的"主循环"有几种典型组织方式：**ReAct**（边想边做）、**Plan-and-Execute**（先规划再执行）、**Reflection**（做完自我批判再改）、**Graph/状态机**（把控制流显式画成图）、**Model-driven/CodeAct**（尽量让模型自己驱动，少加框架约束）。多数框架是这几种的组合与变体。

## 为什么需要"范式"

[[what-is-an-agent|最小循环]]只回答了"循环存在"，没回答"循环怎么转最有效"。范式就是对"思考-行动-观察"这个循环的不同**组织策略**，各有适用场景与代价。

## 五种核心范式

### 1. ReAct（Reason + Act）

模型交替输出 **Thought（思考）→ Action（动作）→ Observation（观察）**，在每一步用最新观察决定下一步。

- **思路**：推理和行动交织，模型走一步看一步。
- **优点**：简单、通用、对开放任务鲁棒。
- **代价**：无全局规划，容易兜圈子；步数多时上下文膨胀。
- **代表**：早期 [[langchain|LangChain]] AgentExecutor、[[llm-agents|LLM Agents]]、[[smolagents]] 的 ToolCallingAgent。

### 2. Plan-and-Execute（先规划后执行）

先让模型产出一个**完整计划/任务列表**，再逐项执行（执行期可重规划）。

- **思路**：把"想清楚"和"动手"分开。
- **优点**：全局视野、步骤可追踪、利于并行与分工。
- **代价**：计划可能脱离现实，需要 replan 机制兜底。
- **代表**：[[metagpt|MetaGPT]]（SOP 驱动）、[[open-multi-agent]]（一次 LLM 调用拆成任务 DAG）、BabyAGI 式任务队列。

### 3. Reflection / Reflexion（自我反思）

产出结果后，让模型（或另一个评审 agent）**批判自己的输出**并据此修正，循环若干轮。

- **思路**：用"自我评审"换质量。
- **优点**：显著提升正确率，尤其代码/推理任务。
- **代价**：成本翻倍，可能陷入"自我说服"。
- **代表**：[[praisonai|PraisonAI]]（self-reflection 内建）、[[agentic-context-engine|ACE]]（从执行反馈中学习）、Reflexion 论文。

### 4. Graph / 状态机（显式控制流）

把 agent 的状态与转移**显式建模为图**（节点=步骤，边=转移条件），框架按图驱动。

- **思路**：用工程化的可控性换自由度。
- **优点**：可控、可恢复、可观测、易加人在环；适合生产。
- **代价**：要先把流程想清楚，灵活性下降——更接近 workflow 一端。
- **代表**：LangGraph、[[mastra|Mastra]] workflows、[[agentscope]]、[[haystack|Haystack]] Pipeline。

### 5. Model-driven / CodeAct（模型驱动，最小约束）

尽量**不替模型做决定**：把工具暴露成（代码）原语，让模型直接写代码/调用来驱动自己，框架只做薄封装。

- **思路**：相信模型能力，框架越薄越好。
- **优点**：上限高、表达力强（一段代码可组合多工具）、随模型变强而变强。
- **代价**：依赖强模型；需要安全沙箱执行（见 [[runtime-execution]]）。
- **代表**：[[strands|Strands]]（model-driven 命名即理念）、[[smolagents]] 的 CodeAgent（让模型写 Python 调工具）。

## 怎么选

| 任务特征 | 倾向范式 |
|----------|----------|
| 开放、探索性强 | ReAct / Model-driven |
| 步骤多、需分工 | Plan-and-Execute / 多 agent |
| 质量要求高、可多轮 | Reflection |
| 生产、需可控可恢复 | Graph / 状态机 |
| 有强模型 + 安全沙箱 | Model-driven / CodeAct |

现实中常**组合使用**：如"Graph 编排 + 节点内 ReAct + 关键节点 Reflection"。

## 关键要点

- 范式是对循环的组织策略，不是互斥阵营——大框架往往同时支持多种。
- 越靠 ReAct/Model-driven 越自由难控；越靠 Graph 越可控少惊喜，这正是 [[design-tradeoffs|核心权衡]]之一。
- 范式落到组件上，主要体现在 [[reasoning-loop]] 与 [[planning]]。

## 关联

- [[reasoning-loop]] — 范式在"循环组件"里的具体实现
- [[planning]] — Plan-and-Execute 的落地
- [[single-vs-multi-agent]] — 范式如何扩展到多 agent
- [[component-matrix]] — 各框架采用的范式一览
