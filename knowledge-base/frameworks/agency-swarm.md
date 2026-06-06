---
title: "Agency Swarm"
aliases:
  - Agency Swarm
  - agency-swarm
  - agency_swarm
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agency-swarm
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/VRSEN/agency-swarm
license: MIT
stars: ~3.5k
---

# Agency Swarm

> [!abstract] 一句话定位
> 一个把多智能体系统类比成"真实公司组织架构"的 Python multi-agent 框架（v1.9.9）：你定义带角色（CEO/Developer/VA）的 `Agent`，用有向的 `communication_flows`（`ceo > dev`）声明谁能给谁发消息，框架据此自动给每个 agent 装上 `send_message` 工具，agent 之间像同事一样同步对话协作。底层完全构建在 **OpenAI Agents SDK + Responses API** 之上（不再是旧版的 Assistants API），自身只做"组织编排 + 线程持久化 + 工具生态"这一层增强。

## 设计理念 / 顶层架构

Agency Swarm v1.x 是一次彻底的重写：**它不自己实现推理循环，而是把 `agency_swarm.Agent` 直接继承自 `agents.Agent`，把执行交给 `agents.Runner`**（`pyproject.toml:18` 锁定 `openai-agents==0.14.8`）。框架的价值集中在三件事上：组织化的多智能体编排、跨会话的线程持久化、以及与 OpenAI Agents SDK 兼容的工具生态。核心设计取舍：

- **"组织即架构"的心智模型**：把自动化想象成真实公司。`Agent` 有 `name`/`description`/`instructions`/`tools`，`Agency` 是这些 agent 的容器（`src/agency_swarm/agency/core.py:44`）。`description` 不只是注释——它会被注入到 `send_message` 工具的描述里，告诉别的 agent"该找谁干什么"。
- **有向通信流是一等公民**：用重载的 `>` 运算符声明谁能发起对话。`Agent.__gt__` 返回 `AgentFlow`（`src/agency_swarm/agent/core.py:546`、`src/agency_swarm/agent/agent_flow.py:14`），`Agency` 解析这些 flow（`src/agency_swarm/agency/setup.py:27`）后调用 `register_subagent` 给发送方动态生成 `send_message` 工具（`src/agency_swarm/agent/subagents.py:34`）。通信是**单向授权**的：`a > b` 只允许 a 主动找 b。
- **薄编排层 + 厚 SDK 内核**：`Agent` 本身是无状态的（docstring 明确写 "Agents are stateless"，`src/agency_swarm/agent/core.py:73`）；线程管理、子 agent 映射、shared instructions 都在运行时经 `AgencyContext`/`MasterContext` 注入（`src/agency_swarm/context.py:24`）。
- **两种工具范式并存**：现代 `@function_tool`（来自 SDK，自动从签名+docstring 生成 schema），与兼容旧版的 `BaseTool`（pydantic `BaseModel` 子类 + `run()` 方法，`src/agency_swarm/tools/base_tool.py:72`）。还能从 OpenAPI schema、MCP server、LangChain 工具批量导入。
- **包结构**：`agent/`（core + execution + file/attachment/subagents）、`agency/`（core + setup + responses + visualization）、`tools/`（base_tool / send_message / tool_factory / mcp_*）、`messages/`（formatter / filter）、`utils/thread.py`（持久化）、`integrations/`（fastapi / mcp_server）、`streaming/`、`cli/`。入口：`from agency_swarm import Agency, Agent, function_tool`。

最小示例（取自 README，async 推荐写法）：

