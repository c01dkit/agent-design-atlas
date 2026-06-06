---
title: "AgentScope"
aliases:
  - AgentScope
  - agentscope
  - AgentScope 2.0
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agentscope
  - lang/python
  - paradigm/single
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/modelscope/agentscope
license: Apache-2.0 (pyproject.toml:10 / LICENSE / README 三处一致)
stars: ~9k
---

# AgentScope

> [!abstract] 一句话定位
> 阿里通义实验室出品的"为越来越 agentic 的 LLM 设计"的生产级 Python agent 框架；2.0 版围绕一个**统一的、纯异步、事件流式的 ReAct `Agent`** 重构，强调"靠模型自身的推理/工具能力而非死板 prompt 编排"，内置 Claude-Code 风格的文件工具集、技能(skill)、权限引擎、上下文自动压缩、人在环 steering、MCP/A2A 与全链路 OTel 可观测，并自带 FastAPI 多租户/多会话 agent 服务与可换的本地/Docker/E2B 沙箱运行时。

## 设计理念 / 顶层架构

AgentScope **2.0** 是一次面向"高能力模型"的重写，与 1.0 差异极大。核心设计取舍：

- **单一统一 Agent，而非继承体系**：整个框架只有一个 `Agent` 类(`src/agentscope/agent/_agent.py:94`)，2484 行把 ReAct loop、压缩、工具批处理、权限、人在环、事件流全部收敛进去。扩展不靠子类化，而靠**中间件(middleware)**——`on_reply / on_reasoning / on_acting / on_model_call / on_system_prompt / on_compress_context` 等钩子(`middleware/_base.py`)，洋葱/管道两种模式。
- **纯异步 + 事件流为一等公民**：对外主接口是 `agent.reply_stream(...)`(`agent/_agent.py:191`) 返回 `AsyncGenerator[AgentEvent]`，把 reply/model-call/text/thinking/tool-call/tool-result 等拆成 24 种细粒度事件(`event/_event.py:14`)，UI 直接消费；`reply()`(`agent/_agent.py:216`) 只是把事件流消费成最终 `Msg`。
- **"模型即智能"哲学**：README 明确 "leverage models' reasoning and tool use rather than constrain them"。所以**没有显式 planner**，规划交给模型 + 一组 Task 工具；**也删掉了 1.0 的 `msghub`/`pipeline` 多智能体编排模块**(本仓 `src/agentscope` 下已不存在)，多 agent 改由"agent 即工具/服务"与 message hub 思路在 service 层承载。
- **包结构(`src/agentscope/`)**：`agent/`(统一 Agent + ReAct/Context/Model 三组 config) · `message/`(`Msg` + 8 类 ContentBlock) · `model/`(8 家 provider chat model) · `formatter/`(把 `Msg` 转各家 API 格式) · `tool/`(`Toolkit` + Claude-Code 式内建工具 Bash/Read/Write/Edit/Glob/Grep + Task 规划工具) · `skill/`(SKILL.md 技能) · `permission/`(规则化权限引擎，5 种 mode) · `mcp/`(统一 MCP 客户端) · `embedding/`(向量) · `state/`(可序列化 `AgentState`) · `middleware/`(含 `_tracing` OTel) · `workspace/`(Local/Docker/E2B 沙箱) · `app/`(FastAPI 多租户服务) · `event/` `credential/` `exception/`。
- **入口 API**：`from agentscope.agent import Agent`，配 `model=` + `toolkit=Toolkit(tools=[...])`，`async for evt in agent.reply_stream(UserMsg(...))`。

最小示例（取自 README）：

