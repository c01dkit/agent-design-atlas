---
title: "CrewAI"
aliases:
  - CrewAI
  - crewai
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/crewai
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/joaomdmoura/crewai
license: MIT (LICENSE 文件 Copyright (c) 2025 crewAI, Inc.)
stars: ~40k
---

# CrewAI

> [!abstract] 一句话定位
> 一个"从零自建、不依赖 LangChain"的 Python multi-agent 编排框架，核心隐喻是**角色扮演的团队（Crew）**：用 role/goal/backstory 定义 Agent，用 Task 描述工作，用 Process（sequential 顺序 / hierarchical 经理派活）驱动协作；同时提供**事件驱动的 Flow** 做生产级精确流程控制，二者可组合，兼顾"自治协作"与"确定性编排"。

## 设计理念 / 顶层架构

CrewAI 的核心范式是 **multi-agent 角色协作 + 进程化任务编排**，并在其上叠加一层 **event-driven Flow** 做生产控制。设计取舍：

- **两条主线 Crew vs Flow**：**Crew** 走自治协作（agent 之间靠 delegation 工具互相派活，强调 agency）；**Flow** 走确定性编排（`@start`/`@listen`/`@router` + 结构化 state，强调可控、可持久化、单次 LLM 调用），README 明确把 Flow 定位为"enterprise/production 架构"。Crew 可作为 Flow 的一个步骤被 `kickoff()` 调用。
- **声明式四件套**：`Agent`(role/goal/backstory) + `Task`(description/expected_output) + `Process` + `Crew`，外加 `@CrewBase`/`@agent`/`@task`/`@crew` 装饰器把 YAML（`agents.yaml`/`tasks.yaml`）绑定到类，CLI `crewai create crew` 脚手架生成项目骨架。
- **monorepo 包结构**：源码在 `lib/crewai/src/crewai`（本笔记路径均相对此根之上的 `lib/crewai/src/`，即仓库内 `lib/crewai/src/crewai/...`）。骨架：`agent/`(Agent 核心) · `agents/`(executor/delegation/parser) · `crew.py` · `task.py` · `process.py` · `flow/`(DSL + runtime + persistence) · `llms/`(native provider + LiteLLM 回退) · `memory/`(LanceDB 统一记忆) · `tools/` · `knowledge/`(RAG) · `mcp/` · `events/`(事件总线) · `telemetry/`(OTel) · `skills/`。
- **不绑定 LangChain**：自带 LLM 抽象、工具系统、记忆、RAG，独立实现；LLM 层用原生 SDK（openai/anthropic/gemini/azure/bedrock）+ LiteLLM 兜底。

最小示例（取自 README）：

