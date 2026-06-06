---
title: "Hive"
aliases:
  - Hive
  - OpenHive
  - hive
  - Aden
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/hive
  - lang/python
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/aden-hive/hive
license: Apache-2.0
stars: ~3k
---

# Hive

> [!abstract] 一句话定位
> 一个 **目标驱动（Outcome-Driven）、自改进的多智能体 harness**：用自然语言描述"想要的结果"，由 Queen（编码 agent）自动生成 graph-based 执行 DAG（节点 + 边 + 共享 buffer），运行时（runtime）负责状态持久化、崩溃恢复、成本管控、人在环与可观测；当 agent 失败时把失败数据喂给编码 agent **重写 graph 进化**——主打"把 prototype 级 agent 拉到 production 业务流程"。

## 设计理念 / 顶层架构

Hive（产品名 OpenHive / 公司 Aden，YC 项目）刻意把自己定位为 **"agent harness（运行时层）"而非又一个 orchestration framework**。核心信条是 **Outcome-Driven Development (ODD)**：你不写工作流步骤，只声明 `Goal`（带 weighted success_criteria + hard/soft constraints + context），系统自己长出 agent 系统（README:161 "you describe outcomes, and the system builds itself"）。设计取舍：

- **`uv` workspace 双包，非 pip 安装**：根 `pyproject.toml:1` 声明 `members = ["core", "tools"]`。`core/`（package 名 `framework`，v0.7.1）是 goal-driven 运行时与 graph executor；`tools/`（`aden_tools`）是 100+ MCP 工具集。README 明确警告不要 `pip install -e .`，必须用 `quickstart.sh` / `quickstart.ps1` 起环境（含浏览器 UI dashboard）。
- **Graph 是一等公民，但只有一种节点类型**：`event_loop`（多轮 LLM 循环，自带 reflexion 自纠：accept / retry / escalate，见 `docs/key_concepts/graph.md`）。另有 `gcu`（browser/compute use）。节点经边（`EdgeSpec`）连接，边支持 `always/on_success/on_failure/conditional/llm_decide` 五种条件（`orchestrator/edge.py:39`），可回环形成反馈循环，多出边可并行 fan-out + fan-in reconverge。
- **Queen + Worker 双层**：**Queen** 是一个对用户交互的 AgentLoop（`agents/queen/agent.py`），用 `read_file/write_file/edit_file/search_files` 等编码工具把自然语言目标"写成"一个 colony（worker agent 的 graph + 代码 + 测试）；**Worker** 是真正跑业务的图。Queen 有 INDEPENDENT / INCUBATING / WORKING / REVIEWING 多相位（`agents/queen/nodes/__init__.py`）。
- **进化循环（Evolution）**：四阶段 Execute→Evaluate→Diagnose→Regenerate（`docs/key_concepts/evolution.md`）。关键点是"由外部 coding agent（Claude Code / Cursor）读 DecisionTracker + problem reports 重写 graph 代码"——进化发生在 **session 之间**，与节点内的 reflexion（session 内）区分。
- **模型无关**：经 LiteLLM 接 100+ provider（`llm/litellm.py`，`litellm==1.83.4`），另有原生 Anthropic / Antigravity / mock provider，统一抽象在 `llm/provider.py` 的 `LLMProvider` ABC。

最小示例（README "How It Works" + `docs/key_concepts/goals_outcome.md`，定义目标而非步骤）：

