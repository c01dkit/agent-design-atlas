---
title: "记忆"
aliases:
  - Memory
  - 向量记忆
tags:
  - knowledge-base
  - domain/agent-components
  - component/memory
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 记忆

> [!abstract] 一句话总结
> 让 agent "记住"超出当前上下文窗口的信息：短期（会话内）、长期（跨会话）、以及基于向量检索的语义记忆。记忆的核心三动作是**写入、检索、遗忘**。

## 它解决什么问题

上下文窗口是易失的、有限的。记忆提供持久化与按需召回，使 agent 能跨轮次、跨会话保持一致，并从过去经验中受益。

## 设计维度 / 实现谱系

- **时效**：短期（消息缓冲）↔ 长期（持久存储）
- **检索方式**：全量 ↔ 关键词 ↔ **向量语义检索**（embedding + 向量库）↔ 混合
- **结构**：原始对话 ↔ 摘要 ↔ 实体/知识图 ↔ 经验/技能（自改进，[[agentic-context-engine\|ACE]]）
- **写入策略**：全部存 ↔ 重要性筛选 ↔ 反思后提炼
- **遗忘/更新**：TTL、容量上限、去重、冲突消解

## 关键要点

- "记忆"常被实现为一种特殊的 [[tool-use|工具]] + [[context-engineering|上下文注入]]。
- 向量检索是主流，但纯向量有局限，知识图/结构化记忆在复杂场景更稳。
- 记忆质量取决于"写入什么"和"何时召回"，而非只是存储。

## 关联

