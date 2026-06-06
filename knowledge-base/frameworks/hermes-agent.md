---
title: "Hermes Agent"
aliases:
  - Hermes Agent
  - hermes-agent
  - hermes
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/hermes-agent
  - lang/python
  - paradigm/single
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/nousresearch/hermes-agent
license: MIT
stars: ~数千
---

# Hermes Agent

> [!abstract] 一句话定位
> Nous Research 出品的 **"自我进化"个人 agent**：单 agent 工具循环为内核，但卖点是一条**闭环学习回路**——它在复杂任务后自动从经验里创建/改写 skill、用后台 fork 自我审查并把"用户是谁"沉淀进持久记忆、用 FTS5 全文检索翻自己的历史会话；模型完全 provider-agnostic（20+ 家、一条 `hermes model` 切换），且"不绑在你的笔记本上"——同一 gateway 进程同时接 Telegram/Discord/Slack/WhatsApp/Signal 等，可跑在 $5 VPS、GPU 集群或六种终端后端（local/Docker/SSH/Singularity/Modal/Daytona）上。

## 设计理念 / 顶层架构

Hermes 的核心范式仍是 **single-agent 的 ReAct 式工具循环**（LLM→tool_calls→回灌→重复），但它把重心从"内核优雅"挪到了**"生产个人助理 + 自我改进"**这两件事上，所以同时带强烈的 platform 气质。设计取舍：

- **不是库，是一个完整产品**：入口是 CLI（`hermes` / `hermes-cli/main.py`）与 messaging gateway，而非"`from x import Agent`"。`pyproject.toml:253` 暴露三个 console script：`hermes`(CLI)、`hermes-agent`(`run_agent:main`)、`hermes-acp`(IDE/ACP 适配)。核心编排类是 `AIAgent`（`run_agent.py:319`），单轮驱动逻辑被抽进 `agent/conversation_loop.py` 的 `run_conversation`（约 3900 行）。
- **闭环学习回路（最独特处）**：每轮结束后 fork 一个受限的 `AIAgent`（白名单只剩 memory/skill 工具）在后台守护线程里"回看本轮该不该存记忆/建 skill"（`agent/background_review.py:34,562`）；外加 idle 触发的 `curator`（`agent/curator.py`）周期性归档/合并/打补丁 agent 自创的 skill。这把 skill/memory 从"用户手填"变成"agent 自维护"。
- **极端工程化的供应链/跨平台纪律**：直接依赖**全部精确 pin 到 `==X.Y.Z`**（`pyproject.toml:24` 起，因 2026-05 的 Mini Shai-Hulud worm 而收紧）；provider 专属/重依赖走 `tools/lazy_deps.py` 首用懒装，缩小攻击面；`hermes_bootstrap.py` 在每个入口顶部做 Windows UTF-8 兜底。原生 Windows 一等公民。
- **包结构**：`agent/`（80+ 模块：conversation_loop、context_engine/compressor、memory_manager、curator、background_review、各家 model adapter）是骨架；`tools/`（40+ 工具：terminal、delegate、skills、memory、session_search、code_execution…）是电池；`providers/`（声明式 ProviderProfile）+ `model_tools.py` 做模型抽象；`gateway/` 做多平台接入；`cron/`、`acp_adapter/`、`mcp_serve.py` 做调度/IDE/MCP；`skills/` 内置数十个 SKILL.md，`hermes_state.py` 是 SQLite+FTS5 会话存储。

最小示例（取自 README 的 Getting Started）：

