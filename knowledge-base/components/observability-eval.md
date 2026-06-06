---
title: "可观测与评估"
aliases:
  - Observability
  - Tracing
  - Evaluation
tags:
  - knowledge-base
  - domain/agent-components
  - component/observability-eval
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 可观测与评估

> [!abstract] 一句话总结
> 看见 agent 内部发生了什么（tracing、日志、token/成本），并衡量它做得好不好（eval）。Agent 行为不确定，可观测与评估是把它从 demo 推向生产的必备工程能力。

## 它解决什么问题

agent 的多步、调工具、非确定性使其难以调试和信任。tracing 让你回放每一步；eval 让你量化质量、防止回归。

## 设计维度 / 实现谱系

- **Tracing**：内置 ↔ 集成 OpenTelemetry/第三方（[[voltagent|VoltAgent]] 内建 observability）
- **指标**：token、成本、延迟、步数、成功率
- **日志/回放**：结构化事件、时间旅行调试
- **评估**：人工 ↔ 规则 ↔ LLM-as-judge ↔ 数据集回归
- **闭环**：评估结果是否反哺改进（[[agentic-context-engine|ACE]] 从反馈学习）

## 关键要点

- 可观测优先级常被低估，却是生产 agent 的成败关键。
- LLM-as-judge 是主流 eval 手段，但需校准。
- 评估闭环（eval 到改进）通向自改进 agent。

## 关联

