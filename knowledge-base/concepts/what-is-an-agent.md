---
title: "什么是 Agent"
aliases:
  - What is an Agent
  - Agent 定义
tags:
  - knowledge-base
  - domain/agent-concepts
  - concept/foundation
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 什么是 Agent

> [!abstract] 一句话总结
> 一个 LLM Agent = **模型 + 循环 + 工具/记忆**：由大模型在一个循环里自主决定"下一步做什么"，调用工具观察结果、更新状态，直到达成目标或触发停止条件。区别于固定流程的 workflow，agent 的控制流是模型动态决定的。

## 核心定义

Anthropic 在《Building Effective Agents》中给出一个有用的区分：

- **Workflow（工作流）**：LLM 和工具通过**预先编排好的代码路径**协作。流程是人写死的，LLM 只在固定的格子里填空。
- **Agent（智能体）**：LLM **动态地决定自己的流程与工具使用**，自主掌控如何完成任务。

判断一个系统是不是 agent，关键看一句话：**"下一步做什么"是由代码写死的，还是由模型在运行时决定的？** 后者才是 agent 的本质。

## 最小构成

一个能跑的 agent，最少需要四件东西：

1. **模型（Model）**——决策核心，见 [[model-abstraction]]
2. **循环（Loop）**——反复"思考→行动→观察"，见 [[reasoning-loop]]
3. **工具（Tools）**——与外部世界交互的手段，见 [[tool-use]]
4. **停止条件（Termination）**——任务完成 / 超出步数 / 出错

```python
# 一个 agent 的本质，去掉所有框架糖衣后大致如此：
state = initial_context(task)
while not done(state):
    action = model.decide(state)        # 模型决定下一步
    if action.is_final:
        return action.answer            # 停止条件
    observation = tools.run(action)     # 行动 + 观察
    state = update(state, action, observation)  # 更新上下文
```

几乎所有框架（无论多复杂）都是在给这个循环加结构：加规划、加记忆、加多 agent 协作、加可观测……但内核不变。

## 与相邻概念的边界

| 概念 | 控制流 | 是否调用工具 | 是否多步自主 |
|------|--------|--------------|--------------|
| **Chatbot** | 人来一句答一句 | 通常否 | 否 |
| **RAG** | 检索→拼接→生成，固定 | 检索算工具 | 否（单步） |
| **Workflow** | 代码预编排 | 是 | 步骤固定 |
| **Agent** | **模型运行时决定** | 是 | **是** |

注意这是光谱而非黑白：很多"agentic RAG"、"agentic workflow"介于其间。把 RAG 的检索包成一个工具交给循环，它就 agent 化了。

## 自主性光谱

- **L0 固定链**：prompt 链，无分支（早期 LangChain Chain）
- **L1 路由**：模型在固定分支里选路（router）
- **L2 工具循环**：ReAct 式自主调工具（见 [[agent-loop-paradigms]]）
- **L3 规划-执行**：先规划再执行，能自我修正（见 [[planning]]）
- **L4 多智能体**：多个 agent 分工协作（见 [[single-vs-multi-agent]]）
- **L5 自改进 / 长期自治**：持续运行、从反馈中学习（如 Agentic Context Engine、Aeon）

## 关键要点

- Agent 的灵魂是**"模型掌控控制流"**，不是"用了 LLM"。
- 复杂框架 = 给最小循环加组件，组件清单见 [[component-taxonomy]]。
- 自主性越高，越强大也越难控制——可控性是工程化的核心矛盾，见 [[design-tradeoffs]]。

## 关联

- [[agent-loop-paradigms]] — 循环具体怎么转
- [[component-taxonomy]] — agent 的零件清单
- [[reasoning-loop]] · [[tool-use]] · [[planning]]
