---
title: "AG2"
aliases:
  - AG2
  - ag2
  - AutoGen
  - autogen
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/ag2
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/ag2ai/ag2
license: Apache-2.0（含部分源自 microsoft/autogen 的 MIT 代码，见 NOTICE.md）
stars: ~2.5k(ag2ai/ag2)
---

# AG2

> [!abstract] 一句话定位
> AutoGen 创始团队（Chi Wang / Qingyun Wu）从微软分叉并完全开源的"AgentOS"，以 **可对话 Agent（ConversableAgent）+ 多 Agent 会话编排** 为核心范式：所有 Agent 都能收发消息、用 LLM/工具/人类输入生成回复，靠 GroupChat、Swarm、Group（handoff）、Nested/Sequential chat 等内建对话模式协作；包名仍叫 autogen（PyPI 双发 ag2/autogen）。

## 设计理念 / 顶层架构

AG2 的内核信条是 **"一切皆可对话的 Agent"**：ConversableAgent 是所有 Agent 的基类，自身不内嵌固定的 ReAct 循环，而是维护一个**有序的"回复函数（reply func）"列表**，generate_reply() 按序尝试每个 reply func，谁先返回 final=True 就用谁的回复。LLM 推理、工具执行、代码执行、终止/人类输入都只是注册进来的 reply func，因此推理流程是**可插拔、可重排、可排除**的。设计取舍：

- **会话即编排**：协作不是图或 DAG，而是"Agent 互相 send/receive 消息"。两 Agent 用 a.initiate_chat(b) / a.run(b)；多 Agent 用 GroupChat + GroupManager（一个 manager Agent 负责选下一个发言者）。
- **包结构（autogen/ 即 ag2）**：agentchat/ 是骨架（conversable_agent.py 220KB 巨型基类、groupchat.py、assistant_agent.py、user_proxy_agent.py、chat.py）；agentchat/group/ 是新一代 handoff 式编排（patterns、handoffs、on_condition、targets、context_variables）；agentchat/contrib/ 是电池（swarm_agent、captainagent、retrieve_*、capabilities/teachability 等）。oai/ 是多 provider model client（openai/anthropic/gemini/bedrock/mistral/groq/cohere/ollama/together/cerebras 等）；llm_config/ 定义 LLMConfig 与 ModelClient Protocol；tools/ 是工具抽象（Tool、依赖注入）；coding/ 是代码执行器（local/docker/jupyter/daytona 等）；logger/、opentelemetry/、cache/、mcp/、interop/（与 langchain/crewai/pydantic-ai 互操作）。
- **入口 API**：from autogen import ConversableAgent, AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager, LLMConfig。新式运行返回 RunResponse（agent.run(...).process()）。
- **演进信号**：README 声明正走向 v1.0，当前框架将进入维护期，autogen.beta 将成为官方版本（待确认其稳定性）。

最小示例（取自 README，两 Agent 对话）：

