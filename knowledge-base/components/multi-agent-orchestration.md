---
title: "多智能体编排"
aliases:
  - Multi-Agent Orchestration
  - Handoff
  - Group Chat
tags:
  - knowledge-base
  - domain/agent-components
  - component/multi-agent-orchestration
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 多智能体编排

> [!abstract] 一句话总结
> 多个各有角色的 agent 如何协作：角色定义、拓扑（主从/网状/流水线/群聊）、通信（handoff/消息/共享状态）。把一个超级 agent 拆成一个团队。概念详见 [[single-vs-multi-agent]]。

## 它解决什么问题

让职责分离（创意 vs 审查）、并行、可组合，代价是协调开销与误差传播。是众多框架（[[autogen|AutoGen]]、[[crewai|CrewAI]]、[[swarm|Swarm]]、[[metagpt|MetaGPT]]）的核心卖点。

## 设计维度 / 实现谱系

- **拓扑**：supervisor 层级 ↔ swarm 网状 ↔ sequential 流水线 ↔ group chat
- **通信**：handoff（移交控制权）↔ 消息传递 ↔ 共享状态/黑板 ↔ 跨进程网络（[[hcom|hcom]]、A2A）
- **角色定义**：role+goal+backstory（[[crewai|CrewAI]]）↔ SOP 标准流程（[[metagpt|MetaGPT]]）↔ 函数式 handoff（[[swarm|Swarm]]）
- **调度**：谁决定下一个发言/行动的 agent
- **终止**：何时认为团队任务完成

## 关键要点

- 三要素：角色、拓扑、通信。
- handoff（[[swarm|Swarm]]）是极简优雅的抽象：工具返回一个 agent 即转交。
- 先把单 agent 做好再上多 agent（[[design-tradeoffs]]）。

## 关联

