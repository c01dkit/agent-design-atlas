---
title: "Swarms"
aliases:
  - Swarms
  - swarms
  - kyegomez/swarms
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/swarms
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/kyegomez/swarms
license: Apache-2.0
stars: ~5k
---

# Swarms

> [!abstract] 一句话定位
> 企业级 Python **多智能体编排**框架：以一个功能极重的 `Agent`（单文件 6400+ 行）为唯一原语，向上堆叠十余种可互换的 swarm 结构（Sequential / Concurrent / AgentRearrange / Graph / MixtureOfAgents / Hierarchical / GroupChat / MajorityVoting / Council / Debate / Heavy …），并用 `SwarmRouter` 一个入口在这些拓扑之间自由切换；模型层全量依赖 LiteLLM，兼容任意 provider。

## 设计理念 / 顶层架构

Swarms 的设计取舍是 **"一个胖 Agent + 一堆可组合的编排壳"**：

- **Agent 即唯一原语**：所有多智能体结构都只是包了一个或多个 `Agent` 实例的编排器。`Agent` 自身把 ReAct 循环、工具、记忆、MCP、流式、自治模式、持久化、可观测全部塞进单个类（`swarms/structs/agent.py:202`，约 6443 行）——属于"反 KISS"的厚内核。
- **结构即拓扑**：`swarms/structs/`（60+ 文件）每个文件是一种 multi-agent 拓扑。它们不共享统一基类约束，而是各自实现 `run()`，靠 `SwarmRouter`（`swarms/structs/swarm_router.py:118`）按 `swarm_type` 字符串分派统一。`SwarmType` 共 17 种（`swarm_router.py:48`），含 `"auto"`（让 LLM 选拓扑）。
- **模型层外包给 LiteLLM**：没有自研 provider 适配，`LiteLLM` 包装类（`swarms/utils/litellm_wrapper.py:132`）直接调用 `litellm.completion`，因此任意 LiteLLM 模型串（OpenAI/Anthropic/Groq/Gemini…）即插即用。
- **入口 API**：官方强约束"只从顶层导入"——`from swarms import Agent, SequentialWorkflow, SwarmRouter, ...`（`swarms/__init__.py` 用 `from swarms.structs import *` 平铺导出）。`agent.run(task)` 是主入口（`agent.py:4690`）。
- **电池**：`tools/`（函数→OpenAI schema、MCP 客户端、Pydantic 转换）、`telemetry/`（启动即向 swarms.world 上报，需开关）、`prompts/`、`cli/`、`v12` 新增 `persistent_memory`/`context_compression`/自治 `max_loops="auto"`。

最小示例（取自 README / CLAUDE.md）：

