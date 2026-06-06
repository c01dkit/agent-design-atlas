---
title: "状态与持久化"
aliases:
  - State
  - Persistence
  - Checkpointing
tags:
  - knowledge-base
  - domain/agent-components
  - component/state-persistence
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 状态与持久化

> [!abstract] 一句话总结
> agent 的状态如何表示、保存与恢复：消息历史、变量、计划进度、子 agent 状态。持久化让 agent 能断点续跑、容错、长时间运行，以及支持人在环的暂停-审批-继续。

## 它解决什么问题

agent 可能跑很久、会失败、需要人介入。把状态显式化并持久化，才能恢复、审计、暂停/恢复，而不是从头再来。

## 设计维度 / 实现谱系

- **状态表示**：隐式（消息列表）↔ 显式 state 对象（图式框架）↔ 黑板
- **持久化后端**：内存 ↔ 文件 ↔ 数据库/KV ↔ checkpointer 抽象
- **粒度**：整体快照 ↔ 每步 checkpoint（支持时间旅行/重放）
- **续跑**：失败重启、暂停-恢复（与 [[human-in-the-loop-governance|人在环]]强相关）
- **长时运行**：心跳、调度、跨进程（[[swarmclaw|SwarmClaw]]、[[aeon|Aeon]]）

## 关键要点

- 显式 state + checkpoint 是图式框架（LangGraph/[[mastra|Mastra]]）的生产级优势。
- 持久化是长期自治 agent 的地基。
- 与 [[memory]] 区别：state 是执行现场，memory 是长期知识。

## 关联

