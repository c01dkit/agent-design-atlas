---
title: "人在环与治理"
aliases:
  - Human-in-the-Loop
  - Governance
  - HITL
tags:
  - knowledge-base
  - domain/agent-components
  - component/human-in-the-loop-governance
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 人在环与治理

> [!abstract] 一句话总结
> 在 agent 自主行动的关键节点插入人的审批/干预，并施加策略约束与审计：审批门、权限/策略 enforcement、签名审计轨迹。是把自主 agent 安全投入生产的刹车与方向盘。

## 它解决什么问题

完全自主的 agent 在高风险动作（付款、删除、对外发布）上不可控。HITL 与治理提供可控性、合规与可审计，平衡自主与安全（见 [[design-tradeoffs]] 的可控-自由轴）。

## 设计维度 / 实现谱系

- **干预点**：动作前审批 ↔ 关键节点暂停 ↔ 事后审查
- **机制**：中断-恢复（依赖 [[state-persistence]]）↔ 审批回调 ↔ 策略引擎
- **治理位置**：进程内 ↔ 进程外控制面（[[cordum|Cordum]] 的 pre-dispatch 策略 + 审批门 + 签名审计）
- **策略**：白/黑名单工具、权限范围、速率限制
- **审计**：结构化事件、不可篡改轨迹

## 关键要点

- HITL 在工程上常落地为：可中断的循环 + 持久化状态 + 审批回调。
- 进程外治理控制面是企业级生产的趋势（与具体框架解耦）。
- 治理是自主性光谱（见 [[what-is-an-agent]]）向生产落地的必经环节。

## 关联

