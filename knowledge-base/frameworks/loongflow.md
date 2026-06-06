---
title: "LoongFlow"
aliases:
  - LoongFlow
  - loongflow
  - 龙场
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/loongflow
  - lang/python
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/baidu-baige/LoongFlow
license: Apache-2.0（LICENSE / pyproject / README 三处一致）
stars: 待确认（社交徽章，未抓取到具体数字）
---

# LoongFlow

> [!abstract] 一句话定位
> 百度出品的"专家级、会思考会学习的进化型 Agent 开发框架"：核心是 **PES（Plan-Execute-Summary）思考范式 + 进化记忆**，把"生成-重试 / 变异-选择"升级为"规划-执行-反思"的有向进化搜索，靠多岛 MAP-Elites + 自适应 Boltzmann 采样在数学/ML 等长程推理任务上持续逼近 SOTA（取得过 Circle Packing 等 11 题超越 AlphaEvolve、MLE-bench 48 赛全奖牌）。

## 设计理念 / 顶层架构

LoongFlow 不是"再写一个 ReAct 库"，而是把抽象层从"进化输出"上移到"标准化 Agent 如何思考、行动、学习"。设计取舍：

- **双层框架（agentsdk 原子件 → framework 范式）**：`src/loongflow/agentsdk/`（models / tools / memory / message / token / logger）是与厂商无关的原子组件；`src/loongflow/framework/` 把它们组装成范式——`react/`（通用 ReAct 工具循环）、`pes/`（进化型 PES 主范式）、`claude_code/`（把 Claude Agent SDK 包成一个 Agent 节点）。再往上 `agents/`（math_agent / ml_agent / general_agent）是面向场景的成品 Agent。这正是题目说的"从原子组件到场景 agent"。
- **PES 范式即进化循环**：`PESAgent` 不是单轮 ReAct，而是并发跑 N 个"evolution cycle"，每个 cycle = Planner→Executor→Summary 三个 Worker 串行（`framework/pes/pes_agent.py:174` `_evolution_cycle`）。Plan 检索历史经验给蓝图、Execute 做受控实验并评测、Summary 反思并把经验写回结构化记忆。
- **Worker 注册式可扩展**：Planner/Executor/Summary 都是实现 `Worker` 接口的可注册类（`framework/pes/register.py:27`），用户用 `register_*_worker` 注入自定义实现（`pes_agent.py:141`）；`get_worker` 用 `inspect.signature` 过滤构造参数后实例化（`register.py:106`）。
- **统一 Agent 基座**：所有 Agent 继承 `AgentBase`（`framework/base/agent_base.py:18`），自带可取消生命周期（asyncio task）、`pre_/post_` 钩子包裹、结构化日志、Pydantic input_schema。
- **入口 API 两形态**：进化任务 `from loongflow.framework.pes import PESAgent`；通用工具循环 `from loongflow.framework.react import ReActAgent`。

PES 最小示例（取自 README "Advanced Usage"）：

```python
from loongflow.framework.pes import PESAgent

# 配置进化 agent
agent = PESAgent(
    config=config,
    checkpoint_path=checkpoint_path,
)

# 注册 Worker（实现 Planner / Executor / Summary 接口）
agent.register_planner_worker("planner", PlanAgent)
agent.register_executor_worker("executor", ExecuteAgent)
agent.register_summary_worker("summary", SummaryAgent)

# 运行（AgentBase.__call__ 包了一层可取消 task）
result = await agent()
```

ReAct 形态：