```python
from framework.schemas.goal import Goal, SuccessCriterion, Constraint

goal = Goal(
    id="deep-research",
    name="Deep Research Report",
    description="Produce a cited deep-research report on a given topic.",
    success_criteria=[
        SuccessCriterion(id="comprehensive", description="覆盖所有主要方面",
                         metric="llm_judge", target=True, weight=0.4),
        SuccessCriterion(id="cited", description="所有论断有引用来源",
                         metric="llm_judge", target=True, weight=0.3),
        SuccessCriterion(id="structured", description="含 ## Summary 段落",
                         metric="output_contains", target="## Summary", weight=0.3),
    ],
    constraints=[
        Constraint(id="budget", description="单次运行 LLM 成本 <= $5",
                   constraint_type="soft", category="cost"),
    ],
)
# 实操：./quickstart.sh 起 dashboard → 在首页输入框用自然语言描述目标
#       → Queen 提问澄清并自动生成 worker agent 的 graph/nodes/edges/tests
#       → 点 Run 或让 Queen 代跑；失败时进化循环重写 graph
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | graph-of-event_loops：唯一节点类型 `event_loop` 是多轮 streaming LLM 循环（reason→tool→observe→judge），节点内 reflexion 自纠（accept/retry/escalate）；Orchestrator 沿边遍历图直到终止或耗尽 `max_steps` | `agent_loop/agent_loop.py:1`, `orchestrator/orchestrator.py:486` (`execute`), `docs/key_concepts/graph.md` |
| [[planning\|规划/任务分解]] | 不预设固定 planner：①Queen（编码 agent）把 NL 目标拆成 graph 结构（节点/边）＝离线规划；②Queen 自身用 `task_create_batch`/`task_update` 做多步任务清单（`framework/tasks/`）；③图内 `llm_decide` 边做运行时路由 | `agents/queen/nodes/__init__.py:230`, `framework/tasks/`, `orchestrator/edge.py:205` (`_llm_decide`) |
| [[memory\|记忆(短/长/向量)]] | 短期=session 级 shared buffer（KV，按节点声明 read/write key 强制边界）；长期=role-based / queen memory（`agents/queen/queen_memory_v2.py` + `recall_selector.py` 召回）；上下文超限自动 compaction。向量检索＝待确认（未见专用 vector store） | `orchestrator/node.py:85` (`DataBuffer`/`NodeSpec`), `agents/queen/queen_memory_v2.py`, `agent_loop/internals/compaction.py` |
| [[tool-use\|工具调用]] | 原生 function calling；工具主要经 **MCP** 暴露（`ToolRegistry` 发现：内建→`tools.py`→MCP server→手动注册）；`Tool` dataclass 带 `concurrency_safe`（安全工具同回合并行）、`produces_image`（对纯文本模型隐藏） | `loader/tool_registry.py:48`, `llm/provider.py:36` (`Tool`), `loader/mcp_client.py` |
| [[model-abstraction\|模型抽象]] | `LLMProvider` ABC（`acomplete`/`stream`，统一 `LLMResponse` 含 token/cost）；实现：LiteLLM(100+ provider，含 ollama 本地)、原生 Anthropic、Antigravity、Mock；`model_catalog.py` 管定价 | `llm/provider.py:73`, `llm/litellm.py:1`, `llm/anthropic.py`, `llm/model_catalog.py` |
| [[multi-agent-orchestration\|多智能体编排]] | 核心范式：Queen 生成 worker graph，多 worker 并行（fan-out/fan-in），colony=一组 worker 的部署；session 隔离 + 共享 buffer；`run_parallel_workers` 横向扩同类工作 | `orchestrator/orchestrator.py:115` (`Orchestrator`), `orchestrator/edge.py:416` (`detect_fan_out_nodes`), `host/colony_runtime.py`, `host/worker.py` |
| [[context-engineering\|上下文工程]] | "洋葱模型"分层 prompt 组合：`identity_prompt`(Layer1 静态身份) + 节点 system_prompt 分层叠加（`continuous`/`isolated` 两种 conversation_mode，`edge.py:366`）；`Goal.to_prompt_context()` 注入每次 LLM 调用；超 token 自动 compaction（LLM 摘要 + emergency summary） | `orchestrator/prompt_composer.py`, `orchestrator/edge.py:375` (`identity_prompt`), `schemas/goal.py:91`, `agent_loop/internals/compaction.py` |
| [[skills-plugins\|技能/插件]] | Skills=带 YAML frontmatter 的 SKILL.md，三级发现(default/preset/community)+ trust gating + tool_gating（激活临时授权）；`SkillsManager` 统一加载并渲染 prompt；内建 6 个 default skill（error-recovery、context-preservation 等）+ preset（browser/linkedin/terminal/x 等） | `skills/manager.py:1`, `skills/discovery.py`, `skills/tool_gating.py`, `skills/_default_skills/`, `skills/_preset_skills/` |
| [[observability-eval\|可观测/评估]] | **DecisionTracker** 记录每个决策(尝试什么/选了什么/结果)＝进化的原料；`runtime_logger`/`runtime_log_store` 结构化日志；EventBus 事件流给 dashboard；judge 评估节点输出对照 success_criteria；HoneyComb 外部观察台 | `tracker/decision_tracker.py:24`, `tracker/runtime_logger.py`, `host/event_bus.py`, `orchestrator/conversation_judge.py` |
| [[runtime-execution\|运行时/部署]] | `uv` workspace；async 执行，节点可并行；headless 24/7 运行（`docs/key_concepts/worker_agent.md`）；`AgentHost`/`colony_runtime` 管 colony 生命周期；webhook/timer/event triggers；`framework.cli:main`(`hive` 命令) + 浏览器 dashboard | `host/agent_host.py`, `host/colony_runtime.py`, `host/triggers.py`, `host/webhook_server.py`, `core/pyproject.toml:28` |
| [[human-in-the-loop-governance\|人在环/治理]] | HITL=节点 `client_facing=True` 暂停问人（开放问答/多选/是非/表单），状态存盘可挂起数天后恢复（新版收敛为仅 Queen 直面用户，见 `edge.py:542` 弃用告警）；hard/soft constraint 治理(违反 hard→escalate)；budget/cost 限额由 runtime 强制 | `docs/key_concepts/graph.md` (Human-in-the-Loop), `agent_loop/internals/synthetic_tools.py` (`ask_user`/`escalate`), `schemas/goal.py:37` (`Constraint`) |
| [[state-persistence\|状态/持久化]] | Checkpoint-based 崩溃恢复：`CheckpointStore` + `CheckpointConfig`，`execute(session_state=...)` 可从 `paused_at` / `resume_from_checkpoint` 恢复；`session_store`/`conversation_store` 写穿落盘；`~/.hive/` 存加密 credentials | `storage/checkpoint_store.py`, `schemas/checkpoint.py`, `orchestrator/orchestrator.py:620` (resume), `storage/session_store.py`, `storage/conversation_store.py` |

## 设计权衡与特性

- **"harness over framework" 的定位**：Hive 反复强调瓶颈不在模型而在"模型外的 harness"（README:77）。它把 state/recovery/cost/observability/HITL 当作一等公民，目标是跑真实业务流程而非 demo——对标的是 production reliability，而非 LangGraph 式的编排表达力。
- **目标→图自动生成（核心差异化）**：与手写 graph 的 [[connectonion]]/Swarm 不同，Hive 让 **Queen（编码 agent）** 把自然语言目标编译成 worker graph + 连接代码 + 测试用例。代价是高度依赖外部 coding agent（Claude Code/Cursor）的质量，且生成结果不透明、需要进化循环兜底。
- **进化≠变聪明**：文档诚实地指出 evolution 只是"被重写以覆盖更多已见过的边界情况"，类比生物进化而非学习（`evolution.md:23`）；真正新颖的情况靠 HITL，而每次人介入又成为下一代进化的燃料——这是一个相当独特、坦诚的设计立场。
- **ODD 三层抽象**：把 Task-Driven / Goal-Driven / Outcome-Driven 显式区分（`goals_outcome.md:9`），`Goal` 是带 weighted criteria + hard/soft constraint 的结构化对象而非字符串，`is_success()` 用加权 0.9 阈值判定——评估信号同时驱动节点 reflexion 与跨代进化。
- **MCP-first 工具生态**：100+ 工具（`tools/src/aden_tools/tools/` 实测 103 项：Slack/HubSpot/GitHub/BigQuery/Gmail/Airtable…）全部经 MCP server 暴露，外加 browser-use（GCU）原生扩展。模型无关靠 LiteLLM（含本地 ollama）。
- **待确认/坑**：①向量记忆未见专用实现（长期记忆是 role-based markdown/召回，非向量库）——标 **待确认**；②`client_facing` 节点级 HITL 正被弃用、收敛为"仅 Queen 直面用户"（`edge.py:542` 有 deprecation warning），新旧两套人在环模型并存；③必须用 `uv` workspace，`pip install` 会产出空壳包（README 显式警告）；④README banner 写 102 MCP tools，实际工具目录 103 项，数量随版本浮动。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi-agent + 平台/自改进)：[[connectonion]] · 源码：`agents-example/hive/`
</content>
</invoke>
