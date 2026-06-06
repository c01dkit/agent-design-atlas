---
title: "上下文工程"
aliases:
  - Context Engineering
  - Prompt Management
tags:
  - knowledge-base
  - domain/agent-components
  - component/context-engineering
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 上下文工程

> [!abstract] 一句话总结
> 在有限的上下文窗口里，把"对的信息"以"对的形式"放进去：系统 prompt、工具说明、历史消息的裁剪/压缩、记忆与检索结果的注入。Agent 质量很大程度上取决于上下文工程，而非模型本身。

## 它解决什么问题

上下文窗口有限且昂贵；放太多会稀释注意力、增加成本，放太少会丢失关键信息。上下文工程决定 agent 在每一步"看到什么"。

## 设计维度 / 实现谱系

- **Prompt 组织**：硬编码字符串 ↔ 模板系统 ↔ 可组合的 prompt 对象（[[semantic-kernel\|Semantic Kernel]] 的 functions）
- **历史管理**：全量保留 ↔ 滑动窗口 ↔ 摘要压缩 ↔ 重要性筛选
- **记忆注入**：何时检索 [[memory\|记忆]]、注入多少、放在哪个位置
- **工具呈现**：把工具 schema 如何描述给模型（影响调用准确率）
- **透明度**：框架是否让你看到/修改最终 prompt（高抽象框架常隐藏，见 [[design-tradeoffs]]）

## 关键要点

- "Context engineering > prompt engineering"：重点是**动态组装**每步上下文。
- 能否"掀开盖子"改最终 prompt，是框架在真实项目可用性的试金石。
- 与 [[memory]] 和 [[tool-use]] 深度耦合。

## 关联

