---
title: "AutoGen"
aliases:
  - AutoGen
  - autogen
  - autogen-core
  - autogen-agentchat
  - pyautogen
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/autogen
  - lang/python
  - lang/csharp
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/microsoft/autogen
license: MIT（代码，各 package 的 LICENSE-CODE 与 pyproject 声明）；仓库根 LICENSE 为 CC BY 4.0（用于文档/内容）
stars: ~50k
---

# AutoGen

> [!abstract] 一句话定位
> Microsoft 出品的**事件驱动多智能体框架**：底层 `autogen-core` 提供 actor 式消息传递（send / publish-subscribe）、agent runtime（单进程 / 分布式 / 跨 .NET-Python）与一套与 LLM provider 无关的 model/tool/memory 抽象；上层 `autogen-agentchat` 在其上封装 `AssistantAgent` 与 `RoundRobin / Selector / Swarm / GraphFlow / Magentic-One` 等 group chat 编排模式，主打"两个 agent 对话到一队专家协作"。当前已进入 **maintenance mode**，官方推荐新项目转向 Microsoft Agent Framework。

## 设计理念 / 顶层架构

AutoGen 的核心范式不是单 agent 的 ReAct 循环，而是 **actor 模型 + 事件驱动消息传递**——agent 是订阅 topic、处理 typed message 的独立单元，多智能体协作是这套消息系统的自然产物。设计取舍：

- **分层、可在不同抽象层介入**（README:179）：`autogen-core`（消息、runtime、底层抽象）→ `autogen-agentchat`（opinionated 高层 API，常见多 agent 模式）→ `autogen-ext`（OpenAI/Azure client、code executor 等一/三方扩展）。agentchat 仅依赖 core（`autogen-agentchat/pyproject.toml`）。
- **Agent = 消息处理器**：底层 `Agent` 是 Protocol，`BaseAgent`/`RoutedAgent` 用 `@message_handler`/`@event`/`@rpc` 装饰器把方法注册为按消息类型分发的 handler（`autogen-core/src/autogen_core/_routed_agent.py:415`）。runtime 负责投递。
- **两种通信原语**：`send_message`（点对点 RPC，有返回值）与 `publish_message`（按 `TopicId` 广播 pub/sub，无返回）（`autogen-core/src/autogen_core/_agent_runtime.py:22,50`）。group chat 正是建立在 pub/sub + topic 订阅之上。
- **Component 配置系统**：几乎所有抽象（agent、team、model client、tool、termination、memory、model_context）都继承 `Component`，支持 `dump_component()`/`load_component()` 声明式序列化（用于 AutoGen Studio 等无代码工具）。
- **入口 API**：`from autogen_agentchat.agents import AssistantAgent`；`await agent.run(task=...)` 返回 `TaskResult`，`run_stream(...)` 返回异步事件流。

最小示例（取自 README:51）：

```python
import asyncio
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient

async def main() -> None:
    model_client = OpenAIChatCompletionClient(model="gpt-4.1")
    agent = AssistantAgent("assistant", model_client=model_client)
    print(await agent.run(task="Say Hello World!"))
    await model_client.close()

asyncio.run(main())
```

多 agent 团队（RoundRobin + 终止条件，AgentChat 典型形态）：

