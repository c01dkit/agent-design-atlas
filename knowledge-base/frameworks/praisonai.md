---
title: "PraisonAI"
aliases:
  - PraisonAI
  - praisonai
  - praisonaiagents
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/praisonai
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/MervinPraison/PraisonAI
license: MIT
stars: ~5k
---

# PraisonAI

> [!abstract] 一句话定位
> 一个"开箱即生产"的多智能体框架（核心 SDK `praisonaiagents`），主打 **Agent / Task / Process 三件套**：单 agent 两行起步，多 agent 经 `Agents` 容器以 sequential / hierarchical / workflow 三种 process 编排；借 **LiteLLM** 一把覆盖 100+ LLM provider，内建 **self-reflection（自我反思迭代）**、planning、memory(RAG/mem0/graph)、MCP（stdio/HTTP/WS/SSE）、guardrails、handoff，并提供 Python + JavaScript(`praisonai-ts`) 双 SDK 与 CLI / Dashboard / Visual Flow 等多层产品。

## 设计理念 / 顶层架构

PraisonAI 的核心范式是 **"Agent + Task + Process" 的分层多智能体编排**，并把"生产级特性"（反思、记忆、planning、检查点、遥测、策略引擎、沙箱）尽量做成 `Agent(...)` 构造参数上的布尔开关。设计取舍：

- **monorepo 多产品分层**：`src/` 下分 `praisonai-agents`（轻量核心 SDK，`pip install praisonaiagents`）、`praisonai`（CLI / YAML no-code / Claw Dashboard / Langflow）、`praisonai-ts`（JS/TS SDK）、`praisonai-platform`、`praisonai-rust`。知识笔记聚焦核心 SDK `praisonaiagents`。
- **三个顶层抽象**：`Agent`（单体执行单元，含 chat 循环与反思）、`Task`（一项工作单元，可声明 `next_tasks` / `condition` / `context`）、`Process`（把 tasks+agents 编排成 sequential / hierarchical / workflow）。`Agents` 容器（`agents/agents.py`）是用户面的 orchestrator，多于一个 task 时自动串成 sequential 流。
- **薄壳 + 重 mixin**：`Agent` 类（`agent/agent.py`，5000+ 行）本体只做配置解析，真正的执行循环拆进 `chat_mixin.py` / `execution_mixin.py` / `memory_mixin.py` 等 mixin；近百个特性通过构造参数（`memory=True`、`reflection=True`、`planning=True`、`handoff=True`、`db=...`）按需懒加载。
- **LiteLLM 作为模型 lingua franca**：`LLM` 类（`llm/llm.py:131`）包一层 litellm，`drop_params=True` / `modify_params=True` 抹平 provider 差异，统一走 OpenAI message 格式与 function-calling。
- **性能取向**：`__init__.py` 顶部即声明 lazy loading（litellm 等重依赖按需载入），README 宣称 agent 实例化 ~3.77μs。

最小示例（取自 README）：

