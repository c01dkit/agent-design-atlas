---
title: "AgentVerse"
aliases:
  - AgentVerse
  - agentverse
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agentverse
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/openbmb/agentverse
license: Apache-2.0
stars: ~4.6k
---

# AgentVerse

> [!abstract] 一句话定位
> 一个面向研究的 **多智能体（multi-agent）仿真与协作框架**（OpenBMB / ICLR 2024 论文配套实现），核心信条是"用 YAML 配置 + 可插拔规则组件描述一个多智能体环境"：同时提供 **simulation**（自定义环境观察 LLM 群体涌现行为，如 NLP 课堂、囚徒困境、Pokemon）与 **task-solving**（把多个 agent 组装成"专家招募→决策→执行→评估"的自动协作系统）两套框架，两者共享 environment / agent / memory / llm 抽象。

## 设计理念 / 顶层架构

AgentVerse 的核心范式不是"单 agent 的工具循环"，而是 **environment 驱动的多 agent 回合制仿真**——`environment.step()` 才是主循环，agent 只是被环境按规则调度的参与者。设计取舍：

- **环境即一等公民**：`BaseEnvironment`（`agentverse/environments/base.py:20`）持有 `agents` 列表、`rule`、`max_turns`/`cnt_turn`，`AgentVerse.run()` 反复 `asyncio.run(environment.step())` 直到 `is_done()`（`agentverse/agentverse.py:47`）。
- **规则可插拔，环境=规则的组合**：simulation 环境把行为拆成 **5 个规则组件**——Order（发言顺序）/ Visibility（可见性）/ Selector（消息筛选）/ Updater（记忆更新）/ Describer（环境描述），由 `SimulationRule` 组合（`agentverse/environments/simulation_env/rules/base.py:32`）。task-solving 环境则换成 **4 个规则组件**——RoleAssigner（专家招募）/ DecisionMaker（决策/讨论）/ Executor（执行）/ Evaluator（评估），由 `TasksolvingRule` 组合（`agentverse/environments/tasksolving_env/rules/base.py:28`）。"实现一个新环境≈实现一组新规则"。
- **注册表 + YAML 配置驱动**：一切组件（env / agent / llm / memory / rule / output_parser）都用极简 `Registry`（`agentverse/registry.py:6`）以装饰器 `@xxx_registry.register("name")` 注册，再由 `initialization.py` 读 `config.yaml` 按 `type` 字段 `build()` 出来（`agentverse/initialization.py:59`）。零代码改动即可换环境/换 agent/换模型。
- **包结构**：`agents/`（base + `simulation_agent/` 的 conversation/tool/reflection… + `tasksolving_agent/` 的 solver/critic/executor/evaluator/role_assigner/manager）；`environments/`（`simulation_env/` 与 `tasksolving_env/`，各带 `rules/` 子目录）；`memory/`（chat_history / summary / vectorstore / sde_team）、`memory_manipulator/`（basic / plan / reflection）、`llms/`（OpenAI/Azure/本地 vLLM/FSChat）、`output_parser/`、`tasks/`（几十个开箱即用配置）。
- **入口 API**：CLI 为主——`agentverse-simulation --task ...` / `agentverse-tasksolving --task ...` / `agentverse-benchmark`（`setup.py:48`）；编程入口 `AgentVerse.from_task(task, tasks_dir)`（`agentverse/agentverse.py:25`）。

最小示例（取自 README 的 CLI 用法，simulation 与 task-solving 各一）：

```bash
# Simulation：9 人 NLP 课堂（1 教授 + 8 学生），观察群体对话行为
agentverse-simulation --task simulation/nlp_classroom_9players
# 带 GUI（gradio，访问 http://127.0.0.1:7860/）
agentverse-simulation-gui --task simulation/nlp_classroom_9players

# Task-solving：多 agent 协作头脑风暴（专家招募→讨论→执行→评估）
agentverse-tasksolving --task tasksolving/brainstorming
# 在 benchmark 数据集上跑（如 HumanEval）
agentverse-benchmark --task tasksolving/humaneval/gpt-3.5 --dataset_path data/humaneval/test.jsonl --overwrite
```