```python
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.conditions import TextMentionTermination

team = RoundRobinGroupChat(
    [writer, critic],                              # 一组 ChatAgent
    termination_condition=TextMentionTermination("APPROVE"),
    max_turns=10,
)
result = await team.run(task="Write a short poem.")
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 双层：①底层是 actor 事件循环（runtime 投递消息→`@message_handler` 分发）；②`AssistantAgent` 提供 ReAct 式工具循环：LLM→若返回 `FunctionCall` 则执行→结果回灌→再次推理，受 `max_tool_iterations`(默认 1)约束；末轮可 `reflect_on_tool_use` 再推理或直接 summarize | `_assistant_agent.py:1118` (`_process_model_result`，内含 `for loop_iteration in range(max_tool_iterations)` @1149), `_assistant_agent.py:1056` (`_call_llm`) |
| [[planning\|规划/任务分解]] | 内核无通用 planner；规划由 LLM 隐式完成。显式规划见 **Magentic-One** orchestrator：先建 task ledger（facts + plan 两段 prompt 推理），再用 progress ledger 驱动外/内双层循环 | `_magentic_one/_magentic_one_orchestrator.py:157` (建 ledger), `:107`/`:116` (facts/plan/progress prompt), `_magentic_one/_prompts.py` |
| [[memory\|记忆(短/长/向量)]] | 短期=`ChatCompletionContext`（消息历史）；长期=`Memory` 抽象基类（`query`/`add`/`update_context` 在推理前把检索内容注入 context），内置 `ListMemory`；向量/语义检索由 `autogen-ext`（如 ChromaDB）实现，core 内 N/A | `autogen-core/src/autogen_core/memory/_base_memory.py:60`, `memory/_list_memory.py`, agent 侧注入 `_assistant_agent.py:1027` (`_update_model_context_with_memory`) |
| [[tool-use\|工具调用]] | `Tool` Protocol + `BaseTool`（pydantic args schema）；`FunctionTool` 用 `inspect` 从函数签名+docstring 自动生成 schema（`args_base_model_from_signature`）；原生 function calling，工具经 `Workbench` 暴露给 LLM；支持 MCP（`McpWorkbench`）与 `AgentTool`（把 agent 当工具）；并行执行用 `asyncio.gather` | `autogen-core/src/autogen_core/tools/_base.py:96` (`BaseTool`), `tools/_function_tool.py:30,100`, 执行 `_assistant_agent.py:1196` (`_execute_tool_calls`) / `:1536` (`_execute_tool_call`) |
| [[model-abstraction\|模型抽象]] | `ChatCompletionClient` 抽象基类定义 `create`/`create_stream`/`model_info`（`ModelInfo` TypedDict 描述 vision/function-calling/family 等能力）；统一 `LLMMessage`（System/User/Assistant/FunctionExecutionResult）与 `CreateResult`；具体 OpenAI/Azure/Anthropic 等 client 在 `autogen-ext` | `autogen-core/src/autogen_core/models/_model_client.py:209` (`ChatCompletionClient`), `:164` (`ModelInfo`), `models/_types.py` (LLMMessage/CreateResult) |
| [[multi-agent-orchestration\|多智能体编排]] | 核心强项。`BaseGroupChat`(Team) + `BaseGroupChatManager`：manager 通过 pub/sub 选下一发言者（`select_speaker`），participant 经 `ChatAgentContainer` 包成 runtime agent；五种内置模式：RoundRobin / Selector(LLM 选人) / Swarm(handoff 驱动) / GraphFlow(DiGraph 显式拓扑) / Magentic-One(ledger 编排) | `_group_chat/_base_group_chat_manager.py:25,306` (`select_speaker`；`_transition_to_next_speakers` @172), `_round_robin_group_chat.py:72`, `_selector_group_chat.py:152,232`, `_swarm_group_chat.py:82`, `_graph/_digraph_group_chat.py:309,458` |
| [[context-engineering\|上下文工程]] | `ChatCompletionContext` 抽象管理喂给 LLM 的消息窗口；多策略实现：`UnboundedChatCompletionContext`、`BufferedChatCompletionContext`(取最近 N)、`HeadAndTailChatCompletionContext`、`TokenLimitedChatCompletionContext`；`system_message` + memory 注入 + `_get_compatible_context`(按 model_info 去图像) | `autogen-core/src/autogen_core/model_context/_chat_completion_context.py:10`, `_buffered_chat_completion_context.py`, `_token_limited_chat_completion_context.py`, `_assistant_agent.py` (`_get_compatible_context`) |
| [[skills-plugins\|技能/插件]] | 无独立"skill/插件"系统；扩展性靠 ①`Component` 声明式组件 + `autogen-ext` 包生态（model client、code executor、tools/MCP）；②自定义 `BaseChatAgent`/`BaseTool`/`Workbench` 子类。无 Claude-Code 式 SKILL.md / slash command 概念 | `autogen-core/src/autogen_core/_component_config.py`, `autogen-ext`(包级扩展), `tools/_workbench.py` |
| [[observability-eval\|可观测/评估]] | runtime 内建 **OpenTelemetry** tracing（`TraceHelper`，可经 `tracer_provider` 注入，`AUTOGEN_DISABLE_RUNTIME_TRACING` 关闭）；结构化事件流（每步 `ToolCallRequestEvent`/`ThoughtEvent` 等）+ `EVENT_LOGGER_NAME`/`TRACE_LOGGER_NAME` 日志；评估工具 **AGBench**(`python/packages/agbench`) | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:256` (TraceHelper), `_telemetry/`, `autogen-agentchat/messages.py`(事件类型), `python/packages/agbench/` |
| [[runtime-execution\|运行时/部署]] | `AgentRuntime` Protocol 多实现：`SingleThreadedAgentRuntime`(单进程异步事件队列)；分布式 gRPC worker/host runtime（`autogen-ext`，跨 .NET/Python，见 protos/）；agent 经 `register_factory` 惰性实例化；code executor 经 `autogen-ext`(Docker/本地)沙箱执行 | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:149`, `_agent_runtime.py:75` (`register_factory`), `_base_agent.py:60`, `protos/` (gRPC) |
| [[human-in-the-loop-governance\|人在环/治理]] | `UserProxyAgent` 把人类作为 agent 接入：`on_messages` 时调用可注入的 `input_func`(同步/异步均可)向人取输入，并发 `UserInputRequestedEvent`；group chat 中作为普通 participant 参与轮转；`Handoff`/`HandoffTermination` 可把控制权交回人 | `autogen-agentchat/src/autogen_agentchat/agents/_user_proxy_agent.py:37,160,210`, `messages.py` (`UserInputRequestedEvent` @502), `conditions/_terminations.py:313` (`HandoffTermination`) |
| [[state-persistence\|状态/持久化]] | 全链路 `save_state()`/`load_state()` → `Mapping`：agent、`ChatCompletionContext`、group chat manager(各自 ManagerState) 与 Team(`TeamState` 聚合各 agent state)均可序列化；`CancellationToken` 控制中断 | `autogen-core/src/autogen_core/model_context/_chat_completion_context.py:66,69`, `_group_chat/_base_group_chat.py:748,798` (Team save/load), `_swarm_group_chat.py:100,108`, `autogen-agentchat/state/` |

## 设计权衡与特性

- **actor/事件驱动 vs 命令式编排**：与多数"主循环 + 工具列表"的 single-agent 框架不同，AutoGen 把多 agent 协作建模为消息传递系统。优点是天然支持并发、分布式、跨语言（.NET ↔ Python via gRPC + protobuf）；代价是心智模型更重——理解 topic/subscription/runtime 才能玩转底层 core。
- **双层 API 的清晰分工**：`autogen-core` 给追求控制力的用户（自定义 runtime、消息类型），`autogen-agentchat` 给要快速搭多 agent 团队的用户。多数应用只碰 agentchat 层，从 v0.2 升级者也最熟悉它。
- **编排模式齐全**：RoundRobin（确定性轮转）、Selector（LLM 动态选人）、Swarm（handoff/交接驱动，OpenAI Swarm 风格）、GraphFlow（DiGraph 显式工作流，支持条件边/并行/循环）、Magentic-One（task+progress ledger 的通用 orchestrator，可跑 web/代码任务）——覆盖从静态流水线到自主编排的谱系。
- **Component 声明式序列化**：几乎所有对象可 dump/load 成配置，是 AutoGen Studio 无代码 GUI 的基础，也利于 team/agent 的存取与复现。
- **可观测性是一等公民**：runtime 原生埋 OpenTelemetry，外加细粒度结构化事件流（thought / tool-call / memory-query 等），调试多 agent 交互比纯日志清晰。
- **License 分裂（注意）**：仓库根 `LICENSE` 是 **CC BY 4.0**（面向文档/内容），而各 Python 包的 `pyproject.toml` 与 `LICENSE-CODE` 声明 **MIT**（面向代码）。引用时应以 MIT 视代码许可。
- **Maintenance mode（重要）**：README 顶部明确 AutoGen 已进入维护模式，不再加新功能，社区管理；官方建议新项目用 Microsoft Agent Framework（MAF），并提供迁移指南。学习其架构仍有价值，但生产选型需权衡。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式（multi-agent 编排）：[[connectonion]]（对比：单 agent + 电池/平台） · 源码：`agents-example/autogen/`
