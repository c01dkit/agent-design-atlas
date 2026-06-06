---
title: "LlamaIndex"
aliases:
  - LlamaIndex
  - llama_index
  - llama-index
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/llamaindex
  - lang/python
  - paradigm/rag
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/jerryjliu/llama_index
license: MIT
stars: ~40k
---

# LlamaIndex

> [!abstract] 一句话定位
> 一个以"数据 / RAG"为中心的 Python 框架：把私有数据通过 reader→node_parser→index→retriever→query_engine 的管线接入 LLM，再把检索能力封装成 tool，由建立在自研 **Workflow**(事件驱动状态机) 之上的 `FunctionAgent` / `ReActAgent` / `AgentWorkflow` 驱动，做"会查资料、能多 agent handoff"的 agentic 应用。

## 设计理念 / 顶层架构

LlamaIndex 的内核取舍是 **"data framework first, agent second"**——它最强的不是 agent 循环，而是把任意数据变成可检索上下文的那条管线；agent 只是消费这套检索能力的上层。设计要点：

- **大型 monorepo + namespace 包**：仓库分 `llama-index-core`(骨架)、`llama-index-integrations`(300+ 第三方 LLM/embedding/vector store 插件)、`llama-index-instrumentation`(可观测)、`llama-index-utils`。import 含 `core` 即用核心、不含即用集成包：`from llama_index.core.llms import LLM` vs `from llama_index.llms.openai import OpenAI`（README:29-43）。本笔记聚焦 `llama-index-core`。
- **RAG 管线为一等公民**：`Document` → `NodeParser`(切块) → `Index`(`VectorStoreIndex` 等) → `Retriever` → `QueryEngine`/`ChatEngine`。索引对象用 `as_retriever()` / `as_query_engine()` / `as_chat_engine()` 一键降级成不同消费形态（`indices/base.py:489,491,518`）。
- **agent = Workflow 之上的状态机**：2024 起新 agent 全部重写在自研 Workflow 引擎上。`BaseWorkflowAgent` 同时继承 `Workflow` + pydantic `BaseModel`（`agent/workflow/base_agent.py:87`），用 `@step` 装饰的方法 + `Event` 在步骤间流转构成 ReAct 式循环。注意 Workflow 引擎本身已外移到独立 `workflows` 包，core 只做 re-export（`workflow/workflow.py:1`、`workflow/context.py:1`）。
- **全局 `Settings` 单例**：`Settings.llm` / `Settings.embed_model` / `Settings.node_parser` 惰性解析默认依赖，避免到处传 LLM（`settings.py:18,34`）。
- **检索即工具**：`RetrieverTool` / `QueryEngineTool` 把"查知识库"封装成普通 tool 交给 agent，这是 LlamaIndex 把 RAG 与 agent 缝合的关键接口（`tools/retriever_tool.py:26`）。

最小示例（取自 README，RAG 主线）：