- [[context-engineering]] · [[tool-use]] · [[state-persistence]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **45** 个实现了「记忆」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | Git 仓库即长期记忆：memory/MEMORY.md（索引）+ topics/ + logs/YYYY-MM-DD.md + cron-state.json（运行指标）+ issues/（工单）。无向量库；检索靠 grep/读文件。CLAUDE.md 强制每任务前读 MEMORY、任务后追加日志 |
| [[ag2\|AG2]] | 短期=每个对话方一条消息列表 _oai_messages（defaultdict(list)）；长期/向量=Teachability capability 用 ChromaDB 存"教导"记忆，经 process_last_received_message hook 召回（recall_threshold 距离阈值）；RAG 见下 |
| [[agency-swarm\|Agency Swarm]] | 短期=ThreadManager 维护的扁平消息列表（MessageStore，按 agent/callerAgent 元数据过滤检索对话对）；长期=由用户的 save/load_threads_callback 落盘；向量记忆=经 files_folder+OpenAI Vector Store 的 FileSearchTool（RAG），非内置语义记忆 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | 短期=数据库里的 Conversation/Message；长期=向量记忆，Memory 表 embedding = Column(Vector)（Postgres 走 pgvector），余弦相似度检索；embedding 用本地 ONNX 模型（onnx/model.onnx）离线生成，无需外部 embedding API |
| [[agentdock\|AgentDock]] | 四层记忆：Working/Episodic/Semantic/Procedural（memory/types/），由 MemoryManager 统管；写入经 PRIME 抽取器（LLM generateObject 按重要度分类落库，2-tier 选模）；召回 RecallService 支持 hybrid（关键词+向量）；含 LazyDecay 衰减、连接图谱、巩固 |
| [[agentfield\|AgentField]] | 控制平面托管的分布式记忆，四作用域 global / session / actor / workflow(run)，读时按 workflow→session→actor→global 由窄到宽回退；KV + 向量检索（/memory/vector set/search，余弦 top_k，含 metadata filter），零外部依赖（内建于控制平面，无需 Redis） |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 长期记忆=Skillbook（跨会话持久化的策略库，JSON + .embeddings.npz sidecar）；可选向量=dedup 用 sentence-transformers 给 skill 算 embedding；检索=BM25(lexical)+dense 的 RRF 融合 top-k |
| [[agentset\|Agentset]] | 短期=多轮 messages（>1 轮时 CONDENSE_ prompt 把历史压成独立 query，chat/route.ts:87）；长期=向量库即记忆（Pinecone/Turbopuffer，按 namespace/tenant 持久）；无对话级长期记忆模块 |
| [[agentverse\|AgentVerse]] | BaseMemory 注册表多实现：ChatHistoryMemory（短期对话历史）、SummaryMemory（摘要压缩）、VectorStoreMemory（向量记忆，OpenAI embedding 存 content）、SdeTeamMemory；agent 默认 ChatHistoryMemory（agents/base.py:25） |
| [[ailoy\|Ailoy]] | 短期=调用方自持的 Vec<Message> 历史（每轮把 assistant/tool 消息 push 回 messages，src/agent/base.rs:246）；本地推理侧有 KV-cache 的 LCP 前缀复用（非语义记忆，src/model/local/inferencer.rs:561）；长期/向量"记忆"经 RAG knowledge 实现，框架本身不存对话 |
| [[astron\|Astron Agent]] | 短期=chat_history 直接拼进 user prompt（RunnerBase.create_history_prompt）+ Scratchpad 累积步骤；长期=独立 memory 微服务（DB 化会话存储，暴露 create/ddl/dml/drop 等 DB 操作 API，前缀 /xingchen-db/v1）；向量记忆走 knowledge/RAG 服务 |
| [[autogen\|AutoGen]] | 短期=ChatCompletionContext（消息历史）；长期=Memory 抽象基类（query/add/update_context 在推理前把检索内容注入 context），内置 ListMemory；向量/语义检索由 autogen-ext（如 ChromaDB）实现，core 内 N/A |
| [[botpress\|Botpress]] | 短期=transcript（对话历史）+ 跨迭代持久的 variables/Object properties；长期/向量记忆非内核职责，靠 Botpress File API（RAG 示例中 client 上传+语义检索）。框架本身无内置向量库=N/A |
| [[connectonion\|ConnectOnion]] | 短期=current_session['messages']（多轮持久）；长期=Memory 工具，markdown 文件 KV，超阈值自动拆目录（非向量检索，regex 搜索）；向量记忆 N/A |
| [[cordum\|Cordum]] | 非 agent 记忆。Context Engine（可选 gRPC 服务）做指针化上下文/记忆存储，写入时强制治理校验（policy/trust/directive 类写入必须带审批引用）；向量检索 N/A |
| [[cortex-mem\|Cortex Memory]] | 核心。短期=会话消息时间线(session/manager.rs,session/timeline.rs)；长期=LLM 提取的结构化记忆(preferences/entities/events/cases/personal_info/work_history/relationships/goals 八类，带 confidence 评分)；向量=Qdrant 三层(L0/L1/L2)语义索引 |
| [[crewai\|CrewAI]] | 统一 Memory：保存时用 LLM 抽取记忆并推断 scope/category/importance，按 recency+semantic+importance 加权检索；默认 LanceDB 向量存储（亦支持 Qdrant）；crew.memory=True 启用 |
| [[dust\|Dust]] | 短期=对话消息（Postgres 持久）+ 自动 compaction 摘要；长期=agent_memory MCP server（AgentMemoryResource）；向量记忆=core 的 data_sources + Qdrant（用于 RAG 而非 agent 自记忆） |
| [[haystack\|Haystack]] | 短期=Agent State（按 state_schema 定义的 KV，messages 默认用 merge_lists handler 累积多轮）；长期/向量=DocumentStore + Retriever（InMemory/外部向量库），即 RAG 充当语义记忆；另有 components/caching 缓存 |
| [[hermes-agent\|Hermes Agent]] | 短期=SQLite 会话消息(多轮持久)；长期=memory 工具写 MEMORY.md(agent 自记) + USER.md(对用户的画像)，§ 分隔、字符上限、session 启动时冻结快照注入 system prompt 保护 prefix cache；可插拔后端(内置/Honcho/Mem0)；向量检索 N/A(走 FTS5 而非 embedding) |
| [[hive\|Hive]] | 短期=session 级 shared buffer（KV，按节点声明 read/write key 强制边界）；长期=role-based / queen memory（agents/queen/queen_memory_v2.py + recall_selector.py 召回）；上下文超限自动 compaction。向量检索＝待确认（未见专用 vector store） |
| [[lagent\|Lagent]] | 短期=按 session_id 分桶的 Memory（一个 List[AgentMessage]），MemoryManager 管理多会话；recent_n 截断 + filter_func 过滤；可 save()/load() 序列化。无长期/向量记忆 |
| [[langchain\|LangChain]] | 短期=AgentState["messages"]（add_messages reducer 累积，middleware/types.py:356），由 checkpointer 按 thread 持久化为多轮记忆；长期/跨线程=LangGraph BaseStore（store= 参数）；向量记忆经 core vectorstores/retrievers 抽象但非 agent 内建 |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 短期=服务端 session(enable_session_persistence，create_session/create_turn 维持多轮)；长期/向量=builtin::rag + VectorIO API，vector_dbs.register 建库、tool_runtime.rag_tool.insert 灌库(all-MiniLM-L6-v2/384 维)；agent_store 还有 "live memory bank" 动态写入 |
| [[llamaindex\|LlamaIndex]] | 短期=ChatMemoryBuffer(token 截断)；统一 Memory 类聚合 memory blocks：StaticMemoryBlock/FactExtractionMemoryBlock(LLM 抽取事实)/VectorMemoryBlock(向量长期记忆)，token 超限自动 flush 到 block；底层走 SQLAlchemyChatStore |
| [[llm-agents\|llm-agents]] | 仅"短期"=本次 run 的 previous_responses 列表（每轮把 generated+Observation 追加，整段塞回 prompt）；无跨会话/长期/向量记忆 |
| [[loongflow\|LoongFlow]] | 两类：① 会话记忆 GradeMemory——STM/MTM/LTM 三级，超 token_threshold(默认 65536) 用 LLM 压缩器自动压缩(auto_compress)；② 进化记忆 EvolveMemory——多岛 + MAP-Elites 网格 + 精英归档 + 岛间迁移，存 Solution(代码/分数/计划/总结/父子链)。非语义向量检索（多样性用长度/行数/字符集差分启发） |
| [[maestro\|Maestro]] | 短期=两个列表 task_exchanges/haiku_tasks 累积历史，作为 previous_results 喂回 orchestrator、作为 system_message 喂回 sub-agent；无长期/向量记忆 |
| [[mastra\|Mastra]] | 抽象基类 MastraMemory（@mastra/memory 提供实现）：短期=线程对话历史（storage 持久化）；长期=working memory（tool-call 模式更新的结构化 markdown/schema）；向量=semantic recall（需配 vector store + embedder，相似度召回历史消息）；另有 observational memory |
| [[metagpt\|MetaGPT]] | 短期=Memory（list 存储 + index[cause_by] 倒排索引，get_by_actions 按 Action 检索）；长期=LongTermMemory/MemoryStorage 走 FAISS 向量检索（search_similar 余弦阈值过滤）；RoleZeroMemory 用 Chroma RAG + LLMRanker 做超长记忆召回 |
| [[modus\|Modus]] | 短期=agent 实例的结构体字段(active instance 私有)；长期=GetState/SetState 序列化字符串由 Runtime 自动落库(Postgres 或内置 modusDB)；向量=独立 vectors 工具包(余弦/点积等数学运算，非托管向量存储) |
| [[nanobot\|nanobot]] | 短期=Session 历史（JSONL，token 预算回放）；长期=MEMORY.md/SOUL.md/USER.md 文件；Dream 两阶段巩固把溢出消息 LLM 摘要进 history.jsonl（原子写+fsync，cursor 增量）；按 token 预算触发 Consolidator。非向量检索 |
| [[open-multi-agent\|Open Multi-Agent]] | 短期=AgentRunner 内 conversationMessages(单次 run) + Agent.messageHistory(跨 prompt() 多轮)；团队共享=SharedMemory 命名空间 KV(<agentName>/<key>)，可选 ttlTurns 过期、getSummary() 生成 markdown 注入；可插拔 MemoryStore(默认 InMemoryStore，可换 Redis/PG)。无向量检索 |
| [[openclaw\|OpenClaw]] | 短期=session JSONL transcript（harness/session/jsonl-storage.ts）；中期=会话压缩摘要（compaction）；长期=/new·/reset 时把会话存为带日期 slug 的 markdown 记忆文件（session-memory hook）+ 工作区根 memory 文件；向量记忆=可选 memory-lancedb 插件（memory_store/memory_recall/memory_forget，LanceDB 向量+自动召回） |
| [[pipecat\|Pipecat]] | 短期=LLMContext 累积对话消息（add_message/get_messages）；长期/向量=可选 Mem0MemoryService（FrameProcessor，接 mem0ai 向量记忆，extra mem0）；亦有 persistent-context 示例做会话落盘 |
| [[praisonai\|PraisonAI]] | memory=True 启用 Memory（StorageMixin+SearchMixin+MemoryCoreMixin）：默认 provider rag→ChromaDB 本地向量；可切 mem0（含 Neo4j/Memgraph graph memory）或 mongodb；短期 short_term.db + 长期 long_term.db + 实体/用户记忆；零依赖 file-based 模式 |
| [[semantic-kernel\|Semantic Kernel]] | 短期=ChatHistory/AgentThread（多轮消息）；上下文压缩=ChatHistorySummarizationReducer / ChatHistoryTruncationReducer；向量长期记忆=独立 VectorData. 连接器（AzureAISearch/Chroma/Qdrant/Redis/PgVector/Pinecone/Milvus/Weaviate…）+ 旧 ISemanticTextMemory(已弱化) |
| [[smolagents\|smolagents]] | 短期=AgentMemory.steps（TaskStep/ActionStep/PlanningStep 列表）每步 write_memory_to_messages() 重放为 chat 消息；无内建长期/向量记忆（N/A，可经 callback/外部工具自接） |
| [[strands\|Strands Agents]] | 短期=agent.messages 列表（多轮）；上下文窗口由 ConversationManager 管：滑窗 SlidingWindowConversationManager（默认）/ 摘要 SummarizingConversationManager（:54，LLM 摘要旧消息）/ NullConversationManager；无内置向量记忆/RAG |
| [[swarmclaw\|SwarmClaw]] | 三层：working / durable / archive（按 category+metadata 分层）；SQLite memory-db + embeddings 向量检索 + MMR 重排；"dream cycles" 在 idle 时做记忆巩固/去重（supersededBy 标记） |
| [[swarms\|Swarms]] | 短期=Conversation（默认 in-memory 消息列表，conversation.py:52）；长期=v12 persistent_memory 把 MEMORY.md 作为 system 前导注入并逐轮追加（conversation.py:281,420）；compact() 摘要+归档（conversation.py:314）；无内建向量记忆 → N/A |
| [[transformers-agents\|Transformers Agents]] | 会话内 agent memory（步骤日志）；无长期/向量记忆 |
| [[upsonic\|Upsonic]] | Memory 三种保存+三种加载开关：full_session_memory(对话历史)/summary_memory(会话摘要)/user_analysis_memory(用户画像，支持 user_profile_schema)；持久化走 storage 后端；向量记忆经 mem0/supermemory extra |
| [[vectara-agentic\|vectara-agentic]] | 短期=LlamaIndex Memory.from_defaults(session_id=..., token_limit=65536)（agent.py:175），workflow 内部管理、结束后从 ctx.store.get("memory") 回写（agent.py:739）；chat_history 可初始化（agent.py:178）。长期/向量记忆 N/A（向量检索属于 Vectara 语料层，不是 agent memory） |
| [[voltagent\|VoltAgent]] | Memory 门面三件套：StorageAdapter(消息/会话/working memory)、VectorAdapter+EmbeddingAdapter(向量语义检索)；getMessagesWithSemanticSearch 把最近消息+语义召回拼接；searchSimilar 做向量检索；WorkingMemory 做结构化长期记忆 |
