---
title: "Agent 组件总览"
aliases:
  - Component Taxonomy
  - 组件分类
  - 零件清单
tags:
  - knowledge-base
  - domain/agent-concepts
  - concept/architecture
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# Agent 组件总览

> [!abstract] 一句话总结
> 把任意 agent 框架"解剖"成一份通用的零件清单：**推理循环、规划、上下文工程、工具、记忆、模型抽象、技能/插件、多智能体编排、状态/持久化、可观测/评估、运行时、人在环/治理**。这份清单是横向比较所有框架的统一坐标系——纵向看每个零件的不同实现，见 [[component-matrix]]。

## 参考架构

一个"全功能"agent 大致是这样分层的（不是每个框架都全有）：

```
┌──────────────────────────────────────────────┐
│  人在环 / 治理 (Human-in-the-loop, Governance) │  ← 审批、策略、审计
├──────────────────────────────────────────────┤
│  多智能体编排 (Orchestration)                   │  ← 角色/拓扑/通信
├──────────────────────────────────────────────┤
│  推理循环 (Reasoning Loop)   规划 (Planning)    │  ← agent 的"大脑控制流"
│  上下文工程 (Context Engineering)               │
├───────────────┬───────────────┬──────────────┤
│  工具 (Tools) │  记忆 (Memory)│ 技能/插件     │  ← 能力与外部世界
├───────────────┴───────────────┴──────────────┤
│  模型抽象 (Model Abstraction)                   │  ← 统一各家 LLM
├──────────────────────────────────────────────┤
│  状态/持久化   运行时/执行   可观测/评估         │  ← 工程底座
└──────────────────────────────────────────────┘
```

## 12 个组件（横向坐标系）

### 控制与推理

1. **[[reasoning-loop|推理循环]]** — agent 的主循环：思考→行动→观察怎么转。承载 [[agent-loop-paradigms|范式]]。
2. **[[planning|规划]]** — 任务分解、计划生成与重规划；从"无规划 ReAct"到"显式 DAG"。
3. **[[context-engineering|上下文工程]]** — 怎么把对的信息放进有限的上下文窗口：prompt 模板、消息裁剪、压缩、记忆注入。

### 能力与外部世界

4. **[[tool-use|工具调用]]** — 如何定义工具、把工具暴露给模型、解析调用、执行、回灌结果。含 MCP。
5. **[[memory|记忆]]** — 短期（会话）、长期（跨会话）、向量检索；记忆的写入/检索/遗忘。
6. **[[model-abstraction|模型抽象]]** — 统一不同 provider（OpenAI/Anthropic/本地…）的接口；流式、函数调用、多模态。
7. **[[skills-plugins|技能/插件]]** — 把能力打包成可复用、可分发的单元（skill/plugin/extension）。

### 协作与编排

8. **[[multi-agent-orchestration|多智能体编排]]** — 角色、拓扑、通信、handoff（见 [[single-vs-multi-agent]]）。
9. **[[state-persistence|状态与持久化]]** — agent 状态如何表示、保存、恢复（checkpoint、断点续跑）。

### 工程化

10. **[[observability-eval|可观测与评估]]** — tracing、日志、token/成本、eval 框架。
11. **[[runtime-execution|运行时与执行]]** — 代码沙箱、并发、部署形态（库/服务/serverless/桌面）。
12. **[[human-in-the-loop-governance|人在环与治理]]** — 审批门、策略enforcement、审计；生产安全的关键。

## 怎么用这份清单

- **读单个框架时**：对照这 12 项，看它实现了哪些、强在哪、缺了什么——这正是 [[_templates/framework-note|框架笔记模板]]的组件表。
- **横向比较时**：固定一个组件，看 N 个框架怎么做——这正是 [[component-matrix|对比矩阵]]的一列/一行。
- **设计自己的 agent 时**：当成 checklist，逐项决策。

## 关键要点

- 不是每个框架都覆盖 12 项：轻量库（[[smolagents]]、[[connectonion|ConnectOnion]]）聚焦少数核心；平台（[[dust|Dust]]、[[astron|Astron]]）覆盖更全。
- 同一组件存在巨大的实现差异（纵向），这正是学习的重点。
- 组件划分是分析工具，不是某个框架的真实模块边界。

## 关联

- 横向落地：[[components/_index|组件维度]]
- 纵向落地：[[frameworks/_index|框架维度]] · [[component-matrix]]
- 上游心智模型：[[what-is-an-agent]] · [[agent-loop-paradigms]] · [[single-vs-multi-agent]]