```python
from agentscope.agent import Agent
from agentscope.tool import Toolkit, Bash, Grep, Glob, Read, Write, Edit
from agentscope.credential import DashScopeCredential
from agentscope.model import DashScopeChatModel
from agentscope.message import UserMsg
from agentscope.event import EventType
import os, asyncio

async def main() -> None:
    agent = Agent(
        name="Friday",
        system_prompt="You're a helpful assistant named Friday.",
        model=DashScopeChatModel(
            credential=DashScopeCredential(api_key=os.environ["DASHSCOPE_API_KEY"]),
            model="qwen3.6-plus",
        ),
        toolkit=Toolkit(tools=[Bash(), Grep(), Glob(), Read(), Write(), Edit()]),
    )
    async for evt in agent.reply_stream(UserMsg("Tony", "Hi, Friday!")):
        match evt.type:                      # 消费细粒度事件流驱动 UI
            case EventType.REPLY_START: ...
            case EventType.MODEL_CALL_START: ...
            case EventType.TEXT_BLOCK_DELTA: ...

asyncio.run(main())
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 纯异步 ReAct：`while cur_iter < max_iters(默认20)` 循环，每轮 `_check_next_action` 判定 reasoning/acting/exit→`_reasoning` 调模型生成 text/thinking/tool_call→`_batch_tool_calls` 把工具分 sequential/concurrent 批执行→结果回灌；无 tool_call 即产出最终 `Msg` 退出 | `agent/_agent.py:595` (loop), `agent/_agent.py:687` (`_reasoning`), `agent/_agent.py:628` (批执行), `agent/_config.py` (`ReActConfig.max_iters`) |
| [[planning\|规划/任务分解]] | 无显式 planner（刻意交给模型）。提供一组 **Task 工具** `TaskCreate/Update/Get/List` 让模型自管 to-do（含 blocks/blocked_by 依赖、pending/in_progress/completed 状态），落在 `AgentState.tasks_context` | `tool/_task/_task_tool_base.py:13`, `tool/_task/_create_task.py`, `state/_task.py:9` (`Task`), `state/_state.py:175` |
| [[memory\|记忆(短/长/向量)]] | **无独立 Memory 模块**。短期=`AgentState.context: list[Msg]`(整段对话上下文)；长期=超阈值时压成结构化 `summary` 字符串预置回上下文；向量=独立 `embedding/` 模块(DashScope/OpenAI/Gemini/Ollama + 文件缓存)，但不与 Agent 自动挂钩(需自接) | `state/_state.py:150` (`context`/`summary`), `embedding/_embedding_base.py:36`, `embedding/__init__.py` |
| [[tool-use\|工具调用]] | `Toolkit` 统一管理函数/MCP/技能；`FunctionTool` 用 `inspect`+docstring 自动抽 JSON schema(`_extract_input_schema`)；工具按 group 分组、可 agentic 激活/停用(meta tool)；执行经 `call_tool`，支持并发安全标记 `is_concurrency_safe` 与状态注入 `is_state_injected(_agent_state)` | `tool/_toolkit.py:66`, `tool/_toolkit.py:225` (`call_tool`), `tool/_adapters.py:30` (`FunctionTool`), `tool/_base.py:35` (`ToolBase`) |
| [[model-abstraction\|模型抽象]] | `ChatModelBase` 抽象 `async __call__(messages, tools, tool_choice)`，统一 stream/重试/`count_tokens`/`context_size`；8 家实现(Anthropic/DashScope/DeepSeek/Gemini/Ollama/OpenAIChat/OpenAIResponse/XAI/Moonshot)；各家配套 `formatter/` 把 `Msg`+block 转 provider 报文；`credential/` 解耦密钥 | `model/_base.py:35,157`, `model/__init__.py`, `formatter/_formatter_base.py:22`, `credential/_base.py` |
| [[multi-agent-orchestration\|多智能体编排]] | **2.0 移除了 1.0 的 `msghub`/`pipeline` 模块**(本仓不存在)。当前路径：① `Agent.observe()` 注入外部消息做松散协作；② FastAPI **agent service** 做多租户多会话承载与编排(`examples/agent_service`)；③ MCP/A2A 把别的 agent 当工具/服务。README 称 message hub 在 roadmap | `agent/_agent.py:254` (`observe`), `app/__init__.py` (service), `mcp/_mcp_client.py:22`；msghub=N/A(2.0 已删) |
| [[context-engineering\|上下文工程]] | 每轮 reasoning 前 `compress_context()`：`count_tokens` 超 `trigger_ratio(0.8)*context_size` 即触发，按 `reserve_ratio(0.1)` 拆分待压/保留，用结构化 `SummarySchema`(task_overview/current_state/...) 让模型生成摘要回填；工具结果按 `tool_result_limit(3000)` 截断；system_prompt 可经 middleware `on_system_prompt` 管道改写 | `agent/_agent.py:300` (`_compress_context_impl`), `agent/_config.py` (`ContextConfig`/`SummarySchema`), `middleware/_base.py:215` |
| [[skills-plugins\|技能/插件]] | **Skills**=带 YAML frontmatter 的 `SKILL.md` 目录，`LocalSkillLoader` 扫描加载，注入提示告知"skill 不是 tool，需用 SkillViewer 读取再照做"(兼容 Claude Code 技能形态)；**插件机制**=middleware(钩子链)而非传统插件；工具组(ToolGroup)可动态激活 | `skill/_base.py:23` (`SkillLoaderBase`), `skill/_local_loader.py:14`, `tool/_toolkit.py:51` (skill 提示), `tool/_builtin/_skill.py` (SkillViewer) |
| [[observability-eval\|可观测/评估]] | 一等公民 **OpenTelemetry**：`TracingMiddleware`(`middleware/_tracing/`) 为 agent/llm/tool 各层开 span，依赖 opentelemetry-sdk + OTLP exporter(pyproject 强依赖)；事件流本身即细粒度可观测；`app/` 服务侧带 OTel。README 提 "built-in evaluation"，但本仓 `src/agentscope` 下未见独立 eval 包(评估在 docs/examples 层) | `middleware/_tracing/_trace.py:116` (`TracingMiddleware`), `middleware/_tracing/_setup.py`, `event/_event.py:14`；eval 模块=待确认 |
| [[runtime-execution\|运行时/部署]] | 纯异步库可直接嵌入；**沙箱化工作区** `workspace/`：`LocalWorkspace`/`DockerWorkspace`/`E2BWorkspace` + `Offloader` 把大上下文/工具结果卸载；生产侧 `app/` 提供 FastAPI **多租户、多会话** agent 服务(`create_app`)、调度器(apscheduler)、AG-UI 协议、Redis 存储；支持本地/Serverless/K8s + OTel | `workspace/__init__.py`, `workspace/_docker/`, `workspace/_e2b/`, `app/_app.py` (`create_app`), `app/_manager/` |
| [[human-in-the-loop-governance\|人在环/治理]] | **规则化 `PermissionEngine`**：5 种 mode(DEFAULT/ACCEPT_EDITS/EXPLORE/BYPASS/DONT_ASK) × 4 种 behavior(ALLOW/DENY/ASK/PASSTHROUGH)，工具自报 `is_read_only` 与 `check_permissions`，危险路径/命令拦截；ASK→agent 产出 `RequireUserConfirmEvent` 暂停等外部确认，`reply()` 可喂回 `UserConfirmResultEvent` 续跑；外部执行经 `RequireExternalExecutionEvent` | `permission/_engine.py:16,76` (`check_permission`), `permission/_types.py:18` (`PermissionMode`), `agent/_agent.py:882` (确认流转), `event/_event.py:46` |
| [[state-persistence\|状态/持久化]] | 全部运行态收敛进单个 pydantic `AgentState`(session_id/context/summary/reply_id/cur_iter/permission_context/tool_context/tasks_context)，可整体序列化恢复；服务侧 `app/storage/` 提供 `RedisStorage` + `SessionRecord/AgentRecord/UserRecord` 等做多会话持久化；文件读缓存带 mtime 失效与 LRU 淘汰 | `state/_state.py:140` (`AgentState`), `app/storage/_redis_storage.py`, `app/storage/_model`, `state/_state.py:23` (`ToolContext` 缓存) |

## 设计权衡与特性

- **"统一 Agent + 中间件" vs 多类继承**：与多数框架用 "BaseAgent→ReActAgent→..." 继承树不同，AgentScope 2.0 把所有能力塞进**一个** `Agent`，用 middleware 钩子横切扩展。优点是行为可预测、事件流统一；代价是单文件 2484 行、定制需懂钩子链与内部状态机。
- **强 ReAct、弱编排**：刻意"相信模型"——无 planner、无强约束 prompt 编排，规划只给 Task 工具。这押注于高能力模型；若用弱模型，缺少脚手架可能不稳。
- **2.0 是断代式重写**：1.0 的 `msghub`/`pipeline` 多智能体原语、`memory` 模块在 2.0 `src/agentscope` 下**已不存在**。多 agent 与记忆改由 service 层 / `observe()` / embedding 自接承载——查 1.0 教程会对不上。
- **Claude-Code 同款电池**：内建 `Bash/Read/Write/Edit/Glob/Grep` 文件工具 + SKILL.md 技能 + 5 档权限 mode + 文件读缓存，几乎是把 Claude Code 的 harness 能力开源化；且兼容 SKILL.md 技能格式。
- **可观测与生产是卖点**：OTel 为强依赖(非可选)，FastAPI 多租户服务 + Docker/E2B 沙箱 + Redis 会话 + apscheduler 调度，明显面向"上云/上 K8s"而非玩具 demo。
- **待确认**：① README 宣称内置 evaluation / multi-agent message hub，但本仓 `src/agentscope` 下未见独立 eval 包、`msghub` 已删，二者更像 roadmap/docs 层能力(待确认)；② embedding 模块存在但默认不与 Agent 记忆自动联动，需开发者自接。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]] · [[context-engineering]]
- 同范式(single+电池/平台)：[[connectonion]] · 源码：`agents-example/agentscope/`
