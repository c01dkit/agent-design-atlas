---
title: "<Framework>"
aliases:
  - <别名/缩写>
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/<name>
  - lang/<python|typescript|go|csharp|rust|other>
  - paradigm/<single|multi|rag|platform|voice|model-stack>
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: <url>
license: <license>
stars: <approx>
---

# <Framework>

> [!abstract] 一句话定位
> <定位 / 设计目标 / 适用场景，一句话>

## 设计理念 / 顶层架构

<opinionated 设计取舍；主模块/包如何组织；入口 API 形态。给一段最小可运行示例（hello-world），展示这个框架"长什么样"。>

```python
# 最小示例
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct? plan-execute? graph? | `path:line` |
| [[planning\|规划/任务分解]] | | |
| [[memory\|记忆(短/长/向量)]] | | |
| [[tool-use\|工具调用]] | | |
| [[model-abstraction\|模型抽象]] | | |
| [[multi-agent-orchestration\|多智能体编排]] | | |
| [[context-engineering\|上下文工程]] | | |
| [[skills-plugins\|技能/插件]] | | |
| [[observability-eval\|可观测/评估]] | | |
| [[runtime-execution\|运行时/部署]] | | |
| [[human-in-the-loop-governance\|人在环/治理]] | | |
| [[state-persistence\|状态/持久化]] | | |

## 设计权衡与特性

<强项、tradeoff、与同范式框架的差异。它"特别"在哪？>

## 关联

- [[component-taxonomy]] · 同范式：[[<framework>]] · 源码：`agents-example/<name>/`