```bash
# 安装（Linux/macOS/WSL2/Termux）
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc

hermes              # 交互式 CLI，开始对话（带 TUI、多行编辑、斜杠命令补全）
hermes model        # 选择 provider 与模型（OpenRouter / Nous Portal / OpenAI / 本地端点…无代码改动）
hermes tools        # 配置启用哪些工具
hermes gateway      # 启动 messaging gateway，然后从 Telegram/Discord/Slack… 给它发消息

# 会话内斜杠命令（CLI 与 messaging 共享）
# /new /reset 重开 · /model 切模型 · /compress 压上下文 · /<skill-name> 触发技能 · /usage 看用量
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 式 `while` 循环：调模型→若有 tool_calls 则执行(可并发)→回灌结果→重复，直到无 tool_call 或耗尽 `max_iterations`(默认 90) / `IterationBudget`；逐 provider 处理 `finish_reason`(stop/length/incomplete)、失败 failover、partial-stream 续写 | `agent/conversation_loop.py:801` (主循环), `agent/conversation_loop.py:351` (`run_conversation`), `run_agent.py:319,353` (`AIAgent`/`max_iterations`) |
| [[planning\|规划/任务分解]] | 无独立 planner，规划交给 LLM 自身。提供 `todo` 工具(内存任务表，压缩后会重注入)做显式分解；并内置 `plan`/`spike` 等软件开发 skill 引导规划 | `tools/todo_tool.py:25` (`TodoStore`), `skills/software-development/plan/SKILL.md` |
| [[memory\|记忆(短/长/向量)]] | 短期=SQLite 会话消息(多轮持久)；长期=`memory` 工具写 `MEMORY.md`(agent 自记) + `USER.md`(对用户的画像)，§ 分隔、字符上限、**session 启动时冻结快照注入 system prompt 保护 prefix cache**；可插拔后端(内置/Honcho/Mem0)；向量检索 N/A(走 FTS5 而非 embedding) | `tools/memory_tool.py:1`, `agent/memory_manager.py:1`, `agent/memory_provider.py` |
| [[tool-use\|工具调用]] | 中央 `ToolRegistry`：每个工具文件 import 时 `registry.register(name, toolset, schema, handler, check_fn…)` 自注册，AST 扫描自动发现(`discover_builtin_tools`)；原生 function calling；执行支持并发/顺序两路；危险命令经 approval 拦截 | `tools/registry.py:234` (`register`), `tools/registry.py:57` (发现), `agent/tool_executor.py:180,690` (并发/顺序执行) |
| [[model-abstraction\|模型抽象]] | 声明式 `ProviderProfile` dataclass(auth/endpoint/api_mode/quirks)，插件式注册(`plugins/model-providers/<name>/`，用户插件 last-writer-wins 可覆盖内置)；底座是 OpenAI SDK，另带 anthropic/bedrock/gemini-native/codex-responses 等专属 adapter；`hermes model` 一条切换、credential pool 多 key 轮换、无代码改动 | `providers/base.py:38` (`ProviderProfile`), `providers/__init__.py:1` (注册/发现), `agent/anthropic_adapter.py`·`agent/bedrock_adapter.py`·`agent/gemini_native_adapter.py` |
| [[multi-agent-orchestration\|多智能体编排]] | `delegate_task` 工具派生隔离子 `AIAgent`：全新对话(无父史)、独立 task_id/终端、受限 toolset(强制剥离 delegate/clarify/memory/send_message/execute_code)、单/批并行(`ThreadPoolExecutor`)，父进程阻塞至子完成、只回看 summary | `tools/delegate_tool.py:1,45` (`DELEGATE_BLOCKED_TOOLS`), `tools/mixture_of_agents_tool.py` |
| [[context-engineering\|上下文工程]] | 可插拔 `ContextEngine` 抽象基类(config `context.engine` 选，默认 `compressor`)；`ContextCompressor` 用辅助小模型摘要中段、保护首尾(token 预算)、结构化模板(Resolved/Pending/Remaining Work)、迭代式更新；记忆/skill 注入用 `<memory-context>` 围栏 + 去注入清洗 | `agent/context_engine.py:32` (ABC), `agent/context_compressor.py:1`, `agent/memory_manager.py:54` (`sanitize_context`) |
| [[skills-plugins\|技能/插件]] | Skills=带 YAML frontmatter 的 SKILL.md，progressive disclosure(list 看元数据→view 加载全文→按需读 references)，**兼容 agentskills.io 开放标准**；`/<skill-name>` 触发；**agent 可自创/自改 skill** 并由 curator 维护；插件体系覆盖 model-provider/gateway 平台/context-engine/MCP | `tools/skills_tool.py:1,9`, `tools/skill_manager_tool.py`, `agent/curator.py:1`, `skills/**/SKILL.md` |
| [[observability-eval\|可观测/评估]] | `session_search` 工具对 SQLite **FTS5** 全文索引做跨会话召回(discovery/scroll/browse 三模式，零 LLM 成本)；`hermes logs --session <id>` 按 session 过滤(`set_session_context`)；`/usage`·`/insights` 看 token/成本；`batch_runner.py`+`trajectory_compressor.py` 产训练轨迹 | `tools/session_search_tool.py:1`, `hermes_state.py:321` (`messages_fts`), `agent/insights.py`, `batch_runner.py` |
| [[runtime-execution\|运行时/部署]] | 六种终端后端：local/Docker/SSH/Singularity/Modal/Daytona(`TERMINAL_ENV` 选；Modal/Daytona 提供 idle 休眠的 serverless 持久化)；`code_execution` 工具让脚本经 **UDS/文件 RPC** 回调 Hermes 工具，把多步流水线压成零上下文成本一轮；可 $5 VPS 长驻 | `tools/terminal_tool.py:5-15` (后端), `tools/code_execution_tool.py:5-17` (RPC), `cron/scheduler.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | 危险命令审批：`DANGEROUS_PATTERNS` 检测→CLI 交互/gateway 异步提示→可选辅助 LLM 智能自动批低风险→永久 allowlist 落 config.yaml；`HERMES_YOLO_MODE` 导入期冻结防 prompt-injection 提权；`clarify` 工具向用户提问；gateway DM 配对/容器隔离 | `tools/approval.py:1,29` (`_YOLO_MODE_FROZEN`), `tools/clarify_tool.py`, `acp_adapter/permissions.py`·`acp_adapter/edit_approval.py` |
| [[state-persistence\|状态/持久化]] | `hermes_state.py` = SQLite 会话库(消息 + FTS5/trigram 全文索引 + checkpoint)，跨会话/跨平台连续；`MEMORY.md`/`USER.md` 文件落盘；profiles 多实例隔离配置/会话/skill/记忆；`tools/checkpoint_manager.py` 文件快照可回滚 | `hermes_state.py:321,350` (FTS5/trigram), `tools/checkpoint_manager.py`, `tools/memory_tool.py:1` |

