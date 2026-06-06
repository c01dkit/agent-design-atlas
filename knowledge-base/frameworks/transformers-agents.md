---
title: "Transformers Agents"
aliases:
  - HuggingFace Transformers Agents
  - transformers.agents
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/transformers-agents
  - lang/python
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://huggingface.co/docs/transformers/transformers_agents
license: Apache-2.0
---

# Transformers Agents

> [!abstract] 一句话定位
> HuggingFace 在 `transformers` 库之上提供的"自然语言 API"：把一句指令交给 LLM，由它选择并调用一组 transformers/HF 工具（图像、语音、文本等）来完成多模态任务。是较早的 agent 化尝试，现已被独立项目 [[smolagents]] 取代/承继。

> [!note] 来源说明
> 该条目在 awesome-agents 中指向 HuggingFace **文档**而非独立 Git 仓库，故未纳入 `agents-example/` submodule；本笔记基于官方文档与其在 `transformers` 主库 `src/transformers/agents` 的实现概念整理，不含 `path:line`。源码级细节请优先参考其精神继承者 [[smolagents]]。

## 设计理念 / 顶层架构

核心思想：**LLM 作为"工具选择器/编排器"**，在一组预置工具（多为 HF pipeline 封装：文生图、语音转写、翻译、问答等）之上，用自然语言驱动多步多模态流程。演进脉络：

- **v1（2023, Transformers Agents）**：`Agent.run()`，LLM 生成"调用哪些工具"的计划/代码，框架执行。
- **v2（Agents 2.0）**：引入 `ReactCodeAgent` / `ReactJsonAgent`——ReAct 循环 + 代码/JSON 两种工具调用形态，强调让模型**写代码**调用工具（CodeAct 雏形）。
- **现状**：该方向已迁出为独立库 [[smolagents]]，`transformers` 内的 agents 模块逐步退役。

```python
# 概念示意（Agents 2.0 风格）
from transformers import ReactCodeAgent, HfApiEngine
agent = ReactCodeAgent(tools=[], llm_engine=HfApiEngine())
agent.run("生成一张猫的图片并描述它")
```

## 组件实现（横向逐项，docs 级，无 path:line）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct（ReactCodeAgent / ReactJsonAgent）；早期为单步 plan-then-run | docs: transformers_agents |
| [[planning\|规划/任务分解]] | 由 LLM 隐式规划工具调用序列；无独立 planner | docs |
| [[memory\|记忆]] | 会话内 agent memory（步骤日志）；无长期/向量记忆 | docs |
| [[tool-use\|工具调用]] | `Tool` 抽象 + HF 工具箱（pipeline 封装）；支持代码调用与 JSON 调用 | docs: custom tools |
| [[model-abstraction\|模型抽象]] | `llm_engine`（HfApiEngine / TransformersEngine / 兼容 OpenAI 等） | docs |
| [[multi-agent-orchestration\|多智能体编排]] | 后期支持 managed agents（一个 agent 调用另一个），整体仍偏单 agent | docs |
| [[context-engineering\|上下文工程]] | 系统提示 + 工具描述 + ReAct 轨迹拼接 | docs |
| [[skills-plugins\|技能/插件]] | 自定义 `Tool` / Hub 上分享工具 | docs: share tool |
| [[observability-eval\|可观测/评估]] | 步骤日志、verbose 输出；无内建 eval | docs |
| [[runtime-execution\|运行时/部署]] | 代码工具在受限 Python 解释器执行（安全沙箱有限）；库内调用 | docs |
| [[human-in-the-loop-governance\|人在环/治理]] | N/A（无显式审批/治理） | — |
| [[state-persistence\|状态/持久化]] | N/A（无持久化） | — |

## 设计权衡与特性

- **多模态工具箱**是其特色：天然接入 HF 生态的图像/语音/文本 pipeline。
- **历史意义 > 当下使用**：它把"LLM 写代码调用工具"（CodeAct）的思路带入主流，但工程化、沙箱、可观测较弱。
- **迁移建议**：新项目直接用 [[smolagents]]（同团队、同理念、独立维护、沙箱更完善）。

## 关联

- 精神继承：[[smolagents]] · 范式：[[agent-loop-paradigms]]（ReAct / CodeAct）
- [[component-taxonomy]] · [[model-abstraction]] · [[tool-use]]