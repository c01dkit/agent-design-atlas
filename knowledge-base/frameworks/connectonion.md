---
title: "ConnectOnion"
aliases:
  - ConnectOnion
  - connectonion
  - co
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/connectonion
  - lang/python
  - paradigm/single
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/openonion/connectonion
license: MIT (pyproject/README 声明) / 仓库 LICENSE 文件实为 Apache-2.0（待确认，二者不一致）
stars: ~1k
---

# ConnectOnion

> [!abstract] 一句话定位
> 一个"开箱即生产"的 Python single-agent 框架，信条是 **"Keep simple things simple, make complicated things possible"**：两行起一个 agent，普通 Python 函数即工具；同时把 Claude Code 级别的能力（auto_compact、subagents、skills、approval、auto_debug）下放给任意 agent，并自带多 LLM provider、HTTP/P2P 托管与 multi-agent 信任系统。

## 设计理念 / 顶层架构

ConnectOnion 的核心范式是 **single-agent 的 ReAct 式工具循环**，但围绕这个内核堆了一整套"生产平台"——所以它同时带有 platform 气质。设计取舍：

- **函数即原语**：agent、tool、event handler、plugin、trust 全部是普通函数/函数列表。工具无需写 schema，`create_tool_from_function()`（`connectonion/core/tool_factory.py:61`）用 `inspect.signature` + type hints 自动生成 OpenAI function schema，docstring 首行成为描述。
- **薄内核 + 事件/插件外挂**：`Agent` 不靠继承扩展，而靠 **12 个生命周期事件**（`connectonion/core/events.py`）。plugin 只是"事件处理函数的列表"，可组合、可 `co copy`。
- **包结构**：`core/`（agent / llm / tool_executor / tool_factory / tool_registry / events / usage / exceptions）是骨架；`useful_tools/`（bash、file_tools、browser、Gmail/Outlook、Memory、TodoList…）与 `useful_plugins/`（re_act、auto_compact、subagents、skills、tool_approval、ulw…）是电池；`network/`（host / connect / relay / trust / asgi）做 multi-agent 托管与发现；`cli/`（含 `co ai` 这个用框架自身写的编码助手）与 `debug/`（`@xray` + auto_debug）做开发体验。
- **入口 API**：`from connectonion import Agent`，`agent.input(prompt)` 返回字符串（`connectonion/core/agent.py:226`）。

最小示例（取自 README）：

