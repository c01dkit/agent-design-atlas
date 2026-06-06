---
title: "规划与任务分解"
aliases:
  - Planning
  - Task Decomposition
tags:
  - knowledge-base
  - domain/agent-components
  - component/planning
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 规划与任务分解

> [!abstract] 一句话总结
> 把一个大目标拆成可执行的子步骤/子任务，并在执行中按需重规划。从"无显式规划的 ReAct"到"先产出完整任务 DAG 再执行"，是 agent 处理复杂、多步、需分工任务的关键。

## 它解决什么问题

纯 ReAct 走一步看一步，面对长程任务容易迷失、重复、漏步。显式规划提供**全局视野**、可追踪的进度、以及把子任务分给不同 agent/工具的基础。

## 设计维度 / 实现谱系

- **有无显式规划**：隐式（边做边想）↔ 显式（先 plan 后 execute）
- **计划结构**：线性任务列表 ↔ 有依赖的 DAG ↔ 层级（目标→子目标）
- **重规划**：一次性计划 ↔ 执行中根据观察动态 replan
- **谁来规划**：同一 agent ↔ 专职 planner agent（见 [[single-vs-multi-agent]]）
- **驱动方式**：自由生成 ↔ SOP/模板约束（如 [[metagpt\|MetaGPT]] 的标准化流程）

## 关键要点

- 规划 vs 不规划是 [[agent-loop-paradigms|范式]]的核心分水岭之一。
- 计划越显式越可控可并行，但越可能"脱离现实"——replan 是必要兜底。
- 多 agent 系统里，规划常上移为 orchestrator 的职责。

## 关联

