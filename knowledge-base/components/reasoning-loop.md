---
title: "推理循环"
aliases:
  - Reasoning Loop
  - Agent Loop
  - 主循环
tags:
  - knowledge-base
  - domain/agent-components
  - component/reasoning-loop
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 推理循环

> [!abstract] 一句话总结
> agent 的"主循环"：反复执行"模型决策 → 执行动作 → 观察结果 → 更新状态"，直到完成或停止。它是承载 [[agent-loop-paradigms|范式]]（ReAct / plan-execute / graph…）的执行骨架，也是其他所有组件的挂载点。

## 它解决什么问题

让模型能**多步自主行动**，而不是一问一答。循环决定了：谁来决定下一步（模型 or 代码）、何时停止、出错怎么办、上下文如何在步间流动。

## 设计维度 / 实现谱系

- **控制权**：模型驱动（ReAct/CodeAct）↔ 框架驱动（状态机/图）
- **停止条件**：模型自报完成 / 最大步数 / 工具返回终态 / 外部中断
- **错误处理**：异常回灌给模型自我修正 vs 框架捕获重试 vs 直接失败
- **循环形态**：while 循环（命令式）vs 图遍历（声明式）vs 事件驱动（流式/语音）
- **步间状态**：消息列表追加 vs 显式 state 对象 vs 黑板

## 关键要点

- 循环是 agent 的"心跳"；范式只是循环的不同组织。
- 流式/语音 agent（[[pipecat\|Pipecat]]）的循环是事件驱动的，与请求-响应式不同。
- 图式循环（LangGraph/[[mastra\|Mastra]]）天然支持断点续跑，见 [[state-persistence]]。

## 关联

