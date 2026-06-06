---
title: "nanobot"
aliases:
  - nanobot
  - nanobot-ai
  - 🐈 nanobot
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/nanobot
  - lang/python
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/HKUDS/nanobot
license: MIT
stars: ~数千 (HKUDS 出品，个人维护)
---

# nanobot

> [!abstract] 一句话定位
> 一个超轻量、可自托管的 Python **single-agent 运行时**：围绕一个小而可读的 agent loop（消息进入→LLM 决定是否调工具→拉取记忆/技能作为上下文→回写渠道），把长时运行 agent 真正需要的"实战零件"——WebUI、9+ 聊天渠道、工具、记忆、MCP、模型路由与部署——都内置进来，让你"拥有自己的 AI agent 技术栈"而不依赖大平台。

## 设计理念 / 顶层架构

nanobot 的核心范式是 **single-agent 的工具循环（tool-using loop）**，刻意保持"薄内核 + 异步消息总线解耦"的取舍：

- **消息总线解耦**：渠道与 agent 核心通过异步 `MessageBus`（`nanobot/bus/queue.py`）通信。渠道发布 `InboundMessage`，`AgentLoop` 消费、构建上下文、协调一个 turn，结果作为 `OutboundMessage` 发回对应渠道。这让"加一个聊天平台"与"改 agent 逻辑"互不耦合。
- **AgentLoop / AgentRunner 双层**：`AgentLoop`（`nanobot/agent/loop.py`）是产品层引擎，负责 session key、hook、上下文构建、压缩、命令路由、mid-turn 注入；它把一个 turn 建模成一张**显式状态机**（`TurnState`: RESTORE→COMPACT→COMMAND→BUILD→RUN→SAVE→RESPOND→DONE，`loop.py:76,167`）。`AgentRunner`（`nanobot/agent/runner.py`）是纯粹的"工具型 LLM 循环"，不含产品层关切，可被主 loop、subagent、Dream 复用。
- **插件式自动发现**：工具（`Tool` 子类）和渠道都用 `pkgutil` 扫描包 + `entry_points` 第三方插件自动注册（`agent/tools/loader.py:37,68`）。新增内置工具=丢一个文件进 `agent/tools/`；新增 provider≈2 步。
- **电池内置但内核小**：记忆（含 Dream 两阶段巩固）、MCP 客户端、cron、sandbox、subagent、长任务/持续目标、图像生成、self-modify 全部内置，但都以"工具/上下文"形态挂在小内核外围，而非重型编排层。
- **入口形态**：CLI `nanobot/cli/commands.py`（`nanobot onboard / agent / gateway`）；Python SDK 门面 `Nanobot`（`nanobot/nanobot.py:23`，`Nanobot.from_config().run(...)`）；OpenAI 兼容 HTTP API（`nanobot/api/server.py`）。配置走 Pydantic + `~/.nanobot/config.json`。

最小示例（取自 README，零代码——配置驱动）：

```bash
# 1) 初始化向导
nanobot onboard

# 2) 在 ~/.nanobot/config.json 配 key 与模型
#   { "providers": { "openrouter": { "apiKey": "sk-or-v1-xxx" } },
#     "agents": { "defaults": { "provider": "openrouter",
#                               "model": "anthropic/claude-opus-4-6" } } }

# 3) 开聊（CLI）；或开 WebUI/网关
nanobot agent
# 启用 websocket 渠道后： nanobot gateway  →  http://127.0.0.1:8765
```

