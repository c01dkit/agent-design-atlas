---
title: "MetaGPT"
aliases:
  - MetaGPT
  - metagpt
  - "Code = SOP(Team)"
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/metagpt
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/geekan/MetaGPT
license: MIT
stars: ~45k
---

# MetaGPT

> [!abstract] 一句话定位
> 一个把"软件公司 SOP 标准作业流程"固化进多智能体协作的 Python 框架，信条是 **`Code = SOP(Team)`**：给不同 LLM 角色（产品经理/架构师/项目经理/工程师/数据分析师）分派职责，靠共享 **Environment 消息池 + cause_by 订阅路由 + 结构化文档接力（ActionNode）**，把"一行需求"流水线化为 PRD→设计→任务→代码→测试的产物。

## 设计理念 / 顶层架构

MetaGPT 的核心范式是 **multi-agent 流水线 + 显式 SOP**，而非自由放养的 agent 群聊。设计取舍：

- **Code = SOP(Team)**：把人类软件公司的标准作业流程"物化"为代码——每个 `Role` 绑定有序的 `Action` 序列与"关注的上游产物"，角色之间不直接对话，而是把结构化文档（PRD、API 设计、任务清单）丢进环境消息池，下游角色按 `cause_by` 订阅自动接力。
- **三大原语 Role / Action / Team**：`Action` 是最小工作单元（一次 LLM 调用 + 结构化输出）；`Role` 是有状态的 agent，内含 `_observe → _think → _act` 循环和私有记忆；`Team` 持有 `Environment` 与预算（`investment`），驱动多轮 `run`。
- **消息驱动 + 发布订阅**：`Environment` 是中央消息池（`publish_message` 按 `member_addrs` 地址路由），每个 `Role` 有私有 `MessageQueue` 缓冲；`_observe` 用 `rc.watch`（订阅的 Action 集合）过滤感兴趣的消息——这是"谁干完什么、谁接着干"的解耦机制。
- **结构化输出即契约**：`ActionNode` 用 schema + format 约束把 LLM 输出钉成可解析的结构化文档（含 auto/human review 自修订），让角色间传递的是强类型产物而非散文。
- **两代角色并存**：经典 `Role`（state-machine，三种 `react_mode`：react/by_order/plan_and_act）+ 新一代 `RoleZero`（`metagpt/roles/di/role_zero.py`，工具化 ReAct，LLM 直接输出命令列表，max_react_loop=50），后者由 `MGXEnv` + `TeamLeader` 做动态编排。
- **入口 API**：`from metagpt.software_company import generate_repo`，或 `Team().hire([...]).run(idea=...)`；CLI `metagpt "Create a 2048 game"`。

最小示例（取自 README）：

