---
title: "vectara-agentic"
aliases:
  - vectara-agentic
  - py-vectara-agentic
  - Vectara Agentic
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/vectara-agentic
  - lang/python
  - paradigm/rag
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/vectara/py-vectara-agentic
license: Apache-2.0
stars: ~500
---

# vectara-agentic

> [!abstract] 一句话定位
> 一个构建在 **LlamaIndex Agent 框架之上的 Agentic-RAG 库**：核心卖点是把 Vectara 的检索/RAG 管线“一行代码封装成工具”（`create_rag_tool` / `create_search_tool`），再让 ReAct 或 Function-Calling agent 调度这些工具；并内置多 LLM provider、流式、可观测（Arize Phoenix）以及 Vectara 自家的幻觉纠正（VHC）。

## 设计理念 / 顶层架构

vectara-agentic 不重写 agent 内核，而是 **薄封装 LlamaIndex 的 workflow-based agent**（`FunctionAgent` / `ReActAgent`），把自己的价值集中在“检索即工具”和“RAG 专属配套能力”上。设计取舍：

- **检索封装为工具（核心范式）**：`VectaraToolFactory.create_rag_tool()`（`vectara_agentic/tools.py:448`）与 `create_search_tool()`（`tools.py:199`）把一次 Vectara RAG/检索调用动态生成成一个 `FunctionTool`。RAG 工具**自动注入 `query` 参数**，再追加用户用 Pydantic schema（`tool_args_schema`）声明的元数据过滤字段（如 `year`/`ticker`）；这些字段经 `build_filter_string`（`tool_utils.py:543`）翻译成 Vectara 的 metadata filter，并支持 `year='>2022'` 这类条件表达式。
- **工厂模式 + 动态函数**：所有工具都经 `create_tool_from_dynamic_function`（`tool_utils.py:386`）根据签名/schema 生成；`ToolsFactory.create_tool()`（`tools.py:763`）把任意 Python 函数转工具，`get_llama_index_tools()`（`tools.py:784`）桥接 LlamaIndex ToolSpecs（Tavily/EXA/arXiv/Slack/Google 等）。
- **薄 Agent 内核**：`Agent` 类（`vectara_agentic/agent.py:78`）只持有 tools/memory/config，真正的 agent 由 `create_agent_from_config`（`agent_core/factory.py:157`）按 `agent_type` 委托给 LlamaIndex 的 `FunctionAgent` 或 `ReActAgent`。两类 agent 都是 LlamaIndex workflow，`achat()` 内部用 `current_agent.run(...)` 跑 workflow（`agent.py:602`）。
- **配置集中**：`AgentConfig`（冻结 dataclass，`agent_config.py:10`）统一 agent_type、main/tool 两套 LLM provider、private LLM、observer，全部可由环境变量回退。
- **入口 API**：`from vectara_agentic import Agent`；`agent.chat()` / `achat()` 返回 `AgentResponse`，`stream_chat()` / `astream_chat()` 返回 `AgentStreamingResponse`（`types.py:111`）。

最小示例（取自 README）：

