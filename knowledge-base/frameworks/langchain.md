---
title: "LangChain"
aliases:
  - LangChain
  - langchain
  - lc
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/langchain
  - lang/python
  - paradigm/single
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/langchain-ai/langchain
license: MIT
stars: ~100k+
---

# LangChain

> [!abstract] 一句话定位
> 一个分层的 LLM 应用 / agent 工程平台：底层 `langchain-core` 用 **Runnable** 协议把模型 / 工具 / 提示 / 检索器统一成可组合、可流式、可批处理的 LCEL 管道；上层 `langchain`(v1) 以 `create_agent()` 提供一个**编译成 LangGraph 状态图的工具循环 agent**，并把所有可扩展点收敛到一套 **middleware** 钩子上——核心卖点是“模型可互换、组件可组合、agent 可控可观测”。

## 设计理念 / 顶层架构

LangChain 是一个 `uv` 管理的大型 **monorepo**（`libs/` 下多包独立版本，见 `CLAUDE.md`）。聚焦本笔记的三个主包及其分层关系：

- **核心层 `langchain-core`**（`libs/core/langchain_core/`）：定义基础抽象，用户一般无需直接接触。最关键的是 **`Runnable` 协议**（`libs/core/langchain_core/runnables/base.py:125`）——统一 `invoke / batch / stream / ainvoke`（`runnables/base.py:823,868,1131`）四件套，配合 `|` 运算符组成 LCEL 管道（`RunnableSequence`/`RunnableParallel`）。模型 `BaseChatModel`（`libs/core/langchain_core/language_models/chat_models.py:270`）、工具 `BaseTool`（`libs/core/langchain_core/tools/base.py:405`，本身就是个 `RunnableSerializable`）、检索器、提示模板全是 Runnable，因此天然可换、可串、可观测。
- **实现层 `langchain`(v1, version 1.3.4)**（`libs/langchain_v1/langchain/`）：当前主力包。入口极薄——`__init__.py` 只导出 `__version__`，真正面向用户的入口是 `langchain.agents.create_agent`（`agents/__init__.py:3`）。它**依赖 `langgraph`**（`libs/langchain_v1/pyproject.toml:28`）：`create_agent()` 不是自己实现循环，而是把 model 节点 / tools 节点 / middleware 节点装配成一张 `StateGraph` 再 `compile()`（`agents/factory.py:1048,1671`）。
- **遗留层 `langchain-classic`(version 1.0.7)**（`libs/langchain/langchain_classic/`）：老的 `AgentExecutor` / chains 体系（`langchain_classic/agents/`），CLAUDE.md 明确标注 "legacy, no new features"。本笔记以 v1 体系为准。
- **集成层 `partners/`**：OpenAI / Anthropic / Ollama 等具体 `ChatXxx` 实现，通过 `init_chat_model("provider:model")` 按字符串前缀懒加载（`chat_models/base.py:38` 的 `_BUILTIN_PROVIDERS` 表，`base.py:175` 的 `init_chat_model`）。

**与 LangGraph 的关系（关键）**：v1 的 agent 是 LangGraph 的“prebuilt 之上的封装”。工具循环的实际执行（`ToolNode`、`ToolCallRequest`、`InjectedState`、`interrupt`、checkpointer、`Send` 并行）全部来自 langgraph——`langchain/tools/tool_node.py` 整个文件只是从 `langgraph.prebuilt` 重导出（`tool_node.py:3`）。LangChain 负责“模型抽象 + middleware DX”，LangGraph 负责“图运行时 + 持久化”。README 进一步指向 **Deep Agents**（planning/subagents/文件系统的更高层封装）与 **LangSmith**（可观测/评估）。

最小示例（取自 `agents/factory.py:831` docstring 与 README）：