- [[memory]] · [[multi-agent-orchestration]] · [[human-in-the-loop-governance]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **47** 个实现了「状态 / 持久化」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 全部状态以文件提交进 Git main 分支；runner 末尾 git commit + pull --rebase + push 带 5 次重试与冲突自动消解；并发 workflow 靠 concurrency.group 串行化 tick、消息走唯一组并行；沙箱内 .pending-notify/ 缓冲通知待 post-run 重投 |
| [[ag2\|AG2]] | 会话状态=各 Agent 的 _oai_messages（进程内）；cache/ 持久化 LLM 响应缓存（disk/redis/cosmos/in-memory），按 seed/cache_seed 复用；对话历史可 clear_history 或保留 N 条；RAG/Teachability 经向量库落盘；无内建跨进程会话恢复 |
| [[agency-swarm\|Agency Swarm]] | Agency(load_threads_callback=, save_threads_callback=) 注入持久化回调：ThreadManager 初始化时 load，每次 add_message/run 结束经 PersistenceHooks.on_run_end save（扁平消息 list，含 agent/callerAgent/timestamp 元数据）。存到 DB/文件由用户实现 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | 全部状态入 SQL：Agent/Conversation/Message/Chain/ChainStep/ChainStepResponse/Memory/TaskItem 等 SQLAlchemy 模型（DB.py）；SQLite 或 Postgres 二选一；定时/重复任务由 Task+TaskMonitor 持久化调度（scheduled/due_date/cron 式重复） |
| [[agentdock\|AgentDock]] | 会话隔离 SessionManager<T>（泛型，按 sessionId 存取，TTL）；orchestration 状态（activeStep/sequenceIndex/recentlyUsedTools/tokenUsage）经 OrchestrationStateManager 持久化；Storage Abstraction：统一 StorageProvider 接口 + 大量 KV/向量 adapter（Memory/Redis/Vercel KV/SQLite/Postgres/Mongo/DynamoDB/S3/Pinecone/Qdrant/Chroma…）+ 迁移工具 |
| [[agentfield\|AgentField]] | 控制平面统一持久层：local=SQLite+BoltDB / cloud=PostgreSQL(goose 迁移)；执行记录、workflow execution、记忆四作用域、配置存储(POST /api/v1/configs/:key)、payload store 均落库；身份与 VC 链持久化可离线验证 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | Skillbook 序列化为 JSON(v2 schema)+ embedding sidecar(.embeddings.npz)；save_to_file/load_from_file；CheckpointStep 按间隔存档、PersistStep 每样本写目标文件(如项目 CLAUDE.md)；SimilarityDecision(KEEP)持久化去重决策 |
| [[agentscope\|AgentScope]] | 全部运行态收敛进单个 pydantic AgentState(session_id/context/summary/reply_id/cur_iter/permission_context/tool_context/tasks_context)，可整体序列化恢复；服务侧 app/storage/ 提供 RedisStorage + SessionRecord/AgentRecord/UserRecord 等做多会话持久化；文件读缓存带 mtime 失效与 LRU 淘汰 |
| [[agentset\|Agentset]] | Prisma + Postgres 为权威状态（org/namespace/document/ingest-job/webhook 等 schema，packages/db/prisma/schema/，含 40+ 迁移）；向量数据在 Pinecone/Turbopuffer；批次/限流用 Redis；文件用 S3 兼容存储 |
| [[agentverse\|AgentVerse]] | 运行态全在内存：环境的 cnt_turn/last_messages/rule_params 与各 agent 的 memory；reset() 清空重来。落盘仅限结果——task-solving save_result() 写 ./results/<task>.txt（plan/result/spend，tasksolving.py:84）、日志写 logs/。无会话恢复/检查点机制 |
| [[ailoy\|Ailoy]] | 会话状态不持久化（messages 由调用方自管）；持久化的是模型工件：cache 模块用 manifest + 文件系统缓存把从 S3 下载的权重/rt./tokenizer 落盘并支持 checksum 校验、download/remove（src/cache/mod.rs, src/model/local/local_language_model.rs:95,113）；WASM 侧用 OPFS(FileSystem API) 缓存（Cargo.toml:114 web-sys FileSystem） |
| [[astron\|Astron Agent]] | 运行态：workflow VariablePool + WorkflowEngineCtx（节点状态/链路）；DAG 引擎用 pickle 序列化做跨节点传递；持久化：MySQL（结构化）、Redis（缓存/会话/EventRegistry 注册表）、MinIO（文件）、memory 服务（会话 DB）、workflow 用 alembic 管理 schema 版本 |
| [[autogen\|AutoGen]] | 全链路 save_state()/load_state() → Mapping：agent、ChatCompletionContext、group chat manager(各自 ManagerState) 与 Team(TeamState 聚合各 agent state)均可序列化；CancellationToken 控制中断 |
| [[botpress\|Botpress]] | Snapshot 暂停/恢复：工具内 throw SnapshotSignal 即序列化当前执行状态→Snapshot.toJSON() 存库→后续 execute({snapshot}) 从断点续跑（适合长流程/人工审批）；跨迭代 variables 持久 |
| [[connectonion\|ConnectOnion]] | 本地 current_session(runtime-only) + .co/ 落盘(logs/evals/uploads)；input(session=...) 可恢复无状态会话；host() 经 session/storage.py 做服务端会话持久化与合并 |
| [[cordum\|Cordum]] | Redis 存工作流状态、job 元数据、指针负载；job 生命周期状态机（Succeeded/Approval/Denied… 见 engine.go setJobState）；审批存储 Redis（core/edge/approval_store_redis.go）；安全裁决落 jobStore（engine.go:2213 SetSafetyDecision，带 JobHash 防过期请求重放）；审计哈希链 head 指针 CAS 持久于 Redis |
| [[cortex-mem\|Cortex Memory]] | 核心。混合持久化：cortex:// 虚拟文件系统(markdown 真相源,filesystem/operations.rs,filesystem/uri.rs:170) + Qdrant 向量索引(vector_store/qdrant.rs)；VectorSyncManager 维护二者一致；MemoryIndex 做版本/元数据追踪 |
| [[crewai\|CrewAI]] | Flow 结构化 state(Pydantic BaseModel) + @persist/persistence 默认 SQLite 落盘，支持断点续跑；Crew 侧 CheckpointConfig+apply_checkpoint 做 task 级 checkpoint 恢复 |
| [[dust\|Dust]] | 全量 Postgres(Sequelize ORM + Resource 抽象层)持久化对话/agent/action；Temporal 持久化工作流状态(可断点续跑)；core 侧 Run/Block 结果存于 stores(Postgres)，文档/向量存 Qdrant，分析存 Elasticsearch；Redis 做流式事件 |
| [[e2b\|E2B]] | 沙箱文件系统即状态；持久化靠 pause/resume + snapshot：pause() 暂停沙箱以便后续 Sandbox.connect(id) 自动恢复；createSnapshot() 把当前文件系统+状态固化为快照，Sandbox.create(snapshotId) 从快照派生新沙箱（快照在沙箱删除后仍存活） |
| [[haystack\|Haystack]] | ①结构持久化：Pipeline.to_dict/from_dict + dumps/loads(YAML) 整图存取；②运行态持久化=Breakpoint/Snapshot：在 component/chat_generator/tool_invoker 处设断点，触发即把 inputs+component_visits+state 存成 PipelineSnapshot/AgentSnapshot(JSON)，可从快照 resume；Agent State 序列化 schema |
| [[hcom\|hcom]] | 全部状态在单个 SQLite（WAL 模式，db/mod.rs:106），路径 ~/.hcom/hcom.db（可经 HCOM_DIR 按项目隔离）。schema 版本化+迁移（db/mod.rs:39, :41）。events append-only 同时是 relay 复制源。session/process binding 表把 OS 进程/会话映射到稳定 agent 身份；reset 会归档替换 DB 文件，长连接经 inode 检测重连（db/mod.rs:123） |
| [[hermes-agent\|Hermes Agent]] | hermes_state.py = SQLite 会话库(消息 + FTS5/trigram 全文索引 + checkpoint)，跨会话/跨平台连续；MEMORY.md/USER.md 文件落盘；profiles 多实例隔离配置/会话/skill/记忆；tools/checkpoint_manager.py 文件快照可回滚 |
| [[hive\|Hive]] | Checkpoint-based 崩溃恢复：CheckpointStore + CheckpointConfig，execute(session_state=...) 可从 paused_at / resume_from_checkpoint 恢复；session_store/conversation_store 写穿落盘；~/.hive/ 存加密 credentials |
| [[lagent\|Lagent]] | state_dict()/load_state_dict() 仿 PyTorch 递归导出/载入各（子）agent 的 memory，键带 __model_spec__ 以重建 AgentMessage 子类；HTTP server 经 /memory/{session_id} 暴露会话状态。落盘格式由调用方决定（无内建 DB） |
| [[langchain\|LangChain]] | 状态=TypedDict AgentState(+middleware 合并出的 schema，factory.py:1043)；checkpointer(线程内会话) + store(跨线程) 由 LangGraph 提供并透传 compile()；jump_to 为 EphemeralValue 不持久化 |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 服务端会话持久化(enable_session_persistence=True)；agent_id/session_id 由 server 分配并复用；向量库 register 后持久；客户端侧仅缓存 chat_history/context(内存字典) |
| [[llamaindex\|LlamaIndex]] | 运行态存 Workflow Context.store(memory/state/scratchpad/num_iterations 等 KV)；initial_state 深拷贝入 store；RAG 侧 StorageContext.persist() 落盘 docstore/index_store/vector_store，load_index_from_storage 恢复；对话历史经 SQLAlchemyChatStore(默认 sqlite 内存,可换持久 DB) |
| [[loongflow\|LoongFlow]] | ① Checkpoint：按 checkpoint-iter-{iter}-{count} 目录定期落盘进化数据库（solutions/.json + metadata.json + best_solution.json），可从 checkpoint 恢复 completion_count 与种群（pes_agent.py:348，in_memory.py:298,377）；② 进化记忆后端可选 in-memory 或 Redis（MemoryFactory）；③ Workspace 把每轮 planner/executor/summarizer/evaluator 产物按 {task_id}/{iter}/ 结构化落盘 |
| [[maestro\|Maestro]] | 运行态状态仅存内存列表，进程结束即丢；唯一持久化是结束时把完整交换日志写成 {timestamp}_{objective}.md + 生成的代码工程落盘 |
| [[mastra\|Mastra]] | 可插拔 storage（MastraStorage base + composite store + filesystem/in-memory/外部 DB 适配器），按 domain 分库（agents/skills/workspaces/mcp-clients/scorer-definitions…）持久化线程、消息、memory、workflow snapshot；workflow 快照支持 resumeStream()；request-context/di 管运行时上下文 |
| [[metagpt\|MetaGPT]] | SerializationMixin + Team.serialize/deserialize 把整个团队（含 context/角色/记忆）存成 team.json 支持断点恢复（recover_path）；Environment.history（Memory）留存全量消息供调试；LongTermMemory.persist 把向量记忆持久化到磁盘 |
| [[modus\|Modus]] | Agent 状态由 Runtime 自动管理：GetState序列化→WriteAgentState 落 Postgres 或内置 modusDB(modusgraph)；suspend/resume 自动保存恢复，passivation 空闲钝化后可从 DB 重建 actor；agent 状态表含 id/name/status/data/updated |
| [[nanobot\|nanobot]] | SessionManager 每会话 JSONL 历史（原子写+fsync，自动修复）；TTL 触发 AutoCompact 闲置压缩；turn 中 _emit_checkpoint 落盘 runtime checkpoint，崩溃//stop 后可恢复；记忆文件 + 可选 git 版本化（GitStore/dulwich）；持续目标状态存 session metadata |
| [[open-multi-agent\|Open Multi-Agent]] | 运行态全在内存：TaskQueue 持任务生命周期、SharedMemory 持跨 agent KV、AgentPool 每 run 临时(无跨 run 状态)；唯一可序列化产物是 PlanArtifact(纯 JSON，createPlanArtifact→runFromPlan 重放同一 DAG)。无内置 durable checkpoint(README 明确说明) |
| [[openclaw\|OpenClaw]] | 会话 transcript 持久化为 JSONL（harness/session/jsonl-storage.ts，另有 memory-storage 内存实现）；cron 作业/状态/run 历史持久化进 共享 SQLite state DB（旧 jobs.json 经 doctor --fix 迁移）；会话/绑定/记忆文件落在 state dir(~/.openclaw/)；session binding service 维护渠道↔会话映射 |
| [[pilotprotocol\|Pilot Protocol]] | 协议级状态原子落盘到 ~/.pilot/：config.json、Ed25519 identity（--identity 跨重启稳定身份）、trust.json（互信记录，仅 IdentityPath 非空时加载/落盘）、beacon 缓存；registry 侧热备复制 + WAL（README.md:189）。注意坑：直接跑 daemon 而非 pilotctl daemon start 时若没自动加载 ~/.pilot/config.json，IdentityPath 为空会静默丢失 trust 持久化（cmd/daemon/main.go:96-111 已修） |
| [[pipecat\|Pipecat]] | 运行态在 LLMContext（消息）+ worker 内部状态；EndFrame/StopFrame 为 uninterruptible（打断也不丢）；序列化主要面向 wire 传输：FrameSerializer.serialize/deserialize（Twilio/Plivo/Vonage/Telnyx/Exotel/Genesys/protobuf）把 frame 转电话/WebSocket 协议；跨 worker 状态走 bus 的 BusMessage |
| [[praisonai\|PraisonAI]] | Session(session.py:24) 管短期会话状态(save_state)；db=db(database_url=...) 接 PostgreSQL/MySQL/SQLite/MongoDB/Redis 等 20+ 后端，自动持久化 messages/runs/traces；CLI auto_save="proj" + Shadow Git Checkpoints(失败自动回滚) + snapshot/ |
| [[semantic-kernel\|Semantic Kernel]] | 会话状态在 AgentThread(如 ChatHistoryAgentThread，含 OnSuspendAsync/OnResumeAsync 生命周期)；旧式 AgentChat 用 AgentChatSerializer 序列化/恢复整个多 agent 对话；ChatCompletionAgent.RestoreChannelAsync 从 JSON 恢复 channel；Process 框架有 KernelProcessStateMetadata 检查点 |
| [[smolagents\|smolagents]] | 运行态=agent.state 字典(additional_args 注入沙箱变量)；reset=False 可跨 run 续接记忆；序列化经 to_dict/from_dict/save/from_hub/push_to_hub 把 agent+tools+prompt 落盘/上 Hub；AGENT_REGISTRY 限制反序列化类防 RCE |
| [[strands\|Strands Agents]] | agent.state=JSON 可序列化 KV(agent/state.py)；SessionManager ABC 经 hooks 自动落盘 messages/state/conversation_manager_state，含 FileSessionManager/S3SessionManager/RepositorySessionManager；take_snapshot/load_snapshot 内存快照；checkpointing 在 cycle 边界暂停可恢复 |
| [[swarmclaw\|SwarmClaw]] | better-sqlite3 本地库，每集合一张 (id,data) 表，load-modify-save + 批量删除守卫（saveCollection）；session_messages 独立表（瘦身 transcript）；storage-normalization 加载时迁移旧记录补默认值；LangGraph checkpoint 持久化；main-loop / delegation / queue / run-ledger 各自 repository；模块级状态用 hmrSingleton 抗 Next.js HMR |
| [[swarms\|Swarms]] | autosave 把 to_dict() 状态序列化落盘（agent.py:3456 后台线程）；Conversation.save_as_json/export（conversation.py:812,895）；v12 MEMORY.md 跨进程持久（按 agent_name keyed）；对话默认 in-memory，无 DB 后端 |
| [[upsonic\|Upsonic]] | 多后端 storage 统一接口：In-Memory / JSON / SQLite / Redis / PostgreSQL / MongoDB / mem0(src/upsonic/storage/)，承载 session/memory/user-profile；db= 参数可整体接管(agent.py:234)；Task 级 cache(vector_search/llm_call，tasks.py:49) |
| [[vectara-agentic\|vectara-agentic]] | Agent 可整体序列化：dumps/loads、to_dict/from_dict（agent.py:1103）经 serialize_agent_to_dict（serialization.py:252）落盘配置+工具+memory，并用 cloudpickle 处理自定义函数工具。session_id（默认 topic:date，agent.py:169）+ Memory 提供会话维度状态；带 fallback agent 配置切换（agent.py:480） |
| [[voltagent\|VoltAgent]] | Memory 经 StorageAdapter 持久化消息/会话/working memory；memory-persist-queue 异步落盘；Workflow 有 WorkflowStateStore/checkpoint(suspend 后可 restart)；observability 的 LocalStorage 持久化 trace；resumable-streams 支持断线续流 |