- [[runtime-execution]] · [[human-in-the-loop-governance]] · [[design-tradeoffs]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **49** 个实现了「可观测 / 评估」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 每次成功运行后 Haiku 自动打 1-5 分（失败/空=1，优秀=5），写 memory/skill-health/{skill}.json（滚动 30 次 + avg）；token 用量记 token-usage.csv；cron-state.json 存成功率/连败数；skill-evals 断言测试；scripts/skill-runs 审计 Actions 运行 |
| [[ag2\|AG2]] | runtime_logging 全局开关，BaseLogger 抽象 + SqliteLogger/FileLogger 后端记录 chat/LLM 调用/成本/工具事件；gather_usage_summary 汇总 token/cost；内建 OpenTelemetry instrumentation（agent/llm/pattern span）；contrib/agent_eval 做评估 |
| [[agency-swarm\|Agency Swarm]] | 复用 SDK 内建 tracing（OpenAI Traces 自动），并通过 with trace(...) 接入 Langfuse / AgentOps（examples/observability.py）；自动累计 token/cost（sub-agent raw_responses 按模型回填到父 result，execution.py:252）；可视化 agency.visualize() 输出结构图 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | 全程把活动写入 conversation 日志（[ACTIVITY]/[SUBACTIVITY] 标记，含命令执行成功/失败）；webhook 事件 command.execution.started/failed（Extensions.py:1078）；UsageTrackingMiddleware 记 token/用量；评估类 chain（Smart Instruct）做自反思。无独立 eval harness（待确认） |
| [[agentdock\|AgentDock]] | 内置 Evaluation Framework：runEvaluation runner + 多评估器（RuleBased/LLMJudge/NLPAccuracy/ToolUsage/LexicalSimilarity/KeywordCoverage/Sentiment/Toxicity），结果落 JsonFileStorage；结构化分类日志 logger(LogCategory)；token 用量经 onFinish 累积进 orchestration 状态（cumulativeTokenUsage） |
| [[agentfield\|AgentField]] | 自动 workflow DAG 可视化（GET /api/v1/workflows/{id}/dag）；Prometheus /metrics（discovery 等用 promauto 埋点）；结构化 JSON 日志；执行时间线；/health+/ready(K8s)；app.note() 写审计日志。形式化 eval N/A（靠 VC 审计而非 eval 框架） |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 本框架重点。EvaluateStep+TaskEnvironment 产出反馈/对错信号；自带 tau2-bench 等基准(benchmarks/)；可观测：ObservabilityStep、Logfire 自动插桩 PydanticAI(logfire extra)、kayba-tracing SDK(configure/trace/start_span)、每条 skill 的 helpful/harmful/used 计数即效用度量 |
| [[agentscope\|AgentScope]] | 一等公民 OpenTelemetry：TracingMiddleware(middleware/_tracing/) 为 agent/llm/tool 各层开 span，依赖 opentelemetry-sdk + OTLP exporter(pyproject 强依赖)；事件流本身即细粒度可观测；app/ 服务侧带 OTel。README 提 "built-in evaluation"，但本仓 src/agentscope 下未见独立 eval 包(评估在 docs/examples 层) |
| [[agentset\|Agentset]] | 检索流程经 stream 实时回传状态(data-status: generating-queries/searching/generating-answer，agentic/index.ts:61)与日志(logs)；用量计入 Postgres(chat/route.ts:33)；服务端事件分析(logServerEvent)；Tinybird 存 webhook 事件；README 列 evaluation/benchmarks 为平台特性 |
| [[agentverse\|AgentVerse]] | ① 单例 Logger（仿 Auto-GPT 风格，彩色 + logs/activity.log/error.log + typewriter 效果，logging.py:32）；② 每个 agent 经 get_spend() 统计美元花费，环境 report_metrics() 汇总（environments/base.py:50）；③ task-solving Evaluator 规则给 plan 打分（score≥8 阈值即 accept，tasksolving_env/basic.py:95），agentverse-benchmark 在数据集上批量评测 |
| [[astron\|Astron Agent]] | 全链路 OpenTelemetry：common/otlp，每步 span.start(...) + add_info_events，结构化 NodeLog/NodeTraceLog/Usage（token 计数）逐节点落 trace；接入 DeepWiki 徽章。无内置自动化 eval 框架（评估口径 待确认） |
| [[autogen\|AutoGen]] | runtime 内建 OpenTelemetry tracing（TraceHelper，可经 tracer_provider 注入，AUTOGEN_DISABLE_RUNTIME_TRACING 关闭）；结构化事件流（每步 ToolCallRequestEvent/ThoughtEvent 等）+ EVENT_LOGGER_NAME/TRACE_LOGGER_NAME 日志；评估工具 AGBench(python/packages/agbench) |
| [[botpress\|Botpress]] | onTrace 非阻塞钩子接收每条 trace（llm_call_started、工具调用、错误、输出）；packages/llmz/src/types.ts 定义 Trace 类型；Cognitive 有 request/response interceptors 可埋点；测试用 Vitest+LLM 重试+快照序列化器 |
| [[connectonion\|ConnectOnion]] | 每步写 current_session['trace']；Logger 三路输出(终端 Rich + .co/logs/{name}.log 纯文本 + .co/evals/.yaml 会话)，含 token/cost；eval 插件做评估；@xray+auto_debug() 交互式断点调试 |
| [[cordum\|Cordum]] | 重点。① 防篡改审计：HMAC-SHA256 签名的 per-tenant 哈希链（Redis Stream + CAS Lua）core/audit/chain.go:265，链校验 chain_verify.go；② SIEM 导出（webhook/syslog/Datadog/CloudWatch/SOC2）core/audit/exporter.go:283；③ DecisionLog 记录每次策略裁决 scheduler/decision_log_adapter.go；④ OTel metrics/trace core/infra/otel/；⑤ Policy Simulator 拿历史数据预演规则（kernel.go:623 Simulate）+ shadow eval safetykernel/shadow_eval.go |
| [[cortex-mem\|Cortex Memory]] | tracing 结构化日志(logging.rs)；REST /health+/health/ready 健康检查；stats 统计与 UpdateStats/CacheStats(skip_rate/cache_hit_rate)；Svelte 仪表盘(insights) 可视化；LoCoMo10 基准脚本 examples/locomo-evaluation |
| [[crewai\|CrewAI]] | 内置事件总线 crewai_event_bus(LLM/Tool/Agent/Memory 全生命周期事件) + OpenTelemetry 匿名遥测(可 OTEL_SDK_DISABLED 关)；Task guardrail / task_evaluator 做输出评估 |
| [[dust\|Dust]] | 多层：Langfuse LLM trace（@langfuse/tracing + front/lib/api/llm/traces/）、OpenTelemetry（Temporal 工作流拦截器 + core/src/open_telemetry.rs）、产品级 observability 指标（tool/skill/datasource 用量与延迟，含 Elasticsearch 分析）、用户 feedback |
| [[e2b\|E2B]] | 沙箱级遥测而非 agent 评估：getMetrics() 取 CPU/内存/磁盘，控制面 /sandboxes/{id}/logs、/metrics 端点；RPC 可挂 createRpcLogger 记录通信 |
| [[haystack\|Haystack]] | Tracing：Tracer/Span 抽象，自动接 OpenTelemetry/Datadog，auto_enable_tracing()（__init__.py 启动时调用），含 LoggingTracer；内容级 trace 由 env 开关；Eval：components/evaluators/（faithfulness/context_relevance/SAS/MRR/NDCG/recall/LLMEvaluator…）+ EvaluationRunResult 出报表 |
| [[hcom\|hcom]] | hcom TUI（ratatui）看板看全部 agent；hcom list 列活跃 agent；hcom term [name] 看/注入某 agent 实时 PTY 屏幕（经 TCP inject 端口 + vt100 解析，commands/term.rs:1, :35）；hcom transcript 读对方结构化转录；hcom events --wait 阻塞直到匹配（脚本化）；hcom status 诊断 |
| [[hermes-agent\|Hermes Agent]] | session_search 工具对 SQLite FTS5 全文索引做跨会话召回(discovery/scroll/browse 三模式，零 LLM 成本)；hermes logs --session <id> 按 session 过滤(set_session_context)；/usage·/insights 看 token/成本；batch_runner.py+trajectory_compressor.py 产训练轨迹 |
| [[hive\|Hive]] | DecisionTracker 记录每个决策(尝试什么/选了什么/结果)＝进化的原料；runtime_logger/runtime_log_store 结构化日志；EventBus 事件流给 dashboard；judge 评估节点输出对照 success_criteria；HoneyComb 外部观察台 |
| [[lagent\|Lagent]] | MessageLogger hook 给每条 AgentMessage 按 sender 着色打印到日志（可选文件 handler）；get_steps() 把工具循环展开成 thought/tool/environment 轨迹。无内建 token/cost 统计与评估框架 |
| [[langchain\|LangChain]] | core 内建 callbacks + tracers 体系（core/.../tracers/）；每个 middleware 钩子用 @traceable 包成 LangSmith span（factory.py:910,1019）并 _scrub_inputs 脱敏（factory.py:140）；评估/监控由外部 LangSmith 平台承担（README） |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 可观测=AgentEventLogger/EventLogger 流式打印每步(shield_call/inference/tool_execution)，turn.steps 可遍历 step_type；评估=llama-stack-client eval run_scoring CLI + agent_store/eval/bulk_generate.py 批量跑数据集生成答案再打分 |
| [[llamaindex\|LlamaIndex]] | 独立 llama-index-instrumentation 包：Dispatcher 发 span/event，@dispatcher.span 装饰、add_event_handler/add_span_handler 挂钩(对接 Arize/Langfuse 等)；agent 每步 write_event_to_stream 暴露 AgentStream/ToolCall 等事件；core/evaluation/ 提供 faithfulness/relevancy 等 RAG 评估器 |
| [[llm-agents\|llm-agents]] | 仅靠 print()：开头打印渲染后的 prompt、每轮打印 generated+Observation（agent.py:66,77）；无结构化 trace、无 token/cost 统计、无 eval 框架。tests/ 目录仅含 setup 校验与空 unit/integration 包 |
| [[loongflow\|LoongFlow]] | ① 全程 get_logger 结构化日志 + Rich 美化 message 打印（message_logger.py），每步打 trace_id；② 逐 cycle 统计 prompt/completion token 与成本（pes_agent.py:294）；③ Evaluator 是一等公民：把候选代码写文件、在独立子进程带 timeout 执行用户 evaluate() 拿 score/metrics/summary；④ math_agent 自带 visualizer 看进化树/岛分布 |
| [[maestro\|Maestro]] | 用 rich Console/Panel 彩色打印每步过程；逐次打印 input/output token 与按 calculate_subagent_cost() 估算的美元成本；全程交换日志写入时间戳 .md。无评估框架 |
| [[mastra\|Mastra]] | AI tracing：SpanType 枚举（AGENT_RUN/WORKFLOW_RUN/MODEL_GENERATION/TOOL_CALL/MEMORY_OPERATION/RAG_ 等）构成结构化 span 树，经 Observability 入口（@mastra/observability，含 storage/platform/OTel exporter）导出；evals/scorers：@mastra/evals + evals/scoreTraces 对 trace 打分；logger/ 分级日志 |
| [[metagpt\|MetaGPT]] | CostManager 在每次 LLM 调用后累计 token/成本（_update_costs），Team.invest 设预算超支抛 NoMoneyException；loguru 全局日志（metagpt/logs.py）；exp_pool（经验池）用 @exp_cache 装饰器缓存+打分（SimpleScorer/LLM judge）历史经验供复用 |
| [[modus\|Modus]] | console 包做结构化日志(debug/info/warn/error，经 host function 上报)；agent 经 PublishEvent 发事件→GoAkt topic actor→GraphQL Subscription 经 SSE(text/event-stream) 推送；集成 Sentry span 做分布式追踪。无内置 eval 框架 |
| [[nanobot\|nanobot]] | 全程 loguru 结构化日志（含 turn 状态机 trace StateTraceEntry、tool 事件、token usage）；运行时事件总线 RuntimeEventBus 推送给 WebUI（model/状态/延迟）；可选 Langfuse tracing（设 LANGFUSE_SECRET_KEY 自动包裹 OpenAI 客户端）与 LangSmith；无内置评估框架（pytest 测试套件） |
| [[open-multi-agent\|Open Multi-Agent]] | onProgress 结构化事件(task_start/complete/retry/skipped/budget_exceeded…) + onTrace span(llm_call/tool_call/task/agent/plan_ready/agent_stream) + 跑后 renderTeamRunDashboard() 生成纯 HTML 任务 DAG 仪表盘；密钥/token 经 redaction.ts 自动脱敏。无内置 eval 框架 |
| [[openclaw\|OpenClaw]] | agent loop 发射结构化事件流（agent_start/turn_start/message_/tool_execution_/turn_end/agent_end）供 UI/日志消费；每条消息带 usage(token+cost)；/usage、/trace on、/verbose chat 命令；cron run-log（JSONL）记录每次定时运行；trajectory/transcripts 子系统留存轨迹；qa/ 下有 e2e 与 QA lab extension |
| [[pilotprotocol\|Pilot Protocol]] | 结构化 JSON 日志走 slog；pilotctl info/--json 暴露地址/对端/连接/uptime 等快照；Polo 公共 dashboard 展示全网节点/请求统计；1048 个测试（含大量拥塞控制/SACK/重放回归用例 zz__bug_test.go） |
| [[pipecat\|Pipecat]] | BaseObserver 旁路监听 frame 流（on_process_frame/on_push_frame），不改管道；内置 turn/latency/startup observer；PipelineParams(enable_metrics=, enable_usage_metrics=) 收集 token/延迟；OpenTelemetry 追踪经 TurnTraceObserver + utils/tracing/（extra tracing），Sentry 集成 |
| [[praisonai\|PraisonAI]] | MinimalTelemetry(PostHog 匿名用量，隐私优先) + OpenTelemetry 集成（traces/spans/metrics，README 标注）+ Langfuse tracing(praisonai langfuse)；token/cost 收集 (telemetry/token_collector.py)；eval/ 做 accuracy/performance/reliability/criteria 评估 |
| [[semantic-kernel\|Semantic Kernel]] | 内建 OpenTelemetry：KernelFunction 自带 ActivitySource("Microsoft.SemanticKernel") + Meter(invocation/streaming duration histogram)；agent 调用经 ModelDiagnostics.StartAgentInvocationActivity；过滤器+结构化日志(LoggerMessage)。评估无内建框架，依赖外部 |
| [[smolagents\|smolagents]] | Monitor 经 ActionStep callback 累计 token/步时长；AgentLogger(Rich) 分级日志；memory.replay() 回放；return_full_result 返回 RunResult(token_usage/steps/timing/state)；telemetry extra 接 OpenTelemetry/Arize Phoenix |
| [[strands\|Strands Agents]] | 一等公民 OpenTelemetry：Tracer 为 agent/cycle/model/tool 起 span(telemetry/tracer.py:77)，EventLoopMetrics 记 token/延迟/cycle，StrandsTelemetry 一键装配；callback_handler 流式回调(默认 PrintingCallbackHandler)；评估走 OTEL 导出 |
| [[swarm\|Swarm]] | 仅 debug_print |
| [[swarmclaw\|SwarmClaw]] | OpenTelemetry OTLP traces（@opentelemetry/sdk-node，env 配端点/headers）；自研 logger/execution-log/activity-log/run-ledger；usage/cost 计量；eval/ 做 baseline+environment-plan 评估；autonomy supervisor 反思每次自治 run |
| [[swarms\|Swarms]] | loguru 日志（utils/loguru_logger.py）；遥测默认向 swarms.world 上报 agent 数据（SWARMS_TELEMETRY_ON 开关，telemetry/main.py:150）；评估类拓扑 council_as_judge/debate_with_judge/majority_voting 充当 LLM-as-judge |
| [[transformers-agents\|Transformers Agents]] | 步骤日志、verbose 输出；无内建 eval |
| [[upsonic\|Upsonic]] | eval/ 子包：AccuracyEvaluator、performance、reliability 三类评测器(.run())；可观测经 integrations/ 接 Langfuse / OpenTelemetry(otel extra) / PromptLayer；core 依赖含 sentry-sdk[opentelemetry]；pipeline 每步发事件 |
| [[vectara-agentic\|vectara-agentic]] | 内置 Arize Phoenix（OpenInference instrument LlamaIndex，_observability.py:16 setup_observer），eval_fcs() 把 Vectara FCS 分数作为 span 评估写回（_observability.py:101）。回调 AgentCallbackHandler/agent_progress_callback 实时上报 TOOL_CALL/TOOL_OUTPUT（agent.py:623）。VHC（幻觉纠正） compute_vhc/analyze_hallucinations 是其独特评估能力 |
| [[voltagent\|VoltAgent]] | 核心卖点：全栈 OpenTelemetry，3 个自定义 SpanProcessor——WebSocket(实时推 VoltOps Console)、LocalStorage(本地 trace 存储+查询)、LazyRemoteExport(OTLP→VoltOps/任意后端)；零配置默认开启。评估：eval(create-scorer/LLM-judge) + 独立 @voltagent/scorers/@voltagent/evals + langfuse exporter |