- [[agent-loop-paradigms]] · [[planning]] · [[context-engineering]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **44** 个实现了「推理循环」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[ag2\|AG2]] | 非固定 ReAct：每个 Agent 持有有序 reply-func 列表，generate_reply() 依次尝试，首个 final=True 即返回。默认顺序（后注册先执行/LIFO insert）：终止&人类输入 → 工具调用 → 代码执行 → LLM(oai) 回复。多轮由 send/receive 互发消息驱动 |
| [[agency-swarm\|Agency Swarm]] | 不自实现；完全委托给 OpenAI Agents SDK 的 Runner.run / run_streamed（ReAct 式 tool-calling loop，跑在 Responses API 上）。框架只在外层包一层 setup→run→保存 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | 自定义 XML 标签 ReAct+反思：LLM 输出 <thinking>/<reflection>/<execute><name>…</name></execute>/<answer>，平台正则解析 <execute> 块→执行→把 <output> 回灌再次推理，直到出现完整 <answer>；非纯原生 function-calling |
| [[agentdock\|AgentDock]] | 非显式 ReAct 循环；委托给 Vercel AI SDK streamText 的 multi-step tool calling：AgentNode.handleMessage 备好工具与 prompt 后调 LLMOrchestrationService.streamWithOrchestration→CoreLLM.streamText，由 SDK 在 maxSteps(默认5) 内自动跑"LLM→tool→回灌→再 LLM"。每个 step 经 onStepFinish 回调追踪已用工具 |
| [[agentfield\|AgentField]] | 框架本身不强制 ReAct 内循环；单次推理是 app.ai() 一发 LLM 调用。当传 tools= 时进入 discover→call 工具循环（execute_tool_call_loop，默认 max_tool_calls=25）；更"自治"的多轮循环交给外部 harness（Claude Code/Codex 等）。控制平面则把多步建成 workflow DAG |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 非传统 ReAct；核心是"执行→评估→反思→策展"学习闭环，组合为不可变 Pipeline 顺序执行。Agent 角色本身是一次结构化 LLM 调用（run_sync）；RR/SkillManager 是带递归+预算的 agentic 循环（RecursiveAgent） |
| [[agentscope\|AgentScope]] | 纯异步 ReAct：while cur_iter < max_iters(默认20) 循环，每轮 _check_next_action 判定 reasoning/acting/exit→_reasoning 调模型生成 text/thinking/tool_call→_batch_tool_calls 把工具分 sequential/concurrent 批执行→结果回灌；无 tool_call 即产出最终 Msg 退出 |
| [[agentset\|Agentset]] | agentic RAG 循环（非 ReAct）：for i in maxEvals → generateQueries(LLM 产出 keyword/semantic 查询) → 并行查库 → evaluateQueries 让 LLM 判 canAnswer → 可答或超 tokenBudget 则停，再用聚合 chunks 流式作答 |
| [[agentverse\|AgentVerse]] | 非 ReAct 单 agent 循环，而是环境回合制：simulation 每个 step() 走 order→describer→agents 并发 astep→selector→updater→visibility（basic.py:57）；task-solving 每轮走 role_assign→decision_making→execute→evaluate（basic.py:45）。单 agent 内 ConversationAgent.astep 只是"填模板→LLM→parse→出 Message"带 max_retry 重试，无自循环 |
| [[ailoy\|Ailoy]] | ReAct 式 loop：流式调 LM 累积 delta → 若 assistant 消息含 tool_calls 则逐个执行并把结果作为 Role::Tool 消息回灌 → 否则 break；提供 run(聚合) 与 run_delta(流式) 两个入口 |
| [[astron\|Astron Agent]] | ReAct 式 CoT：非原生 function-calling，而是 prompt 约定 Thought/Action/Action Input/Observation/Final Answer 文本格式，while max_loop>loop_count 循环：流式读 LLM→字符串切分解析出 action→执行 plugin→把 Observation 写回 scratchpad→重灌再问 |
| [[autogen\|AutoGen]] | 双层：①底层是 actor 事件循环（runtime 投递消息→@message_handler 分发）；②AssistantAgent 提供 ReAct 式工具循环：LLM→若返回 FunctionCall 则执行→结果回灌→再次推理，受 max_tool_iterations(默认 1)约束；末轮可 reflect_on_tool_use 再推理或直接 summarize |
| [[botpress\|Botpress]] | code-first 而非 ReAct-JSON：while(true) 循环，每轮让 LLM 生成 TS 代码→编译→沙箱执行；命中 Exit 则成功返回，thinking/error/invalid-code 则 continue 重试，超 loop 上限抛 LoopExceededError。Chat 模式下 ListenExit=让位用户 |
| [[connectonion\|ConnectOnion]] | ReAct 式 while 循环：LLM→若有 tool_calls 则执行→把结果回灌→重复，直到无 tool_call 或达 max_iterations(默认 100)；可经 stop_signal 中途让位用户 |
| [[crewai\|CrewAI]] | 双模 agent loop：LLM 支持 native function calling 则走结构化 tool_calls 回灌循环，否则回退 ReAct 文本模式（解析 Action/Action Input）；均循环至 AgentFinish 或 max_iter |
| [[dust\|Dust]] | step 式 multi-actions 循环（非经典 ReAct 文本）：Temporal 工作流逐步执行"调模型选动作 → 执行工具 → 回灌"，每步一次 LLM 调用，最多 MAX_STEPS_USE_PER_RUN_LIMIT 步；core 侧另有块式 App 顺序执行引擎 |
| [[haystack\|Haystack]] | 两层：①Pipeline 层=声明式 DAG，引擎按拓扑序+优先级队列驱动 component（非 LLM 推理，是数据流编排），支持环/分支；②Agent 层=ReAct 式 while counter < max_agent_steps 循环：ChatGenerator→若 replies 含 tool_call 则 ToolInvoker 执行→回灌 messages→重复，直到无 tool_call 或命中 exit_condition |
| [[hermes-agent\|Hermes Agent]] | ReAct 式 while 循环：调模型→若有 tool_calls 则执行(可并发)→回灌结果→重复，直到无 tool_call 或耗尽 max_iterations(默认 90) / IterationBudget；逐 provider 处理 finish_reason(stop/length/incomplete)、失败 failover、partial-stream 续写 |
| [[hive\|Hive]] | graph-of-event_loops：唯一节点类型 event_loop 是多轮 streaming LLM 循环（reason→tool→observe→judge），节点内 reflexion 自纠（accept/retry/escalate）；Orchestrator 沿边遍历图直到终止或耗尽 max_steps |
| [[lagent\|Lagent]] | 多种范式并存：基础 Agent 是单次 LLM 调用；ReAct 用 for _ in range(max_turn) 循环 select_agent→检查 finish_condition→执行 actions(默认 max_turn=5)；AgentForInternLM/MathCoder 是 InternLM 原生工具循环；FunctionCallAgent 是 select/env 双 agent 的 while 循环 |
| [[langchain\|LangChain]] | 经典 ReAct 式工具循环，但物化为 LangGraph 状态图：model 节点调 LLM→条件边 _make_model_to_tools_edge 看末条 AIMessage 有无 tool_calls，有则 Send("tools", ...) 执行、回灌、循环，无则走 exit；递归上限 9999 |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 服务端 Agentic Loop：一个 Turn 内 Executor 串 Shield→Inference→(Tool+Inference 循环)→Shield→输出；客户端经 create_turn 触发，AgentEventLogger 流式回放 inference/shield/tool_execution 步骤。另有 ReActAgent 提供 ReAct 范式(JSON schema 约束输出) |
| [[llamaindex\|LlamaIndex]] | Workflow 事件状态机：init_run→setup_agent→run_agent_step(调 take_step)→parse_agent_output→call_tool→aggregate_tool_results→回 AgentInput 循环。FunctionAgent 用原生 function calling，ReActAgent 用 Thought/Action/Observation 文本协议解析 |
| [[llm-agents\|llm-agents]] | 经典文本式 ReAct：run() 里 while num_loops < max_loops(默认15) 循环——把累积的 previous_responses 填回 prompt → LLM 生成 Thought+Action → 正则解析出工具 → 执行 → 把 Observation: <result> 拼回去；命中 Final Answer: 即返回 |
| [[loongflow\|LoongFlow]] | 两套范式：① PES 进化循环——并发多 cycle，每 cycle 串行 Plan→Execute→Summary，按 target_score / max_iterations 收敛；② ReAct 循环——while(step<max_steps) 做 Reason→Act→(Finalize 检查)→Observe，达 finalizer 工具或步数耗尽退出 |
| [[maestro\|Maestro]] | 非 ReAct；是 supervisor 式 orchestrate-execute-refine 循环：while True 反复调 orchestrator 拆出"下一个子任务"→交 sub-agent 执行→结果回灌，直到 orchestrator 输出含 "The task is complete:" 才 break；无工具调用环节 |
| [[mastra\|Mastra]] | 自主工具循环，但用 workflow 引擎实现：一次运行编译成 agentic-loop，靠 .dowhile(agenticExecution, …) 反复执行 LLM 调用→工具调用步骤，直到 stepResult.isContinued 为 false；停止条件由 stopWhen（StopCondition 数组，如 step 计数）与 maxSteps 控制，每轮触发 onIterationComplete 钩子可注入反馈/继续/中止 |
| [[metagpt\|MetaGPT]] | 经典 Role 是 _observe→_think→_act 状态机循环：react() 按 react_mode 分派；REACT 模式下 _think 用 LLM 选下一个 Action（STATE_TEMPLATE 让 LLM 回答状态编号），_react 在 max_react_loop 内 think-act 交替。新 RoleZero 是工具化 ReAct：LLM 直接输出命令列表→解析→执行→回灌 |
| [[modus\|Modus]] | 框架不内置 ReAct/计划循环；范式是"函数即端点 + actor 化 agent 的消息处理"。Agent 靠 OnReceiveMessage(msgName, data) 的 switch 分发处理消息(类 actor 收信)，多步推理需用户在函数内自行编排 model+tool 调用 |
| [[nanobot\|nanobot]] | single-agent 工具循环：turn 建模为显式状态机（RESTORE→…→RESPOND→DONE），内层 AgentRunner._run_core 按 max_iterations（默认见 AgentDefaults）迭代：请求模型→若 should_execute_tools 则执行工具回灌→否则收敛为最终回复；含空回复/截断/注入恢复 |
| [[open-multi-agent\|Open Multi-Agent]] | worker 层为 ReAct 式 while(true)：LLM→提取 tool_use→并行执行工具→回灌 tool_result→循环，直到无 tool_call 或达 maxTurns(默认 10)；团队层为 plan-execute：coordinator 一次拆解 → 队列分轮并行执行 → coordinator 合成 |
| [[openclaw\|OpenClaw]] | ReAct 式双层 while 循环：内层 LLM→若有 toolCall 则执行(顺序/并行)→结果回灌→重复；外层处理 steering（运行中插话）与 follow-up 消息；stopReason/shouldStopAfterTurn/terminate 决定终止 |
| [[pipecat\|Pipecat]] | 非 ReAct；范式是 frame-based 流式管道：Frame 沿 processor 链单向流动，每个 FrameProcessor.process_frame() 处理后 push_frame() 给下游；推理本身委托给 LLM service（function-calling 多轮由 run_function_calls 把结果回灌进 LLMContext 再触发下一轮 inference） |
| [[praisonai\|PraisonAI]] | 函数调用式 ReAct：_chat_completion 取 LLM 响应→若有 tool_calls 则执行并回灌→无 tool_call 后进入自我反思 while 循环（先答、再让 LLM 输出 {reflection, satisfactory} JSON、不满意则"按反思重写"再循环）；满足 min_reflect 且 satisfactory=yes，或达 max_reflect 才返回 |
| [[semantic-kernel\|Semantic Kernel]] | 非显式 ReAct；核心是 native function-calling 自动循环：模型返回 FunctionCallContent→FunctionCallsProcessor 查表执行→结果回灌 ChatHistory→再次请求模型，直到无工具调用或达上限。Agent 层把每轮新增的 tool/assistant 消息回写线程 |
| [[smolagents\|smolagents]] | ReAct 多步循环：while not final and step<=max_steps，每步 think→act→observe；CodeAct 变体下 act=执行 Python 代码。子类只实现 _step_stream |
| [[strands\|Strands Agents]] | model-driven 自驱循环：调模型→stop_reason=="tool_use" 则执行工具→结果回灌→递归重开，无 planner/状态机，全靠模型决策；max_tokens 默认硬失败 |
| [[swarm\|Swarm]] | ReAct 式工具循环；while 直到无 tool_call 或 max_turns |
| [[swarmclaw\|SwarmClaw]] | LangGraph createReactAgent + MemorySaver 跑单回合 ReAct（streamEvents v2 流式），外层自研 for 迭代循环做"续跑/早停/工具频控/idle watchdog"，受 recursionLimit 约束 |
| [[swarms\|Swarms]] | ReAct 式 while 循环：call_llm→parse_llm_output→若有 tool_calls 则 execute_tools 回灌→重复，直到无 tool_call 或 loop_count >= max_loops；max_loops="auto" 时无上限直到自决完成 |
| [[transformers-agents\|Transformers Agents]] | ReAct（ReactCodeAgent / ReactJsonAgent）；早期为单步 plan-then-run |
| [[upsonic\|Upsonic]] | 非单一 while 循环，而是 24 步显式 pipeline；LLM↔工具的迭代发生在 model-execution 步内（CallManager 驱动 process_response，达 tool_call_limit(默认100) 停止）；带 streaming 平行管线 |
| [[vectara-agentic\|vectara-agentic]] | 不自研循环，复用 LlamaIndex 的 workflow agent：AgentType.FUNCTION_CALLING（原生 function calling，默认）或 REACT（Thought/Action/Observation 文本协议）。achat() 经 current_agent.run(user_msg, memory, ctx) 驱动 workflow，循环由 LlamaIndex FunctionAgent/ReActAgent 内部完成 |
| [[voltagent\|VoltAgent]] | 不自造循环：委托 Vercel AI SDK 的多步工具循环，stopWhen: stepCountIs(maxSteps) 控制步数（默认 maxSteps=5，启用 workspace 时=100）；每步 onStepFinish 回灌并写 trace。提供 generateText/streamText/generateObject/streamObject 四种入口 |
