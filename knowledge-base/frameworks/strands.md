---
title: "Strands Agents"
aliases:
  - Strands
  - strands
  - strands-agents
  - strands-py
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/strands
  - lang/python
  - paradigm/single
  - paradigm/model-driven
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/strands-agents/sdk-python
license: Apache-2.0 (strands-py/LICENSE)
stars: ~3k
---

# Strands Agents

> [!abstract] 一句话定位
> AWS 出品的 **model-driven（模型驱动）** Python Agent SDK：几行代码就能起一个 agent，把"规划/工具选择/反思/何时停"全部交给底层模型在一个极简的 event loop 里自驱，框架本身只做模型抽象、工具调度、上下文管理与多智能体编排这些"脚手架"，刻意不写硬编码的编排逻辑。

## 设计理念 / 顶层架构

Strands 的核心信条是 **model-driven approach**（README 第 13、35 行）：与 plan-execute、状态机、显式 graph 那类"框架替你决定下一步做什么"的范式相反，Strands 认为现代大模型已经足够强，能自己完成"思考→选工具→看结果→继续推理→给答案"的循环（`agent.py:114-122` 的 6 步 workflow 注释即此理念的直接表达）。因此框架的工作不是"编排智能"，而是**给模型提供一个干净、可观测、可扩展的运行时**，让模型在循环里自主决策。具体取舍：

- **极简自驱 event loop**：整个推理内核就是 `event_loop_cycle()`（`event_loop/event_loop.py:179`）一个递归协程——调模型→若 `stop_reason=="tool_use"` 则执行工具→把结果回灌→`recurse_event_loop()` 再来一轮（`event_loop.py:400,790`），直到模型自己 `end_turn`。没有 planner、没有状态机，**"下一步做什么"完全由模型 token 决定**。这就是 model-driven 落在代码上的样子。
- **模型可插拔是第一公民**：`Model` 抽象基类（`models/model.py:158`）只要求实现 `stream()` / `structured_output()` / `get_config()`，自带 13+ provider（Bedrock 默认、Anthropic、OpenAI、Gemini、Ollama、LiteLLM、Mistral、Writer、SageMaker…）。换模型 = 换一行构造参数，agent 逻辑零改动——"model-driven"的前提是"model-agnostic"。
- **函数即工具**：`@tool` 装饰器（`tools/decorator.py:731`）用 `inspect` + type hints + `docstring_parser` + Pydantic 自动把普通 Python 函数转成带 JSON schema 的工具，docstring 即给模型的说明书。
- **薄内核 + hooks/plugins 扩展**：不靠继承扩展，靠 typed hook 事件系统（`hooks/registry.py`）与 `Plugin`（`plugins/`）；retry、session、conversation_manager、model 生命周期本身都注册为 hook。
- **包结构**：`agent/`（Agent 入口 + conversation_manager 上下文管理）、`event_loop/`（推理内核 + 流式 + 重试）、`models/`（13+ provider）、`tools/`（装饰器/注册表/执行器/MCP/结构化输出）、`multiagent/`（graph/swarm/a2a）、`session/`（file/s3 持久化）、`telemetry/`（OTEL tracer + metrics）、`hooks/` + `plugins/` + `vended_plugins/`（skills/steering/context_offloader）、`experimental/`（bidi 语音双向流、checkpoint、steering）。
- **入口 API**：`from strands import Agent`；`agent("prompt")` 同步返回 `AgentResult`（内部 `run_async` 跑 `invoke_async` → `stream_async`，见 `agent.py:528,539,810`）。

最小示例（取自 README）：

