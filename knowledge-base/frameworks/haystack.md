---
title: "Haystack"
aliases:
  - Haystack
  - haystack
  - haystack-ai
  - deepset Haystack
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/haystack
  - lang/python
  - paradigm/rag
  - paradigm/pipeline
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/deepset-ai/haystack
license: Apache-2.0
stars: ~21k
---

# Haystack

> [!abstract] 一句话定位
> deepset 出品的 **production-ready RAG & Agent 编排框架**：核心是一套**声明式 DAG Pipeline**——任何标了 `@component` 的类（retriever / embedder / generator / ranker / agent…）都有类型化的 input/output sockets，用 `add_component()` + `connect()` 按数据流接成图，引擎按拓扑序（支持环路/分支）驱动执行；Agent 只是其中一个特殊 component，内部跑 LLM↔ToolInvoker 的 ReAct 式循环。强调 "context engineering"：检索、路由、记忆、生成全部透明可追踪、可序列化、可热插拔模型厂商。

## 设计理念 / 顶层架构

Haystack 的世界观是 **"一切皆 Component，编排即 DAG"**，与 single-agent ReAct 框架（如 [[connectonion]]）的 "agent 是一等公民" 相反——这里 **Pipeline（图）才是一等公民，Agent 是图里的一个节点**。核心设计取舍：

- **Component 契约（鸭子类型 + 元类）**：`@component` 装饰器（`haystack/core/component/component.py:644` 的 `component = _Component()`）通过 `ComponentMeta` 元类（`component.py:187`）在实例化时用 `inspect.signature` 解析 `run()` 的形参类型生成 **InputSocket**，用 `@component.output_types(...)` 装饰器（`component.py:534`）声明 **OutputSocket**。唯一硬性契约：必须有 `run()` 且返回 `Mapping`。
- **声明式 DAG + 类型检查连线**：`Pipeline` 内部是 `networkx.MultiDiGraph`（`haystack/core/pipeline/base.py:112`）。`connect("retriever", "prompt_builder.documents")`（`base.py:441`）在**连线时**就校验 sender 的 output socket 类型与 receiver 的 input socket 类型是否兼容，类型不匹配直接报错。执行引擎用拓扑序+优先级队列调度；若图含环（如 Agent 自反馈、retry）则走 `networkx.condensation` 处理强连通分量（`base.py:1289`），故 **Pipeline 支持 loop/branch，不只是纯 DAG**。
- **RAG 是头等场景**：`components/` 下按职责切分目录——`retrievers/`、`embedders/`、`rankers/`、`readers/`、`converters/`、`preprocessors/`、`writers/`、`generators/`、`builders/`（PromptBuilder）、`routers/`、`joiners/`、`evaluators/`。一条标准 RAG = Retriever→PromptBuilder→ChatGenerator→AnswerBuilder 用 `connect()` 串起来。
- **模型/厂商无关**：Generator 与 Retriever 都是协议（Protocol）。`ChatGenerator`（`haystack/components/generators/chat/types/protocol.py:10`）只要求 `run(messages) -> dict`；OpenAI/Azure/HuggingFace 等是核心包内置，其余厂商（Anthropic/Cohere/Bedrock/Mistral…）在 `haystack-core-integrations` 仓库，换厂商=换一个 component 实例。
- **可序列化是一等需求**：component 的 `__init__` 参数必须 JSON-serializable，`Pipeline.to_dict()/from_dict()`（`base.py:150/177`）+ `dumps()/loads()`（`base.py:264/287`，默认 YAML marshaller）让整条 pipeline 能存成 YAML 并复原——这也是 Hayhooks 把 pipeline 暴露成 REST/MCP 的基础。
- **入口 API**：`from haystack import Pipeline, component, Document`（`haystack/__init__.py`）；Agent 在 `haystack.components.agents.Agent`。

最小示例（取自 `Pipeline.run` docstring，`haystack/core/pipeline/pipeline.py:127`）：

