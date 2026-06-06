---
title: "Agent-LLM (AGiXT)"
aliases:
  - Agent-LLM
  - AGiXT
  - agent-llm
  - agixt
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agent-llm
  - lang/python
  - paradigm/platform
  - paradigm/multi
  - paradigm/rag
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/Josh-XT/Agent-LLM
license: MIT (DevXT LLC 2025，见 LICENSE)
stars: ~3k
---

# Agent-LLM (AGiXT)

> [!abstract] 一句话定位
> AGiXT 是一个"重型 AI 自动化平台"而非轻量库：以 FastAPI 服务 + 多租户 SQL 数据库为底座，把 agent / provider / chain / memory / extension 全部做成可配置的服务端资源，自带 97+ 内置 extension（从 Tesla、家居到数据库/邮件/社交）、多 LLM provider 抽象、pgvector 长期记忆、JSON 定义的工作流编排与定时任务，并暴露 OpenAI 兼容 API，目标是"用自然语言驱动数字与物理世界的中枢神经"。

## 设计理念 / 顶层架构

AGiXT 的核心范式是 **平台化（platform）**——它不是 `import` 一个 Agent 类就能跑的库，而是一整套要 `agixt start` 起服务的应用。设计取舍：

- **一切皆服务端资源**：agent、conversation、chain、memory、prompt、extension/provider 都落在 SQL 数据库（SQLite 或 Postgres，`agixt/DB.py:98` 按 `DATABASE_TYPE` 切换），通过 FastAPI 路由（`agixt/app.py:220` 起 `app = FastAPI(...)`，`agixt/endpoints/` 下 20+ router）增删改查。多租户、OAuth、计费（Stripe/crypto）、webhook 全部内建。
- **extension = 工具的唯一抽象**：所有能力（包括 LLM provider 本身）都是继承 `Extensions` 的类，把方法挂进 `self.commands` 字典即成为 agent 可调用的命令（`agixt/Extensions.py:435`）。Provider 只是 `CATEGORY = "AI Provider"` 的特殊 extension（`agixt/Providers.py:57`）。
- **prompt 驱动的 ReAct 循环**：推理不强依赖原生 function-calling，而是用 "Think About It" 提示让 LLM 输出 `<thinking>`/`<reflection>`/`<answer>`/`<execute><name>…</name></execute>` 这类 XML 标签，平台解析 `<execute>` 块、执行命令、把 `<output>` 回灌再次推理（`agixt/Interactions.py:7058` 解析，`:7199` `execution_agent` 执行循环）。
- **三层封装**：`Extensions`（工具/provider 底座）→ `Interactions`（推理/反思/命令选择与执行循环，`agixt/Interactions.py:1162`）→ `XT`（对外门面：`inference`、`chat_completions`、`run_chain_step`，`agixt/XT.py`）。
- **入口形态**：CLI `agixt=agixt.cli:main`（`setup.py:47`）启动；编程入口是 OpenAI 兼容的 `XT.chat_completions`（`agixt/XT.py:2783`）或 `XT.inference`（`agixt/XT.py:736`）。

最小示例（取自 docs/README.md 的 Quick Start）：

```bash
# 安装并启动平台（起 FastAPI 服务，默认 7437 端口）
pip install agixt
agixt start
```