```python
import asyncio
from agency_swarm import Agency, Agent, function_tool

@function_tool
def my_custom_tool(example_field: str) -> str:
    """A brief description of what the custom tool does."""   # docstring = 工具描述
    return f"Result: {example_field}"

ceo = Agent(
    name="CEO",
    description="Responsible for client communication and task planning.",
    instructions="You must converse with other agents to ensure task execution.",
    tools=[my_custom_tool],
    model="gpt-5.4-mini",
)
dev = Agent(name="Developer", description="Writes code.", instructions="...")

agency = Agency(
    ceo,                              # 第一个位置参数 = 用户的入口 agent
    communication_flows=[ceo > dev], # 有向：CEO 可以发起找 Developer
    shared_instructions="agency_manifesto.md",  # 所有 agent 共享的前置指令
)

async def main():
    resp = await agency.get_response("Create a project skeleton.")
    print(resp.final_output)

asyncio.run(main())
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 不自实现；完全委托给 OpenAI Agents SDK 的 `Runner.run` / `run_streamed`（ReAct 式 tool-calling loop，跑在 Responses API 上）。框架只在外层包一层 setup→run→保存 | `agent/execution_helpers.py:72` (`Runner.run`), `agent/execution_streaming.py:133` (`run_streamed`), `agent/execution.py:69` |
| [[planning\|规划/任务分解]] | 无显式 planner；规划交给 LLM 自身 + 组织结构。"CEO 先调工具拿数据，再委派专家"靠 instructions 引导（见 `examples/multi_agent_workflow.py:87`），框架不提供 plan-execute 原语 | N/A（依赖 prompt/组织设计），`examples/multi_agent_workflow.py:85` |
| [[memory\|记忆(短/长/向量)]] | 短期=`ThreadManager` 维护的扁平消息列表（`MessageStore`，按 `agent`/`callerAgent` 元数据过滤检索对话对）；长期=由用户的 `save/load_threads_callback` 落盘；向量记忆=经 `files_folder`+OpenAI Vector Store 的 `FileSearchTool`（RAG），非内置语义记忆 | `utils/thread.py:12` (`MessageStore`), `utils/thread.py:121` (`ThreadManager`), `agent/file_manager.py` |
| [[tool-use\|工具调用]] | 三条路：①`@function_tool`（SDK，签名+docstring 自动转 schema）；②`BaseTool`（pydantic `BaseModel`+`run()`，`openai_schema` 生成 JSON Schema）；③`ToolFactory` 从 OpenAPI/MCP/LangChain 批量导入。`tools_folder` 自动发现 | `tools/base_tool.py:72`, `tools/base_tool.py:107` (`openai_schema`), `tools/tool_factory_utils/factory.py:10` (`ToolFactory`), `tools/tool_factory_utils/openapi_importer.py:45` |
| [[model-abstraction\|模型抽象]] | 直接复用 SDK 的 `Model`/`ModelSettings`；默认 `gpt-5.4-mini`，OpenAI 走 `OpenAIResponsesModel`，其它厂商（Claude/Gemini/Grok/Azure/OpenRouter）经可选 `LitellmModel`（litellm extra）路由 | `agent/core.py:140` (model 参数), `__init__.py:53` (`LitellmModel`), `pyproject.toml:64` |
| [[multi-agent-orchestration\|多智能体编排]] | 核心卖点。①`send_message` 工具（同步 RPC：sender 调工具→`recipient.get_response()`→把 final_output 当工具返回值回灌，`tools/send_message.py:314`）；②有向 `communication_flows`（`a > b` 经 `AgentFlow`+`register_subagent` 动态装工具）；③可选 `Handoff` 控制权转移工具 | `tools/send_message.py:38` (`SendMessage`), `agency/setup.py:178` (`configure_agents`), `agent/subagents.py:34`, `agent/agent_flow.py:14` |
| [[context-engineering\|上下文工程]] | 运行前把 `shared_instructions`（agency 级）+ agent 自身 instructions + 本次 `additional_instructions` 拼成最终 system prompt（`execution_helpers.py:307` 起，运行后还原 `:435`）；instructions 支持 str/文件路径；`MessageFilter`/`MessageFormatter` 决定哪些消息进 history、打 agent 元数据 | `agent/execution_helpers.py:307` (`setup_execution`), `messages/message_formatter.py`, `messages/message_filter.py` |
| [[skills-plugins\|技能/插件]] | 无独立"skill"系统。扩展点=工具（function/BaseTool/OpenAPI/MCP/LangChain 导入）+ SDK 的 hooks/guardrails。`shared_tools`/`shared_tools_folder`/`shared_mcp_servers` 在 agency 级批量挂载到所有 agent | `agency/core.py:117` (shared_* 参数), `tools/mcp_converter.py:67` (`from_mcp`), `tools/tool_factory_utils/langchain.py:9` |
| [[observability-eval\|可观测/评估]] | 复用 SDK 内建 tracing（OpenAI Traces 自动），并通过 `with trace(...)` 接入 Langfuse / AgentOps（`examples/observability.py`）；自动累计 token/cost（sub-agent `raw_responses` 按模型回填到父 result，`execution.py:252`）；可视化 `agency.visualize()` 输出结构图 | `examples/observability.py:92`, `agent/execution.py:252`, `agency/visualization.py` |
| [[runtime-execution\|运行时/部署]] | 纯库；async 优先（`get_response` / `get_response_stream`），`get_response_sync` 为同步包装。部署：`run_fastapi()`（REST + 可选 AG-UI）、`run_mcp()`（暴露为 MCP server）、`copilot_demo()`（Web UI）、`tui()`（终端，watchfiles 热重载） | `agency/core.py:229` (`get_response`), `agency/core.py:363` (`run_fastapi`), `integrations/fastapi.py`, `integrations/mcp_server.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | 治理=SDK 的 input/output **guardrails**（tripwire 触发→`raise_input_guardrail_error` 决定抛错还是回灌引导文本，可重试 `validation_attempts` 次，`execution_helpers.py:86`）；通信流的有向授权本身即一种"谁能找谁"的访问控制。无内置 tool-approval 审批闸门 | `agent/execution_helpers.py:115` (guardrail 处理), `examples/guardrails_input.py`, `examples/guardrails_output.py`, `agency/core.py:83` (communication_flows 授权) |
| [[state-persistence\|状态/持久化]] | `Agency(load_threads_callback=, save_threads_callback=)` 注入持久化回调：`ThreadManager` 初始化时 load，每次 `add_message`/run 结束经 `PersistenceHooks.on_run_end` save（扁平消息 list，含 agent/callerAgent/timestamp 元数据）。存到 DB/文件由用户实现 | `hooks.py:12` (`PersistenceHooks`), `utils/thread.py:234` (`_save_messages`), `agency/core.py:91` (callback 参数), `examples/custom_persistence.py` |

