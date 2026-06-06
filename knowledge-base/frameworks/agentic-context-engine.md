---
title: "Agentic Context Engine (ACE)"
aliases:
  - ACE
  - agentic-context-engine
  - ace-framework
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agentic-context-engine
  - lang/python
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/kayba-ai/agentic-context-engine
license: FSL-1.1-MIT (Functional Source License, 两年后转 MIT)
stars: 未知（gh 不可用，未臆造）
---

# Agentic Context Engine (ACE)

> [!abstract] 一句话定位
> 一个让 single-agent **从执行反馈中自我改进**的 Python 框架：不微调、不训练、不要向量库，而是用 Agent / Reflector / SkillManager 三角色把每次执行的经验沉淀进一本可演化的 **Skillbook（策略手册 = 自策展上下文）**，下次执行时把策略注入 prompt——核心创新是 **Recursive Reflector**：在受限沙箱里写并执行 Python 代码来"程序化地"分析 trace、定位错误、提炼可行策略。

## 设计理念 / 顶层架构

ACE 的范式是 **single-agent + 持续自改进（self-improving）**。它不发明新的 agent 执行循环，而是给"任意 agent"外挂一个**学习闭环**：执行 → 评估 → 反思 → 策展上下文。理论基础是 ACE 论文（Stanford & SambaNova, arXiv:2510.04618）与 Dynamic Cheatsheet。

opinionated 设计取舍：