```python
# 通过官方 SDK 以 OpenAI 兼容方式调用已配置好的 agent
from agixtsdk import AGiXTSDK

sdk = AGiXTSDK(base_uri="http://localhost:7437", api_key="YOUR_API_KEY")
response = sdk.prompt_agent(
    agent_name="AGiXT",
    prompt_name="Think About It",          # 触发 ReAct/反思式推理循环
    prompt_args={"user_input": "Search the web for Python tutorials and summarize."},
)
print(response)
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 自定义 XML 标签 ReAct+反思：LLM 输出 `<thinking>`/`<reflection>`/`<execute><name>…</name></execute>`/`<answer>`，平台正则解析 `<execute>` 块→执行→把 `<output>` 回灌再次推理，直到出现完整 `<answer>`；非纯原生 function-calling | `Interactions.py:7058` (解析 execute 块), `Interactions.py:7199` (`execution_agent`), `Interactions.py:3247` (`run_stream`), `Interactions.py:64` (`_RE_EXECUTE_TAG`) |
| [[planning\|规划/任务分解]] | ①隐式：靠 "Think About It" 提示让 LLM 自己 thinking/reflection；②显式：用 JSON **Chain** 预编排多步工作流（如 `chains/Smart Instruct.json`、`Generate Task Chain.json`）；命令选择阶段先让 LLM 挑出相关命令及其前置命令 | `Interactions.py:2831` (命令选择 prompt), `agixt/chains/*.json`, `Chain.py:38` |
| [[memory\|记忆(短/长/向量)]] | 短期=数据库里的 Conversation/Message；长期=向量记忆，`Memory` 表 `embedding = Column(Vector)`（Postgres 走 pgvector），余弦相似度检索；embedding 用**本地 ONNX 模型**（`onnx/model.onnx`）离线生成，无需外部 embedding API | `DB.py:2725` (`class Memory`/`Vector`), `DB.py:2775` (`calculate_vector_similarity`), `Memories.py:64` (`embed`), `Memories.py:73` (ONNX `InferenceSession`) |
| [[tool-use\|工具调用]] | extension 类把方法挂进 `self.commands` 字典即成工具；运行时 `Extensions.execute_command` 按签名注入参数与 `injection_variables`（user_id/agent_id/ApiClient/凭据等）；支持 client-side 远程工具与 MCP（`Use MCP Server` 命令、`mcp_client.py`） | `Extensions.py:435`, `Extensions.py:893` (`load_commands`), `Extensions.py:1045` (`execute_command`), `mcp_client.py` |
| [[model-abstraction\|模型抽象]] | provider = `CATEGORY="AI Provider"` 的 extension，按 `services()`（llm/tts/image/embeddings/vision…）分类自动发现；`get_providers_by_service` 路由；内置 OpenAI/Anthropic/Gemini/Azure/DeepSeek/HuggingFace/ezlocalai 等（`extensions/*.py`） | `Providers.py:23` (`_get_ai_provider_extensions`), `Providers.py:204` (`get_providers_by_service`), `agixt/extensions/openai.py` 等 |
| [[multi-agent-orchestration\|多智能体编排]] | ①agent 互调：extension 命令内经 `self.ApiClient.prompt_agent(...)` 让一个 agent 调另一个 agent（`automation_helpers.py:264`）；②Chain 可在步骤里指定不同 `agent_name` 串接多 agent；③各 BotManager（Discord/Slack/Teams…）+ `WorkerRegistry`/`BotManagerRegistry` 做渠道侧编排 | `automation_helpers.py:264`, `XT.py:1004` (`run_chain_step`, 每步可 `agent_override`), `WorkerRegistry.py`, `BotManagerRegistry.py` |
| [[context-engineering\|上下文工程]] | 注入向量记忆（`injected_memories`/`context_results`）+ 近期对话（`conversation_results`）+ 可选 web 搜索（`Websearch.py`）+ 浏览链接；**两段式命令选择**先用大窗口模型从全部命令里筛出相关子集再注入，控制工具上下文膨胀；对话历史可压缩 | `Interactions.py:3247` (`run_stream` 组装上下文), `Interactions.py:2831` (命令选择), `Websearch.py`, `Interactions.py:2521` (历史压缩) |
| [[skills-plugins\|技能/插件]] | extension 即插件体系：97+ 内置（`agixt/extensions/`），可自定义并经 **Extensions Hub** 从外部 git 仓库/本地路径热加载（`EXTENSIONS_HUB` 环境变量，`ExtensionsHub.py`）；extension 可带 SQLAlchemy 模型、FastAPI 路由、WebSocket、webhook、Desktop UI 包 | `agixt/extensions/` (97 文件), `ExtensionsHub.py`, `extensions/README.md` (扩展开发规范), `Marketplace.py` |
| [[observability-eval\|可观测/评估]] | 全程把活动写入 conversation 日志（`[ACTIVITY]`/`[SUBACTIVITY]` 标记，含命令执行成功/失败）；webhook 事件 `command.execution.started/failed`（`Extensions.py:1078`）；`UsageTrackingMiddleware` 记 token/用量；评估类 chain（Smart Instruct）做自反思。无独立 eval harness（待确认） | `Interactions.py:7542` (subactivity 日志), `Extensions.py:1078` (webhook 事件), `middleware.py` (`UsageTrackingMiddleware`), `session_tracker.py` |
| [[runtime-execution\|运行时/部署]] | FastAPI + uvicorn 服务（`app.py:220`），Docker/`docker-compose.yml` 部署；危险代码经 `safeexecute`（Docker 沙箱执行库，见 requirements）隔离；`agixt start` CLI 一键起服务，ngrok 内网穿透可选 | `app.py:220`, `Dockerfile`, `docker-compose.yml`, `cli.py`, `run-local.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | 多租户 + RBAC：`MagicalAuth.py` 做认证/OAuth/角色，`endpoints/Roles.py`；extension 自动派生 `ext:<name>:read/execute/configure` 权限作用域；`CriticalEndpointProtectionMiddleware`/`middleware.py` 端点保护；可经聊天渠道由人审批/介入。无内置逐工具调用审批 UI（待确认） | `MagicalAuth.py`, `endpoints/Roles.py`, `middleware.py:258` (`CriticalEndpointProtectionMiddleware`), `extensions/README.md` (scopes 章节) |
| [[state-persistence\|状态/持久化]] | 全部状态入 SQL：`Agent`/`Conversation`/`Message`/`Chain`/`ChainStep`/`ChainStepResponse`/`Memory`/`TaskItem` 等 SQLAlchemy 模型（`DB.py`）；SQLite 或 Postgres 二选一；定时/重复任务由 `Task`+`TaskMonitor` 持久化调度（`scheduled`/`due_date`/cron 式重复） | `DB.py:1594` (`Agent`), `DB.py:1939` (`Chain`), `DB.py:2169` (`TaskItem`), `DB.py:2725` (`Memory`), `Task.py:64` (`create_task`), `TaskMonitor.py` |

## 设计权衡与特性

- **平台 vs 库**：与 [[connectonion\|ConnectOnion]]（薄库，两行起 agent）相反，AGiXT 是"先起服务、再配资源"的整套后端。强项是开箱即用的企业级能力（多租户、OAuth、计费、webhook、97+ 集成、定时任务、OpenAI 兼容 API）；代价是依赖极重（playwright、spacy、onnxruntime、SQLAlchemy、stripe、solana、各种厂商 SDK，`requirements.txt` 近 90 项）且必须跑 DB+服务，单文件极简场景不适用。
- **extension 一统天下**：把 tool 与 LLM provider 统一成同一种 `Extensions` 抽象（provider 只是 `CATEGORY="AI Provider"`），并支持从外部 git 仓库热加载 hub，是其最大特色——生态扩展边界清晰，但也意味着新增任何能力都要遵循这套服务端约定（命名、`self.commands`、`__init__` 显式参数）。
- **prompt 标签式 ReAct 而非原生 function-calling**：用 `<execute><name>…</name></execute>` 文本协议解析工具调用，跨 provider 一致（连不支持 function-calling 的模型也能用），但需要大量正则与"标签是真调用还是文中提及"的鲁棒性处理（`Interactions.py` 中可见对 `<answer>`/`<execute>` 误用的纠偏逻辑），脆弱性高于结构化 tool-calls。
- **两段式命令选择控上下文**：面对 97+ extension 的海量命令，先用大窗口模型筛出相关命令子集再注入推理上下文（`Interactions.py:2831`），缓解工具列表爆炸——是平台级框架特有的工程取舍。
- **本地 ONNX embedding + pgvector**：长期记忆用本地 ONNX 模型生成向量、Postgres pgvector 存储检索，避免外部 embedding API 依赖与成本，适合自托管。
- **待确认/坑**：①目标仓库标注为 `Josh-XT/Agent-LLM`，但代码与品牌已全面更名为 **AGiXT**（`Josh-XT/AGiXT`），Agent-LLM 实为其历史名/重定向；②可观测仅靠对话活动日志 + webhook + 用量中间件，无独立 eval/tracing harness（待确认是否有外部 evals 仓库）；③人在环主要靠 RBAC/权限作用域与聊天渠道审批，未见内置"逐工具调用确认"UI（待确认）；④代码量巨大（单 `DB.py`/`Interactions.py`/`XT.py` 均数十万字符），单文件远超常规可维护阈值。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式（platform/电池全包）：[[connectonion]] · 源码：`agents-example/agent-llm/`