```python
from metagpt.software_company import generate_repo
from metagpt.utils.project_repo import ProjectRepo

repo: ProjectRepo = generate_repo("Create a 2048 game")  # 一行需求 → 整个软件公司 SOP
print(repo)  # 打印生成的 repo 结构与文件（PRD / 设计 / 代码 / 测试）

# 等价的库用法（generate_repo 内部）：
# company = Team(context=ctx)
# company.hire([TeamLeader(), ProductManager(), Architect(), Engineer2(), DataAnalyst()])
# company.invest(investment=3.0)               # 设预算，超支抛 NoMoneyException
# asyncio.run(company.run(n_round=5, idea="Create a 2048 game"))
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 经典 `Role` 是 `_observe→_think→_act` 状态机循环：`react()` 按 `react_mode` 分派；REACT 模式下 `_think` 用 LLM 选下一个 Action（STATE_TEMPLATE 让 LLM 回答状态编号），`_react` 在 max_react_loop 内 think-act 交替。新 `RoleZero` 是工具化 ReAct：LLM 直接输出命令列表→解析→执行→回灌 | `metagpt/roles/role.py:454` (`_react`), `role.py:340` (`_think`), `role.py:512` (`react`), `metagpt/roles/di/role_zero.py:303` (`_react`) |
| [[planning\|规划/任务分解]] | 两层：①SOP 即"硬编码计划"——角色的 Action 顺序就是流程；②`plan_and_act` 模式下 `Planner` 用 `WritePlan` 让 LLM 生成 `Plan`（`Task` 列表 + 依赖，拓扑排序），逐任务执行+review+动态改计划 | `metagpt/strategy/planner.py:77` (`update_plan`), `role.py:472` (`_plan_and_act`), `metagpt/schema.py:496` (`Plan`), `schema.py:457` (`Task`) |
| [[memory\|记忆(短/长/向量)]] | 短期=`Memory`（list 存储 + `index[cause_by]` 倒排索引，`get_by_actions` 按 Action 检索）；长期=`LongTermMemory`/`MemoryStorage` 走 FAISS 向量检索（`search_similar` 余弦阈值过滤）；`RoleZeroMemory` 用 Chroma RAG + LLMRanker 做超长记忆召回 | `metagpt/memory/memory.py:20`, `metagpt/memory/longterm_memory.py:18`, `metagpt/memory/memory_storage.py:56,61`, `metagpt/memory/role_zero_memory.py:71` |
| [[tool-use\|工具调用]] | 经典角色无通用工具调用（Action 即"能力"）；工具体系服务于 `RoleZero`/DataInterpreter：`@register_tool` 装饰器把类/函数注册进 `ToolRegistry`（AST 自动抽 schema），`ToolRecommender`（TypeMatch / BM25 / Embedding 三种召回）按任务推荐工具子集 | `metagpt/tools/tool_registry.py:94` (`register_tool`), `tool_registry.py:31` (`ToolRegistry`), `metagpt/tools/tool_recommend.py:195` (`BM25ToolRecommender`), `tool_recommend.py:231` |
| [[model-abstraction\|模型抽象]] | `BaseLLM` 抽象基类（`aask`/`acompletion`/`acompletion_text`）+ `@register_provider` 按 `LLMType` 注册，`create_llm_instance` 工厂按 `api_type` 路由；内置 OpenAI/Azure/Anthropic/Gemini/Ollama/Bedrock/Qianfan/Zhipu/Spark/Dashscope/Ark 等十余 provider；统一 OpenAI message 格式 | `metagpt/provider/base_llm.py:35` (`BaseLLM`), `provider/llm_provider_registry.py:38` (`create_llm_instance`), `llm_provider_registry.py:24` (`register_provider`), `provider/openai_api.py:58` |
| [[multi-agent-orchestration\|多智能体编排]] | 框架核心：`Team.hire(roles)` 把角色放进 `Environment`；`Environment.publish_message` 按 `member_addrs` 地址路由到角色私有队列；`Environment.run` 用 `asyncio.gather` 并发跑所有非 idle 角色；订阅靠 `cause_by ∈ rc.watch` 解耦。新一代 `MGXEnv` + `TeamLeader`（Mike）做动态 @ 路由与 direct_chat | `metagpt/team.py:32` (`Team`), `metagpt/environment/base_env.py:175` (`publish_message`), `base_env.py:197` (`run`), `role.py:399` (`_observe`/订阅), `metagpt/environment/mgx/mgx_env.py:24` |
| [[context-engineering\|上下文工程]] | `Role._get_prefix` 用 PREFIX/CONSTRAINT 模板拼 system_prompt（含环境内其他角色名）；`_think` 用 STATE_TEMPLATE 注入对话历史让 LLM 选状态；`Planner.get_useful_memories` 用 STRUCTURAL_CONTEXT 裁剪上下文；`ActionNode.compile` 把 instruction+example+constraint 编译成结构化 prompt | `role.py:323` (`_get_prefix`), `role.py:54` (STATE_TEMPLATE), `planner.py:155` (`get_useful_memories`), `metagpt/actions/action_node.py:382` (`compile`) |
| [[skills-plugins\|技能/插件]] | 无独立"插件"系统；扩展即"写新 `Action` 子类 + 组装进 `Role`"或 `@register_tool` 注册工具。另有 `metagpt/skills/` + `SkillAction` 把 YAML 描述的技能转成可执行 Action（较边缘）；环境层 `ext/`（android/werewolf/minecraft 等）展示领域扩展 | `metagpt/actions/action.py:29` (`Action` 基类), `metagpt/actions/skill_action.py`, `metagpt/tools/tool_registry.py:94`, `metagpt/ext/` |
| [[observability-eval\|可观测/评估]] | `CostManager` 在每次 LLM 调用后累计 token/成本（`_update_costs`），`Team.invest` 设预算超支抛 `NoMoneyException`；`loguru` 全局日志（`metagpt/logs.py`）；`exp_pool`（经验池）用 `@exp_cache` 装饰器缓存+打分（`SimpleScorer`/LLM judge）历史经验供复用 | `metagpt/provider/base_llm.py:124` (`_update_costs`), `metagpt/utils/cost_manager.py`, `metagpt/team.py:98` (`_check_balance`), `metagpt/exp_pool/decorator.py:29` (`exp_cache`) |
| [[runtime-execution\|运行时/部署]] | 纯库 + `typer` CLI（`metagpt/software_company.py` 的 `generate_repo`/`startup`）；全异步（asyncio）；产物落盘到 `workspace/` 经 `ProjectRepo`/`GitRepository`（含 `archive` git 提交）；代码执行经 `RunCode` Action / Data Interpreter 在本地执行（无强沙箱）；提供 Dockerfile | `metagpt/software_company.py:14` (`generate_repo`), `metagpt/team.py:122` (`run`), `metagpt/environment/base_env.py:244` (`archive`), `metagpt/actions/run_code.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | `HumanProvider` 把 `is_human=True` 的角色 LLM 调用替换成 `input()` 终端交互；`Planner.ask_review`（非 auto_run 时）让人审核/改计划；`ActionNode.human_review` 人工评审结构化产物；`RoleZero.ask_human`/`reply_to_human` 工具经 `env.ask_human` 向人提问 | `metagpt/provider/human_provider.py:14`, `metagpt/strategy/planner.py:119` (`ask_review`), `metagpt/actions/action_node.py:665` (`human_review`), `metagpt/roles/di/role_zero.py:456` (`ask_human`) |
| [[state-persistence\|状态/持久化]] | `SerializationMixin` + `Team.serialize`/`deserialize` 把整个团队（含 context/角色/记忆）存成 `team.json` 支持断点恢复（`recover_path`）；`Environment.history`（`Memory`）留存全量消息供调试；`LongTermMemory.persist` 把向量记忆持久化到磁盘 | `metagpt/team.py:59` (`serialize`), `team.py:67` (`deserialize`), `metagpt/environment/base_env.py:134` (`history`), `metagpt/memory/longterm_memory.py:69` (`persist`) |