## 设计权衡与特性

- **"组织隐喻"是最强差异点**：与 [[swarm\|Swarm]] 的极简 handoff、或 LangGraph 的显式状态图不同，Agency Swarm 用"公司部门 + 有向汇报线"来组织多 agent。`description` 驱动的 `send_message` enum 让"该找谁"对 LLM 自解释，心智负担低。
- **站在 OpenAI Agents SDK 肩膀上**：v1.x 把推理循环、模型抽象、guardrails、tracing、handoff 全部下沉给官方 SDK，自己只维护编排+持久化+工具导入这一薄层。好处是能白嫖 Responses API 的最新能力（hosted tools、code interpreter、file search、computer use 全部经 `__init__.py` 再导出）；代价是与 SDK 版本强耦合（`openai-agents==0.14.8` 精确锁定）。
- **send_message 是同步阻塞的 RPC**：发送方调用后会 `await recipient.get_response()` 拿到完整 final_output 才继续（`tools/send_message.py:505`），并有 per-thread "同一收件人不能并发两条" 的防重入锁（`:380`）。这让多 agent 协作可预测，但意味着没有真正的并行 agent 流水线（除非用多个独立 send_message 调用）。
- **扁平消息存储 + 元数据过滤**：v1.x 用单一扁平 `MessageStore` 取代旧版的 thread 字典，靠 `agent`/`callerAgent` 字段在检索时切分对话对（`utils/thread.py:51`）。所有入口 agent 共享同一条"用户线程"（`callerAgent is None`，`:192`）。
- **持久化是"自带电池但要自己接线"**：框架给了 `PersistenceHooks` 和回调协议，但具体存哪（Postgres/Redis/文件）完全留给用户实现（`examples/custom_persistence.py`），生产可控但需要自己写胶水。
- **多种部署出口**：同一个 `Agency` 可一行变成 FastAPI 服务、MCP server、Copilot Web UI 或终端 TUI，对"agents-as-a-service"商业化场景友好（作者公司 VRSEN 即做此业务）。
- **待确认/注意**：①需要 Python 3.12+（`pyproject.toml:13`），门槛偏高；②v0.x → v1.x 是破坏性重写（基座从 Assistants API 换成 Agents SDK），旧教程/代码不通用，须看官方 Migration Guide；③`send_message_tool_class` 的 per-agent 配置已 deprecated，改在 `communication_flows` 上按流配置。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi)：[[swarm]] · 上游基座：OpenAI Agents SDK · 源码：`agents-example/agency-swarm/`
