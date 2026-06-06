---
title: "Swarm"
aliases:
  - OpenAI Swarm
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/swarm
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/openai/swarm
license: MIT
---

# Swarm

> [!abstract] 一句话定位
> OpenAI 出品的**教学型**极简多智能体编排库（核心仅约 300 行）：用"函数即工具 + 返回 Agent 即移交（handoff）"两个原语，演示轻量、人体工学的多 agent 协作。无状态、不为生产设计。

## 设计理念 / 顶层架构

Swarm 刻意做到最小，只为讲清两个概念：**Agent（轻量角色）**与 **handoff（控制权移交）**。整个库就 4 个文件（`agents-example/swarm/swarm/`）：`core.py`（循环）、`types.py`（数据模型）、`util.py`（函数转 schema）、`__init__.py`。

- `Swarm` 类仅包一个 OpenAI client（`core.py:26`），无额外状态——**无状态**设计：history 由调用方传入、随 `Response` 传出。
- `Agent` 是 pydantic 模型（`types.py:14`）：`name / model / instructions(可为函数) / functions / tool_choice / parallel_tool_calls`。
- 核心循环 `Swarm.run()`（`core.py:231`）：取补全 → 若无 tool_calls 则结束 → 执行工具 → **若某工具返回了 Agent，则切换 active_agent**（`core.py:285`）。

最小示例：

```python
from swarm import Swarm, Agent
client = Swarm()

def transfer_to_spanish():            # 工具返回一个 Agent = 移交
    return spanish_agent

english = Agent(name="English", instructions="Only English.", functions=[transfer_to_spanish])
spanish = Agent(name="Spanish", instructions="Solo español.")

resp = client.run(agent=english, messages=[{"role":"user","content":"Hola"}])
print(resp.messages[-1]["content"])   # 自动 handoff 到 spanish_agent
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 式工具循环；`while` 直到无 tool_call 或 max_turns | `core.py:257` |
| [[planning\|规划/任务分解]] | N/A，无显式规划 | — |
| [[memory\|记忆]] | N/A，无记忆；history 调用方自管（无状态） | `core.py:253` |
| [[tool-use\|工具调用]] | 普通 Python 函数 → `function_to_json` 自动转 OpenAI tool schema；原生 function calling | `util.py:function_to_json`, `core.py:50` |
| [[model-abstraction\|模型抽象]] | **仅 OpenAI**，硬编码 `OpenAI()` client，无抽象层 | `core.py:8,29` |
| [[multi-agent-orchestration\|多智能体编排]] | **网状 handoff**：工具返回 `Agent`/`Result(agent=...)` 即移交控制权 | `core.py:76,134,285` |
| [[context-engineering\|上下文工程]] | system=instructions + history；`context_variables` 注入函数且对模型隐藏 | `core.py:42,51,120` |
| [[skills-plugins\|技能/插件]] | N/A | — |
| [[observability-eval\|可观测/评估]] | 仅 `debug_print` | `util.py:debug_print` |
| [[runtime-execution\|运行时/部署]] | 纯库，同步；工具在本进程直接执行（无沙箱） | `core.py:122` |
| [[human-in-the-loop-governance\|人在环/治理]] | N/A | — |
| [[state-persistence\|状态/持久化]] | N/A，无持久化；`Response` 含 messages+agent+context_variables 供下次传入 | `types.py:23` |

## 设计权衡与特性

- **极简优雅**：handoff 抽象（工具返回 agent）是全库最大亮点，被后来许多框架借鉴。
- **无状态**：可控、易测，但记忆/编排/持久化全交给使用者。
- **教学定位**：官方明确不维护、不为生产；要生产用 [[ag2\|AG2]] / [[autogen\|AutoGen]]。
- 与 [[crewai\|CrewAI]]（角色+流程）、[[autogen\|AutoGen]]（群聊）相比，Swarm 是"去框架化"的极小内核。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式：[[agency-swarm]] · [[autogen]] · [[swarms]] · 源码：`agents-example/swarm/`