```python
from praisonaiagents import Agent, Agents

# 1) 单 agent
agent = Agent(instructions="You are a senior data analyst.")
agent.start("Analyze the top 3 tech trends of 2026 as a markdown table.")

# 2) 多 agent —— 自动串成 sequential 流，后者读取前者产出
research = Agent(instructions="Research about AI")
summarise = Agent(instructions="Summarise the research agent's findings")
Agents(agents=[research, summarise]).start()

# 3) self-reflection：agent 先答、再自评 satisfactory? 不满意就按反思重写
critic = Agent(instructions="Write a poem", reflection=True)  # min 1 / max 3 轮
critic.start("Write a haiku about the sea")
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 函数调用式 ReAct：`_chat_completion` 取 LLM 响应→若有 `tool_calls` 则执行并回灌→无 tool_call 后进入**自我反思 while 循环**（先答、再让 LLM 输出 `{reflection, satisfactory}` JSON、不满意则"按反思重写"再循环）；满足 `min_reflect` 且 satisfactory=yes，或达 `max_reflect` 才返回 | `agent/chat_mixin.py:1131` (反思 while), `agent/chat_mixin.py:1865` (reflection_prompt), `agent/chat_mixin.py:1917` (satisfactory 判定) |
| [[planning\|规划/任务分解]] | 可选 `planning=True`：`PlanningAgent` 仿 CrewAI AgentPlanner / Claude Code Plan Mode，先以只读工具(`READ_ONLY_TOOLS`)研究再产出 `Plan`/`PlanStep`；Task 级别用 `next_tasks`/`condition` 静态声明 DAG，hierarchical process 由 manager LLM 动态分派 | `planning/planner.py:24`, `planning/plan.py`, `process/process.py:434` (aworkflow) |
| [[memory\|记忆(短/长/向量)]] | `memory=True` 启用 `Memory`（StorageMixin+SearchMixin+MemoryCoreMixin）：默认 provider `rag`→ChromaDB 本地向量；可切 `mem0`（含 Neo4j/Memgraph **graph memory**）或 `mongodb`；短期 `short_term.db` + 长期 `long_term.db` + 实体/用户记忆；零依赖 file-based 模式 | `memory/memory.py:34`, `memory/file_memory.py`, `memory/auto_memory.py` |
| [[tool-use\|工具调用]] | 普通 Python 函数即工具，`@tool` 装饰器（`inspect.signature`+docstring 自动生成 schema）或裸函数皆可；`BaseTool` 类工具；原生 function-calling，循环执行 `execute_tool`；YAML 模式自动发现 `tools.py` 内同名函数；内置 100+ 工具（搜索/文件/shell/web crawl 等） | `tools/decorator.py:173` (`@tool`), `tools/base.py` (`BaseTool`), `agent/tool_execution.py` |
| [[model-abstraction\|模型抽象]] | `LLM` 类包一层 **LiteLLM**，覆盖 100+ provider(OpenAI/Anthropic/Gemini/Ollama/Groq/Bedrock/Vertex…)；`drop_params`/`modify_params` 抹平差异；`ModelRouter.select_model()` 按任务能力/预算自动路由到最便宜可用模型；failover / rate_limiter / cost 计量 | `llm/llm.py:131` (`class LLM`), `llm/model_router.py:222` (`select_model`), `llm/failover.py` |
| [[multi-agent-orchestration\|多智能体编排]] | `Agents` 容器 + `Process` 三模式：`sequential`（按序、自动传上下文）、`hierarchical`（manager_llm 充当 orchestrator 动态派活）、`workflow`（按 `next_tasks`/`condition` 走图，支持 route/parallel/loop/repeat）；另有 `Handoff` 做 agent→agent 转交（仿 OpenAI Agents SDK）、A2A 协议 | `agents/agents.py:1439` (process 分派), `process/process.py:19`, `agent/handoff.py` |
| [[context-engineering\|上下文工程]] | system prompt 由 `instructions`/`role`/`goal`/`backstory` 拼装；可选 `ContextCompactor`（`execution.context_compaction=True` 时超 `max_context_tokens` 自动摘要压缩，带 BEFORE/AFTER_COMPACTION hook）；`ContextAgent` 做 fast-context 注入；RAG 检索结果按需拼入 | `agent/chat_mixin.py:558` (compaction 钩入), `compaction/`, `agent/context_agent.py` |
| [[skills-plugins\|技能/插件]] | Skills=带 YAML frontmatter 的 `SKILL.md`，三级发现(project→user→builtin)，激活时按 `allowed_tools` 临时授权；**兼容 Claude Code `.claude/skills/`**（也认 `.praisonai/skills/`，向上递归祖先目录）；另有 hooks / middleware / 插件式扩展 | `skills/manager.py:64` (`discover`), `skills/discovery.py:36` (`.claude/skills` 兼容), `tools/skill_bridge.py` |
| [[observability-eval\|可观测/评估]] | `MinimalTelemetry`(PostHog 匿名用量，隐私优先) + OpenTelemetry 集成（traces/spans/metrics，README 标注）+ Langfuse tracing(`praisonai langfuse`)；token/cost 收集 (`telemetry/token_collector.py`)；`eval/` 做 accuracy/performance/reliability/criteria 评估 | `telemetry/telemetry.py:78` (`MinimalTelemetry`), `telemetry/integration.py`, `eval/` |
| [[runtime-execution\|运行时/部署]] | 纯 Python 库，同步/异步(`astart`/`achat`)双轨；可选 `sandbox/` 隔离代码执行；`praisonai` CLI(TUI/auto/interactive/chat)、`praisonai claw` Dashboard(13 页, :8082)、`praisonai flow`(Langflow :7861)、`praisonai ui`、ACP server、Docker | `agent/execution_mixin.py:602` (`start`)/`:143` (`astart`), `sandbox/`, `src/praisonai/`(CLI 子包) |
| [[human-in-the-loop-governance\|人在环/治理]] | `@require_approval(risk_level=...)` 标记高危工具→执行前 `request_approval` 走审批后端(console/自定义 callback)；**Guardrails**(`LLMGuardrail` 或函数式)对输入/输出做校验+重试；Policy Engine 声明式行为控制；doom-loop 检测自动恢复 | `approval/__init__.py:166` (`require_approval`), `approval/backends.py`, `guardrails/llm_guardrail.py:15` (`LLMGuardrail`), `policy/` |
| [[state-persistence\|状态/持久化]] | `Session`(`session.py:24`) 管短期会话状态(`save_state`)；`db=db(database_url=...)` 接 PostgreSQL/MySQL/SQLite/MongoDB/Redis 等 20+ 后端，自动持久化 messages/runs/traces；CLI `auto_save="proj"` + Shadow Git Checkpoints(失败自动回滚) + `snapshot/` | `session.py:24` (`class Session`), `db/__init__.py` (`db`/`DB`/`PraisonAIDB`), `checkpoints/`, `snapshot/` |

## 设计权衡与特性

- **"参数即特性" vs 极简内核**：与 [[swarm\|Swarm]] / [[connectonion\|ConnectOnion]] 不同，PraisonAI 把近百个能力（反思、记忆、planning、检查点、策略、沙箱、遥测、handoff、压缩）都做成 `Agent(...)` 上的开关，上手成本极低、特性密度极高；代价是核心包很重、`agent.py` 单文件 5000+ 行、mixin 层叠，可读性与可维护性是明显 tradeoff（靠 lazy loading 缓解启动开销）。
- **self-reflection 是头牌特性**：反思被实现为一个独立 while 循环——先产出答案，再让（可单独指定的 `reflect_llm`）模型输出结构化 `{reflection, satisfactory}`，不满意就追加"按反思重写"消息再生成，受 `min_reflect`(默认 1)/`max_reflect`(默认 3) 夹逼。对自定义/非 OpenAI LLM 走"手动解析 JSON"降级路径（`chat_mixin.py:1876`），不支持结构化输出时会跳过反思。
- **借 LiteLLM 吃下 100+ provider**：模型抽象近乎零自研，统一为 OpenAI 格式 + function-calling，`drop_params`/`modify_params` 兜底；再叠 `ModelRouter` 自动选最便宜可用模型、failover、rate limiter、cost 计量，主打"省钱+不挑模型"。
- **三种 Process + workflow 图**：sequential/hierarchical/workflow 覆盖从线性流水线到 manager 动态派活到 route/parallel/loop/repeat 工作流图，编排表达力强于纯 handoff 式框架；workflow 由 Task 的 `next_tasks`/`condition` 静态声明，可读但需手写图。
- **强生态/产品化**：不止 SDK——CLI(TUI)、YAML no-code、Claw Dashboard(接 Telegram/Slack/Discord)、Langflow 可视化、JS SDK、ACP/A2A/MCP 协议、24/7 scheduler，定位"AI Workforce 平台"而非单纯库。
- **兼容 Claude Code 生态**：Skills 直接认 `.claude/skills/` 的 `SKILL.md`，可编排外部 agent（Claude Code / Gemini CLI / Codex / Cursor CLI）作为工具，复用现有 harness 资产。
- **待注意**：核心 SDK 体量巨大、抽象众多，"参数开关"背后的真实行为分散在多个 mixin 与子包，调试与定位成本偏高；反思/审批均依赖 LLM 输出可解析的结构化结果，弱模型上稳定性需自行验证。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi)：[[crewai]] · [[autogen]] · [[ag2]] · 源码：`agents-example/praisonai/`