```python
from swarms import Agent, SequentialWorkflow

# 1) 单 agent —— 唯一原语
agent = Agent(
    agent_name="Analyst",
    model_name="gpt-4.1",       # 任意 LiteLLM 模型串
    max_loops=1,
)
print(agent.run("Summarise the current state of LLM research."))

# 2) 把多个 agent 串成拓扑
pipeline = SequentialWorkflow(
    agents=[
        Agent(agent_name="Researcher", model_name="gpt-4.1"),
        Agent(agent_name="Writer",     model_name="gpt-4.1"),
        Agent(agent_name="Editor",     model_name="gpt-4.1"),
    ],
    max_loops=1,
)
print(pipeline.run("Write an article about the history of neural networks."))
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 式 `while` 循环：`call_llm`→`parse_llm_output`→若有 tool_calls 则 `execute_tools` 回灌→重复，直到无 tool_call 或 `loop_count >= max_loops`；`max_loops="auto"` 时无上限直到自决完成 | `agent.py:1616` (主循环), `agent.py:1701` (`call_llm`), `agent.py:1787` (`execute_tools` 触发) |
| [[planning\|规划/任务分解]] | 可选 `plan_enabled`/`plan(task)`：用 planning_prompt+历史让 LLM 先产出 step-by-step 计划写入短期记忆；`max_loops="auto"` 走 `_run_autonomous_loop` 的 plan→execute→reflect 三段式；专门拓扑 `PlannerWorkerSwarm`/`AutoSwarmBuilder` | `agent.py:3159` (`plan`), `agent.py:2105` (`_run_autonomous_loop`), `structs/planner_worker_swarm.py` |
| [[memory\|记忆(短/长/向量)]] | 短期=`Conversation`（默认 in-memory 消息列表，`conversation.py:52`）；长期=v12 `persistent_memory` 把 `MEMORY.md` 作为 system 前导注入并逐轮追加（`conversation.py:281,420`）；`compact()` 摘要+归档（`conversation.py:314`）；**无内建向量记忆** → N/A | `structs/conversation.py:52`, `agent.py:522` (`persistent_memory`), `conversation.py:314` (`compact`) |
| [[tool-use\|工具调用]] | 普通 Python 函数（带 docstring/type hints）→ `BaseTool.func_to_dict` 自动转 OpenAI function schema；Pydantic 模型经 `base_model_to_openai_function`；原生 function calling，结果回灌对话 | `tools/base_tool.py:69,142`, `tools/pydantic_to_json.py`, `agent.py:6042` (`execute_tools`), `agent.py:6367` (`tool_execution_retry`) |
| [[model-abstraction\|模型抽象]] | 不自研 provider：`LiteLLM` 包装类持有模型名/参数，`run()` 内组装 `completion_params` 调 `litellm.completion`；自动探测 vision/reasoning 支持，映射 `reasoning_effort`/`thinking_tokens` | `utils/litellm_wrapper.py:132` (`LiteLLM`), `litellm_wrapper.py:1151` (`run`), `litellm_wrapper.py:1335` (`completion`), `agent.py:1065` (`llm_handling`) |
| [[multi-agent-orchestration\|多智能体编排]] | 核心卖点：60+ 拓扑文件，经 `SwarmRouter` 按 17 种 `SwarmType` 统一分派；含 Sequential/Concurrent(ThreadPool)/AgentRearrange(flow DSL)/Graph(DAG 拓扑排序)/MixtureOfAgents/Hierarchical/GroupChat/MajorityVoting/Council/Debate/Heavy/RoundRobin 等；另有 `handoffs` 让 agent 间移交 | `structs/swarm_router.py:118`, `swarm_router.py:48` (`SwarmType` 17 项), `structs/sequential_workflow.py:52`, `structs/concurrent_workflow.py:23`, `structs/agent_rearrange.py:34`, `structs/graph_workflow.py`, `structs/multi_agent_exec.py` |
| [[context-engineering\|上下文工程]] | system_prompt 注入 + 历史拼接（`return_history_as_string`）；v12 `ContextCompressor` 在 token 用量超 90% 阈值时 `maybe_compress` 摘要旧消息；`transforms` 可在每轮重写 task_prompt；`dynamic_context_window` 工具 | `agent.py:528` (`ContextCompressor(threshold=0.9)`), `agents/context_compressor.py:40,162`, `agent.py:1658` (`handle_transforms`), `utils/dynamic_context_window.py` |
| [[skills-plugins\|技能/插件]] | 无独立"plugin 总线"；扩展点是 ①工具列表 ②可选拓扑结构。`dynamic_skills_loader`/`skill_orchestra`/`csv_to_agent`/`agent_loader`(markdown) 提供从文件/CSV/MD 动态装载 agent 与技能 | `structs/dynamic_skills_loader.py`, `structs/skill_orchestra.py`, `structs/csv_to_agent.py`, `utils/agent_loader_markdown.py` |
| [[observability-eval\|可观测/评估]] | loguru 日志（`utils/loguru_logger.py`）；遥测默认向 swarms.world 上报 agent 数据（`SWARMS_TELEMETRY_ON` 开关，`telemetry/main.py:150`）；评估类拓扑 `council_as_judge`/`debate_with_judge`/`majority_voting` 充当 LLM-as-judge | `telemetry/main.py:96,150`, `telemetry/bootup.py:8`, `structs/council_as_judge.py`, `utils/loguru_logger.py` |
| [[runtime-execution\|运行时/部署]] | 纯库；同步为主，`Concurrent`/`run_agents_concurrently` 用 `ThreadPoolExecutor`，另有 `arun`/`arun_stream` 异步与 asyncio 版；`aop.py`(Agent-as-server)、`cron_job.py`(schedule)、`batch_agent_execution`；`autosave` 落盘状态；`swarms` CLI 入口 | `structs/concurrent_workflow.py:403` (ThreadPool), `structs/multi_agent_exec.py`, `agent.py:3075` (`arun`), `structs/aop.py`, `structs/cron_job.py`, `cli/main.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | `interactive=True` 进入 REPL，每轮经 `formatter.console.input` 收用户输入（`agent.py:1871`）；`AgentRearrange` flow DSL 支持插入 `-> H ->` 人审步骤 + `custom_human_in_the_loop` 回调；无细粒度工具审批/沙箱 | `agent.py:433,1871` (`interactive`), `structs/agent_rearrange.py:34` (flow `H` 步骤 + `human_in_the_loop`) |
| [[state-persistence\|状态/持久化]] | `autosave` 把 `to_dict()` 状态序列化落盘（`agent.py:3456` 后台线程）；`Conversation.save_as_json`/`export`（`conversation.py:812,895`）；v12 `MEMORY.md` 跨进程持久（按 `agent_name` keyed）；对话默认 in-memory，无 DB 后端 | `agent.py:3456` (`autosave`), `structs/conversation.py:812` (`save_as_json`), `conversation.py:420` (MEMORY.md 追加), `utils/swarm_autosave.py` |

