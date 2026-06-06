---
title: "组件维度 · Components"
aliases:
  - Agent Components
tags:
  - knowledge-base
  - MOC
  - domain/agent-components
date_created: 2026-06-05
date_updated: 2026-06-05
status: draft
---

# 组件维度 · Components

**横向**视角：把 agent 拆成可独立讨论的组件。每篇组件笔记回答两个问题——这个组件**是什么 / 解决什么问题**，以及它在各框架里有哪些**不同实现方式**（纵向汇总）。

## 控制与推理

- [[reasoning-loop]] — 推理/执行循环（agent 的"主循环"）
- [[planning]] — 规划与任务分解
- [[context-engineering]] — 上下文工程与 prompt 管理

## 能力与外部世界

- [[tool-use]] — 工具调用 / function calling
- [[memory]] — 记忆（短期 / 长期 / 向量）
- [[model-abstraction]] — 模型抽象层（LLM provider 接口）
- [[skills-plugins]] — 技能 / 插件 / 扩展机制

## 协作与编排

- [[multi-agent-orchestration]] — 多智能体编排（角色 / 通信 / handoff）
- [[state-persistence]] — 状态与持久化

## 工程化

- [[observability-eval]] — 可观测、追踪与评估
- [[runtime-execution]] — 运行时、执行环境与部署
- [[human-in-the-loop-governance]] — 人在环与治理

## 关联

- 总体框架见 [[component-taxonomy]]；横向对比见 [[component-matrix]]