```python
from langchain.agents import create_agent


def check_weather(location: str) -> str:
    """Return the weather forecast for the specified location."""
    return f"It is always sunny in {location}"


# create_agent 返回的是一个编译好的 LangGraph StateGraph
graph = create_agent(
    model="anthropic:claude-sonnet-4-5-20250929",  # 字符串 -> init_chat_model 懒加载 provider
    tools=[check_weather],                          # 普通函数自动转 BaseTool
    system_prompt="You are a helpful assistant",
)
inputs = {"messages": [{"role": "user", "content": "what is the weather in sf"}]}
for chunk in graph.stream(inputs, stream_mode="updates"):
    print(chunk)
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 经典 ReAct 式工具循环，但物化为 **LangGraph 状态图**：`model` 节点调 LLM→条件边 `_make_model_to_tools_edge` 看末条 AIMessage 有无 `tool_calls`，有则 `Send("tools", ...)` 执行、回灌、循环，无则走 exit；递归上限 9999 | `agents/factory.py:1317` (`model_node`), `factory.py:1724` (`_make_model_to_tools_edge`), `factory.py:1805` (`_make_tools_to_model_edge`), `factory.py:1662` |
| [[planning\|规划/任务分解]] | 内核无显式 planner；规划交给 LLM。可选 `TodoListMiddleware` 注入 `write_todos` 工具+`todos` 状态字段做轻量任务清单（对标 Claude Code TodoWrite）；更重的 planning 在上层 Deep Agents 包 | `agents/middleware/todo.py:35` (`PlanningState`), `todo.py:46` (`WriteTodosInput`) |
| [[memory\|记忆(短/长/向量)]] | 短期=`AgentState["messages"]`（`add_messages` reducer 累积，`middleware/types.py:356`），由 checkpointer 按 thread 持久化为多轮记忆；长期/跨线程=LangGraph `BaseStore`（`store=` 参数）；向量记忆经 core `vectorstores`/`retrievers` 抽象但非 agent 内建 | `agents/middleware/types.py:353` (`AgentState`), `factory.py:707` (`store`), `factory.py:706` (`checkpointer`) |
| [[tool-use\|工具调用]] | 普通函数/`BaseTool`/dict 均可；`BaseTool` 即 Runnable（`tools/base.py:405`）；执行器是 langgraph 重导出的 `ToolNode`（`tools/tool_node.py:4`），支持并行 `Send`、`InjectedState`/`ToolRuntime` 注入、`return_direct`；模型经 `bind_tools` 绑定（`factory.py:1249`） | `agents/factory.py:949` (`ToolNode` 装配), `core/.../tools/base.py:405,878` (`BaseTool.run`), `core/.../chat_models.py:2325` (`bind_tools`) |
| [[model-abstraction\|模型抽象]] | `BaseChatModel`(core) 为统一接口，暴露 `invoke/stream/bind_tools/with_structured_output`；`init_chat_model("provider:model")` 按前缀懒加载 partner 实现（`_BUILTIN_PROVIDERS` 表覆盖 anthropic/openai/google/groq/ollama…）；模型可整体互换 | `chat_models/base.py:175` (`init_chat_model`), `base.py:38` (`_BUILTIN_PROVIDERS`), `core/.../chat_models.py:270,2325,2344` |
| [[multi-agent-orchestration\|多智能体编排]] | `create_agent(name=...)` 返回的图可作为子图节点嵌入另一张 LangGraph（`factory.py:803` 文档）；`SubagentTransformer` 把嵌套命名 agent 识别为 `run.subagents` 句柄并转发其事件流；更高层编排走 LangGraph / Deep Agents | `agents/_subagent_transformer.py:1`, `factory.py:1681` (注册 transformer), `factory.py:803` |
| [[context-engineering\|上下文工程]] | system_prompt 注入在 `_execute_model_sync`（`factory.py:1300`）；`SummarizationMiddleware` 近上限时用 LLM 摘要旧消息并 `RemoveMessage` 重写历史；`ContextEditingMiddleware`(ClearToolUsesEdit) 清理工具输出；`dynamic_prompt` 钩子动态改 prompt | `agents/middleware/summarization.py:33`, `middleware/context_editing.py` (`ClearToolUsesEdit`), `middleware/types.py:65` (`dynamic_prompt`) |
| [[skills-plugins\|技能/插件]] | 没有独立“skill”体系；**扩展机制即 middleware**：`AgentMiddleware` 提供 before/after_agent、before/after_model、wrap_model_call、wrap_tool_call 等钩子，可注册自带 `tools`/`state_schema`/`transformers`；内置十余款（PII、shell、tool_retry、tool_selection、model_fallback…） | `agents/middleware/types.py:383` (`AgentMiddleware`), `middleware/__init__.py:46` (内置清单) |
| [[observability-eval\|可观测/评估]] | core 内建 **callbacks + tracers** 体系（`core/.../tracers/`）；每个 middleware 钩子用 `@traceable` 包成 LangSmith span（`factory.py:910,1019`）并 `_scrub_inputs` 脱敏（`factory.py:140`）；评估/监控由外部 **LangSmith** 平台承担（README） | `factory.py:140` (`_scrub_inputs`), `factory.py:1019` (`traceable`), `libs/core/langchain_core/tracers/` |
| [[runtime-execution\|运行时/部署]] | 纯库；`create_agent` 产出可 `invoke/stream/astream` 的 `CompiledStateGraph`（`factory.py:714`），运行时为 LangGraph Pregel；`debug=`/`cache=`/`transformers=` 透传；生产部署指向 LangSmith Deployment（README） | `agents/factory.py:1671` (`graph.compile`), `factory.py:714` (返回类型), `pyproject.toml:28` (langgraph 依赖) |
| [[human-in-the-loop-governance\|人在环/治理]] | `HumanInTheLoopMiddleware` 用 langgraph `interrupt()` 在工具执行前暂停征求批准/编辑/拒绝（`InterruptOnConfig`）；`create_agent(interrupt_before/after=...)` 节点级中断；`ShellToolMiddleware` 带 Docker/Codex 沙箱执行策略；PII 中间件 | `agents/middleware/human_in_the_loop.py:1`, `factory.py:708,709` (`interrupt_before/after`), `middleware/shell_tool.py:1` (`DockerExecutionPolicy`) |
| [[state-persistence\|状态/持久化]] | 状态=`TypedDict` `AgentState`(+middleware 合并出的 schema，`factory.py:1043`)；`checkpointer`(线程内会话) + `store`(跨线程) 由 LangGraph 提供并透传 `compile()`；`jump_to` 为 `EphemeralValue` 不持久化 | `agents/factory.py:1037` (schema 合并), `factory.py:1671` (`checkpointer/store`), `middleware/types.py:357` |

## 设计权衡与特性

- **分层抽象是核心信条**：core 的 Runnable/LCEL 让“模型可互换、组件可组合”成为底座；`init_chat_model` 一行换 provider 是它对比手写 SDK 的最大卖点。代价是抽象层很厚、概念多（Runnable/Chain/Tool/Retriever/Middleware/Graph），学习曲线陡。
- **v1 把 agent 让位给 LangGraph**：与 ConnectOnion/Swarm “自己写 while 循环”不同，LangChain v1 的 `create_agent` 把循环编译成状态图，换来**可中断、可 checkpoint、可并行工具调用、可嵌套子图**等图运行时能力——可控性强，但意味着 `langchain` 与 `langgraph` 强耦合（pyproject 锁 `langgraph>=1.2.4,<1.3.0`），调试需理解两层。
- **middleware 是统一扩展面**：planning、记忆压缩、HITL、重试、PII、shell 沙箱、结构化输出全部表达为同一套钩子（before/after/wrap × agent/model/tool），可任意叠加、按注册顺序组合成洋葱（`factory.py:271` `compose_two`）。这是 v1 相对 v0 `AgentExecutor` 黑盒的最大架构改进。
- **结构化输出双策略**：`ProviderStrategy`(原生 JSON schema) vs `ToolStrategy`(伪装成工具调用)，按模型能力 `AutoStrategy` 自动选择（`factory.py:871,1220`、`structured_output.py`），兼顾不同 provider。
- **monorepo + partner 解耦**：核心抽象与具体集成分包，partner 包按需安装（`pyproject.toml:32` optional-deps），core 不依赖任何 SDK——保证“换模型不换代码”。
- **待确认/坑**：①笔记基于仓库内 `langchain_v1`(主力,1.3.4) 与 `langchain-classic`(遗留,1.0.7) 并存，导入路径与教程版本极易混淆（`import langchain.agents` 走 v1，老教程的 `AgentExecutor` 在 classic）；②`ToolNode`/`interrupt`/`checkpointer` 等实现实际在 **langgraph 仓库**（本仓库内仅重导出），深入需另读 langgraph 源码；③评估/部署能力（LangSmith）为闭源 SaaS，OSS 仅提供 tracer 钩子。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]] · [[model-abstraction]]
- 同范式(平台/可组合)：[[connectonion]] · 极简对照：[[swarm]] · 源码：`agents-example/langchain/`（聚焦 `libs/core`、`libs/langchain_v1`）