```python
from strands import Agent, tool

@tool
def word_count(text: str) -> int:
    """Count words in text.

    This docstring is used by the LLM to understand the tool's purpose.
    """
    return len(text.split())

# 不传 model 时默认 BedrockModel（Claude Sonnet @ us-west-2），几行即成 agent
agent = Agent(tools=[word_count])
response = agent("How many words are in this sentence?")  # 模型自行决定是否调用工具
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **model-driven 自驱循环**：调模型→`stop_reason=="tool_use"` 则执行工具→结果回灌→递归重开，无 planner/状态机，全靠模型决策；`max_tokens` 默认硬失败 | `event_loop/event_loop.py:179` (`event_loop_cycle`), `event_loop.py:400` (`recurse_event_loop`), `event_loop.py:790` |
| [[planning\|规划/任务分解]] | 内核无显式 planner——这正是 model-driven 的取舍：规划交给模型隐式完成。结构化分解可借 `multiagent/graph.py` 的依赖图或 `swarm.py` 的自治移交，但单 agent 层无独立规划组件 | N/A（单 agent 内核）；`multiagent/graph.py:241` (`GraphBuilder`) |
| [[memory\|记忆(短/长/向量)]] | 短期=`agent.messages` 列表（多轮）；上下文窗口由 `ConversationManager` 管：滑窗 `SlidingWindowConversationManager`（默认）/ 摘要 `SummarizingConversationManager`（`:54`，LLM 摘要旧消息）/ `NullConversationManager`；**无内置向量记忆/RAG** | `agent/conversation_manager/sliding_window_conversation_manager.py`, `summarizing_conversation_manager.py:54`；向量记忆 N/A |
| [[tool-use\|工具调用]] | `@tool` 装饰器经 `inspect`+type hints+`docstring_parser`+Pydantic 自动生成 JSON schema；原生 function calling；支持目录热加载(`load_tools_from_directory`)、`ToolProvider`、agent-as-tool；默认并发执行 | `tools/decorator.py:731` (`tool`), `tools/registry.py:32` (`ToolRegistry`), `tools/executors/concurrent.py:19` |
| [[model-abstraction\|模型抽象]] | **框架核心**：`Model` ABC 仅需 `stream`/`structured_output`/`get_config`；13+ provider，默认 `BedrockModel`(Claude Sonnet)；传 str 走 Bedrock model-id，传实例走自定义；`stateful` 属性标记服务端托管会话 | `models/model.py:158` (`Model`), `models/bedrock.py:72` (`BedrockModel`), `agent.py:231` (默认装配) |
| [[multi-agent-orchestration\|多智能体编排]] | 三模式：①`Graph` 确定性依赖图（支持环/嵌套，`GraphBuilder` 声明边）；②`Swarm` 自治协作团队（工具化 handoff + 共享上下文）；③A2A 协议(server/executor)；另 `agent.as_tool()` 把 agent 当工具 | `multiagent/graph.py:429` (`Graph`), `multiagent/swarm.py:237` (`Swarm`), `multiagent/a2a/`, `agent/agent.py:697` (`as_tool`) |
| [[context-engineering\|上下文工程]] | system_prompt 支持 str 或 `SystemContentBlock` 列表(含 cache point)；`ConversationManager` 在 `ContextWindowOverflowException` 时 `reduce_context` 重试(`agent.py:1055`)；`count_tokens` 启发式估算(tiktoken 或 chars/4)做前瞻压缩；`context_offloader` vended plugin | `agent.py:1208` (`_initialize_system_prompt`), `models/model.py:263` (`count_tokens`), `vended_plugins/context_offloader/` |
| [[skills-plugins\|技能/插件]] | 两层：`Plugin`(注册 hooks/装配 agent，`plugins/`) + typed hook 事件；`AgentSkills` vended plugin 把带 frontmatter 的 SKILL.md 注入 system prompt 并提供 `skills` 激活工具，按需加载；MCP=即插即用工具源 | `plugins/plugin.py`, `vended_plugins/skills/agent_skills.py:45` (`AgentSkills`), `tools/mcp/mcp_client.py:104` (`MCPClient`) |
| [[observability-eval\|可观测/评估]] | 一等公民 OpenTelemetry：`Tracer` 为 agent/cycle/model/tool 起 span(`telemetry/tracer.py:77`)，`EventLoopMetrics` 记 token/延迟/cycle，`StrandsTelemetry` 一键装配；`callback_handler` 流式回调(默认 `PrintingCallbackHandler`)；评估走 OTEL 导出 | `telemetry/tracer.py:77` (`Tracer`), `telemetry/metrics.py` (`EventLoopMetrics`), `telemetry/config.py` (`StrandsTelemetry`) |
| [[runtime-execution\|运行时/部署]] | 纯库；`agent()` 同步(`run_async` 跨线程跑 event loop)，`invoke_async`/`stream_async` 异步流式；工具默认并发执行；`agent.cancel()` 线程安全优雅取消；`experimental.bidi` 提供语音双向流式 runtime；并发调用默认抛 `ConcurrencyException` | `agent.py:484` (`__call__`), `agent.py:810` (`stream_async`), `_async.py` (`run_async`), `experimental/bidi/` |
| [[human-in-the-loop-governance\|人在环/治理]] | `Interrupt`/`InterruptException` 暂停 agent 等人类输入，经 session 持久化后 resume(`agent.py:878`)；`AfterInvocationEvent.resume` 钩子可注入新输入续跑；`experimental/steering` 提供 LLM/ledger 引导；guardrail 触发 `redactContent` 自动脱敏(`agent.py:1310`) | `interrupt.py:11` (`Interrupt`), `agent.py:1004-1015` (resume), `experimental/steering/`, `agent.py:1310` (`_redact_user_content`) |
| [[state-persistence\|状态/持久化]] | `agent.state`=JSON 可序列化 KV(`agent/state.py`)；`SessionManager` ABC 经 hooks 自动落盘 messages/state/conversation_manager_state，含 `FileSessionManager`/`S3SessionManager`/`RepositorySessionManager`；`take_snapshot`/`load_snapshot` 内存快照；`checkpointing` 在 cycle 边界暂停可恢复 | `session/session_manager.py:31` (`SessionManager`), `session/file_session_manager.py`, `session/s3_session_manager.py`, `agent.py:1238` (`take_snapshot`), `experimental/checkpoint/` |

## 设计权衡与特性

- **"框架只做脚手架，智能归模型"**：与 [[crewai\|CrewAI]] 的角色/任务编排、[[metagpt\|MetaGPT]] 的 SOP 流水线、[[langchain\|LangChain]] 的 chain 显式拼装相比，Strands 把"下一步做什么"彻底下放给模型，框架内核小到只有一个递归 event loop。优点是代码极简、随模型能力升级自动变强；代价是行为可预测性低、强依赖底层模型的工具调用与反思能力（弱模型上效果会明显打折）。
- **AWS 血统但 model-agnostic**：默认 `BedrockModel`(Claude Sonnet @ us-west-2，需配 AWS 凭证)、内置 `S3SessionManager`/`SageMaker` provider，AWS 生态集成深；但 `Model` 抽象让它同时支持 OpenAI/Gemini/Ollama/本地 llama.cpp，并非锁死 AWS。
- **可观测性是一等公民**：原生 OpenTelemetry（agent/cycle/model/tool 四级 span + token/cost metrics），在"模型自驱、行为不可预测"的范式下，这种深度 tracing 是必要的可解释性补偿——这是 model-driven 框架的合理工程取舍。
- **企业级特性齐全**：session 持久化(file/s3/repo)、checkpoint、interrupt 人在环、guardrail 脱敏、并发锁、优雅取消、A2A 协议、MCP 原生支持、结构化输出(Pydantic)、prompt caching——production-ready 而非玩具。
- **多智能体三选一**：确定性 `Graph`（要可控流程时用）vs 自治 `Swarm`（要涌现协作时用）vs A2A（跨服务），且三者可嵌套、agent 还能 `as_tool()` 互嵌——编排层灵活度高。
- **monorepo 现状**：仓库是 monorepo（Python SDK 在 `strands-py/`，另有 TS SDK `strands-ts/`、WASM、文档站）；本笔记基于 Python SDK。`experimental/` 下的 bidi 语音双向流、steering、checkpoint 标注为实验特性，API 可能变动。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[model-abstraction]] · [[reasoning-loop]]
- 同范式(single + model-driven/电池齐全)：[[connectonion]] · [[smolagents]] · [[crewai]] · 源码：`agents-example/strands/`