```python
import logging
from autogen import ConversableAgent, LLMConfig

llm_config = LLMConfig.from_json(path="OAI_CONFIG_LIST")

coder = ConversableAgent(
    name="coder",
    system_message="You are a Python developer. Write short Python scripts.",
    llm_config=llm_config,
)
reviewer = ConversableAgent(
    name="reviewer",
    system_message="You are a code reviewer. Suggest improvements; do not generate code.",
    llm_config=llm_config,
)

# reviewer 主动发起，与 coder 来回最多 10 轮
response = reviewer.run(recipient=coder,
                        message="Write a Python function that computes Fibonacci numbers.",
                        max_turns=10)
response.process()                       # 驱动事件流 / 打印对话
logging.info("Final:\n%s", response.summary)
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 非固定 ReAct：每个 Agent 持有有序 reply-func 列表，generate_reply() 依次尝试，首个 final=True 即返回。默认顺序（后注册先执行/LIFO insert）：终止&人类输入 → 工具调用 → 代码执行 → LLM(oai) 回复。多轮由 send/receive 互发消息驱动 | agentchat/conversable_agent.py:3172 (generate_reply)、:3224 (遍历 _reply_func_list)、注册顺序 :325-396、:624 (insert 到 0) |
| [[planning\|规划/任务分解]] | 内核无显式 planner，规划交给 LLM/对话模式。contrib/captainagent 可动态组建专家团队；society_of_mind_agent 把子群当一个"内省"Agent；agent_optimizer 离线优化函数集 | agentchat/contrib/captainagent/、agentchat/contrib/society_of_mind_agent.py、agentchat/contrib/agent_optimizer.py |
| [[memory\|记忆(短/长/向量)]] | 短期=每个对话方一条消息列表 _oai_messages（defaultdict(list)）；长期/向量=Teachability capability 用 ChromaDB 存"教导"记忆，经 process_last_received_message hook 召回（recall_threshold 距离阈值）；RAG 见下 | 短期 conversable_agent.py:272、:1103 (append)；agentchat/contrib/capabilities/teachability.py:23 |
| [[tool-use\|工具调用]] | 原生 function/tool calling。@agent.register_for_llm() 把函数转 schema（type hints + Annotated 描述）供 LLM 调用，@executor.register_for_execution() 注册到执行方；Tool 类封装 func+schema，inject_params 支持依赖注入（Depends）；执行在 generate_tool_calls_reply | conversable_agent.py:3968 (register_for_llm)、:4114 (register_for_execution)、:2782 (generate_tool_calls_reply)、tools/tool.py:20、tools/dependency_injection.py:230 (inject_params) |
| [[model-abstraction\|模型抽象]] | ModelClient 是 Protocol（须实现 create/message_retrieval/cost/get_usage）；OpenAIWrapper 按 config 的 api_type 路由到各 provider client（openai/azure/anthropic/gemini/bedrock/mistral/groq/cohere/ollama/together/cerebras/deepseek 等）；统一以 OpenAI ChatCompletion 格式为内部协议；支持 config_list 故障转移与 register_model_client 自定义 | llm_config/client.py:14 (ModelClient Protocol)、oai/client.py:761 (OpenAIWrapper)、:949 (_register_default_client 路由)、oai/ 下各 provider |
| [[multi-agent-orchestration\|多智能体编排]] | 多模式：①GroupChat+GroupChatManager，speaker 选择 auto/manual/random/round_robin/可调用；②新式 Group/handoff：agent.handoffs 挂 OnContextCondition(无 LLM) / OnCondition(LLM) / after-work，配 Pattern(Auto/RoundRobin/Manual/Random)，由 GroupToolExecutor 执行转移；③Swarm(initiate_swarm_chat/run_swarm)；④nested / sequential / 两两 chat | agentchat/groupchat.py:147 (selection)、:678 (select_speaker)；agentchat/group/handoffs.py:16、group/patterns/auto.py:19、group/multi_agent_chat.py:44 (initiate_group_chat)；agentchat/contrib/swarm_agent.py:869 |
| [[context-engineering\|上下文工程]] | system message 可静态或 UpdateSystemMessage 动态生成；group 模块的 ContextVariables 在 Agent 间共享可变状态并驱动条件转移/system 模板（ContextExpression/ContextStr）；transform_messages capability 做消息裁剪/压缩/限长 | conversable_agent.py (UpdateSystemMessage)、group/context_variables.py:18、group/context_expression.py、agentchat/contrib/capabilities/transform_messages.py |
| [[skills-plugins\|技能/插件]] | 两条路：①AgentCapability 子类经 add_to_agent() 给 Agent 加能力（teachability/vision/generate_images/transform_messages）；②interop/ 把 LangChain/CrewAI/PydanticAI 工具桥接为 AG2 Tool；mcp/ 作为 MCP client 接入外部工具 | agentchat/contrib/capabilities/agent_capability.py、interop/、mcp/mcp_client.py、tools/contrib/、tools/experimental/ |
| [[observability-eval\|可观测/评估]] | runtime_logging 全局开关，BaseLogger 抽象 + SqliteLogger/FileLogger 后端记录 chat/LLM 调用/成本/工具事件；gather_usage_summary 汇总 token/cost；内建 OpenTelemetry instrumentation（agent/llm/pattern span）；contrib/agent_eval 做评估 | runtime_logging.py、logger/base_logger.py:26、logger/sqlite_logger.py:66、agentchat/utils.py (gather_usage_summary)、opentelemetry/instrumentators/、agentchat/contrib/agent_eval/ |
| [[runtime-execution\|运行时/部署]] | 纯库，同步为主（多数 API 有 a_ 异步孪生）。run() 在后台线程跑对话返回 RunResponse 事件流，run_iter() 可逐事件步进；代码执行器可插拔：local/docker/jupyter/daytona/yepcode/remyx 等（沙箱程度各异）；a2a/ag_ui 暴露协议端点 | conversable_agent.py:1524 (run)、:1664 (run_iter)、io/run_response.py、coding/factory.py、coding/docker_commandline_code_executor.py、coding/jupyter/ |
| [[human-in-the-loop-governance\|人在环/治理]] | human_input_mode 取 ALWAYS/NEVER/TERMINATE；check_termination_and_human_reply 作为最先执行的 reply func 拦截并征询人类（默认经控制台 IOStream，get_human_input）；UserProxyAgent 是代表人类的预设 Agent；group/guardrails.py 与 safeguards/ 提供护栏 | conversable_agent.py:189 (human_input_mode)、:2879 (check_termination_and_human_reply)、:3379 (get_human_input)、agentchat/user_proxy_agent.py、agentchat/group/guardrails.py |
| [[state-persistence\|状态/持久化]] | 会话状态=各 Agent 的 _oai_messages（进程内）；cache/ 持久化 LLM 响应缓存（disk/redis/cosmos/in-memory），按 seed/cache_seed 复用；对话历史可 clear_history 或保留 N 条；RAG/Teachability 经向量库落盘；无内建跨进程会话恢复 | conversable_agent.py:272 (_oai_messages)、:2473 (保留 N 条)、cache/cache.py、cache/disk_cache.py、cache/cache_factory.py |

## 设计权衡与特性

- **与 [[autogen]] 的关系与异同**：AG2 是 AutoGen 创始团队从 microsoft/autogen 分叉的延续，包名、ConversableAgent/GroupChat/UserProxyAgent 核心 API 与早期 AutoGen(0.2.x) 基本一致，迁移成本低（NOTICE.md 保留 MIT 归属）。分歧点：微软主线 AutoGen 0.4+ 重写为 event-driven 的 autogen-core/autogen-agentchat 异步 actor 架构；AG2 选择保留并演进经典的"reply-func 列表 + 会话"模型，再叠加新的 group/ handoff 编排、Swarm、CaptainAgent、interop、a2a 等，定位为"AgentOS"而非重写运行时。简言之：AG2 = 经典 AutoGen 内核 + 持续社区扩展；微软 AutoGen = 全新 actor 内核。（两者具体版本对齐情况待确认）
- **reply-func 列表是最大特色**：推理循环不写死，而是一串可注册/排除/重排的函数，终止、人类、工具、代码、LLM 都平权可插拔——极灵活，但行为分散、conversable_agent.py 膨胀到 220KB（远超 800 行规范），新手不易一眼看清"一次回复到底发生了什么"。
- **两套多 Agent 编排并存**：老的 GroupChat（中心化 manager 选 speaker）与新的 group/（去中心化 handoff + Pattern + ContextVariables）同时存在，能力重叠，选型需看文档（新代码倾向 group）。
- **provider 覆盖广、统一 OpenAI 格式**：一套 config_list 即可多模型/故障转移，但内部一律转 OpenAI ChatCompletion schema，非 OpenAI 模型的高级特性可能被抹平。
- **代码执行是一等公民**：UserProxyAgent + code executor 让"Agent 写代码 → 执行 → 看结果"成为内建闭环，Docker/Jupyter/Daytona 可选；但 use_docker=False 时是本机执行，有安全风险（需自行隔离）。
- **生态互操作强**：interop/ 直接吃 LangChain/CrewAI/PydanticAI 工具，mcp/ 接 MCP，a2a/ag_ui 出协议——融入而非自封闭。
- **待确认/坑**：①README 称当前框架将进入维护期、autogen.beta 升为 v1.0 官方版，长期 API 可能迁移；②oai/client.py 含大量 _v2/responses_v2 分支，新旧 client 并行，行为差异需查文档；③巨型基类与双套编排带来学习曲线。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同源/同范式（multi）：[[autogen]] · 源码：agents-example/ag2/