```python
from haystack import Pipeline, Document
from haystack.components.builders.chat_prompt_builder import ChatPromptBuilder
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.components.retrievers.in_memory import InMemoryBM25Retriever
from haystack.dataclasses import ChatMessage
from haystack.document_stores.in_memory import InMemoryDocumentStore

document_store = InMemoryDocumentStore()
document_store.write_documents([
    Document(content="My name is Jean and I live in Paris."),
    Document(content="My name is Mark and I live in Berlin."),
])

template = [ChatMessage.from_user(
    "Given these documents, answer the question.\n"
    "Documents:\n{% for doc in documents %}{{ doc.content }}\n{% endfor %}\n"
    "Question: {{question}}\nAnswer:"
)]

rag = Pipeline()                                              # 声明式 DAG
rag.add_component("retriever", InMemoryBM25Retriever(document_store=document_store))
rag.add_component("prompt_builder", ChatPromptBuilder(template=template))
rag.add_component("llm", OpenAIChatGenerator())
rag.connect("retriever", "prompt_builder.documents")          # 类型化连线（连线即校验）
rag.connect("prompt_builder", "llm")

question = "Who lives in Paris?"
result = rag.run({"retriever": {"query": question}, "prompt_builder": {"question": question}})
print(result["llm"]["replies"][0].text)                       # Jean lives in Paris
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **两层**：①Pipeline 层=声明式 DAG，引擎按拓扑序+优先级队列驱动 component（非 LLM 推理，是数据流编排），支持环/分支；②Agent 层=ReAct 式 `while counter < max_agent_steps` 循环：ChatGenerator→若 replies 含 tool_call 则 ToolInvoker 执行→回灌 messages→重复，直到无 tool_call 或命中 exit_condition | DAG: `core/pipeline/pipeline.py:114` (`run`), `core/pipeline/base.py:1289` (拓扑/环处理)；Agent: `components/agents/agent.py:809` (while 循环), `agent.py:861` (无 tool_call 即停) |
| [[planning\|规划/任务分解]] | 无内置 planner/任务分解器；"规划"=开发者**显式画 DAG**（把多步拆成 component 用 connect 串联），或交给 Agent 内 LLM 隐式决定下一步调哪个 tool。声明式图本身即是静态计划 | `core/pipeline/base.py:441` (`connect` 手工编排)；Agent 动态决策见 `agent.py:809` |
| [[memory\|记忆(短/长/向量)]] | 短期=Agent `State`（按 `state_schema` 定义的 KV，`messages` 默认用 `merge_lists` handler 累积多轮）；长期/向量=**DocumentStore + Retriever**（InMemory/外部向量库），即 RAG 充当语义记忆；另有 `components/caching` 缓存 | State: `components/agents/state/state.py:56`, `agent.py:289` (messages handler)；向量记忆: `components/retrievers/in_memory/embedding_retriever.py:13`, `document_stores/types/protocol.py:11` |
| [[tool-use\|工具调用]] | `Tool` dataclass（name+description+JSON-schema parameters+function）；`@tool`/`create_tool_from_function` 用 type hints+docstring 自动生成 schema；`ComponentTool`/`PipelineTool` 把任意 component/pipeline 包成 tool；`ToolInvoker` component 解析 LLM 的 ToolCall 并执行，结果可经 `outputs_to_state` 写回 State；`Toolset`/`SearchableToolset`(语义检索工具,支持 MCP) | `tools/tool.py:19` (`Tool`), `tools/from_function.py:18,215` (`create_tool_from_function`/`@tool`), `tools/component_tool.py:39`, `tools/pipeline_tool.py:21`, `components/tools/tool_invoker.py`, `tools/searchable_toolset.py:21` |
| [[model-abstraction\|模型抽象]] | 基于 **Protocol（鸭子类型）**而非基类：`ChatGenerator` 协议仅要求 `run(messages)->dict`、返回 `replies: list[ChatMessage]`；OpenAI/Azure/HF 内置，其余厂商在 haystack-core-integrations；`ChatMessage`/`ToolCall` 为统一数据格式；`FallbackChatGenerator` 多模型故障转移 | `components/generators/chat/types/protocol.py:10` (协议), `components/generators/chat/openai.py:58,304`, `components/generators/chat/fallback.py:21`, `dataclasses/chat_message.py` |
| [[multi-agent-orchestration\|多智能体编排]] | 无专门 multi-agent runtime；**复用 DAG**：因 `Agent` 也是 `@component`，可把多个 Agent `add_component` 进同一 Pipeline 并 `connect` 成图（顺序/分支/路由）；或用 `ComponentTool` 把一个 Agent 当 tool 交给另一个 Agent（agent-as-tool 实现层级编排）；Router 类做条件分支 | Agent 是 component: `components/agents/agent.py:103` (`@component`)；agent-as-tool: `tools/component_tool.py:39`；路由: `components/routers/` |
| [[context-engineering\|上下文工程]] | 框架核心卖点：上下文如何被检索/排序/过滤/拼装全部显式可控——PromptBuilder 用 Jinja2 模板拼 prompt，Ranker 重排，Joiner 合并多路文档，Router 条件路由；Agent 的 system/user prompt 支持 Jinja2 模板（ChatPromptBuilder），`required_variables` 校验 | `components/builders/` (ChatPromptBuilder), `components/rankers/`, `components/joiners/`, `agent.py:314` (prompt builder), `agent.py:343` (`_register_prompt_variables`) |
| [[skills-plugins\|技能/插件]] | 无 "skill/plugin" 概念；扩展机制=**写自定义 `@component`**（统一契约，社区共享生态）+ `SuperComponent` 把一整条 pipeline 封装成单个可复用 component；集成生态在 haystack-core-integrations | `core/component/component.py:644` (`@component`), `core/super_component/super_component.py:37` (`SuperComponent`/`input_mapping`/`output_mapping`) |
| [[observability-eval\|可观测/评估]] | Tracing：`Tracer`/`Span` 抽象，自动接 OpenTelemetry/Datadog，`auto_enable_tracing()`（`__init__.py` 启动时调用），含 `LoggingTracer`；内容级 trace 由 env 开关；Eval：`components/evaluators/`（faithfulness/context_relevance/SAS/MRR/NDCG/recall/LLMEvaluator…）+ `EvaluationRunResult` 出报表 | `tracing/tracer.py:82` (`Tracer`), `tracing/logging_tracer.py:34`, `components/evaluators/` (10+ 评估器), `evaluation/eval_run_result.py:18` |
| [[runtime-execution\|运行时/部署]] | 纯 Python 库；`Pipeline.run()` 同步顺序执行，`AsyncPipeline.run_async()` 让无依赖分支并行（asyncio）；`warm_up()` 钩子做模型/连接的重初始化；本进程执行无沙箱；生产部署经 **Hayhooks**(独立项目) 把 pipeline 包成 REST API / MCP server / OpenAI 兼容端点 | `core/pipeline/pipeline.py:114` (`run`), `core/pipeline/async_pipeline.py:28,468` (`AsyncPipeline.run_async`), `core/component/component.py:49` (`warm_up` 契约) |
| [[human-in-the-loop-governance\|人在环/治理]] | Agent 支持 `confirmation_strategies`：按 tool 名映射 `ConfirmationStrategy`，工具执行前可拦截要求用户确认（`BlockingConfirmationStrategy` 等），含 `ConfirmationPolicy`/`ConfirmationUI` 协议，支持 web 场景注入 request-scoped 上下文（WebSocket 等）；`ToolExecutionDecision` 记录决策 | `human_in_the_loop/strategies.py:28` (`BlockingConfirmationStrategy`), `human_in_the_loop/types/protocol.py:30,57` (Policy/Strategy 协议), `agent.py:225,878` (confirmation 接入) |
| [[state-persistence\|状态/持久化]] | ①结构持久化：`Pipeline.to_dict/from_dict` + `dumps/loads`(YAML) 整图存取；②运行态持久化=**Breakpoint/Snapshot**：在 component/chat_generator/tool_invoker 处设断点，触发即把 inputs+component_visits+state 存成 `PipelineSnapshot`/`AgentSnapshot`(JSON)，可从快照 resume；Agent `State` 序列化 schema | 结构: `core/pipeline/base.py:150,264`, `marshal/yaml.py`；运行态: `dataclasses/breakpoints.py:13,66,120,197` (Breakpoint/AgentBreakpoint/AgentSnapshot/PipelineSnapshot), `core/pipeline/breakpoint.py`, `pipeline.py:340` (resume) |

## 设计权衡与特性

- **"图编排" vs "agent 编排"**：与 [[connectonion]]/Swarm 等 "agent 是中心、循环是核心" 的框架根本不同——Haystack 把 **DAG 当一等公民**，Agent 只是图里一个会内部循环的节点。好处是**透明可控、可静态校验类型、可序列化成 YAML 部署**；代价是写法更 "工程化"（要手工 add_component+connect），不如两行起一个 agent 那样轻。
- **连线即类型检查**：`connect()` 在装配期就比对 socket 类型（`base.py:441`），把 "上游输出对不上下游输入" 这类错误从运行时提前到构建时——这是声明式 DAG 相对命令式 agent 循环的硬优势。
- **RAG 第一公民**：检索/嵌入/重排/读取/写入/转换/预处理被拆成独立可组合 component，配合 DocumentStore 协议，换向量库/换 embedding 模型/插一个 ranker 都只是改一个节点。Context engineering（检索→排序→过滤→拼装→路由全透明）是其相对 "黑盒 RAG" 框架的核心差异。
- **Protocol 而非继承**：Generator/Retriever/DocumentStore 都是 `typing.Protocol`，模型/厂商/存储无关性靠鸭子类型达成，换厂商=换 component 实例，不改 pipeline 结构。
- **支持环与分支**：虽名为 DAG，引擎实际经 `networkx.condensation` 支持带环图（`base.py:1289`），故 retry、self-correction、Agent 反馈回路都能在 pipeline 层表达；`AsyncPipeline` 还能并行无依赖分支。
- **生产化外置**：核心库不含 server；REST/MCP 暴露交给独立的 **Hayhooks**，企业版（Enterprise Platform）补 observability/治理/协作——核心库保持精简。
- **multi-agent 是 "涌现" 而非 "内建"**：没有专门的 multi-agent 调度器，多 agent 协作靠 "Agent 也是 component" 复用 DAG 或 agent-as-tool，灵活但需自己设计编排拓扑。
- **待确认/注意**：①版本为 `2.31.0-rc0`(VERSION.txt) 的 release candidate，部分 API 可能仍在演进；②绝大多数第三方厂商集成不在本仓库（在 haystack-core-integrations），本笔记仅覆盖核心包内置的 OpenAI/Azure/HF；③Tool 的 `function` 必须是同步函数（`tool.py:105` 显式拒绝 async）。

## 关联

- [[component-taxonomy]] · [[context-engineering]] · [[tool-use]] · [[state-persistence]]
- 同范式(RAG/声明式 pipeline)：[[component-taxonomy]] · 对比 single-agent：[[connectonion]]
- 源码：`agents-example/haystack/`
