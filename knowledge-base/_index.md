---
title: "Agent 设计知识库"
aliases:
  - Agent Knowledge Base
  - agent-design-kb
tags:
  - knowledge-base
  - MOC
date_created: 2026-06-05
date_updated: 2026-06-05
status: draft
---

# Agent 设计知识库

通过通读 [awesome-agents](https://github.com/kyrolabs/awesome-agents) 收录的 50 个开源框架源码，系统梳理 **LLM Agent 的设计原理、组件构成与实现方式**。

本库围绕一个二维视图组织：

- **横向（组件维度）**：一个 agent 可以拆成哪些组件？不同项目的顶层架构与组件相同或不同 → [[component-taxonomy|组件总览]]
- **纵向（实现维度）**：同一个组件，在不同框架里有哪些不同实现方式？ → [[component-matrix|框架 × 组件 矩阵]]

## 领域导航

- [[concepts/_index|① 顶层思考 · Concepts]] — agent 是什么、有哪些范式、核心设计权衡
- [[components/_index|② 组件维度 · Components]] — 推理循环、规划、记忆、工具、编排……逐个组件横向汇总各框架实现
- [[frameworks/_index|③ 框架维度 · Frameworks]] — 50 个框架的源码级深度分析（每框架一篇）
- [[comparisons/_index|④ 横纵对比 · Comparisons]] — 对比矩阵、范式聚类、语言/生态分布

## 推荐学习路径

1. 先读 [[what-is-an-agent]] 与 [[agent-loop-paradigms]]，建立 agent 的心智模型
2. 用 [[component-taxonomy]] 理解一个 agent 的"零件清单"（横向）
3. 在 [[component-matrix|对比矩阵]] 里挑你关心的组件，横向比较各框架实现（纵向）
4. 下钻到具体 [[frameworks/_index|框架笔记]] 看源码级细节
5. 用 [[design-tradeoffs]] 回到顶层，理解"为什么不同框架做了不同选择"

## 元信息

- 框架源码位于 `agents-example/<name>/`（git submodule，浅克隆）
- 笔记规范见 [[_templates/framework-note|框架笔记模板]] 与 [[_templates/component-note|组件笔记模板]]
