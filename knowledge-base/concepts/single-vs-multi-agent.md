---
title: "单 Agent 与多 Agent"
aliases:
  - Single vs Multi-Agent
  - 多智能体
tags:
  - knowledge-base
  - domain/agent-concepts
  - concept/architecture
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 单 Agent 与多 Agent

> [!abstract] 一句话总结
> 当单个循环难以兼顾"既要规划、又要执行、还要审查"时，把职责拆给多个各有角色的 agent，通过**编排拓扑**（主从/网状/流水线/群聊）与**通信机制**（handoff/消息/共享状态）协作。多 agent 不总是更优——它用协调成本换分工与专注。

## 从单到多：为什么

单 agent 的瓶颈：

- 上下文塞太多（既是程序员又是测试又是产品经理）→ 注意力稀释
- 单一 prompt 难以同时是"创意发散"和"严格审查"
- 难以并行

多 agent 的回报：**专注**（每个 agent 一个角色/一套工具/一段 prompt）、**分工与并行**、**可组合**。代价是**协调开销**与**误差传播**。

## 编排拓扑

| 拓扑 | 形态 | 代表框架 |
|------|------|----------|
| **主从 / 层级（Supervisor）** | 一个 orchestrator 派活给 worker，汇总结果 | [[maestro\|Maestro]]、[[metagpt\|MetaGPT]]、LangGraph supervisor |
| **网状 / 群（Swarm/Network）** | agent 之间对等，可互相 handoff | [[swarm\|Swarm]]、[[swarms\|Swarms]]、[[agency-swarm\|agency-swarm]] |
| **流水线（Sequential）** | A→B→C 顺序传递 | [[crewai\|CrewAI]] sequential process、[[haystack\|Haystack]] |
| **群聊（Group Chat）** | 多 agent 在共享会话里发言，由 manager 调度 | [[autogen\|AutoGen]]、[[ag2\|AG2]] |
| **环境 / 沙盘（Environment）** | agent 在一个共享环境里行动（含仿真） | [[agentverse\|AgentVerse]] |

## 通信机制

- **Handoff（移交）**：当前 agent 把控制权连同上下文交给另一个 agent（[[swarm|Swarm]] 的核心抽象——工具返回一个 agent 即转交）。
- **消息传递（Messages）**：agent 间发结构化消息，常配合群聊/黑板（[[autogen|AutoGen]]）。
- **共享状态 / 黑板（Shared State）**：所有 agent 读写同一份状态（LangGraph state、[[metagpt|MetaGPT]] 的共享消息池）。
- **跨进程 / 网络**：agent 跑在不同终端/机器，用协议通信（[[hcom|hcom]]、[[pilotprotocol|Pilot Protocol]]、A2A）。

## 角色（Roles）

把人类组织搬进系统：MetaGPT 用"产品经理/架构师/工程师/QA"的 SOP；CrewAI 用 role+goal+backstory 定义每个 crew 成员。角色 = 专属 prompt + 专属工具集 + 在拓扑中的位置。

## 何时**不要**上多 agent

- 任务能被单 agent + 好工具解决时，多 agent 只是徒增延迟与失败面。
- 误差会沿链路传播放大；agent 越多越难调试。
- 经验法则：**先把单 agent 做到极致，再在确有分工收益处引入多 agent。**

## 关键要点

- 多 agent 的三要素：**角色、拓扑、通信**。
- 拓扑选择本质是"集中控制 vs 分布自治"的权衡。
- 落到组件即 [[multi-agent-orchestration]]；与 [[state-persistence]]（共享状态）强相关。

## 关联

- [[multi-agent-orchestration]] — 编排组件的实现细节
- [[agent-loop-paradigms]] — 单 agent 的循环范式
- [[component-matrix]] — 哪些框架专注多 agent