## 设计权衡与特性

- **SOP 即护城河 vs 自由编排**：与 AutoGen / CrewAI 的"agent 自由对话/委派"不同，MetaGPT 把流程"焊死"在角色的 Action 序列与 `cause_by` 订阅里——可复现性、产物质量高（论文核心卖点），代价是流程僵化、加新角色/改流程要动代码。
- **消息池 + cause_by 订阅的解耦**：角色互不持有引用，全靠环境广播 + 标签过滤，天然支持并发（`asyncio.gather`）与可观测（`Environment.history` 全留痕）。但调试需理解 RFC 116/113 风格的路由（`member_addrs`/`send_to`/`MESSAGE_ROUTE_*`）。
- **结构化输出（ActionNode）是关键工程**：把"LLM 写散文"约束成"填表式结构化文档 + 自动/人工 review 重填"，这是多角色能稳定接力的前提，也是 MetaGPT 区别于 prompt-chain 玩具的核心。
- **新旧两套并行的张力**：经典 `Role`（state-machine + by_order SOP）正被 `RoleZero`/`MGXEnv`/`TeamLeader`（工具化 ReAct + 动态路由，对应 MGX 产品）逐步取代——`generate_repo` 默认已 `use_mgx=True` 且雇 `TeamLeader/Engineer2/DataAnalyst`。两套抽象并存，阅读源码时容易混淆哪条路径生效。
- **预算治理**：`investment` + `CostManager` 把"花多少钱"做成一等公民（超支抛异常停机），在多 agent 易失控烧钱的场景下是务实设计。
- **重依赖**：requirements 含 faiss/lancedb/playwright/llama-index(rag extra)/tiktoken 等；RAG/向量记忆、浏览器工具、Data Interpreter 各带一坨可选依赖。
- **待确认**：①经典 `Role.long_term_memory` 在 `RoleContext` 中被注释禁用（默认只用短期 `Memory`），长期向量记忆需显式接 `LongTermMemory`；②`stars` 为约数（README 未标注精确值）。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式（multi-agent 编排）：[[autogen]] · [[crewai]] · 源码：`agents-example/metagpt/`