- [[memory]] · [[tool-use]] · [[reasoning-loop]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **47** 个实现了「上下文工程」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | prompt 注入分层：CLAUDE.md（Claude Code 自动加载的 agent 身份/规则/安全约束）+ 当前 SKILL.md + 链上下文文件 + var。可选 soul/（SOUL.md/STYLE.md/examples）注入人格风格。明确防注入：外部内容一律当不可信数据 |
| [[ag2\|AG2]] | system message 可静态或 UpdateSystemMessage 动态生成；group 模块的 ContextVariables 在 Agent 间共享可变状态并驱动条件转移/system 模板（ContextExpression/ContextStr）；transform_messages capability 做消息裁剪/压缩/限长 |
| [[agency-swarm\|Agency Swarm]] | 运行前把 shared_instructions（agency 级）+ agent 自身 instructions + 本次 additional_instructions 拼成最终 system prompt（execution_helpers.py:307 起，运行后还原 :435）；instructions 支持 str/文件路径；MessageFilter/MessageFormatter 决定哪些消息进 history、打 agent 元数据 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | 注入向量记忆（injected_memories/context_results）+ 近期对话（conversation_results）+ 可选 web 搜索（Websearch.py）+ 浏览链接；两段式命令选择先用大窗口模型从全部命令里筛出相关子集再注入，控制工具上下文膨胀；对话历史可压缩 |
| [[agentdock\|AgentDock]] | createSystemPrompt(agentConfig, dynamicState) 由 personality+动态 orchestration 状态(activeStep/recentlyUsedTools)拼 system prompt，并注入当前日期/时区；applyHistoryPolicy 按 none/lastN/all 裁剪历史；模板级 tokenOptimization(compressToolOutputs/maxToolOutputTokens) |
| [[agentfield\|AgentField]] | 自动上下文传播（Workflow/Session/Actor/Execution ID 经 header 转发，X-Workflow-ID/X-Execution-ID）；app.ai 的 system/user/schema 拼装；harness 支持 system_prompt 覆盖与 env 注入。无内建 token 压缩/auto-compact（依赖外部 harness 自管） |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 本框架重点。Skillbook 即被工程化的上下文：策略以 XML <strategy> 注入 agent prompt(render_skills_xml)；检索用 BM25+dense 的 RRF top-k；SkillManager 用 ADD/UPDATE/TAG/REMOVE 自策展；as_prompt() 渲染整本；外部 agent 用 wrap_skillbook_for_external_agent 注入 |
| [[agentscope\|AgentScope]] | 每轮 reasoning 前 compress_context()：count_tokens 超 trigger_ratio(0.8)context_size 即触发，按 reserve_ratio(0.1) 拆分待压/保留，用结构化 SummarySchema(task_overview/current_state/...) 让模型生成摘要回填；工具结果按 tool_result_limit(3000) 截断；system_prompt 可经 middleware on_system_prompt 管道改写 |
| [[agentset\|Agentset]] | 检索后用模板把 chunks 包成 <source_n>...</source_n> 注入(utils.ts:13)；强约束 system prompt 要求"仅基于来源作答 + 强制 [n] 引用"(prompts.ts:3)；多轮先 condense 历史为单 query 控上下文 |
| [[agentverse\|AgentVerse]] | prompt 用 string.Template 占位符填充：${agent_name}/${env_description}/${role_description}/${chat_history}（tool agent 另加 ${tools}/${tool_names}/${tool_observation}）；prepend_prompt_template+append_prompt_template 分段拼接（agents/base.py:62）；环境描述由 Describer 规则按 agent 动态生成注入 |
| [[ailoy\|Ailoy]] | 本地模型用 minijinja 渲染 chat template（src/model/local/chat_template.rs）；RAG 文档经 DocumentPolyfill（Qwen3 模板）注入 system/query 消息，适配"原生不支持知识输入"的模型（src/model/polyfill.rs:13,42）；推理参数 LangModelInferConfig（temperature/top_p/max_tokens/grammar/think_effort，src/model/language_model.rs:101） |
| [[astron\|Astron Agent]] | 模板拼装式：system prompt 由 {now}/{instruct}/{knowledge}/{tools}/{tool_names}/{r1_more} 占位替换（对 xdeepseekr1 模型走专用模板分支），user prompt 拼 {chat_history}+{question}+{scratchpad}；knowledge 检索结果（含图片/表格引用替换）作为背景注入 |
| [[autogen\|AutoGen]] | ChatCompletionContext 抽象管理喂给 LLM 的消息窗口；多策略实现：UnboundedChatCompletionContext、BufferedChatCompletionContext(取最近 N)、HeadAndTailChatCompletionContext、TokenLimitedChatCompletionContext；system_message + memory 注入 + _get_compatible_context(按 model_info 去图像) |
| [[botpress\|Botpress]] | 双模 prompt 系统（chat-mode/ vs worker-mode/，Markdown 模板编译成 TS）；运行时注入工具签名/schema/历史；truncateWrappedContent 按 token 上限智能截断（带 flex/minTokens 标记），保证不超模型窗口 |
| [[connectonion\|ConnectOnion]] | system_prompt 支持 str/文件/Path；auto_compact 插件在 context≥90% 时用 gemini-flash 摘要旧消息(保留 system+摘要+最近5条)；system_reminder/ulw 等插件注入上下文 |
| [[cordum\|Cordum]] | 指针化：Gateway 把输入 context JSON 写 Redis 设 context_ptr，总线只带指针；Safety Kernel 评估时按需解引用做内容级扫描（如 PII/payload 字段提取） |
| [[cortex-mem\|Cortex Memory]] | 核心卖点。三层渐进披露按查询意图动态加权(EntityLookup 偏 L2 0.7、Relational 偏 L1 0.5 等，search/weight_model.rs:45 weights_for_intent)，让接入方只加载所需粒度，省 token |
| [[crewai\|CrewAI]] | Task 描述模板插值({topic})；task context 由前序 TaskOutput 串联(_get_context)；执行前注入 knowledge(RAG) 检索与 memory 召回；超窗时 respect_context_window 处理 |
| [[dust\|Dust]] | system prompt 由 constructPromptMultiActions 组装并注入 memory/toolsets/user/workspace 上下文；超长时 compactionWorkflow 用专门 prompt 把历史摘要为 compaction 消息，保留最近若干轮交互 |
| [[haystack\|Haystack]] | 框架核心卖点：上下文如何被检索/排序/过滤/拼装全部显式可控——PromptBuilder 用 Jinja2 模板拼 prompt，Ranker 重排，Joiner 合并多路文档，Router 条件路由；Agent 的 system/user prompt 支持 Jinja2 模板（ChatPromptBuilder），required_variables 校验 |
| [[hcom\|hcom]] | bootstrap primer 注入身份+CLI 契约（bootstrap.rs:34）；config 的 hints（追加到每条收到的消息）与 notes（启动一次性追加）（README:309）；hcom bundle prepare 把事件/文件/转录片段打包成结构化 handoff 上下文（commands/bundle.rs, send.rs:23） |
| [[hermes-agent\|Hermes Agent]] | 可插拔 ContextEngine 抽象基类(config context.engine 选，默认 compressor)；ContextCompressor 用辅助小模型摘要中段、保护首尾(token 预算)、结构化模板(Resolved/Pending/Remaining Work)、迭代式更新；记忆/skill 注入用 <memory-context> 围栏 + 去注入清洗 |
| [[hive\|Hive]] | "洋葱模型"分层 prompt 组合：identity_prompt(Layer1 静态身份) + 节点 system_prompt 分层叠加（continuous/isolated 两种 conversation_mode，edge.py:366）；Goal.to_prompt_context() 注入每次 LLM 调用；超 token 自动 compaction（LLM 摘要 + emergency summary） |
| [[lagent\|Lagent]] | Aggregator 负责把 memory 拼成 OpenAI message：DefaultAggregator 合并 system+历史，InternLMToolAggregator 处理工具步骤；output_format(parser) 用 format_instruction() 注入格式要求、parse_response() 抽取 thought/action 存入 AgentMessage.formatted |
| [[langchain\|LangChain]] | system_prompt 注入在 _execute_model_sync（factory.py:1300）；SummarizationMiddleware 近上限时用 LLM 摘要旧消息并 RemoveMessage 重写历史；ContextEditingMiddleware(ClearToolUsesEdit) 清理工具输出；dynamic_prompt 钩子动态改 prompt |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | instructions(system prompt) + sampling_params(top_p/greedy)；document/attachment 注入(agent.create_turn(documents=...))，RAG query_config(max_chunks/max_tokens_in_context) 控制召回上下文长度；首轮注入 system message 的手动管理 |
| [[llamaindex\|LlamaIndex]] | system_prompt 前置；state_prompt 把运行时 state 注入最后一条 user 消息(DEFAULT_STATE_PROMPT)；ReAct 用 ReActChatFormatter 把工具描述+reasoning 步骤渲进 system header 模板；RAG 检索结果作为上下文喂入；memory block 模板化注入 |
| [[llm-agents\|llm-agents]] | 极简：每轮把全部历史 '\n'.join(previous_responses) 原样拼回 prompt（无摘要/压缩/裁剪）；唯一"工程"手段是 stop_pattern=['\nObservation:', ...] 防止 LLM 续写假 Observation |
| [[loongflow\|LoongFlow]] | ① GradeMemory 自动压缩控上下文长度（LLMCompressor 摘要 MTM+STM，grade/memory.py:108）；② Planner 把"父代解+评测+总结"作为经验注入下一轮 prompt；③ ReAct 每步把 system_prompt+历史+工具声明拼成 CompletionRequest（default_reasoner.py:37）；场景 Agent 用 prompt 模板（如 claude_code/general_prompt.py） |
| [[maestro\|Maestro]] | 纯 prompt 拼接：历史结果直接字符串 join 进 prompt/system；无压缩/摘要/裁剪。仅有的"上下文管理"是输出≥4000 token 时递归续写防截断 |
| [[mastra\|Mastra]] | processor 管线：input/output/error processors（及可作 processor 的 workflow）在 LLM 调用前后改写消息/系统提示/工具集，内置 token-limiter、message-selection、system-prompt-scrubber、moderation、PII、prompt-injection、structured-output 等；system-reminders 注入；instructions/model/tools 均支持 DynamicArgument（按 requestContext 动态解析） |
| [[metagpt\|MetaGPT]] | Role._get_prefix 用 PREFIX/CONSTRAINT 模板拼 system_prompt（含环境内其他角色名）；_think 用 STATE_TEMPLATE 注入对话历史让 LLM 选状态；Planner.get_useful_memories 用 STRUCTURAL_CONTEXT 裁剪上下文；ActionNode.compile 把 instruction+example+constraint 编译成结构化 prompt |
| [[nanobot\|nanobot]] | ContextBuilder 组装 system prompt（identity + 引导文件 AGENTS/SOUL/USER.md + 长期记忆 + 技能摘要）；runner 内做上下文治理：drop 孤儿 tool 结果、backfill 缺失、_microcompact 折叠旧工具结果、按 token 预算 _snip_history、大工具结果落盘（maybe_persist_tool_result）；turn 级 MCP/CLI-app runtime 注释行 |
| [[open-multi-agent\|Open Multi-Agent]] | 4 种 contextStrategy：sliding-window(按 turn 边界保尾)、summarize(LLM 摘要旧消息+缓存)、compact(规则压缩、保留 tool_use/截断长文本)、custom；另 compressToolResults 压已消费工具输出；按 turn 边界切分避免孤立 tool_use_id；prompt 注入仅默认给"依赖任务输出"(default-deny)，memoryScope:'all' 才给全量 |
| [[openclaw\|OpenClaw]] | system prompt 由 harness 组装（注入 AGENTS.md/工作区文件 + 可见 skills 元数据 XML 块）；transformContext/convertToLlm 在每轮把 AgentMessage[] 转 LLM Message[]；超窗自动 compaction（摘要旧消息、保留 file-ops 清单 readFiles/modifiedFiles），并有 compaction-safeguard / context-pruning 运行时 hook |
| [[pipecat\|Pipecat]] | LLMContext 为单一上下文真相，由 LLMContextAggregatorPair 拆成 user/assistant 两个 aggregator 在管道里增量聚合；system_instruction 经 service 注入并可 append_system_instruction；LLMContextSummaryRequestFrame 触发上下文摘要（context-summarization 示例） |
| [[praisonai\|PraisonAI]] | system prompt 由 instructions/role/goal/backstory 拼装；可选 ContextCompactor（execution.context_compaction=True 时超 max_context_tokens 自动摘要压缩，带 BEFORE/AFTER_COMPACTION hook）；ContextAgent 做 fast-context 注入；RAG 检索结果按需拼入 |
| [[semantic-kernel\|Semantic Kernel]] | system prompt 经 IPromptTemplate(Handlebars/Liquid/SK 语法)渲染并注入变量；AggregateAIContextProvider 在每轮调用前聚合多个 AIContextProvider 的额外指令/函数注入到 kernel(AddFromAIContext)；ChatHistory reducer 控制 token 预算 |
| [[smolagents\|smolagents]] | system_prompt 由 Jinja 模板 populate_template 注入 tools/managed_agents/authorized_imports/instructions；每步把记忆重放为消息；planning summary_mode 裁剪历史；observation/输出经 truncate_content 截断。无自动压缩 |
| [[strands\|Strands Agents]] | system_prompt 支持 str 或 SystemContentBlock 列表(含 cache point)；ConversationManager 在 ContextWindowOverflowException 时 reduce_context 重试(agent.py:1055)；count_tokens 启发式估算(tiktoken 或 chars/4)做前瞻压缩；context_offloader vended plugin |
| [[swarm\|Swarm]] | system=instructions + history；context_variables 注入函数且对模型隐藏 |
| [[swarmclaw\|SwarmClaw]] | prompt 由众多 section 组合（identity/planning/thinking/runtime/workspace/agent-awareness/situational/project/credential/delegation/run-context…）；自动 compaction（context 阈值触发，可配 generation preference）；内部 meta 标记用"平衡括号+zod"剥离不外泄 |
| [[swarms\|Swarms]] | system_prompt 注入 + 历史拼接（return_history_as_string）；v12 ContextCompressor 在 token 用量超 90% 阈值时 maybe_compress 摘要旧消息；transforms 可在每轮重写 task_prompt；dynamic_context_window 工具 |
| [[transformers-agents\|Transformers Agents]] | 系统提示 + 工具描述 + ReAct 轨迹拼接 |
| [[upsonic\|Upsonic]] | context_management=True 时中间件在接近 model 上下文上限时剪枝工具历史 + 摘要旧消息（保留 context_management_keep_recent(默认5) 条，可指定更大窗口的 context_management_model）；system_prompt 由 SystemPromptBuildStep 组装(role/goal/instructions/education/work_experience/culture/metadata) |
| [[vectara-agentic\|vectara-agentic]] | 提示词模板化：GENERAL_PROMPT_TEMPLATE / REACT_PROMPT_TEMPLATE（prompts.py:134,150）由 format_prompt 注入 topic/date/general+custom 指令（factory.py:32）。get_general_instructions 按是否含 DB 工具动态拼接指令（prompts.py:111）；强约束“仅基于工具输出、内联引用”。Gemini 工具需 sanitize_tools_for_gemini（agent.py:153） |
| [[voltagent\|VoltAgent]] | system prompt(instructions 静态/动态)、conversation buffer、消息归一化(message-normalizer)、按 token 的上下文裁剪(contextLimit)与 apply-summarization 摘要旧消息；createPrompt 工具 |