- [[state-persistence]] · [[observability-eval]] · [[design-tradeoffs]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **41** 个实现了「人在环 / 治理」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 设计上 no approval loop（卖点：不打扰人）。可选治理层：Fleet Watcher——每技能跑前向自托管控制面问 ALLOW/BLOCK（fail-closed），跑后回报用于污点链分析；通知通道（Telegram/Discord/Slack）双向可让用户发指令；./onboard 校验配置 |
| [[ag2\|AG2]] | human_input_mode 取 ALWAYS/NEVER/TERMINATE；check_termination_and_human_reply 作为最先执行的 reply func 拦截并征询人类（默认经控制台 IOStream，get_human_input）；UserProxyAgent 是代表人类的预设 Agent；group/guardrails.py 与 safeguards/ 提供护栏 |
| [[agency-swarm\|Agency Swarm]] | 治理=SDK 的 input/output guardrails（tripwire 触发→raise_input_guardrail_error 决定抛错还是回灌引导文本，可重试 validation_attempts 次，execution_helpers.py:86）；通信流的有向授权本身即一种"谁能找谁"的访问控制。无内置 tool-approval 审批闸门 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | 多租户 + RBAC：MagicalAuth.py 做认证/OAuth/角色，endpoints/Roles.py；extension 自动派生 ext:<name>:read/execute/configure 权限作用域；CriticalEndpointProtectionMiddleware/middleware.py 端点保护；可经聊天渠道由人审批/介入。无内置逐工具调用审批 UI（待确认） |
| [[agentfield\|AgentField]] | 双重：①执行级 app.pause() 把执行转 "waiting"，注册 future 后等审批 webhook 回调或超时恢复，crash-safe 可持久（execute_pause.go/webhook_approval.go）；②访问治理 = 类 Okta IAM：tag-based ALLOW/DENY 访问策略（按 priority 降序求值）+ tag VC 校验 + 跨 agent 调用 Ed25519 签名 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | learn_from_feedback()/learn_from_traces() 让人提供纠错反馈或历史 trace 作为学习信号；Skillbook 可读(get_strategies)、可导出 markdown、可人工编辑后回载；CLAUDE.md 规定核心模块改动需人工批准。无运行时审批拦截 |
| [[agentscope\|AgentScope]] | 规则化 PermissionEngine：5 种 mode(DEFAULT/ACCEPT_EDITS/EXPLORE/BYPASS/DONT_ASK) × 4 种 behavior(ALLOW/DENY/ASK/PASSTHROUGH)，工具自报 is_read_only 与 check_permissions，危险路径/命令拦截；ASK→agent 产出 RequireUserConfirmEvent 暂停等外部确认，reply() 可喂回 UserConfirmResultEvent 续跑；外部执行经 RequireExternalExecutionEvent |
| [[agentset\|Agentset]] | 治理=多租户 + API key + 配额：withNamespaceApiHandler 校验 org/namespace 归属(handler/namespace.ts:50)，x-tenant-id 头解析租户(tenant.ts:6)，Stripe 计费/isFreePlan 限额、Webhook 通知；无 LLM 动作审批/打断式 HITL |
| [[agentverse\|AgentVerse]] | 大部分自动化运行无内建审批；human-in-the-loop 主要见于：① Pokemon demo 玩家可作为一个 agent 实时介入对话（README）；② task-solving Evaluator 有被注释掉的 human_eval 交互式打分分支（tasksolving_env/rules/base.py:148，默认走 LLM 评估）。无系统化治理/权限框架 |
| [[astron\|Astron Agent]] | workflow 的 question_answer 节点做人在环：中断工作流等待用户，靠 EventRegistry 注册中断事件，支持 resume / ignore / abort 三种恢复事件；治理侧有 core/common/audit_system（审计）+ tenant 服务（多租户/空间隔离/配额）+ Casdoor 鉴权 |
| [[autogen\|AutoGen]] | UserProxyAgent 把人类作为 agent 接入：on_messages 时调用可注入的 input_func(同步/异步均可)向人取输入，并发 UserInputRequestedEvent；group chat 中作为普通 participant 参与轮转；Handoff/HandoffTermination 可把控制权交回人 |
| [[botpress\|Botpress]] | 多重钩子做 guardrail：onExit 校验/拦截退出（如转账超额 throw）、onBeforeExecution 审查/改写生成代码（封禁危险操作）、onBeforeTool/onAfterTool 改 IO；Chat 模式 ListenExit 让位用户；平台侧有 HITL 插件（plugins/hitl） |
| [[connectonion\|ConnectOnion]] | tool_approval/shell_approval 插件在 before_each_tool 拦截危险操作请求审批(bashlex 解析命令)；ask_user 工具+agent.io 与前端交互；plan_mode 工具 |
| [[cordum\|Cordum]] | 核心重点。① Safety Kernel 返回 5 类裁决 ALLOW/DENY/REQUIRE_HUMAN/THROTTLE/ALLOW_WITH_CONSTRAINTS（safety_client.go:235），Scheduler 在 dispatch 前据此分流：REQUIRE_APPROVAL→置 JobStateApproval 阻塞等待人审（engine.go:1596）、DENY→入 DLQ（engine.go:1608）、THROTTLE→延迟重排（engine.go:1549）；② DENY-uncrossable 优先级（Global 不可被 Workflow 放宽）safetykernel/global_policy_tiers.go:92；③ 服务端 risk-tag 派生防客户端伪造低危标签（kernel.go:741）；④ Edge 审批生命周期 pending/approved/rejected/expired/invalidated（core/edge/approval.go）；⑤ ProvenanceGate：销毁性动作/requires_provenance 标签必须有已解析的审批记录+匹配审计事件，"approved by CFO" 之类纯文本声明一律 DENY（core/policy/actiongates/provenance_gate.go:68）；⑥ Velocity/速率治理 safetykernel/velocity.go；⑦ fail-open 旁路会发专门审计事件 engine.go:1580 |
| [[cortex-mem\|Cortex Memory]] | 多租户隔离(--tenant/X-Tenant-ID，tenant 后缀 collection)做数据边界；本地优先、零云依赖(MemClaw 主打隐私)。无审批/权限审查流 |
| [[crewai\|CrewAI]] | Task human_input=True：agent 出终答后请求人工反馈并据此再迭代；Flow 侧 human_feedback DSL 做流程级审批；before/after_kickoff 钩子 |
| [[dust\|Dust]] | 工具按 stake 等级（never_ask/low/high，front/lib/actions/constants.ts:40）决定是否需审批；需审批时 step 循环中断等待 validateAction 用户批准后恢复(launchAgentLoopWorkflow)；外加 RBAC、space/group 权限、publishing 限制、WorkOS 审计日志 |
| [[haystack\|Haystack]] | Agent 支持 confirmation_strategies：按 tool 名映射 ConfirmationStrategy，工具执行前可拦截要求用户确认（BlockingConfirmationStrategy 等），含 ConfirmationPolicy/ConfirmationUI 协议，支持 web 场景注入 request-scoped 上下文（WebSocket 等）；ToolExecutionDecision 记录决策 |
| [[hcom\|hcom]] | 人始终在环：每个 agent 跑在可见、可滚动、可打断的真实终端。安全命令白名单免审批、危险命令（stop/kill/run/reset）需显式批准（hooks/common.rs:51）。relay 跨设备为"全有或全无"信任域：enroll 即等于给该设备 shell 权限，无分级角色/只读 peer（README:147,165） |
| [[hermes-agent\|Hermes Agent]] | 危险命令审批：DANGEROUS_PATTERNS 检测→CLI 交互/gateway 异步提示→可选辅助 LLM 智能自动批低风险→永久 allowlist 落 config.yaml；HERMES_YOLO_MODE 导入期冻结防 prompt-injection 提权；clarify 工具向用户提问；gateway DM 配对/容器隔离 |
| [[hive\|Hive]] | HITL=节点 client_facing=True 暂停问人（开放问答/多选/是非/表单），状态存盘可挂起数天后恢复（新版收敛为仅 Queen 直面用户，见 edge.py:542 弃用告警）；hard/soft constraint 治理(违反 hard→escalate)；budget/cost 限额由 runtime 强制 |
| [[langchain\|LangChain]] | HumanInTheLoopMiddleware 用 langgraph interrupt() 在工具执行前暂停征求批准/编辑/拒绝（InterruptOnConfig）；create_agent(interrupt_before/after=...) 节点级中断；ShellToolMiddleware 带 Docker/Codex 沙箱执行策略；PII 中间件 |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 治理核心=Llama Guard Shields：input_shields/output_shields 在推理前后做安全过滤(ShieldCallStep)，含 code/cybersec shield 拦截工具调用代码；client.shields.list() 发现。无审批/打断式 HITL，但有人工反馈("Ingest into Memory Bank"点赞写回) |
| [[llamaindex\|LlamaIndex]] | 经 Workflow 的 InputRequiredEvent/HumanResponseEvent：工具内 ctx.write_event_to_stream(InputRequiredEvent) 暂停并 wait_for_event(HumanResponseEvent) 等人工输入再继续；无内置审批/权限沙箱，工具默认本进程执行 |
| [[llm-agents\|llm-agents]] | 唯一"人在环"是 run_agent.py 启动时 input() 收集一次问题；无审批/拦截/危险操作治理——PythonREPL 直接 exec() 任意代码，无沙箱（安全风险） |
| [[loongflow\|LoongFlow]] | 主要是 中断治理 而非审批：AgentBase.interrupt() 取消 asyncio task，PESAgent 经 _stop_event 优雅停机并终止全部评测子进程（SIGTERM→SIGKILL，evaluator.py:427）；ReAct 可注册自定义 interrupt 处理器（react_agent.py:184）；ClaudeCodeAgent 有 permission_mode（prompt/acceptEdits/acceptAll）但默认自动接受；无内置工具审批/危险命令拦截层 |
| [[maestro\|Maestro]] | 仅启动时 CLI 交互（目标/是否加文件/是否搜索）；运行中全自动，无审批/中断/护栏；写文件无确认 |
| [[mastra\|Mastra]] | suspend/resume：workflow step 与 tool 均可声明 suspendSchema/resumeSchema，执行中 suspend() 暂停并把状态落 storage，之后 resume() 携用户输入恢复（可无限期暂停）；requireToolApproval 工具审批；DurableAgent 把整次 agent 运行包成可持久/可恢复的 workflow |
| [[metagpt\|MetaGPT]] | HumanProvider 把 is_human=True 的角色 LLM 调用替换成 input() 终端交互；Planner.ask_review（非 auto_run 时）让人审核/改计划；ActionNode.human_review 人工评审结构化产物；RoleZero.ask_human/reply_to_human 工具经 env.ask_human 向人提问 |
| [[nanobot\|nanobot]] | ask_user 工具（支持 choices）向渠道发问；DM 发送者 pairing 审批（每渠道持久配对码，pairing/store.py）；渠道 allow-list / 安全默认拒绝；SSRF 硬边界（私网 URL 不可绕过，runner.py:1043）；shell allow-list；/stop 中途取消 turn 并保留部分上下文 |
| [[open-multi-agent\|Open Multi-Agent]] | onPlanReady(tasks) 在任何 agent 执行前审批整份计划(返 false 中止)；onApproval(completed,next) 在每轮任务之间审批；planOnly 只看不跑；AbortSignal 运行中取消；beforeRun/afterRun 钩子改写 prompt / 后处理结果；maxTokenBudget 硬性封顶花费 |
| [[openclaw\|OpenClaw]] | DM pairing：未知发信人默认收到配对码、消息不被处理，openclaw pairing approve 后加入 allowlist（dmPolicy/allowFrom）；沙箱：agents.defaults.sandbox.mode:"non-main" 让非 main 会话跑在 Docker/SSH/OpenShell 沙箱，默认 deny browser/canvas/nodes/cron/discord/gateway；beforeToolCall 钩子+ACP approval-classifier 对危险工具审批；openclaw doctor 体检风险配置 |
| [[pilotprotocol\|Pilot Protocol]] | 互信即治理：节点默认私有，必须双向 handshake 才能被解析/连接（"no mutual trust"会拒绝 find）；--trust-auto-approve 可自动批准（demo 用），否则人工 pilotctl trust 审批；policy 插件用 expr-lang 表达式对 connect/dial/datagram/join/leave 等事件做策略判定 |
| [[pipecat\|Pipecat]] | 实时交互而非审批治理：打断/barge-in——InterruptionFrame（携 asyncio.Event，到 sink 时 set）由用户轮次开始策略触发；轮次管理——UserTurnStrategies（start: VAD+转写; stop）判定用户起止说话；RTVIProcessor 作为客户端↔管道协议桥接收文本/音频/函数结果 |
| [[praisonai\|PraisonAI]] | @require_approval(risk_level=...) 标记高危工具→执行前 request_approval 走审批后端(console/自定义 callback)；Guardrails(LLMGuardrail 或函数式)对输入/输出做校验+重试；Policy Engine 声明式行为控制；doom-loop 检测自动恢复 |
| [[semantic-kernel\|Semantic Kernel]] | ① IAutoFunctionInvocationFilter 在工具自动调用前后拦截，可设 context.Terminate=true 中止循环、把结果交还用户审批(FunctionCallsProcessor.cs:205/225/366 消费)；② 编排层 OrchestrationInteractiveCallback / GroupChatManager ShouldRequestUserInput 请求人工输入；③ FunctionChoiceBehavior.None 让模型只建议不执行 |
| [[strands\|Strands Agents]] | Interrupt/InterruptException 暂停 agent 等人类输入，经 session 持久化后 resume(agent.py:878)；AfterInvocationEvent.resume 钩子可注入新输入续跑；experimental/steering 提供 LLM/ledger 引导；guardrail 触发 redactContent 自动脱敏(agent.py:1310) |
| [[swarmclaw\|SwarmClaw]] | 审批门：requestApproval/submitDecision，危险工具走 durable_wait 终端边界挂起等人审，审批后 wake 续跑；E-Stop 急停（estop）；learned-skill 上线需人工审查；capability/tool 策略与权限预设（OpenClaw permission-presets）；mission budget 上限（USD/token/turn/wallclock） |
| [[swarms\|Swarms]] | interactive=True 进入 REPL，每轮经 formatter.console.input 收用户输入（agent.py:1871）；AgentRearrange flow DSL 支持插入 -> H -> 人审步骤 + custom_human_in_the_loop 回调；无细粒度工具审批/沙箱 |
| [[upsonic\|Upsonic]] | HITL 经异常驱动暂停/恢复：ConfirmationPause/UserInputPause/ExternalExecutionPause(tools/hitl.py:92,100,108)，由 ToolConfig.requires_confirmation 等触发，agent.continue_run()(agent.py:4946) 恢复；治理经 safety engine 策略(user/agent/tool_pre/tool_post policy + feedback loop) + PII 匿名化 |
| [[voltagent\|VoltAgent]] | 两条线：①Guardrails(input/output 方向，可设 severity/action 拦截校验 IO)；②工具 needsApproval + Workflow suspend()/resume()(带 resumeSchema) 做审批挂起恢复（README 报销审批示例） |