```python
# Python SDK 形态（nanobot/nanobot.py）
import asyncio
from nanobot import Nanobot

async def main():
    bot = Nanobot.from_config()                 # 读 ~/.nanobot/config.json
    result = await bot.run("Summarize this repo")
    print(result.content)

asyncio.run(main())
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | single-agent 工具循环：turn 建模为显式状态机（RESTORE→…→RESPOND→DONE），内层 `AgentRunner._run_core` 按 `max_iterations`（默认见 `AgentDefaults`）迭代：请求模型→若 `should_execute_tools` 则执行工具回灌→否则收敛为最终回复；含空回复/截断/注入恢复 | `agent/loop.py:76,167` (TurnState/transitions), `agent/runner.py:321` (`_run_core`), `agent/runner.py:386` |
| [[planning\|规划/任务分解]] | 内核无独立 planner，规划交给 LLM；提供 **sustained goal / long_task** 机制：`/goal` 持续目标跨 turn 续跑，`goal_continue_message` 注入让模型继续推进或 `complete_goal`；Step Plan 经 skill 引导 | `session/goal_state.py:40` (`sustained_goal_active`), `agent/runner.py:196` (goal continue), `agent/tools/long_task.py`, `skills/long-goal/SKILL.md` |
| [[memory\|记忆(短/长/向量)]] | 短期=`Session` 历史（JSONL，token 预算回放）；长期=`MEMORY.md`/`SOUL.md`/`USER.md` 文件；**Dream 两阶段巩固**把溢出消息 LLM 摘要进 `history.jsonl`（原子写+fsync，cursor 增量）；按 token 预算触发 `Consolidator`。**非向量检索** | `agent/memory.py:40` (`MemoryStore`), `agent/memory.py:555` (`Consolidator`), `agent/memory.py:781` (`maybe_consolidate_by_tokens`) |
| [[tool-use\|工具调用]] | `Tool` ABC（name/description/parameters JSON Schema + `execute`）；`ToolLoader` pkgutil 扫描自动注册，`@tool_parameters` 装饰器注入 schema；`ToolRegistry` 缓存定义、`prepare_call` 做类型 cast+校验；runner 支持并发批（`concurrency_safe`/`read_only`）执行 | `agent/tools/base.py:124` (`Tool`), `agent/tools/base.py:264` (`tool_parameters`), `agent/tools/registry.py:8`, `agent/tools/loader.py:86`, `agent/runner.py:853` |
| [[model-abstraction\|模型抽象]] | `LLMProvider` ABC（OpenAI message 为通用格式，统一 `LLMResponse`/`ToolCallRequest`）；`factory.make_provider` 按 provider backend 路由：openai_compat/anthropic/azure/bedrock/github_copilot/openai_codex/openai_responses；`FallbackProvider` 做多模型 failover，原生 `openai`+`anthropic` SDK（已弃用 litellm） | `providers/base.py:92` (`LLMProvider`), `providers/factory.py:31` (`_make_provider_core`), `providers/fallback_provider.py`, `providers/registry.py` |
| [[multi-agent-orchestration\|多智能体编排]] | 进程内 `SubagentManager` 派生隔离子 agent（独立 `ToolRegistry`/workspace scope，复用 `AgentRunner`），结果经 bus 作为 system 消息回灌父会话；`spawn` 工具触发，受 `max_concurrent_subagents` 限流。**无跨网络 agent 协议** | `agent/subagent.py:74` (`SubagentManager`), `agent/tools/spawn.py`, `agent/loop.py:275` |
| [[context-engineering\|上下文工程]] | `ContextBuilder` 组装 system prompt（identity + 引导文件 AGENTS/SOUL/USER.md + 长期记忆 + 技能摘要）；runner 内做上下文治理：drop 孤儿 tool 结果、backfill 缺失、`_microcompact` 折叠旧工具结果、按 token 预算 `_snip_history`、大工具结果落盘（`maybe_persist_tool_result`）；turn 级 MCP/CLI-app runtime 注释行 | `agent/context.py:51` (`ContextBuilder`), `agent/runner.py:347,1261` (`_microcompact`), `agent/runner.py:1307` (`_snip_history`), `agent/context.py:30` (`runtime_lines`) |
| [[skills-plugins\|技能/插件]] | Skills=带 YAML frontmatter 的 `SKILL.md`，三级发现（workspace→builtin，workspace 覆盖同名），`requires.bins/env` 决定可用性，`always=true` 强制注入，渐进式加载（先摘要后 `read_file`）；内置 skill 含 cron/long-goal/github/memory/skill-creator 等。工具插件经 `entry_points("nanobot.tools")` 扩展 | `agent/skills.py:21` (`SkillsLoader`), `agent/skills.py:203` (`get_always_skills`), `skills/*/SKILL.md`, `agent/tools/loader.py:62` |
| [[observability-eval\|可观测/评估]] | 全程 `loguru` 结构化日志（含 turn 状态机 trace `StateTraceEntry`、tool 事件、token usage）；运行时事件总线 `RuntimeEventBus` 推送给 WebUI（model/状态/延迟）；可选 **Langfuse** tracing（设 `LANGFUSE_SECRET_KEY` 自动包裹 OpenAI 客户端）与 LangSmith；无内置评估框架（pytest 测试套件） | `agent/loop.py:88` (`StateTraceEntry`), `bus/runtime_events.py`, `providers/openai_compat_provider.py:403` (Langfuse) |
| [[runtime-execution\|运行时/部署]] | 纯 asyncio 库 + CLI；三种入口：CLI `nanobot agent`、网关 `nanobot gateway`（WebSocket 多路复用 + 内置 WebUI，打进 wheel）、OpenAI 兼容 HTTP API；shell 工具带 sandbox 后端与 allow-list；Docker / docker-compose / Linux service / macOS LaunchAgent 部署 | `cli/commands.py`, `api/server.py`, `channels/websocket.py`, `agent/tools/sandbox.py`, `Dockerfile`, `docker-compose.yml` |
| [[human-in-the-loop-governance\|人在环/治理]] | `ask_user` 工具（支持 choices）向渠道发问；DM 发送者 **pairing** 审批（每渠道持久配对码，`pairing/store.py`）；渠道 allow-list / 安全默认拒绝；SSRF 硬边界（私网 URL 不可绕过，`runner.py:1043`）；shell allow-list；`/stop` 中途取消 turn 并保留部分上下文 | `agent/tools/message.py` (`ask_user`), `pairing/`, `channels/base.py:13`, `agent/runner.py:1043` (SSRF), `agent/loop.py:990` (取消恢复) |
| [[state-persistence\|状态/持久化]] | `SessionManager` 每会话 JSONL 历史（原子写+fsync，自动修复）；TTL 触发 `AutoCompact` 闲置压缩；turn 中 `_emit_checkpoint` 落盘 runtime checkpoint，崩溃/`/stop` 后可恢复；记忆文件 + 可选 git 版本化（`GitStore`/dulwich）；持续目标状态存 session metadata | `session/manager.py` (`SessionManager`), `agent/autocompact.py` (`AutoCompact`), `agent/loop.py:707` (checkpoint), `agent/memory.py:370` (`_write_entries` 原子写), `utils/gitstore.py` |

## 设计权衡与特性

- **"小核心 + 实战电池" vs 极简内核**：与去框架化的 [[swarm\|Swarm]] 不同，nanobot 把 9+ 聊天渠道、记忆巩固、MCP、cron、subagent、sandbox、WebUI 全部内置——目标是"个人就能拥有并自托管一个 24/7 长跑 agent"。代价是依赖很重（telegram/lark/slack/qq/discord SDK、mcp、tiktoken、boto3、pypdf/docx/pptx/openpyxl 文档解析、dulwich 等几十个）。
- **turn 显式状态机 + mid-turn 注入**：把一个对话回合建成 `TurnState` 状态机并记录每态耗时 trace，是较少见的工程化做法；配合 per-session 串行 / 跨 session 并发 + pending queue，可在 agent 仍在跑工具时把用户后续消息"注入"当前 turn（`runner._try_drain_injections`），而非排队新 turn——对长任务体验关键。
- **Dream 两阶段记忆**：历史用 append-only `history.jsonl`（cursor 增量、原子写 + fsync + 目录 fsync），`Consolidator` 按 token 预算把溢出消息 LLM 摘要、降级时 raw-archive 兜底；`MemoryStore` 还做了 legacy `HISTORY.md`→JSONL 一次性迁移。可靠性细节（去孤儿 tool 结果、backfill、microcompact、token snip）非常密集。
- **provider 抽象成熟**：原生 `openai`+`anthropic` SDK（2026-03 移除 litellm），统一 OpenAI message 格式 + `ToolCallRequest`，覆盖 OpenAI-compat / Anthropic / Azure / Bedrock / GitHub Copilot / OpenAI Codex / Responses API，并有 `FallbackProvider` 多模型 failover 与 model presets 热切换（`_apply_provider_snapshot` 不打断进行中的 turn）。
- **single-agent 边界清晰**：多智能体仅限进程内 subagent（隔离工具/工作区，结果经 bus 回灌父会话），**没有**跨网络 agent-to-agent 协议或信任系统——与 ConnectOnion 的 host/relay/trust 路线形成对照。
- **安全是硬边界**：SSRF（私网 URL）为"不可绕过"边界、shell sandbox + allow-list、workspace 路径限制、DM pairing 审批、默认拒绝未知渠道；CLI 入口启用 PTH 文件守卫（`nanobot/security/`）。
- **待确认/坑**：①向量检索缺失，长期记忆是文件 + LLM 摘要而非语义检索；②依赖面极大，按需用 optional-extras（discord/matrix/wecom/weixin/msteams/pdf 等）裁剪；③仍标 `Development Status :: 3 - Alpha`、版本 0.2.1，News 显示迭代极快（near-daily），API 可能漂移；④Windows 下 MCP stdio 启动器需特殊包装（`mcp.py:101`），且部分目录 fsync 在 Windows 跳过。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(single+电池/自托管平台)：[[connectonion]] · [[swarm]] · 源码：`agents-example/nanobot/`