```python
from connectonion import Agent

def search(query: str) -> str:
    """Search for information."""        # docstring 首行 = 工具描述
    return f"Results for {query}"

agent = Agent(
    name="assistant",
    tools=[search],                       # 普通函数直接当工具，无需写 schema
    model="co/gemini-2.5-pro",            # 默认走 OpenOnion 托管 key
    max_iterations=100,
)
print(agent.input("Search for Python tutorials"))
print(agent.history.summary() if hasattr(agent, "history") else "")  # 行为自动落盘 .co/logs/
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 式 while 循环：LLM→若有 tool_calls 则执行→把结果回灌→重复，直到无 tool_call 或达 max_iterations(默认 100)；可经 stop_signal 中途让位用户 | `core/agent.py:416` (`_run_iteration_loop`), `core/agent.py:446` (`_get_llm_decision`) |
| [[planning\|规划/任务分解]] | 内核无显式 planner；规划交给 LLM 自身。可选 `subagents` 插件附带内建 `plan`/`explore` 子 agent（AGENT.md）；ReAct 插件只做意图识别+反思，不做计划 | `useful_plugins/subagents.py`, `useful_plugins/builtin_agents/plan/AGENT.md`, `useful_plugins/re_act.py:17` |
| [[memory\|记忆(短/长/向量)]] | 短期=`current_session['messages']`（多轮持久）；长期=`Memory` 工具，markdown 文件 KV，超阈值自动拆目录（**非向量检索**，regex 搜索）；向量记忆 N/A | `core/agent.py:259`, `useful_tools/memory.py:44` |
| [[tool-use\|工具调用]] | 普通函数→`create_tool_from_function` 自动转 schema；class 实例自动抽方法为工具；原生 function calling；声明 `agent` 形参的工具运行时注入且对 LLM 隐藏(`_needs_agent`) | `core/tool_factory.py:61,130`, `core/tool_executor.py:23`, `core/tool_registry.py` |
| [[model-abstraction\|模型抽象]] | `LLM` 抽象基类 + `create_llm()` 工厂按模型名前缀路由；OpenAI/Anthropic/Gemini/Groq/Grok/Mistral/OpenRouter/OpenOnion(co/)；OpenAI message 格式为 lingua franca，统一 `ToolCall` dataclass | `core/llm.py:1130` (`create_llm`), `core/llm.py` (provider 类) |
| [[multi-agent-orchestration\|多智能体编排]] | 两条路：①进程内 `subagents` 插件经 `task()` 工具派生隔离子 agent；②跨网络 `host()` 把 agent 暴露为 HTTP+WebSocket，经 relay 做 P2P 发现，`connect()`/`RemoteAgent` 远程调用 | `network/host/server.py:280` (`host`), `network/connect.py:565` (`connect`), `useful_plugins/subagents.py` |
| [[context-engineering\|上下文工程]] | system_prompt 支持 str/文件/Path；`auto_compact` 插件在 context≥90% 时用 gemini-flash 摘要旧消息(保留 system+摘要+最近5条)；`system_reminder`/`ulw` 等插件注入上下文 | `prompts.py` (`load_system_prompt`), `useful_plugins/auto_compact.py:30`, `useful_plugins/system_reminder.py` |
| [[skills-plugins\|技能/插件]] | plugin=事件处理函数列表；12 钩子(`events.py`)；Skills=带 YAML frontmatter 的 SKILL.md，三级自动发现(project→user→builtin)，`/command` 触发并临时授予工具权限(turn 结束清除)，**兼容 Claude Code `.claude/skills/`** | `core/events.py`, `useful_plugins/skills.py`, `useful_plugins/__init__.py` |
| [[observability-eval\|可观测/评估]] | 每步写 `current_session['trace']`；`Logger` 三路输出(终端 Rich + `.co/logs/{name}.log` 纯文本 + `.co/evals/*.yaml` 会话)，含 token/cost；`eval` 插件做评估；`@xray`+`auto_debug()` 交互式断点调试 | `logger.py`, `core/agent.py:167` (`_record_trace`), `debug/xray.py`, `useful_plugins/eval.py` |
| [[runtime-execution\|运行时/部署]] | 纯库；同步执行，工具在本进程顺序执行(无沙箱)；`host()` 起 uvicorn ASGI(HTTP+WS) 服务，配置在 `.co/host.yaml`；`co create/init/deploy` CLI 脚手架 | `network/host/server.py:280`, `network/asgi/__init__.py:24` (`create_app`), `cli/main.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | `tool_approval`/`shell_approval` 插件在 `before_each_tool` 拦截危险操作请求审批(bashlex 解析命令)；`ask_user` 工具+`agent.io` 与前端交互；plan_mode 工具 | `useful_plugins/tool_approval/approval.py`, `useful_plugins/tool_approval/bash_parser.py`, `useful_tools/ask_user.py` |
| [[state-persistence\|状态/持久化]] | 本地 `current_session`(runtime-only) + `.co/` 落盘(logs/evals/uploads)；`input(session=...)` 可恢复无状态会话；`host()` 经 `session/storage.py` 做服务端会话持久化与合并 | `core/agent.py:247`, `network/host/session/storage.py`, `network/host/session/merge.py` |

## 设计权衡与特性

- **"电池全包" vs Swarm 极简**：与 [[swarm\|Swarm]] 的去框架化极小内核相反，ConnectOnion 把工具生态、审批、skills、压缩、托管、信任、调试器全部内置——目标是"只写 prompt 和 tools 就能上生产"。代价是依赖很重（playwright、textual、google-api、PyNaCl、uvicorn 等十几个）。
- **函数即原语 + 事件/插件**：明确反对用继承扩展 Agent（CLAUDE.md 写明"Events/plugins over subclassing"），可读性与 `co copy` 可改性是卖点。
- **对标 Claude Code**：`auto_compact`/`subagents`/`ulw`/skills 直接对应 Claude Code 的上下文压缩、子 agent、自治模式，且兼容 `.claude/skills/`——把闭源 harness 的能力开放给任意 agent。
- **信任系统的 fast rules**：agent 互调时先跑零 token 的 YAML 规则(allow/deny/onboard)，仅 unknown 才问 LLM（`network/trust/fast_rules.py:5`），是较少见的"行为换信任"治理设计；三档预设 open/careful/strict。
- **默认模型走托管代理**：默认 `co/gemini-2.5-pro` 经 OpenOnion 代理与计费（`InsufficientCreditsError` 把 402 转成可读错误），降低上手门槛但引入对其托管服务的耦合。
- **待确认/坑**：①LICENSE 文件是 **Apache-2.0**，而 pyproject.toml + README 声明 **MIT**，二者不一致；②CLAUDE.md 内多处路径/版本号(0.4.1)已过时（实际 0.9.5，源码在 `core/` 子包下）；③工具同步顺序执行、无沙箱，危险操作靠 approval 插件而非强隔离。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(single+电池/平台)：[[swarm]] · 源码：`agents-example/connectonion/`