```python
import os
from vectara_agentic.tools import VectaraToolFactory
from vectara_agentic import Agent
from pydantic import BaseModel, Field

vec_factory = VectaraToolFactory(
    vectara_api_key=os.environ["VECTARA_API_KEY"],
    vectara_corpus_key=os.environ["VECTARA_CORPUS_KEY"],
)

class QueryFinancialReportsArgs(BaseModel):
    year: int | str = Field(..., description="The year, e.g. 2022 or '>2020'")
    ticker: str = Field(..., description="The company ticker, e.g. AAPL")

# 检索被封装成一个工具；query 参数由 create_rag_tool 自动添加
ask_finance = vec_factory.create_rag_tool(
    tool_name="query_financial_reports",
    tool_description="Query financial reports for a company and year",
    tool_args_schema=QueryFinancialReportsArgs,
)

agent = Agent(
    tools=[ask_finance],
    topic="10-K annual financial reports",
    custom_instructions="You are a helpful financial assistant.",
)
print(agent.chat("What was the revenue for Apple in 2021?").response)
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 不自研循环，复用 LlamaIndex 的 workflow agent：`AgentType.FUNCTION_CALLING`（原生 function calling，默认）或 `REACT`（Thought/Action/Observation 文本协议）。`achat()` 经 `current_agent.run(user_msg, memory, ctx)` 驱动 workflow，循环由 LlamaIndex `FunctionAgent`/`ReActAgent` 内部完成 | `agent.py:592` (分支), `agent.py:602` (`run`), `agent_core/factory.py:58` (`create_react_agent`), `factory.py:103` (`create_function_agent`) |
| [[planning\|规划/任务分解]] | 内核无显式 planner；规划交给 LLM（base 指令鼓励“拆子问题”，`prompts.py:54`）。提供可选 **内置 workflow** 做显式分解：`SubQuestionQueryWorkflow`（并行子问题，`@step(num_workers=8)`）与 `SequentialSubQuestionsWorkflow`（顺序依赖）；旧的 StructuredPlanning 已在 v0.4 废弃 | `sub_query_workflow.py:23`, `sub_query_workflow.py:149`, `sub_query_workflow.py:199` |
| [[memory\|记忆(短/长/向量)]] | 短期=LlamaIndex `Memory.from_defaults(session_id=..., token_limit=65536)`（`agent.py:175`），workflow 内部管理、结束后从 `ctx.store.get("memory")` 回写（`agent.py:739`）；`chat_history` 可初始化（`agent.py:178`）。**长期/向量记忆 N/A**（向量检索属于 Vectara 语料层，不是 agent memory） | `agent.py:175`, `agent.py:739`, `agent.py:259` (`clear_memory`) |
| [[tool-use\|工具调用]] | 三类来源：① Vectara RAG/search 工具（`tools.py:448` / `tools.py:199`）；② 任意 Python 函数 `ToolsFactory.create_tool`（`tools.py:763`）；③ LlamaIndex ToolSpecs 桥接 `get_llama_index_tools`（`tools.py:784`）。统一经 `create_tool_from_dynamic_function`（`tool_utils.py:386`）按签名+Pydantic schema 生成 `VectaraTool`；`get_current_date` 工具自动追加（`agent.py:133`） | `tools.py:179` (`VectaraToolFactory`), `tool_utils.py:386`, `tools_catalog.py` (内置 legal/finance/db 工具) |
| [[model-abstraction\|模型抽象]] | `get_llm(role, config)`（`llm_utils.py:174`）按 provider 枚举工厂式实例化 LlamaIndex LLM；支持 OpenAI/Anthropic/Gemini/Together/GROQ/Bedrock/Cohere/Private(OpenAILike)。**主 LLM 与工具 LLM 可分别配置**（`LLMRole.MAIN`/`TOOL`，`types.py:52`）；带 LLM 实例缓存与各 provider 默认模型表 | `llm_utils.py:174` (`get_llm`), `llm_utils.py:19` (默认模型表), `agent_config.py:28` (main/tool provider) |
| [[multi-agent-orchestration\|多智能体编排]] | 无内建多 agent 系统（无 agent-as-tool / handoff / swarm）。“多步协作”通过 workflow 内多个 `@step` 与子问题分解模拟；可在自定义 Workflow 的 `StartEvent` 拿到 `agent`/`tools`/`llm` 复用。**多 agent 编排 N/A（仅单 agent + workflow）** | `agent.py:1025` (`run`), `sub_query_workflow.py` |
| [[context-engineering\|上下文工程]] | 提示词模板化：`GENERAL_PROMPT_TEMPLATE` / `REACT_PROMPT_TEMPLATE`（`prompts.py:134,150`）由 `format_prompt` 注入 topic/date/general+custom 指令（`factory.py:32`）。`get_general_instructions` 按是否含 DB 工具动态拼接指令（`prompts.py:111`）；强约束“仅基于工具输出、内联引用”。Gemini 工具需 `sanitize_tools_for_gemini`（`agent.py:153`） | `prompts.py:35` (`_BASE_INSTRUCTIONS`), `factory.py:32` (`format_prompt`), `prompts.py:111` |
| [[skills-plugins\|技能/插件]] | 无独立 skills/plugin 体系。扩展点是 **自定义 Workflow**（`workflow_cls`，`agent.py:1025`）与 ToolSpecs 生态接入（`tools.py:32` 的 `LI_packages` 注册表，含 yahoo_finance/arxiv/tavily/google/slack 等）。**插件系统 N/A，以工具+workflow 为扩展面** | `tools.py:32` (`LI_packages`), `agent.py:1040` (`workflow_cls`) |
| [[observability-eval\|可观测/评估]] | 内置 **Arize Phoenix**（OpenInference instrument LlamaIndex，`_observability.py:16` `setup_observer`），`eval_fcs()` 把 Vectara FCS 分数作为 span 评估写回（`_observability.py:101`）。回调 `AgentCallbackHandler`/`agent_progress_callback` 实时上报 `TOOL_CALL`/`TOOL_OUTPUT`（`agent.py:623`）。**VHC（幻觉纠正）** `compute_vhc`/`analyze_hallucinations` 是其独特评估能力 | `_observability.py:16`, `_observability.py:101`, `_callback.py`, `agent_core/utils/hallucination.py:113` |
| [[runtime-execution\|运行时/部署]] | 纯 Python 库；`chat()` 用 `asyncio.run` 包裹 `achat()`（`agent.py:547`）。内置 **OpenAI 兼容 HTTP 端点**：`create_app()` 基于 FastAPI 暴露 `/chat`、`/v1/completions`、`/v1/chat`（X-API-Key 鉴权），`start_app()` 用 uvicorn 起服务（`agent_endpoint.py:95,240`）；附 Dockerfile | `agent_endpoint.py:95` (`create_app`), `agent_endpoint.py:240` (`start_app`), `docker/Dockerfile` |
| [[human-in-the-loop-governance\|人在环/治理]] | 无审批/打断式 HITL（无 tool-approval 拦截）。治理偏“内容安全”：`get_bad_topics` 工具+指令限制可谈话题（`prompts.py:39`），工具按 `ToolType.QUERY`/`ACTION` 分类（`types.py:59`，可据此识别副作用工具），`validate_tools` 校验指令引用的工具是否存在（`agent.py:157`）。**交互式人在环 N/A** | `prompts.py:39`, `types.py:59`, `agent.py:157` (`validate_tool_consistency`) |
| [[state-persistence\|状态/持久化]] | Agent 可整体序列化：`dumps`/`loads`、`to_dict`/`from_dict`（`agent.py:1103`）经 `serialize_agent_to_dict`（`serialization.py:252`）落盘配置+工具+memory，并用 cloudpickle 处理自定义函数工具。`session_id`（默认 `topic:date`，`agent.py:169`）+ `Memory` 提供会话维度状态；带 fallback agent 配置切换（`agent.py:480`） | `agent.py:1103`, `agent_core/serialization.py:252`, `serialization.py:285` (`deserialize_agent_from_dict`) |

## 设计权衡与特性

- **“RAG 优先、薄封装 LlamaIndex” vs 自研内核**：与 [[connectonion\|ConnectOnion]] 那种自带循环/事件/插件的“电池全包”内核不同，vectara-agentic 几乎不自研 agent 循环——`FunctionAgent`/`ReActAgent` 全来自 LlamaIndex。它的差异化完全压在 **“检索即工具”** 这一层：`create_rag_tool` 自动注入 `query`、把 Pydantic 字段映射成 Vectara 元数据过滤、支持 `>2022` 条件与 `fixed_filter`，让“给语料配一个带过滤维度的检索工具”变成一行代码。
- **双 LLM 角色**：主 agent LLM 与工具内部 LLM（summarize/rephrase 等）可分开配置（`LLMRole.MAIN`/`TOOL`），便于“强模型做编排、便宜模型做摘要”。
- **VHC（Vectara Hallucination Correction）是独特卖点**：对最终回答做幻觉检测与纠正，且只采信标记为 `vhc_eligible=True` 的工具输出作为事实依据（`tools.py:489`、`agent.py:914`）。这是把厂商自有的事实一致性能力（FCS）下沉到 agent 评估层，同类通用框架罕见。
- **生产配套齐全**：内置 Arize Phoenix 可观测、OpenAI 兼容 HTTP 端点、Docker、序列化（cloudpickle），定位“快速做出可上线的 Agentic-RAG 助手”。
- **能力边界 / 待确认**：① **无真正的多 agent 编排与交互式人在环/审批**——多步靠 workflow 子问题分解模拟；② 强绑定 LlamaIndex 版本（`requirements.txt` 锁 `llama-index==0.14.7` 等精确版本），升级面较脆；③ 对 Vectara 平台有耦合（RAG 工具、VHC、FCS 评估均依赖 Vectara API key）；④ v0.4 起移除 Fireworks、OPENAI AgentType、StructuredPlanning、token counting（迁移注意，README 有说明）。

## 关联

- [[component-taxonomy]] · [[tool-use]] · [[observability-eval]]
- 同范式(RAG/检索封装为工具)：[[connectonion]] · 源码：`agents-example/vectara-agentic/`
</content>
</invoke>