```python
from crewai import Agent, Crew, Process, Task

researcher = Agent(
    role="Senior Data Researcher",
    goal="Uncover cutting-edge developments in AI",
    backstory="You're a seasoned researcher with a knack for the latest trends.",
)
research_task = Task(
    description="Conduct thorough research about AI agents in 2025.",
    expected_output="A list of 10 bullet points of the most relevant info.",
    agent=researcher,
)
crew = Crew(
    agents=[researcher],
    tasks=[research_task],
    process=Process.sequential,   # 或 Process.hierarchical（自动加经理 agent）
    verbose=True,
)
print(crew.kickoff(inputs={"topic": "AI Agents"}))
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 双模 agent loop：LLM 支持 native function calling 则走结构化 tool_calls 回灌循环，否则回退 ReAct 文本模式（解析 `Action/Action Input`）；均循环至 `AgentFinish` 或 `max_iter` | `crewai/agents/crew_agent_executor.py:306` (`_invoke_loop`), `:327` (`_invoke_loop_react`), `:467` (`_invoke_loop_native_tools`) |
| [[planning\|规划/任务分解]] | ①Crew 级 `planning=True`：跑前用 planning agent 为每个 task 生成 step-by-step plan 注入描述；②hierarchical 经理动态分解派活；任务编排本身是声明式 Task 列表 | `crewai/crew.py:1406` (`_handle_crew_planning`), `crewai/utilities/planning_handler.py:37` (`CrewPlanner`), `:80` (`_create_planning_agent`) |
| [[memory\|记忆(短/长/向量)]] | 统一 `Memory`：保存时用 LLM 抽取记忆并推断 scope/category/importance，按 recency+semantic+importance 加权检索；默认 LanceDB 向量存储（亦支持 Qdrant）；`crew.memory=True` 启用 | `crewai/memory/unified_memory.py:56` (`Memory`), `crewai/memory/analyze.py` (`extract_memories_from_content`), `crewai/memory/storage/lancedb_storage.py`, `crewai/crew.py:653` |
| [[tool-use\|工具调用]] | `BaseTool`(pydantic `args_schema`) / `Tool`；`@tool` 装饰器或子类化；native 模式转 OpenAI schema，ReAct 模式渲染文本；`ToolUsage` 负责选择/执行/缓存/容错 | `crewai/tools/base_tool.py` (`BaseTool`), `crewai/tools/tool_usage.py:73` (`ToolUsage`), `:123` (`use`), `crewai/tools/structured_tool.py` |
| [[model-abstraction\|模型抽象]] | `BaseLLM` 抽象基类 + `LLM.__new__` 工厂按 `provider/model` 前缀路由：openai/anthropic/azure/bedrock/gemini 走原生 SDK，其余回退 LiteLLM；`create_llm` 统一构造 | `crewai/llms/base_llm.py:129` (`BaseLLM`), `crewai/llm.py:315` (`LLM`), `:340` (`__new__` 路由), `crewai/utilities/llm_utils.py:13` (`create_llm`) |
| [[multi-agent-orchestration\|多智能体编排]] | `Process.sequential`(按序执行 task) / `Process.hierarchical`(自动建经理 agent 持 `AgentTools` 委派)；agent 间经 Delegate/AskQuestion 工具协作；A2A 协议跨进程 | `crewai/process.py:4`, `crewai/crew.py:1464` (`_run_sequential_process`), `:1468`/`:1473` (`_run_hierarchical_process`/`_create_manager_agent`), `crewai/tools/agent_tools/delegate_work_tool.py:16` |
| [[context-engineering\|上下文工程]] | Task 描述模板插值(`{topic}`)；task context 由前序 TaskOutput 串联(`_get_context`)；执行前注入 knowledge(RAG) 检索与 memory 召回；超窗时 `respect_context_window` 处理 | `crewai/agent/core.py:782` (`_prepare_task_execution`+knowledge), `crewai/crew.py:1564` (`_get_context`), `crewai/knowledge/knowledge.py`, `crewai/agents/crew_agent_executor.py:444` (context length) |
| [[skills-plugins\|技能/插件]] | `skills/` 模块：发现并激活 Skill（`discover_skills`/`activate_skill`，YAML 元数据）；`crewai_tools` 独立包提供数百个工具；MCP 客户端把外部 MCP server 工具接入 | `crewai/skills/loader.py` (`discover_skills`/`activate_skill`), `crewai/skills/models.py`, `crewai/mcp/client.py:54` (`MCPClient`), `lib/crewai-tools/` |
| [[observability-eval\|可观测/评估]] | 内置事件总线 `crewai_event_bus`(LLM/Tool/Agent/Memory 全生命周期事件) + OpenTelemetry 匿名遥测(可 `OTEL_SDK_DISABLED` 关)；Task guardrail / task_evaluator 做输出评估 | `crewai/events/event_bus.py`, `crewai/telemetry/telemetry.py:1`, `crewai/tasks/llm_guardrail.py:49` (`LLMGuardrail`), `crewai/utilities/evaluators/task_evaluator.py` |
| [[runtime-execution\|运行时/部署]] | 纯库；`crew.kickoff()` 同步执行(支持 `kickoff_async`/`kickoff_for_each`/`stream`)，async task 用 ThreadPool 并行；CLI `crewai create/run/install`；AMP 云控制面做生产部署 | `crewai/crew.py:963` (`kickoff`), `:1547` (async task 并行), `crewai/flow/runtime.py:1925` (Flow `kickoff`), `crewai/cli/` |
| [[human-in-the-loop-governance\|人在环/治理]] | Task `human_input=True`：agent 出终答后请求人工反馈并据此再迭代；Flow 侧 `human_feedback` DSL 做流程级审批；before/after_kickoff 钩子 | `crewai/task.py:227` (`human_input`), `crewai/agents/crew_agent_executor.py:1596` (`_handle_human_feedback`), `crewai/flow/human_feedback.py`, `crewai/project/annotations.py:42` (`before_kickoff`) |
| [[state-persistence\|状态/持久化]] | Flow 结构化 `state`(Pydantic BaseModel) + `@persist`/`persistence` 默认 SQLite 落盘，支持断点续跑；Crew 侧 `CheckpointConfig`+`apply_checkpoint` 做 task 级 checkpoint 恢复 | `crewai/flow/runtime.py:244` (`FlowState`), `crewai/flow/persistence/sqlite.py`, `crewai/flow/persistence/decorators.py:163` (`persist`), `crewai/state/checkpoint_config.py:159` (`CheckpointConfig`), `:214` (`apply_checkpoint`) |

## 设计权衡与特性

- **角色扮演心智模型**：用 role/goal/backstory 的"团队"隐喻降低多智能体上手门槛，是 CrewAI 区别于 graph 派（LangGraph）的最大特色——开发者描述"谁、做什么、目标"，而非显式画状态图。
- **Crew(自治) vs Flow(确定) 双层**：早期只有 Crew，自治协作虽灵活但难以保证生产可控性；后来加入 Flow（事件驱动 + 结构化 state + 持久化）补足确定性，README 直接对标 LangGraph 并强调 5.76x 性能优势。代价是框架表面积变大、两套心智需要学习取舍。
- **"从零自建"独立性**：明确不依赖 LangChain，自带 LLM/工具/记忆/RAG。LLM 层"原生 SDK 优先 + LiteLLM 兜底"兼顾性能与广覆盖（`llm.py:340`）。
- **声明式 + 装饰器 + YAML**：`@CrewBase`/`@agent`/`@task` 把配置与代码分离，利于非工程角色维护 prompt；但魔法装饰器与 forward-ref 重建（`__init__.py` 大量 `model_rebuild`）增加了调试复杂度。
- **记忆代际更替**：当前版本(1.14.7a1)记忆已统一为 LLM 分析 + LanceDB 向量的 `unified_memory.Memory`，未见旧版 ShortTerm/LongTerm/Entity 分立类——与较老文档/教程描述不一致，使用时需以源码为准。
- **遥测默认开启**：OpenTelemetry 匿名遥测默认收集（版本/OS/agent 数/process 类型等，不含 prompt），可 `OTEL_SDK_DISABLED=true` 关闭；`share_crew=True` 会上报更详细数据，隐私敏感场景需注意。
- **待确认**：①本仓库为 monorepo（`lib/crewai` 元包依赖 `crewai-core`/`crewai-cli`），核心逻辑实际分散在多个子包，部分实现细节可能下沉到 `crewai-core`（本笔记以 `lib/crewai/src/crewai` 为准）；②`BaseLLM` 具体行号未逐一核对，标注为类定义位置。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi-agent 编排)：[[connectonion]] · 源码：`agents-example/crewai/`