```yaml
# 一个 simulation 环境的最小 config.yaml（取自 README 的 classroom 示例）
environment:
  env_type: basic        # 注册名 sim-basic
  max_turns: 10
  rule:
    order:      { type: sequential }   # 轮流发言
    visibility: { type: all }          # 消息对所有 agent 可见
    selector:   { type: basic }        # 不筛选
    updater:    { type: basic }        # 更新到所有 agent
    describer:  { type: basic }        # 无额外环境描述
agents:
  - agent_type: conversation
    name: Professor Micheal
    role_description: You are Prof. Micheal, ...
    memory: { memory_type: chat_history }
    prompt_template: *professor_prompt
    llm: { llm_type: text-davinci-003, model: text-davinci-003, temperature: 0.7, max_tokens: 250 }
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **非 ReAct 单 agent 循环，而是环境回合制**：simulation 每个 `step()` 走 order→describer→agents 并发 astep→selector→updater→visibility（`basic.py:57`）；task-solving 每轮走 role_assign→decision_making→execute→evaluate（`basic.py:45`）。单 agent 内 `ConversationAgent.astep` 只是"填模板→LLM→parse→出 Message"带 max_retry 重试，无自循环 | sim：`environments/simulation_env/basic.py:57`；task：`environments/tasksolving_env/basic.py:45`；agent：`agents/simulation_agent/conversation.py:50` |
| [[planning\|规划/任务分解]] | task-solving 的"规划"= DecisionMaker 规则产出 `List[SolverMessage]` plan，支持多种拓扑：horizontal/vertical/central/concurrent/brainstorming/dynamic（`rules/decision_maker/`）；memory_manipulator 中另有 `plan` 变体辅助生成计划；simulation 无显式 planner | `environments/tasksolving_env/rules/decision_maker/`（`base.py`、`vertical.py`、`horizontal.py`、`dynamic.py:16`）、`memory_manipulator/plan.py` |
| [[memory\|记忆(短/长/向量)]] | `BaseMemory` 注册表多实现：`ChatHistoryMemory`（短期对话历史）、`SummaryMemory`（摘要压缩）、`VectorStoreMemory`（**向量记忆**，OpenAI embedding 存 content）、`SdeTeamMemory`；agent 默认 `ChatHistoryMemory`（`agents/base.py:25`） | `memory/__init__.py`、`memory/chat_history.py`、`memory/summary.py`、`memory/vectorstore.py:16` |
| [[tool-use\|工具调用]] | `ToolAgent`（simulation）内含 while 循环：LLM→parse 若为 `AgentAction` 则 `_call_tool` 执行并把 Observation 回灌，直到 `AgentFinish`（`tool.py:36`）；工具是 **LangChain `BaseTool`**，经 **BMTools**（`load_single_tools`/`import_all_apis`）加载；task-solving 工具用经 XAgent ToolServer 的 `executor: tool_using` | `agents/simulation_agent/tool.py:31,116`、`initialization.py:49`、`environments/tasksolving_env/rules/executor/tool_using.py` |
| [[model-abstraction\|模型抽象]] | `BaseLLM` 抽象（`generate_response`/`agenerate_response`/`get_spend`，统一返回 `LLMResult`）+ `llm_registry`；主实现 `OpenAIChat`（含 Azure 分支）；本地模型经 vLLM / FSChat 走 OpenAI 兼容端点，`LOCAL_LLMS`/`LOCAL_LLMS_MAPPING` 列表登记 | `llms/base.py:19`、`llms/openai.py`、`llms/__init__.py:3` |
| [[multi-agent-orchestration\|多智能体编排]] | **框架本体即多 agent 编排**。两条主线：① simulation 经 5 规则（order/visibility/selector/updater/describer）调度 N 个对话 agent 的回合制交互；② task-solving 经 4 规则把 agent 按 `AGENT_TYPES`（ROLE_ASSIGNMENT/SOLVER/CRITIC/EXECUTION/EVALUATION/MANAGER）组织成"招募→讨论→执行→评估"流水线，讨论拓扑可选 vertical/horizontal/central/dynamic | `environments/simulation_env/rules/base.py:32`、`environments/tasksolving_env/rules/base.py:71`、`utils`(`AGENT_TYPES`) |
| [[context-engineering\|上下文工程]] | prompt 用 `string.Template` 占位符填充：`${agent_name}`/`${env_description}`/`${role_description}`/`${chat_history}`（tool agent 另加 `${tools}`/`${tool_names}`/`${tool_observation}`）；`prepend_prompt_template`+`append_prompt_template` 分段拼接（`agents/base.py:62`）；环境描述由 Describer 规则按 agent 动态生成注入 | `agents/simulation_agent/conversation.py:84`、`agents/simulation_agent/tool.py:144`、`agents/base.py:62` |
| [[skills-plugins\|技能/插件]] | 无独立"技能/插件"系统；扩展点是 **Registry + 继承**：新规则组件/agent/env/memory/output_parser 用 `@registry.register(name)` 注册即可被 YAML 引用。算"规则即插件"，但非运行时热插拔技能 | `registry.py:6`、`initialization.py`、各 `rules/*/__init__.py` |
| [[observability-eval\|可观测/评估]] | ① 单例 `Logger`（仿 Auto-GPT 风格，彩色 + `logs/activity.log`/`error.log` + typewriter 效果，`logging.py:32`）；② 每个 agent 经 `get_spend()` 统计美元花费，环境 `report_metrics()` 汇总（`environments/base.py:50`）；③ task-solving Evaluator 规则给 plan 打分（score≥8 阈值即 accept，`tasksolving_env/basic.py:95`），`agentverse-benchmark` 在数据集上批量评测 | `logging.py:32`、`environments/base.py:50`、`environments/tasksolving_env/basic.py:95`、`agentverse_command/benchmark.py` |
| [[runtime-execution\|运行时/部署]] | 纯 Python 库 + CLI；环境 `run()` 同步驱动、每个 step 内 `asyncio.gather` 并发跑多 agent 的 `astep`（`simulation_env/basic.py:67`）；4 个 console_scripts 入口（simulation / simulation-gui / tasksolving / benchmark，`setup.py:48`）；GUI 经 gradio，Pokemon demo 经 FastAPI+uvicorn(`pokemon_server.py`) + 前端(`ui/`) | `agentverse.py:47`、`setup.py:48`、`pokemon_server.py`、`agentverse/gui.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | 大部分自动化运行无内建审批；human-in-the-loop 主要见于：① Pokemon demo 玩家可作为一个 agent 实时介入对话（README）；② task-solving Evaluator 有被注释掉的 human_eval 交互式打分分支（`tasksolving_env/rules/base.py:148`，默认走 LLM 评估）。无系统化治理/权限框架 | `tasks/simulation/pokemon/`、`environments/tasksolving_env/rules/base.py:148`（human_eval，已注释） |
| [[state-persistence\|状态/持久化]] | 运行态全在内存：环境的 `cnt_turn`/`last_messages`/`rule_params` 与各 agent 的 `memory`；`reset()` 清空重来。落盘仅限结果——task-solving `save_result()` 写 `./results/<task>.txt`（plan/result/spend，`tasksolving.py:84`）、日志写 `logs/`。无会话恢复/检查点机制 | `tasksolving.py:84`、`environments/base.py:36`、`agents/base.py:25` |

## 设计权衡与特性

- **"环境 + 规则组件"是它最大的辨识度**：与多数"agent 为中心、工具循环"的框架（如 [[connectonion]]）相反，AgentVerse 把多 agent 交互显式拆成可替换的规则原子（order/visibility/selector/updater/describer 或 role_assigner/decision_maker/executor/evaluator），用 YAML 描述一个"世界"。研究者改一个 `type` 字段就能切换发言顺序、可见性、讨论拓扑——非常适合做"涌现行为/协作机制"的对照实验，这也是其 ICLR 论文的核心卖点。
- **simulation vs task-solving 双框架共享底座**：两套 env 都继承 `BaseEnvironment`、复用同一套 agent/memory/llm/registry，但规则集与 step 流程完全不同——前者偏开放式群体仿真，后者偏目标导向的"专家系统流水线"（招募专家→讨论出方案→执行→评分迭代，最高 max_turn 轮）。
- **配置驱动、轻代码**：Registry + YAML 让"加一个场景"基本是写配置 + 写一个 output_parser，无需碰核心代码（README 的 classroom 教程即三步）。代价是抽象层级多、调试需理解规则装配链路。
- **强研究、弱生产**：依赖偏研究态（pydantic **1.10.7**、langchain **0.0.157**、openai **1.1.0** 等被钉死的老版本，requirements.txt）；工具生态依赖外部 **BMTools**（simulation）与 **XAgent ToolServer**（task-solving），不内置；无沙箱、无鉴权、无会话持久化/检查点、无系统化 human-in-the-loop。
- **待确认/坑**：① README 顶部明确标注 simulation 框架"正在重构"，需稳定纯 simulation 版本要切 `release-0.1` 分支；Pokemon 也仅在 `release-0.1` 可用。② `setup.py` 版本号为 **0.1.8.1**，与仓库实际状态可能不一致（待确认）。③ `DynamicDecisionMaker` 源码注释含"To Do: implement dynamic"，部分高级编排实现度待确认（`decision_maker/dynamic.py:24`）。④ 钉死的老依赖（langchain 0.0.157 / pydantic v1）对新环境安装不友好。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi-agent，仿真/协作)：[[connectonion]] · 源码：`agents-example/agentverse/`