## 设计权衡与特性

- **"拓扑超市" vs 极简**：与极简的 [[swarm\|Swarm]]（OpenAI 那个去框架化、约百行的 routine/handoff 实验品）**截然相反**——Swarms 是企业向的"全家桶"，强项是开箱即用的多种编排拓扑与一个 `SwarmRouter` 入口随意切换；同名但毫无关系。两者重名易混，本笔记特指 `kyegomez/swarms`。
- **胖 Agent 的代价**：`Agent` 单类 6400+ 行、构造参数数十个，违背 KISS / 小文件原则；好处是单一对象即可拿到流式、工具、MCP、记忆、自治、持久化，学习曲线"会一个类就够"。坏处是可读性/可测试性差、参数交互暗坑多（CLAUDE.md 专列 "What to Avoid"：勿传 `tools=[]`、勿同时开 `streaming_on` 与 `streaming_callback`、长自治会话必开 `context_compression` 等）。
- **模型层零自研**：完全押注 LiteLLM（pin 死 `1.76.1`），优点是 provider 覆盖极广、升级即享新模型；缺点是行为与坑都继承 LiteLLM，版本锁定。
- **编排即字符串**：`SwarmRouter(swarm_type="...")` 与 `AgentRearrange(flow="A -> B, C -> D")` 把拓扑表达为可读字符串/DSL，是它"换架构不改编排代码"的核心卖点；`swarm_type="auto"` 进一步让 LLM 选拓扑。
- **遥测默认外发**：`bootup()` 在 `import swarms` 时即运行，遥测经 `SWARMS_TELEMETRY_ON` 控制向 swarms.world 上报 agent/系统数据——企业落地需注意数据合规（可关闭）。
- **v12 向 Claude Code 看齐**：`persistent_memory`(MEMORY.md) + `context_compression`(90% 阈值摘要) + `max_loops="auto"` 自治循环（自带 think/grep/bash/file 工具）= 长程自治 agent，对标闭源 harness 的压缩/子任务能力。
- **缺口**：无内建向量记忆（RAG 需自接工具）、无独立插件总线（扩展靠工具+拓扑）、对话默认 in-memory（无 DB 后端）、HITL 较粗（REPL + flow `H` 步骤，无工具级审批/沙箱）。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 注意区分：极简的 [[swarm]]（OpenAI routine/handoff 实验）≠ 本框架 `kyegomez/swarms`
- 同范式(multi)：[[swarm]] · 源码：`agents-example/swarms/`