- [[agent-loop-paradigms]] · [[reasoning-loop]] · [[multi-agent-orchestration]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **32** 个实现了「规划」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 单技能内无显式 planner（交给 LLM）；跨技能用 chains（chains: 配置 DAG，parallel: 并发组 + consume: 注入上游输出）和 frontmatter depends_on（调度器据此排序，依赖在前 sleep 5 再派发依赖方） |
| [[ag2\|AG2]] | 内核无显式 planner，规划交给 LLM/对话模式。contrib/captainagent 可动态组建专家团队；society_of_mind_agent 把子群当一个"内省"Agent；agent_optimizer 离线优化函数集 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | ①隐式：靠 "Think About It" 提示让 LLM 自己 thinking/reflection；②显式：用 JSON Chain 预编排多步工作流（如 chains/Smart Instruct.json、Generate Task Chain.json）；命令选择阶段先让 LLM 挑出相关命令及其前置命令 |
| [[agentdock\|AgentDock]] | 内核无独立 planner；规划=人写的 orchestration steps（声明式状态机）+ LLM 自身推理。step 可设 sequence(强制工具顺序) 与 conditions(tool_used/sequence_match) 实现确定性多阶段流程；另有 agent-planner 模板做"设计其他 agent" |
| [[agentset\|Agentset]] | deepResearch 模式做查询规划：generateInitialQueries→performSearch→conductIterativeResearch(budget 轮，evaluateResearchCompleteness 产出补充 query)→filter→generateResearchAnswer 生成多页报告 |
| [[agentverse\|AgentVerse]] | task-solving 的"规划"= DecisionMaker 规则产出 List[SolverMessage] plan，支持多种拓扑：horizontal/vertical/central/concurrent/brainstorming/dynamic（rules/decision_maker/）；memory_manipulator 中另有 plan 变体辅助生成计划；simulation 无显式 planner |
| [[astron\|Astron Agent]] | 单体 agent 无显式 planner，规划隐式交给 LLM 的 CoT；显式编排在 workflow 层：decision 节点用 router prompt 做意图分流/分支，iteration/loop 节点做循环分解，整个 DAG 由 DSL 描述 |
| [[autogen\|AutoGen]] | 内核无通用 planner；规划由 LLM 隐式完成。显式规划见 Magentic-One orchestrator：先建 task ledger（facts + plan 两段 prompt 推理），再用 progress ledger 驱动外/内双层循环 |
| [[connectonion\|ConnectOnion]] | 内核无显式 planner；规划交给 LLM 自身。可选 subagents 插件附带内建 plan/explore 子 agent（AGENT.md）；ReAct 插件只做意图识别+反思，不做计划 |
| [[cordum\|Cordum]] | 仅有 Workflow Engine 把声明式工作流拆成多个 JobRequest 步骤并推进（loop/parallel/subworkflow），非 LLM 规划 |
| [[crewai\|CrewAI]] | ①Crew 级 planning=True：跑前用 planning agent 为每个 task 生成 step-by-step plan 注入描述；②hierarchical 经理动态分解派活；任务编排本身是声明式 Task 列表 |
| [[hive\|Hive]] | 不预设固定 planner：①Queen（编码 agent）把 NL 目标拆成 graph 结构（节点/边）＝离线规划；②Queen 自身用 task_create_batch/task_update 做多步任务清单（framework/tasks/）；③图内 llm_decide 边做运行时路由 |
| [[langchain\|LangChain]] | 内核无显式 planner；规划交给 LLM。可选 TodoListMiddleware 注入 write_todos 工具+todos 状态字段做轻量任务清单（对标 Claude Code TodoWrite）；更重的 planning 在上层 Deep Agents 包 |
| [[llamaindex\|LlamaIndex]] | 内核无显式 planner；规划隐式交给 LLM(ReAct 的 Thought 链 / function-calling 多轮)。另有 CodeActAgent 让 LLM 写 Python 代码作为"计划+执行"；tools/query_plan 提供查询级子问题分解。无独立 plan-then-execute 编排器 |
| [[loongflow\|LoongFlow]] | PES 的 Planner Worker 是显式独立阶段：理解任务+从进化记忆检索父代经验+产出执行蓝图（best_plan.txt）；Planner 仅是 get_worker 的薄封装，具体策略由场景 Agent 实现（如 general_agent/planner.py）；ReAct 侧用 Todo 工具做轻量任务清单 |
| [[maestro\|Maestro]] | 由 orchestrator LLM 隐式规划：每轮只产出"下一个子任务"的 prompt（增量式拆解，非一次性全计划），并自评目标是否达成 |
| [[mastra\|Mastra]] | 内核无显式 planner；自主规划交给 LLM。显式规划走声明式 workflow：开发者用 .then/.branch/.parallel/.dowhile/.foreach/.map 手工编排为 DAG；多 agent 场景由 routing agent 动态决定下一个 primitive（见多智能体编排） |
| [[metagpt\|MetaGPT]] | 两层：①SOP 即"硬编码计划"——角色的 Action 顺序就是流程；②plan_and_act 模式下 Planner 用 WritePlan 让 LLM 生成 Plan（Task 列表 + 依赖，拓扑排序），逐任务执行+review+动态改计划 |
| [[nanobot\|nanobot]] | 内核无独立 planner，规划交给 LLM；提供 sustained goal / long_task 机制：/goal 持续目标跨 turn 续跑，goal_continue_message 注入让模型继续推进或 complete_goal；Step Plan 经 skill 引导 |
| [[open-multi-agent\|Open Multi-Agent]] | goal→任务 DAG 的一次性 LLM 拆解：coordinator 收 goal+roster，输出 json 任务数组；parseTaskSpecs 容错解析（fenced/裸数组），title 形式的 dependsOn 在 loadSpecsIntoQueue 中两遍映射为真实 task id；简单目标走 isSimpleGoal 短路只跑单 agent |
| [[openclaw\|OpenClaw]] | 内核无显式 planner，规划交给 LLM 自身；提供 thinking 级别（--thinking high、/think <level>）与 reasoning 透传；自治侧靠 standing orders（写在 AGENTS.md 里的"程序"边界）而非结构化计划 |
| [[pipecat\|Pipecat]] | 框架内核无显式 planner；任务分解交给 LLM 自身或上层应用。结构化"分解"体现在管道编排（Pipeline/ParallelPipeline）与多 worker job RPC（@job + job_group 扇出），而非自动 plan |
| [[praisonai\|PraisonAI]] | 可选 planning=True：PlanningAgent 仿 CrewAI AgentPlanner / Claude Code Plan Mode，先以只读工具(READ_ONLY_TOOLS)研究再产出 Plan/PlanStep；Task 级别用 next_tasks/condition 静态声明 DAG，hierarchical process 由 manager LLM 动态分派 |
| [[semantic-kernel\|Semantic Kernel]] | 内核无独立 planner（旧 Stepwise/Handlebars planner 已从主源码移除，仅余 InternalUtilities/planning/ 与 samples 迁移示例）。规划=模型自身多步 function calling；多步业务流程交给 Process 框架；Magentic manager 内含动态计划账本 |
| [[smolagents\|smolagents]] | 可选周期性规划：planning_interval 触发独立 planning step，首步生成 initial_plan、之后 update_plan（summary_mode 重写记忆）；计划存为 PlanningStep 注入记忆，非强制 |
| [[strands\|Strands Agents]] | 内核无显式 planner——这正是 model-driven 的取舍：规划交给模型隐式完成。结构化分解可借 multiagent/graph.py 的依赖图或 swarm.py 的自治移交，但单 agent 层无独立规划组件 |
| [[swarmclaw\|SwarmClaw]] | main-agent-loop 维护持久 MainLoopState（goal/goalContract/planSteps/completedPlanSteps/currentPlanStep/reviewNote），心跳每次回灌；plan/review 由 LLM 经 meta 标记产出后解析（parseMainLoopPlan/parseMainLoopReview） |
| [[swarms\|Swarms]] | 可选 plan_enabled/plan(task)：用 planning_prompt+历史让 LLM 先产出 step-by-step 计划写入短期记忆；max_loops="auto" 走 _run_autonomous_loop 的 plan→execute→reflect 三段式；专门拓扑 PlannerWorkerSwarm/AutoSwarmBuilder |
| [[transformers-agents\|Transformers Agents]] | 由 LLM 隐式规划工具调用序列；无独立 planner |
| [[upsonic\|Upsonic]] | 内核无强制 planner，规划交给 LLM；可选 enable_thinking_tool/enable_reasoning_tool（agent.py:263）；deepagent 子包带 planning_toolkit/TodoList(tasks.py:11 引用)；Graph 把多 Task 显式编排成 DAG/链 |
| [[vectara-agentic\|vectara-agentic]] | 内核无显式 planner；规划交给 LLM（base 指令鼓励“拆子问题”，prompts.py:54）。提供可选 内置 workflow 做显式分解：SubQuestionQueryWorkflow（并行子问题，@step(num_workers=8)）与 SequentialSubQuestionsWorkflow（顺序依赖）；旧的 StructuredPlanning 已在 v0.4 废弃 |
| [[voltagent\|VoltAgent]] | 内核无强制 planner；规划交给 LLM。独立的 PlanAgent（Claude-Code 风格）内建 write_todos 规划工具箱 + filesystem + subagent，强制"多步任务先写 todo" |