```python
from loongflow.framework.react import ReActAgent
from loongflow.agentsdk.tools import TodoReadTool, TodoWriteTool, Toolkit

toolkit = Toolkit()
toolkit.register_tool(TodoReadTool())
toolkit.register_tool(TodoWriteTool())

agent = ReActAgent.create_default(model=model, sys_prompt=sys_prompt, toolkit=toolkit)
result = await agent(message)
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 两套范式：① **PES 进化循环**——并发多 cycle，每 cycle 串行 Plan→Execute→Summary，按 target_score / max_iterations 收敛；② **ReAct 循环**——while(step<max_steps) 做 Reason→Act→(Finalize 检查)→Observe，达 finalizer 工具或步数耗尽退出 | PES: `framework/pes/pes_agent.py:174,399`；ReAct: `framework/react/react_agent.py:94` |
| [[planning\|规划/任务分解]] | PES 的 **Planner Worker** 是显式独立阶段：理解任务+从进化记忆检索父代经验+产出执行蓝图（`best_plan.txt`）；Planner 仅是 `get_worker` 的薄封装，具体策略由场景 Agent 实现（如 general_agent/planner.py）；ReAct 侧用 Todo 工具做轻量任务清单 | `framework/pes/planner/planner.py:13`，`framework/pes/register.py:55`，`agentsdk/tools/todo_write_tool.py` |
| [[memory\|记忆(短/长/向量)]] | 两类：① **会话记忆 GradeMemory**——STM/MTM/LTM 三级，超 token_threshold(默认 65536) 用 LLM 压缩器自动压缩(`auto_compress`)；② **进化记忆 EvolveMemory**——多岛 + MAP-Elites 网格 + 精英归档 + 岛间迁移，存 Solution(代码/分数/计划/总结/父子链)。**非语义向量检索**（多样性用长度/行数/字符集差分启发） | 会话: `agentsdk/memory/grade/memory.py:32`；进化: `agentsdk/memory/evolution/in_memory.py:23`（`_calculate_MAP_Elites:695`，`_check_migration:1057`） |
| [[tool-use\|工具调用]] | `Toolkit` 注册/分发 `FunctionTool`；声明优先 Pydantic `args_schema`，否则 `inspect.signature`+docstring 自动生成 OpenAI function schema；`tool_context` 形参运行时注入且从 schema 隐藏；内置 Read/Write/Ls/Shell/Todo/Agent/ExecuteCode 等工具；ReAct 侧 Actor 可串行/并行执行 | `agentsdk/tools/toolkit.py:14`，`agentsdk/tools/function_tool.py:68`，`agentsdk/tools/__init__.py:19`，`agentsdk/tools/execute_code_tool.py:58` |
| [[model-abstraction\|模型抽象]] | `BaseLLMModel` 抽象 + `LiteLLMModel` 默认实现，底层走 **LiteLLM**，统一 `CompletionRequest/CompletionResponse`，async generator 支持流式；`from_config` 读 model/url/api_key，默认 provider=openai（如 `openai/gemini-3-pro-preview`）；ClaudeCodeAgent 另走 Anthropic 兼容端点 | `agentsdk/models/litellm_model.py:19`，`agentsdk/models/base_llm_model.py`，`agentsdk/models/formatter/litellm_formatter.py` |
| [[multi-agent-orchestration\|多智能体编排]] | **进程内多 Worker 流水线**：PESAgent 以 asyncio 并发跑多个 evolution cycle（`concurrency` 控并发数），每 cycle 内 Planner/Executor/Summary 三 Agent 协作；岛模型把种群分到 num_islands 并定期迁移，等价于并行进化群体；无跨网络分布式 agent 协议 | `framework/pes/pes_agent.py:377`(`_try_start_new_cycle`)`:445`(主循环)，岛迁移 `agentsdk/memory/evolution/in_memory.py:1057` |
| [[context-engineering\|上下文工程]] | ① GradeMemory 自动压缩控上下文长度（LLMCompressor 摘要 MTM+STM，`grade/memory.py:108`）；② Planner 把"父代解+评测+总结"作为经验注入下一轮 prompt；③ ReAct 每步把 system_prompt+历史+工具声明拼成 CompletionRequest（`default_reasoner.py:37`）；场景 Agent 用 prompt 模板（如 claude_code/general_prompt.py） | `agentsdk/memory/grade/memory.py:91`，`agentsdk/memory/grade/compressor/`，`framework/react/components/default_reasoner.py:28` |
| [[skills-plugins\|技能/插件]] | **复用 Claude Code 的 Skill 体系**：`ClaudeCodeAgent` 默认放行 `Skill`/`Task` 工具并 `setting_sources=["project"]`，从仓库 `.claude/skills/`、`.agents/skills/`（如 skill-creator、code-analysis）加载技能；自定义工具经 `create_sdk_mcp_server` 包成 MCP server 注入；通用扩展点是 AgentBase 的 pre_/post_ 钩子 | `framework/claude_code/claude_code_agent.py:60,157,197`，`agents/general_agent/executor.py:290`，`.claude/skills/`、`.agents/skills/` |
| [[observability-eval\|可观测/评估]] | ① 全程 `get_logger` 结构化日志 + Rich 美化 message 打印（`message_logger.py`），每步打 trace_id；② 逐 cycle 统计 prompt/completion token 与成本（`pes_agent.py:294`）；③ **Evaluator** 是一等公民：把候选代码写文件、在独立子进程带 timeout 执行用户 `evaluate()` 拿 score/metrics/summary；④ math_agent 自带 visualizer 看进化树/岛分布 | 评测 `framework/pes/evaluator/evaluator.py:126`，日志 `agentsdk/logger/message_logger.py`，可视化 `agents/math_agent/visualizer/visualizer.py` |
| [[runtime-execution\|运行时/部署]] | 纯 Python 库（`pip install -e .`，需 3.12+）；全异步 asyncio；进化任务由 `run_general.sh`/`run_math.sh`/`run_ml.sh` 脚本以 `--background` 后台跑并写 run.log；**代码执行隔离**靠 multiprocessing 子进程 + timeout（非容器沙箱）；ClaudeCodeAgent 默认 `permission_mode="acceptEdits"` 直接读写真实文件系统 | `run_math.sh`、`run_general.sh`，子进程执行 `framework/pes/evaluator/evaluator.py:217`，`claude_code_agent.py:183` |
| [[human-in-the-loop-governance\|人在环/治理]] | 主要是 **中断治理** 而非审批：`AgentBase.interrupt()` 取消 asyncio task，PESAgent 经 `_stop_event` 优雅停机并终止全部评测子进程（SIGTERM→SIGKILL，`evaluator.py:427`）；ReAct 可注册自定义 `interrupt` 处理器（`react_agent.py:184`）；ClaudeCodeAgent 有 permission_mode（prompt/acceptEdits/acceptAll）但默认自动接受；无内置工具审批/危险命令拦截层 | `framework/base/agent_base.py:90`，`framework/pes/pes_agent.py:589`，`framework/react/react_agent.py:184` |
| [[state-persistence\|状态/持久化]] | ① **Checkpoint**：按 `checkpoint-iter-{iter}-{count}` 目录定期落盘进化数据库（solutions/*.json + metadata.json + best_solution.json），可从 checkpoint 恢复 completion_count 与种群（`pes_agent.py:348`，`in_memory.py:298,377`）；② 进化记忆后端可选 in-memory 或 **Redis**（MemoryFactory）；③ **Workspace** 把每轮 planner/executor/summarizer/evaluator 产物按 `{task_id}/{iter}/` 结构化落盘 | `framework/pes/pes_agent.py:348`，`agentsdk/memory/evolution/in_memory.py:298`，`agentsdk/memory/evolution/redis_memory.py`，`framework/pes/context/workspace.py:39` |

## 设计权衡与特性

- **范式即护城河**：与 [[swarm]]/[[connectonion]] 这类"ReAct + 工具"的单/多 agent 库不同，LoongFlow 的卖点是 **PES 思考范式**——显式分离 Plan/Execute/Summary 并把"失败反思"写回结构化记忆，定位是"长程、专家级、可持续进化"的任务（数学猜想、Kaggle、算法优化），而非聊天/RAG 助手。
- **进化算法是真内核**：多岛模型 + MAP-Elites 维持多样性、自适应 Boltzmann 采样按种群多样性动态调温（`boltzmann.py:59`）、连续 5 代分数停滞自动放大 exploration_rate 跳出局部最优（`database.py:54`）——这些是从 OpenEvolve/AlphaEvolve 演化来的"有向进化搜索"，代码里明确标注改编自 openevolve（`in_memory.py:697,1059`，Apache-2.0）。
- **站在 Claude Code 肩上**：`general_agent` 直接把 Claude Agent SDK（`claude-agent-sdk` 依赖）包成一个 Executor Worker，复用其 Read/Write/Bash/Skill/Task 与 `.claude/skills` 技能生态——等于把 Claude Code 的编码能力嵌进进化循环，自己只负责 PES 调度与进化记忆。
- **评测驱动 = 双刃剑**：每个候选解都要跑一次用户 `evaluate()` 拿分，强约束了"可量化任务"，对开放式任务不友好；子进程 + timeout 隔离能防死循环/崩溃，但**不是容器级安全沙箱**，且 ClaudeCodeAgent 默认 `acceptEdits` 会直接改真实文件，生产需谨慎授权。
- **工程成熟度参差**：核心 PES/进化记忆代码扎实（细粒度锁、checkpoint、岛迁移去重），但仍有调试痕迹（`toolkit.py:160` 残留 print）、Worker 的 Planner/Executor/Summary 三个封装类几乎同构（DRY 可优化）。
- **待确认**：① GitHub stars 仅有社交徽章、未取到具体数值；② pyproject 版本 `0.0.2` 与 README 宣传的成绩/成熟度落差较大，属早期开源；③ "支持任意 OpenAI 兼容 API" 经 LiteLLM 实现，但 general_agent 路径强依赖 Anthropic 兼容端点（claude-agent-sdk）。

## 关联

- [[component-taxonomy]] · [[agent-loop-paradigms]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式（进化/多 worker 流水线）：[[metagpt]] · 复用其能力：参见 Claude Agent SDK · 源码：`agents-example/loongflow/`