```python
import os
os.environ["OPENAI_API_KEY"] = "YOUR_KEY"

from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

# 1. 读数据 → 2. 建向量索引（自动切块+embedding）
documents = SimpleDirectoryReader("YOUR_DATA_DIRECTORY").load_data()
index = VectorStoreIndex.from_documents(documents)

# 3. 降级成 query engine 检索增强问答
query_engine = index.as_query_engine()
print(query_engine.query("YOUR_QUESTION"))

# 进阶：把检索封成 tool 交给 agent
from llama_index.core.agent.workflow import FunctionAgent
from llama_index.core.tools import QueryEngineTool

tool = QueryEngineTool.from_defaults(query_engine, name="docs", description="查内部文档")
agent = FunctionAgent(tools=[tool])   # llm 缺省取 Settings.llm
# response = await agent.run(user_msg="根据文档回答…")
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | Workflow 事件状态机：`init_run`→`setup_agent`→`run_agent_step`(调 `take_step`)→`parse_agent_output`→`call_tool`→`aggregate_tool_results`→回 `AgentInput` 循环。`FunctionAgent` 用原生 function calling，`ReActAgent` 用 Thought/Action/Observation 文本协议解析 | `agent/workflow/base_agent.py:383-725`, `agent/workflow/function_agent.py:101`, `agent/workflow/react_agent.py:121` |
| [[planning\|规划/任务分解]] | 内核无显式 planner；规划隐式交给 LLM(ReAct 的 Thought 链 / function-calling 多轮)。另有 `CodeActAgent` 让 LLM 写 Python 代码作为"计划+执行"；`tools/query_plan` 提供查询级子问题分解。无独立 plan-then-execute 编排器 | `agent/workflow/codeact_agent.py:25`, `tools/query_plan.py`, `agent/react/prompts.py` |
| [[memory\|记忆(短/长/向量)]] | 短期=`ChatMemoryBuffer`(token 截断)；统一 `Memory` 类聚合 **memory blocks**：`StaticMemoryBlock`/`FactExtractionMemoryBlock`(LLM 抽取事实)/`VectorMemoryBlock`(向量长期记忆)，token 超限自动 flush 到 block；底层走 `SQLAlchemyChatStore` | `memory/memory.py:187,216`, `memory/memory_blocks/vector.py:29`, `memory/memory_blocks/fact.py:66`, `memory/chat_memory_buffer.py` |
| [[tool-use\|工具调用]] | 普通函数→`FunctionTool.from_defaults` 用 `inspect.signature`+type hints+docstring 自动生成 schema(`create_schema_from_function`)；声明 `Context` 形参的工具运行时注入且对 LLM 隐藏(`requires_context`/`ctx_param_name`)；`return_direct` 工具结果直接返回；并行 tool calls 默认开 | `tools/function_tool.py:71,171`, `tools/types.py`, `agent/workflow/base_agent.py:347` (`_call_tool`) |
| [[model-abstraction\|模型抽象]] | `BaseLLM`→`LLM`→`FunctionCallingLLM` 三层抽象；统一 `ChatMessage`/`ChatResponse` 与 block 化多模态；`achat_with_tools`/`get_tool_calls_from_response`/`predict_and_call` 抹平各家 function calling；300+ provider 在 integrations 包；`Settings.llm` 全局默认 | `base/llms/base.py:26`, `llms/llm.py:163,792`, `llms/function_calling.py:24,63,191,202` |
| [[multi-agent-orchestration\|多智能体编排]] | `AgentWorkflow` 持有多个命名 agent + `root_agent`；自动注入 `handoff` 工具(`return_direct`)按 `can_handoff_to` 白名单切换 `current_agent_name`，共享同一 memory/state；`from_tools_or_functions` 据是否 function-calling 自动选 Function/ReAct agent | `agent/workflow/multi_agent_workflow.py:99,73` (`handoff`), `:216` (`_get_handoff_tool`), `:839` (`from_tools_or_functions`) |
| [[context-engineering\|上下文工程]] | `system_prompt` 前置；`state_prompt` 把运行时 `state` 注入最后一条 user 消息(`DEFAULT_STATE_PROMPT`)；ReAct 用 `ReActChatFormatter` 把工具描述+reasoning 步骤渲进 system header 模板；RAG 检索结果作为上下文喂入；memory block 模板化注入 | `agent/workflow/base_agent.py:437` (`setup_agent`), `agent/react/formatter.py:51`, `agent/react/templates/system_header_template.md`, `agent/workflow/prompts.py` |
| [[skills-plugins\|技能/插件]] | 无"skill"概念；扩展方式=integrations 插件包(LLM/embedding/vector store/reader/tool spec) + `ToolSpec` 工具集 + LlamaHub 生态；`ObjectRetriever`/`tool_retriever` 支持工具过多时按需检索工具 | `tools/tool_spec/`, `objects/` (`ObjectRetriever`), `agent/workflow/base_agent.py:273` (`get_tools`) |
| [[observability-eval\|可观测/评估]] | 独立 `llama-index-instrumentation` 包：`Dispatcher` 发 span/event，`@dispatcher.span` 装饰、`add_event_handler`/`add_span_handler` 挂钩(对接 Arize/Langfuse 等)；agent 每步 `write_event_to_stream` 暴露 `AgentStream`/`ToolCall` 等事件；`core/evaluation/` 提供 faithfulness/relevancy 等 RAG 评估器 | `instrumentation/__init__.py:1`, `llama-index-instrumentation/src/llama_index_instrumentation/dispatcher.py:50,137,342`, `evaluation/` |
| [[runtime-execution\|运行时/部署]] | 纯库；agent 是 async Workflow，`agent.run()` 返回 `WorkflowHandler`(可 await / 流式迭代)；步骤并发由 Workflow 引擎(外部 `workflows` 包)调度；无内置 server，部署/服务化交给 LlamaDeploy / LlamaAgents(仓库外) | `agent/workflow/base_agent.py:761` (`run`), `workflow/handler.py`, `workflow/workflow.py:1` |
| [[human-in-the-loop-governance\|人在环/治理]] | 经 Workflow 的 `InputRequiredEvent`/`HumanResponseEvent`：工具内 `ctx.write_event_to_stream(InputRequiredEvent)` 暂停并 `wait_for_event(HumanResponseEvent)` 等人工输入再继续；无内置审批/权限沙箱，工具默认本进程执行 | `workflow/events.py:1-8` (re-export), `agent/workflow/base_agent.py:817` (`WaitingForEvent`) |
| [[state-persistence\|状态/持久化]] | 运行态存 Workflow `Context.store`(memory/state/scratchpad/num_iterations 等 KV)；`initial_state` 深拷贝入 store；RAG 侧 `StorageContext.persist()` 落盘 docstore/index_store/vector_store，`load_index_from_storage` 恢复；对话历史经 `SQLAlchemyChatStore`(默认 sqlite 内存,可换持久 DB) | `agent/workflow/base_agent.py:284` (`_init_context`), `storage/storage_context.py`, `storage/chat_store/sql.py:31,35`, `indices/loading.py` |

## 设计权衡与特性

- **RAG 深度是护城河**：相比 ConnectOnion/Swarm 这类"agent 优先"框架，LlamaIndex 在数据接入、切块、索引(向量/树/关键词/property graph)、检索(fusion/auto-merging/recursive/router)、重排、RAG 评估上铺得极厚。要做"基于私有知识库的 agent"，它的电池最全。
- **agent 重写在自研 Workflow 上**：好处是 agent 与任意自定义 Workflow 同构、可组合、事件可观测、原生 async/流式；代价是概念栈更深(Event/step/Context/StartEvent/StopEvent)，且 Workflow 引擎已外移到 `workflows` 独立包，core 仅 re-export——读源码时真正的调度逻辑不在本仓库内（待确认其完整实现）。
- **multi-agent = handoff 模型**：`AgentWorkflow` 的多 agent 协作走 OpenAI Swarm 同款"handoff 工具切换当前 agent + 共享 memory/state"，按 `can_handoff_to` 白名单治理，属轻量编排；没有复杂的 supervisor/层级图(那类需求要自己用 Workflow 手写)。
- **三种 agent 互补**：`FunctionAgent`(原生 function calling，主推)、`ReActAgent`(无 function calling 模型的文本 ReAct 协议+输出解析+错误重试)、`CodeActAgent`(写代码即行动)。`from_tools_or_functions` 据模型能力自动二选一。
- **集成生态庞大但分散**：300+ integrations 各自独立版本/包，灵活但依赖与版本管理复杂；核心包(`llama-index-core` 0.14.x)与集成包需配套升级。
- **治理偏弱**：HITL 靠 Workflow 事件可实现，但内核无工具审批、权限沙箱或危险操作拦截——工具默认在本进程直接执行，安全边界需调用方自建。
- **待确认**：①Workflow 调度/并发/重试的真正实现在外部 `workflows` 包，本仓库只见 re-export；②`AgentWorkflow` 限制 `initial_state` 不支持 per-agent(`multi_agent_workflow.py:136`)。

## 关联

- [[component-taxonomy]] · [[multi-agent-orchestration]] · [[single-vs-multi-agent]]
- 同范式(rag / 数据中心)：[[llamaindex]] · 同为 handoff 多 agent：[[swarm]] · 源码：`agents-example/llamaindex/`