## 设计权衡与特性

- **"自我进化"是真正的差异点**：与 [[connectonion\|ConnectOnion]] 的 auto_compact/subagents/skills 这类"对标 Claude Code 的能力下放"相比，Hermes 多了一条**后台自审 + curator 维护**的闭环——skill/memory 不只是用户写的，agent 会在每轮后主动 fork 自评是否该沉淀、idle 时归并旧 skill（`agent/background_review.py:562`、`agent/curator.py`）。这是它区别于绝大多数 single-agent 框架的核心卖点，也是 Nous Research "与你共同成长" 定位的落地。
- **个人助理 / "不绑笔记本" 形态**：一个 gateway 进程接十几个 messaging 平台、六种终端后端、Modal/Daytona serverless 休眠——把 agent 当成跑在云上随时可聊的常驻服务，而非一次性脚本。代价是配置面巨大（`pyproject.toml` 几十个 optional-dependencies extra）。
- **供应链与跨平台的偏执工程**：直接依赖全部精确 pin、provider 专属依赖懒装、Windows UTF-8 bootstrap、FTS5 不可用时的降级探测——可见其面向"真实终端用户长期运行"而非"demo"打磨。`pyproject.toml` 注释本身就是一份事故复盘史（CVE、worm、Windows 编码回归）。
- **provider-agnostic 做到极致**：声明式 `ProviderProfile` + 插件覆盖 + credential pool 轮换 + 20+ 家(含 Nous Portal 统一订阅 model/搜索/图像/TTS/cloud browser)，主打 "no lock-in"。底座是 OpenAI 消息格式，专属 adapter 兜各家差异。
- **记忆的 "frozen snapshot" 取舍**：长期记忆 session 启动时冻结注入 system prompt、mid-session 写盘但不改 prompt——刻意牺牲"当轮即时生效"换取整个 session 的 prefix cache 命中（`tools/memory_tool.py:1` 注释）。这是性能/成本导向的明确设计决定。
- **待确认/坑**：① skill/memory 自审是 LLM 驱动的后台 fork，质量与触发频率依赖 nudge interval 与模型能力，可能产生噪声 skill（curator 用归档而非删除来兜底，`agent/curator.py` 注明"never auto-deletes"）；② 终端 `local` 后端直接在宿主执行，隔离靠 approval/容器后端而非默认沙箱；③ 仓库体量极大（`cli.py`/`run_agent.py`/`hermes_state.py` 均数千~数十万行），单文件远超常规规模，阅读成本高。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(single + 电池/平台 + 自我进化)：[[connectonion]] · 源码：`agents-example/hermes-agent/`