- [[single-vs-multi-agent]] · [[state-persistence]] · [[planning]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **41** 个实现了「多智能体编排」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 进程内非传统多 agent；靠 chains（多 workflow step 串/并行 + 输出落 .outputs/{skill}.md 注入下游）。真正"多实例"= Instance Fleet：spawn-instance fork 出专精副本登记 memory/instances.json，fleet-control/fork-fleet 管理 |
| [[ag2\|AG2]] | 多模式：①GroupChat+GroupChatManager，speaker 选择 auto/manual/random/round_robin/可调用；②新式 Group/handoff：agent.handoffs 挂 OnContextCondition(无 LLM) / OnCondition(LLM) / after-work，配 Pattern(Auto/RoundRobin/Manual/Random)，由 GroupToolExecutor 执行转移；③Swarm(initiate_swarm_chat/run_swarm)；④nested / sequential / 两两 chat |
| [[agency-swarm\|Agency Swarm]] | 核心卖点。①send_message 工具（同步 RPC：sender 调工具→recipient.get_response()→把 final_output 当工具返回值回灌，tools/send_message.py:314）；②有向 communication_flows（a > b 经 AgentFlow+register_subagent 动态装工具）；③可选 Handoff 控制权转移工具 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | ①agent 互调：extension 命令内经 self.ApiClient.prompt_agent(...) 让一个 agent 调另一个 agent（automation_helpers.py:264）；②Chain 可在步骤里指定不同 agent_name 串接多 agent；③各 BotManager（Discord/Slack/Teams…）+ WorkerRegistry/BotManagerRegistry 做渠道侧编排 |
| [[agentfield\|AgentField]] | 核心卖点：app.call("node.func") 经控制平面路由（绝不直连），自动传播 workflow/session/actor 上下文并构建 DAG；版本路由用加权轮询做 canary（5%→50%→100%），回 X-Routed-Version；AgentRouter(prefix=...) 做命名空间 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 非"多个对等 agent 协作"，而是三个固定角色的学习流水线经 Pipeline 编排；Branch 支持并行分支+合并，RR 内部可递归派生只读 sandbox 子 agent(create_readonly_sandbox) |
| [[agentscope\|AgentScope]] | 2.0 移除了 1.0 的 msghub/pipeline 模块(本仓不存在)。当前路径：① Agent.observe() 注入外部消息做松散协作；② FastAPI agent service 做多租户多会话承载与编排(examples/agent_service)；③ MCP/A2A 把别的 agent 当工具/服务。README 称 message hub 在 roadmap |
| [[agentverse\|AgentVerse]] | 框架本体即多 agent 编排。两条主线：① simulation 经 5 规则（order/visibility/selector/updater/describer）调度 N 个对话 agent 的回合制交互；② task-solving 经 4 规则把 agent 按 AGENT_TYPES（ROLE_ASSIGNMENT/SOLVER/CRITIC/EXECUTION/EVALUATION/MANAGER）组织成"招募→讨论→执行→评估"流水线，讨论拓扑可选 vertical/horizontal/central/dynamic |
| [[astron\|Astron Agent]] | 靠 workflow DAG 引擎而非 agent 间直接通信：agent 节点把一个完整 agent 嵌入工作流；flow 节点可嵌套调用其它 workflow（WorkflowPlugin 让 CoT 把别的 workflow 当工具调）；节点间靠 VariablePool 传值，引擎用 asyncio.create_task 并发调度依赖就绪的节点 |
| [[autogen\|AutoGen]] | 核心强项。BaseGroupChat(Team) + BaseGroupChatManager：manager 通过 pub/sub 选下一发言者（select_speaker），participant 经 ChatAgentContainer 包成 runtime agent；五种内置模式：RoundRobin / Selector(LLM 选人) / Swarm(handoff 驱动) / GraphFlow(DiGraph 显式拓扑) / Magentic-One(ledger 编排) |
| [[botpress\|Botpress]] | 内核无固定多 agent 协议；用 Exit 做 handoff 实现：MultiAgentOrchestrator 把每个子 agent 暴露为 handoff_<name> Exit，onExit 钩子里切换 currentAgent 并防环路；可扩展到上百子 agent |
| [[connectonion\|ConnectOnion]] | 两条路：①进程内 subagents 插件经 task() 工具派生隔离子 agent；②跨网络 host() 把 agent 暴露为 HTTP+WebSocket，经 relay 做 P2P 发现，connect()/RemoteAgent 远程调用 |
| [[cordum\|Cordum]] | 这是核心：Scheduler 按 Heartbeat（算力/能力/pool/labels）做容量感知路由到 worker 池或直连 worker，靠内存 TTL 注册表（无持久 DB）；策略可做 pool segmentation（敏感数据只进可信池） |
| [[crewai\|CrewAI]] | Process.sequential(按序执行 task) / Process.hierarchical(自动建经理 agent 持 AgentTools 委派)；agent 间经 Delegate/AskQuestion 工具协作；A2A 协议跨进程 |
| [[dust\|Dust]] | run_agent MCP server 实现"agent as tool"：两种模式 run-agent（子 agent 在后台子对话执行并回传结果）与 handoff（子 agent 直接接管对话）；可向子 agent 转发文件/toolset |
| [[hcom\|hcom]] | 核心。①消息：hcom send @name(s) [--intent request/inform/ack] [--reply-to] [--thread]，按 @mention 定向或广播，写成 events 行（commands/send.rs:1, messages.rs:13 scope 计算）。②投递：Claude 经 PostToolUse hook turn 中途注入、SessionStart/Stop 注入（hooks/claude.rs:916 handle_posttooluse, :421 handle_sessionstart）；PTY 模式经 TCP inject 端口投递（delivery.rs:1）。③spawn/fork/resume/kill：hcom [N] <tool> 起真实终端或 headless（commands/launch.rs:1, launcher.rs:1），hcom f/r/kill（commands/fork.rs, resume.rs, kill.rs）。④订阅/反应：hcom events sub <filters>，订阅存 kv 的 events_sub: 行，命中可自动 on_hit_text 回消息（db/subscriptions.rs:1）。⑤碰撞检测默认开：两 agent 30s 内改同一文件双方收通知（README:101） |
| [[hermes-agent\|Hermes Agent]] | delegate_task 工具派生隔离子 AIAgent：全新对话(无父史)、独立 task_id/终端、受限 toolset(强制剥离 delegate/clarify/memory/send_message/execute_code)、单/批并行(ThreadPoolExecutor)，父进程阻塞至子完成、只回看 summary |
| [[hive\|Hive]] | 核心范式：Queen 生成 worker graph，多 worker 并行（fan-out/fan-in），colony=一组 worker 的部署；session 隔离 + 共享 buffer；run_parallel_workers 横向扩同类工作 |
| [[lagent\|Lagent]] | 组合式：Sequential 容器按顺序串接 agent 并可 exit_at 提前退出；AgentList/AgentDict 把 agent 当容器元素；任意 agent 赋值为属性即成递归子 agent（_agents）。无中心调度器/角色协议 |
| [[langchain\|LangChain]] | create_agent(name=...) 返回的图可作为子图节点嵌入另一张 LangGraph（factory.py:803 文档）；SubagentTransformer 把嵌套命名 agent 识别为 run.subagents 句柄并转发其事件流；更高层编排走 LangGraph / Deep Agents |
| [[llamaindex\|LlamaIndex]] | AgentWorkflow 持有多个命名 agent + root_agent；自动注入 handoff 工具(return_direct)按 can_handoff_to 白名单切换 current_agent_name，共享同一 memory/state；from_tools_or_functions 据是否 function-calling 自动选 Function/ReAct agent |
| [[loongflow\|LoongFlow]] | 进程内多 Worker 流水线：PESAgent 以 asyncio 并发跑多个 evolution cycle（concurrency 控并发数），每 cycle 内 Planner/Executor/Summary 三 Agent 协作；岛模型把种群分到 num_islands 并定期迁移，等价于并行进化群体；无跨网络分布式 agent 协议 |
| [[maestro\|Maestro]] | 核心范式：1 个 orchestrator (强模型) + N 次 sub-agent (弱模型) 的 supervisor 编排；模型分层由 3 常量配置；orchestrator 串行派发，子代理无并发、不互相通信 |
| [[mastra\|Mastra]] | 三条路：①agent.network(messages, opts) 用一个 routing agent 在 sub-agents/workflows/tools 间动态路由迭代直至完成；②sub-agent：在 agents: 注册的 SubAgent 被包成工具供主 agent 调用（getToolsForExecution）；③workflow 内 createStep(agent) 把 agent 当步骤静态编排；另有 A2A 协议（@mastra/core/a2a） |
| [[metagpt\|MetaGPT]] | 框架核心：Team.hire(roles) 把角色放进 Environment；Environment.publish_message 按 member_addrs 地址路由到角色私有队列；Environment.run 用 asyncio.gather 并发跑所有非 idle 角色；订阅靠 cause_by ∈ rc.watch 解耦。新一代 MGXEnv + TeamLeader（Mike）做动态 @ 路由与 direct_chat |
| [[modus\|Modus]] | actor 间消息传递：SendMessage(同步阻塞带 timeout)/SendMessageAsync(timeout=0 异步)；agent 可在自身方法内 Start/SendMessage 其他 agent；底层 GoAkt 支持分布式(actor 可能在别的进程/机器) |
| [[nanobot\|nanobot]] | 进程内 SubagentManager 派生隔离子 agent（独立 ToolRegistry/workspace scope，复用 AgentRunner），结果经 bus 作为 system 消息回灌父会话；spawn 工具触发，受 max_concurrent_subagents 限流。无跨网络 agent 协议 |
| [[open-multi-agent\|Open Multi-Agent]] | 核心范式：coordinator 拆 DAG → TaskQueue 拓扑解析(完成自动 unblock、失败级联) → Scheduler 自动分配(默认 dependency-first，另有 round-robin/least-busy/capability-match) → AgentPool 信号量并发执行；可选 delegate_to_agent 工具做同步子 agent 委派(带环检测/深度上限/池槽防死锁) |
| [[openclaw\|OpenClaw]] | 两条路：①多 agent 路由——按渠道/账号/peer 把入站消息路由到隔离 agent（独立 workspace + per-agent session）；②子 agent 派生——sessions_spawn 工具派生 subagent / ACP 外部 CLI agent，受 maxSpawnDepth、maxChildren、requireAgentId 策略约束；sessions_list/sessions_history/sessions_send 做跨会话协作 |
| [[pilotprotocol\|Pilot Protocol]] | 核心，但是"网络级编排"：①寻址=48 位虚拟地址 N:NNNN.HHHH.LLLL + 16 位端口 + hostname 发现；②互信=双向签名握手（端口 444，经 registry relay），节点默认私有；③发现/NAT=经 rendezvous 注册解析、STUN、打洞、relay 兜底。data flows 点对点直连 |
| [[pipecat\|Pipecat]] | 两路：①进程内 ParallelPipeline 并行多条管道；②多 worker 经 WorkerBus 协作——@job(name=, sequential=) 暴露 handler，调用方 async with self.job(name) / self.job_group(names) 发请求并等 JobStatus；WorkerRegistry 跟踪本地/远程 worker（pgmq/redis 可跨进程） |
| [[praisonai\|PraisonAI]] | Agents 容器 + Process 三模式：sequential（按序、自动传上下文）、hierarchical（manager_llm 充当 orchestrator 动态派活）、workflow（按 next_tasks/condition 走图，支持 route/parallel/loop/repeat）；另有 Handoff 做 agent→agent 转交（仿 OpenAI Agents SDK）、A2A 协议 |
| [[semantic-kernel\|Semantic Kernel]] | 两代并存：① 旧 AgentGroupChat/AgentChat（轮转+终止策略）；② 新 AgentOrchestration<TIn,TOut> 基类下的 Concurrent / Sequential / GroupChat / Handoff / Magentic 五种模式，跑在 actor Runtime 上；GroupChat 由 GroupChatManager(SelectNextAgent/ShouldTerminate/ShouldRequestUserInput) 编排；agent 亦可作为另一 agent 的 plugin |
| [[smolagents\|smolagents]] | 层级式：把子 agent 放进 managed_agents，框架给它套上 name/description/inputs 使其"像工具一样可被调用"；父 agent 经 agent(task=...)(__call__) 调用，子 agent 跑完整 run 返回报告。注意：远程沙箱执行器不支持 managed agents |
| [[strands\|Strands Agents]] | 三模式：①Graph 确定性依赖图（支持环/嵌套，GraphBuilder 声明边）；②Swarm 自治协作团队（工具化 handoff + 共享上下文）；③A2A 协议(server/executor)；另 agent.as_tool() 把 agent 当工具 |
| [[swarm\|Swarm]] | 网状 handoff：工具返回 Agent/Result(agent=...) 即移交控制权 |
| [[swarmclaw\|SwarmClaw]] | ①进程内 subagent：spawnSubagent 派生隔离子 session，带 delegationDepth 限制（DEFAULT_DELEGATION_MAX_DEPTH）；②外部委派：delegate 工具 spawn claude/codex/opencode/gemini/copilot/droid/cursor/qwen CLI 子进程，回退链 + resume id；③跨 OpenClaw gateway 路由；org-chart/team 可视化编排 |
| [[swarms\|Swarms]] | 核心卖点：60+ 拓扑文件，经 SwarmRouter 按 17 种 SwarmType 统一分派；含 Sequential/Concurrent(ThreadPool)/AgentRearrange(flow DSL)/Graph(DAG 拓扑排序)/MixtureOfAgents/Hierarchical/GroupChat/MajorityVoting/Council/Debate/Heavy/RoundRobin 等；另有 handoffs 让 agent 间移交 |
| [[transformers-agents\|Transformers Agents]] | 后期支持 managed agents（一个 agent 调用另一个），整体仍偏单 agent |
| [[upsonic\|Upsonic]] | Team 三种模式 sequential/coordinate(leader 协调)/route(router 分派)，ask_other_team_members 自动互为工具；Graph 做带 State 的 DAG/链工作流(可 parallel_execution)；agent 亦可作为工具被另一 agent 调用 |
| [[voltagent\|VoltAgent]] | Supervisor/Sub-agent：SubAgentManager 经 delegate_task 工具把任务 handoffTask 给子 agent，handoffToMultiple 并行委派多个；另有 A2A server 协议跨进程协作 |