- **三角色分工**（`ace/implementations/`）：**Agent**（用当前 Skillbook 的策略作答）、**Reflector**（分析 trace，提炼"哪条策略有用/有害/中性"，纯分析不打标签）、**SkillManager**（把反思转成对 Skillbook 的原子增删改）。三者全部由 [PydanticAI](https://ai.pydantic.dev/) 驱动，输出经 Pydantic 结构化校验+自动重试。
- **Skillbook 即"上下文"**（`ace/core/skillbook.py:348`）：一份持久化的策略集合，分 `context` / `harness` 两段，每条 `Skill` 带 keywords、issue、insight、`used/helpful/harmful/neutral_count` 与来源 `occurrences`。这就是 ACE 名字里 "Context Engine" 的本体——上下文不是静态 prompt，而是会被 ADD/UPDATE/TAG/REMOVE 持续策展的结构化资产。
- **Pipeline-first**（`pipeline/`）：所有功能都是带 `requires`/`provides` 契约的 `Step`，经 `Pipeline().then(...)` 组合，`StepContext` 不可变（`ACEStepContext` 是 frozen dataclass）。标准学习链：`AgentStep -> EvaluateStep -> ReflectStep -> UpdateStep -> (DeduplicateStep)`。
- **Recursive Reflector（RR）**：关键创新。Reflector 不再"一遍读 trace 写摘要"，而是作为递归 agent 在 `TraceSandbox`（`ace/core/sandbox.py:53`）里反复 `execute_code` 跑 Python，把 trace 当"证据工作台"逐步切片、校验、定位错误，直到产出结构化 `ReflectorOutput`。
- **Runner 多入口**：`ACELiteLLM`（电池全包，`.ask()/.learn()/.save()`，100+ LiteLLM provider）、`ACE`（带 epoch 的完整批量学习）、`TraceAnalyser`（仅从已录 trace 学习，不重跑）、`LangChain` / `BrowserUse` / `ClaudeCode`（把外部框架包成"可学习"）。
- **包结构**：`ace/core/`（skillbook / context / sandbox / recursive_agent / environments，受保护内核）、`ace/implementations/`（三角色 + RR）、`ace/steps/`（每个 Step 一文件）、`ace/runners/`、`ace/integrations/`（langchain / browser_use / claude_code / mcp / openclaw）、`ace/deduplication/`、`ace/providers/`、`ace/tracing/`、`pipeline/`（通用引擎）。

最小示例（取自 README）：

```python
from ace import ACELiteLLM

agent = ACELiteLLM(model="gpt-4o-mini")

# 第一次：agent 可能幻觉
answer = agent.ask("Is there a seahorse emoji?")

# 喂入纠错反馈 —— ACE 提炼出一条策略并更新 Skillbook
agent.learn_from_feedback("There is no seahorse emoji in Unicode.")

# 之后的调用受益于学到的策略
answer = agent.ask("Is there a seahorse emoji?")

# 查看 agent 学到了什么
print(agent.get_strategies())
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 非传统 ReAct；核心是"执行→评估→反思→策展"学习闭环，组合为不可变 Pipeline 顺序执行。Agent 角色本身是一次结构化 LLM 调用（`run_sync`）；RR/SkillManager 是带递归+预算的 agentic 循环（RecursiveAgent） | `pipeline/pipeline.py:53`, `ace/runners/ace.py:27` (`ACE`), `ace/implementations/agent.py:71` (`generate`) |
| [[planning\|规划/任务分解]] | 无显式 planner。任务分解隐含在 Reflector 的"递归"中：RR 可拆分对 trace 的多步检查、`parallel_map` 并行处理 batch 项；不做前置 plan-then-execute | `ace/steps/rr_step.py:51`, `ace/core/sandbox.py:526` (`_parallel_map`) |
| [[memory\|记忆(短/长/向量)]] | 长期记忆=**Skillbook**（跨会话持久化的策略库，JSON + `.embeddings.npz` sidecar）；可选向量=dedup 用 sentence-transformers 给 skill 算 embedding；检索=BM25(lexical)+dense 的 RRF 融合 top-k | `ace/core/skillbook.py:348,663` (`save_to_file`), `ace/implementations/skill_rendering.py:129` (`retrieve_top_k`) |
| [[tool-use\|工具调用]] | 框架自身的"工具"是给内部 agent 的：SkillManager 的 `add/update/remove/tag_skill`+`search/read_skill`（`sm_tools.py`），RR 的 `execute_code/think/read_skill/search_skillbook`（`rr/tools.py`）。被学习对象（用户 agent）的工具调用由其所属框架(LangChain/browser-use)负责，ACE 仅消费其 trace | `ace/implementations/sm_tools.py`, `ace/implementations/rr/tools.py`, `ace/integrations/mcp/` |
| [[model-abstraction\|模型抽象]] | 经 PydanticAI 统一；`resolve_model()` 把 LiteLLM 风格模型名路由到 PydanticAI 原生 provider 或 `litellm:` 代理（100+ provider：OpenAI/Anthropic/Google/Bedrock/Groq…）；可按角色分别配模型(`ACEModelConfig`) | `ace/providers/pydantic_ai.py:107` (`resolve_model`), `ace/providers/config.py`, `ace/core/metered_model.py` |
| [[multi-agent-orchestration\|多智能体编排]] | 非"多个对等 agent 协作"，而是**三个固定角色的学习流水线**经 Pipeline 编排；`Branch` 支持并行分支+合并，RR 内部可递归派生只读 sandbox 子 agent(`create_readonly_sandbox`) | `pipeline/branch.py`, `ace/runners/ace.py:80` (`build_steps`), `ace/core/sandbox.py:749` |
| [[context-engineering\|上下文工程]] | **本框架重点**。Skillbook 即被工程化的上下文：策略以 XML `<strategy>` 注入 agent prompt(`render_skills_xml`)；检索用 BM25+dense 的 RRF top-k；SkillManager 用 ADD/UPDATE/TAG/REMOVE 自策展；`as_prompt()` 渲染整本；外部 agent 用 `wrap_skillbook_for_external_agent` 注入 | `ace/implementations/skill_rendering.py:44,129`, `ace/core/skillbook.py:767` (`as_prompt`), `ace/integrations/langchain.py:149` (`_inject_context`) |
| [[skills-plugins\|技能/插件]] | "Skill"=Skillbook 条目(策略)，非可执行插件；可插拔性体现在：Step 协议(`requires`/`provides`)、Runner 经 `extra_steps` 扩展、`learning_tail()` 复用、optional extras(browser-use/langchain/mcp/dedup)。另含 Claude Code `.claude/skills/kayba-pipeline/` 七阶段分析技能 | `ace/steps/__init__.py:50` (`learning_tail`), `ace/core/skillbook.py:302` (`Skill`), `ace/cli/skills/kayba-pipeline/` |
| [[observability-eval\|可观测/评估]] | **本框架重点**。`EvaluateStep`+`TaskEnvironment` 产出反馈/对错信号；自带 tau2-bench 等基准(`benchmarks/`)；可观测：`ObservabilityStep`、Logfire 自动插桩 PydanticAI(`logfire` extra)、`kayba-tracing` SDK(`configure/trace/start_span`)、每条 skill 的 helpful/harmful/used 计数即效用度量 | `ace/steps/evaluate.py`, `ace/steps/observability.py`, `ace/observability/__init__.py`, `ace/tracing/__init__.py:17` |
| [[runtime-execution\|运行时/部署]] | 纯库（pip/uv 安装），无服务进程；`ace` CLI 做交互式配置/模型校验，`ace-mcp` 起 MCP server 供 IDE 集成，`kayba` 是云端 CLI(上传 trace/拉取洞见)；RR 的代码执行在 `TraceSandbox`(SIGALRM 超时, 仅 Unix; Windows 不强制超时) | `ace/cli/setup.py`, `ace/integrations/mcp/server.py`, `ace/core/sandbox.py:612` (`execute`) |
| [[human-in-the-loop-governance\|人在环/治理]] | `learn_from_feedback()`/`learn_from_traces()` 让人提供纠错反馈或历史 trace 作为学习信号；Skillbook 可读(`get_strategies`)、可导出 markdown、可人工编辑后回载；CLAUDE.md 规定核心模块改动需人工批准。无运行时审批拦截 | `ace/runners/litellm.py:424` (`learn_from_feedback`), `ace/steps/export_markdown.py`, `.claude/skills/kayba-pipeline/stage-6-hitl/` |
| [[state-persistence\|状态/持久化]] | Skillbook 序列化为 JSON(v2 schema)+ embedding sidecar(`.embeddings.npz`)；`save_to_file`/`load_from_file`；`CheckpointStep` 按间隔存档、`PersistStep` 每样本写目标文件(如项目 CLAUDE.md)；`SimilarityDecision`(KEEP)持久化去重决策 | `ace/core/skillbook.py:663,692`, `ace/steps/checkpoint.py`, `ace/steps/persist.py:12` |

## 设计权衡与特性

- **"学习层"而非"执行框架"**：ACE 不和 LangChain/CrewAI 等竞争 agent 执行循环，而是做它们的**上行学习闭环**。卖点是 README 的实测：Tau2 航空基准 pass^4 一致性翻倍（15 条学到的策略、无奖励信号）、browser-use token 降 49%、Claude Code 自治翻译 14k 行 0 编译错误（学习成本约 \$1.50）。
- **Recursive Reflector 是核心差异化**：把"反思"从一次性摘要升级为"在沙箱里写代码查证据"。优点是能对大/复杂 trace 做程序化精确定位；代价是更多 LLM 轮次与预算管理（`BudgetExhausted`/微压缩/超时回退），且沙箱**明确声明非安全隔离**（`TraceSandbox` 注释：仅信任 LLM 不写恶意代码，勿跑不可信代码；Windows 下超时不强制）。
- **上下文自策展（curation）很克制**：SkillManager 直接用工具原子改 Skillbook（无 staging、无独立 ApplyStep，返回的是事后审计日志）；TAG 机制让策略带 helpful/harmful 计数从而可被"投票淘汰"；可选 embedding 去重(`DeduplicationManager`)合并近义策略，KEEP 决策会被记住避免反复。
- **不可变 + 契约式 Pipeline**：`ACEStepContext` frozen、`StepContext.replace()` 更新、Step 声明 `requires`/`provides` 并在组装期做顺序/契约校验（`PipelineOrderError`），`async_boundary` 让 ReflectStep 之后的重学习步骤进后台线程池，主调用快速返回。
- **License 注意**：FSL-1.1-MIT 是 **Functional Source License**（限制竞争性使用，发布两年后自动转 MIT），并非标准 OSI 开源；pyproject 同时标 `License :: Other/Proprietary License` 分类器。商用前需确认条款。
- **依赖较重 / Python 3.12+**：核心依赖 litellm、pydantic-ai-slim、rank-bm25、tau2；向量去重/浏览器/langchain/transformers 等均为 optional extras。

## 关联

- [[component-taxonomy]] · [[context-engineering]] · [[observability-eval]] · [[single-vs-multi-agent]]
- 同范式(single + 自改进/平台外挂)：[[connectonion]] · 源码：`agents-example/agentic-context-engine/`
