---
title: "工具调用"
aliases:
  - Tool Use
  - Function Calling
  - Tools
  - MCP
tags:
  - knowledge-base
  - domain/agent-components
  - component/tool-use
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 工具调用

> [!abstract] 一句话总结
> agent 与外部世界交互的手段：定义工具（名字+参数 schema+实现）→ 把工具暴露给模型 → 模型产出调用 → 框架解析并执行 → 结果回灌。是把 LLM 从"会说"变成"会做"的关键组件。MCP 正在成为工具的标准协议。

## 它解决什么问题

模型本身只能生成文本。工具让它能查数据库、调 API、跑代码、读写文件——把语言能力接到真实动作上。

## 设计维度 / 实现谱系

- **工具定义方式**：装饰器/函数签名自动生成 schema（[[connectonion\|ConnectOnion]]、[[strands\|Strands]]）↔ 显式 schema 类 ↔ OpenAPI 导入
- **调用机制**：原生 function calling ↔ 文本协议解析（ReAct 格式）↔ **写代码调用**（CodeAct，[[smolagents]]）
- **执行**：本地函数 ↔ 远程/沙箱（[[e2b\|e2b]]、[[runtime-execution]]）
- **标准化**：私有工具 ↔ **MCP**（Model Context Protocol，跨框架复用工具）
- **错误与校验**：参数校验、超时、重试、结果截断

## 关键要点

- "函数即工具"是当下主流（最低样板代码）。
- **CodeAct**（让模型写代码组合多工具）表达力远超单次 function call，但需安全沙箱。
- MCP 是重要趋势：工具一次实现、多框架/多 agent 复用。

## 关联

- [[runtime-execution]] · [[skills-plugins]] · [[context-engineering]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **44** 个实现了「工具调用」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 工具=Claude Code 内置工具 + 受限 bash，由 runner 的 --allowedTools 白名单授权（Read,Write,Edit,Glob,Grep,WebFetch,WebSearch + Bash(gh:)/Bash(git:)/Bash(curl:)/Bash(./notify:) 等）。gh CLI 处理 GitHub 鉴权；./notify 运行时生成 |
| [[ag2\|AG2]] | 原生 function/tool calling。@agent.register_for_llm() 把函数转 schema（type hints + Annotated 描述）供 LLM 调用，@executor.register_for_execution() 注册到执行方；Tool 类封装 func+schema，inject_params 支持依赖注入（Depends）；执行在 generate_tool_calls_reply |
| [[agency-swarm\|Agency Swarm]] | 三条路：①@function_tool（SDK，签名+docstring 自动转 schema）；②BaseTool（pydantic BaseModel+run()，openai_schema 生成 JSON Schema）；③ToolFactory 从 OpenAPI/MCP/LangChain 批量导入。tools_folder 自动发现 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | extension 类把方法挂进 self.commands 字典即成工具；运行时 Extensions.execute_command 按签名注入参数与 injection_variables（user_id/agent_id/ApiClient/凭据等）；支持 client-side 远程工具与 MCP（Use MCP Server 命令、mcp_client.py） |
| [[agentdock\|AgentDock]] | 工具=扩展 BaseNode 的节点；createTool({name,description,parameters:zod,execute}) 创建（nodes/tool/index.ts:190）；全局 DefaultToolRegistry 单例注册，getToolsForAgent(nodeNames) 按 agent 的 nodes 取工具；运行时 streamWithOrchestration 包装 execute 注入 llmContext(CoreLLM 实例) |
| [[agentfield\|AgentField]] | 两类原语：@app.reasoner(AI)/@app.skill(确定性) 经装饰器自动转 REST 端点；app.ai(tools=...) 支持 raw OpenAI tool schema 或 tools="discover" 让 LLM 自动发现并调用 mesh 内其他 agent；底层用 LiteLLM function calling + 工具循环执行 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 框架自身的"工具"是给内部 agent 的：SkillManager 的 add/update/remove/tag_skill+search/read_skill（sm_tools.py），RR 的 execute_code/think/read_skill/search_skillbook（rr/tools.py）。被学习对象（用户 agent）的工具调用由其所属框架(LangChain/browser-use)负责，ACE 仅消费其 trace |
| [[agentscope\|AgentScope]] | Toolkit 统一管理函数/MCP/技能；FunctionTool 用 inspect+docstring 自动抽 JSON schema(_extract_input_schema)；工具按 group 分组、可 agentic 激活/停用(meta tool)；执行经 call_tool，支持并发安全标记 is_concurrency_safe 与状态注入 is_state_injected(_agent_state) |
| [[agentverse\|AgentVerse]] | ToolAgent（simulation）内含 while 循环：LLM→parse 若为 AgentAction 则 _call_tool 执行并把 Observation 回灌，直到 AgentFinish（tool.py:36）；工具是 LangChain BaseTool，经 BMTools（load_single_tools/import_all_apis）加载；task-solving 工具用经 XAgent ToolServer 的 executor: tool_using |
| [[ailoy\|Ailoy]] | Tool 枚举三态：Function/MCP/Knowledge（src/tool/base.rs:26）。普通函数转工具：Python 侧用 inspect+type hints+Google docstring 自动生成 JSON schema（bindings/python/ailoy/_patches.py:209 get_json_schema）；Rust 侧 ToolFunc = dyn Fn(Value)->Future（src/tool/function.rs:17）。内置工具：Terminal / WebSearch(DuckDuckGo) / WebFetch（src/tool/builtin/mod.rs:14） |
| [[astron\|Astron Agent]] | 工具=BasePlugin（name/description/schema_template/typ/run callable）；schema 以文本模板注入 system prompt 的 {tools}，非 JSON function schema；执行时按 action 名字符串匹配 plugin 并 await plugin.run(action_input)；找不到返回 400 占位 |
| [[autogen\|AutoGen]] | Tool Protocol + BaseTool（pydantic args schema）；FunctionTool 用 inspect 从函数签名+docstring 自动生成 schema（args_base_model_from_signature）；原生 function calling，工具经 Workbench 暴露给 LLM；支持 MCP（McpWorkbench）与 AgentTool（把 agent 当工具）；并行执行用 asyncio.gather |
| [[botpress\|Botpress]] | new Tool({name,description,input,output,handler,retry})，input/output 用 Zui schema 做校验+TS 类型生成；工具以真实 async 函数签名注入沙箱，LLM 直接 await tool(args) 调用；内置 retry 逻辑；getTypings() 生成给 prompt 的类型 |
| [[connectonion\|ConnectOnion]] | 普通函数→create_tool_from_function 自动转 schema；class 实例自动抽方法为工具；原生 function calling；声明 agent 形参的工具运行时注入且对 LLM 隐藏(_needs_agent) |
| [[cortex-mem\|Cortex Memory]] | 反向——它是"被 agent 当工具调用"的一方：cortex-mem-rig 暴露 11 个 Rig Tool(abstract/overview/read/search/find/ls/explore/store…)，MCP server 暴露 search/recall/store/commit/ls/explore/abstract/overview/content 等工具 |
| [[crewai\|CrewAI]] | BaseTool(pydantic args_schema) / Tool；@tool 装饰器或子类化；native 模式转 OpenAI schema，ReAct 模式渲染文本；ToolUsage 负责选择/执行/缓存/容错 |
| [[dust\|Dust]] | 统一为 MCP：内置工具与第三方集成都实现为 MCP server，原生 function calling；工具规格 buildToolSpecification，执行 mcp_execution.ts；60+ 内置 server 在 index 注册 |
| [[haystack\|Haystack]] | Tool dataclass（name+description+JSON-schema parameters+function）；@tool/create_tool_from_function 用 type hints+docstring 自动生成 schema；ComponentTool/PipelineTool 把任意 component/pipeline 包成 tool；ToolInvoker component 解析 LLM 的 ToolCall 并执行，结果可经 outputs_to_state 写回 State；Toolset/SearchableToolset(语义检索工具,支持 MCP) |
| [[hcom\|hcom]] | 不抽象 LLM 工具调用；hcom 本身是 agent 通过 shell 调用的"工具"。bootstrap primer（~700 token）教 agent hcom send/list/events/term/... 用法；安全命令可免审批 |
| [[hermes-agent\|Hermes Agent]] | 中央 ToolRegistry：每个工具文件 import 时 registry.register(name, toolset, schema, handler, check_fn…) 自注册，AST 扫描自动发现(discover_builtin_tools)；原生 function calling；执行支持并发/顺序两路；危险命令经 approval 拦截 |
| [[hive\|Hive]] | 原生 function calling；工具主要经 MCP 暴露（ToolRegistry 发现：内建→tools.py→MCP server→手动注册）；Tool dataclass 带 concurrency_safe（安全工具同回合并行）、produces_image（对纯文本模型隐藏） |
| [[lagent\|Lagent]] | 两条路：①@tool_api 装饰器 + ToolMeta 元类，用 griffe 解析 typehint+docstring 自动生成 schema，BaseAction 可单函数(run)或多 API toolkit；ActionExecutor 按 name.api 路由调用并裹 ActionReturn；②fc_agent 走 LLM 原生 function calling（get_tool_prompt 转 OpenAI tools schema） |
| [[langchain\|LangChain]] | 普通函数/BaseTool/dict 均可；BaseTool 即 Runnable（tools/base.py:405）；执行器是 langgraph 重导出的 ToolNode（tools/tool_node.py:4），支持并行 Send、InjectedState/ToolRuntime 注入、return_direct；模型经 bind_tools 绑定（factory.py:1249） |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 三态：built-in(builtin::websearch/builtin::rag/knowledge_search)、client tool(@client_tool 装饰函数 / 继承 ClientTool 实现 get_params_definition+run_impl)、code interpreter。工具以 list 传入 Agent(tools=[...]) |
| [[llamaindex\|LlamaIndex]] | 普通函数→FunctionTool.from_defaults 用 inspect.signature+type hints+docstring 自动生成 schema(create_schema_from_function)；声明 Context 形参的工具运行时注入且对 LLM 隐藏(requires_context/ctx_param_name)；return_direct 工具结果直接返回；并行 tool calls 默认开 |
| [[llm-agents\|llm-agents]] | 文本协议而非原生 function-calling：工具实现 ToolInterface.use(input_text)->str；tool_description/tool_names/tool_by_names 把工具列表渲染进 prompt 供 LLM 选；解析后按名查表调用，未知工具抛 ValueError。内置 PythonREPL/SerpAPI/Google/Searx/HackerNews |
| [[loongflow\|LoongFlow]] | Toolkit 注册/分发 FunctionTool；声明优先 Pydantic args_schema，否则 inspect.signature+docstring 自动生成 OpenAI function schema；tool_context 形参运行时注入且从 schema 隐藏；内置 Read/Write/Ls/Shell/Todo/Agent/ExecuteCode 等工具；ReAct 侧 Actor 可串行/并行执行 |
| [[mastra\|Mastra]] | createTool({ id, description, inputSchema, outputSchema, execute })，Zod/Standard-Schema 定义入参出参，运行时自动校验输入输出（validateToolInput/validateToolOutput）；工具也可声明 suspendSchema/resumeSchema 支持 HITL；兼容 Vercel AI SDK tool 与 MCP 工具 |
| [[metagpt\|MetaGPT]] | 经典角色无通用工具调用（Action 即"能力"）；工具体系服务于 RoleZero/DataInterpreter：@register_tool 装饰器把类/函数注册进 ToolRegistry（AST 自动抽 schema），ToolRecommender（TypeMatch / BM25 / Embedding 三种召回）按任务推荐工具子集 |
| [[nanobot\|nanobot]] | Tool ABC（name/description/parameters JSON Schema + execute）；ToolLoader pkgutil 扫描自动注册，@tool_parameters 装饰器注入 schema；ToolRegistry 缓存定义、prepare_call 做类型 cast+校验；runner 支持并发批（concurrency_safe/read_only）执行 |
| [[open-multi-agent\|Open Multi-Agent]] | defineTool() + Zod schema → 自研 zodToJsonSchema 转 JSON Schema 喂 LLM；ToolRegistry 注册、三层过滤(preset→allowlist→denylist)；6 内置(bash/file_read/file_write/file_edit/grep/glob)；工具错误永不抛出，捕获为 ToolResult{isError:true} |
| [[openclaw\|OpenClaw]] | 原生 function calling；AgentTool 契约带 execute(id,args,signal,onPartial)，支持 executionMode: "sequential" 与 prepareArguments；内置编码工具 bash/read/write/edit/process + web_search/web_fetch + browser/canvas/cron/nodes/sessions_ 等；参数经 validateToolArguments 校验，beforeToolCall/afterToolCall 钩子可拦截/改写 |
| [[pipecat\|Pipecat]] | LLM service 上 register_function(name, handler) 注册函数，handler 收 FunctionCallParams；支持 direct function、并行/顺序执行、cancel_on_interruption、超时；外部工具经 MCPClient.register_tools(llm) 把 MCP server 工具批量注册 |
| [[praisonai\|PraisonAI]] | 普通 Python 函数即工具，@tool 装饰器（inspect.signature+docstring 自动生成 schema）或裸函数皆可；BaseTool 类工具；原生 function-calling，循环执行 execute_tool；YAML 模式自动发现 tools.py 内同名函数；内置 100+ 工具（搜索/文件/shell/web crawl 等） |
| [[semantic-kernel\|Semantic Kernel]] | 三种来源统一为 KernelFunction：① C# 方法+[KernelFunction] 经 KernelFunctionFromMethod 反射生成 schema；② prompt 模板 KernelFunctionFromPrompt；③ OpenAPI/gRPC 导入。FunctionChoiceBehavior.Auto/Required/None 控制模型选择；工具可经 [FromKernelServices] 注入 DI 服务 |
| [[smolagents\|smolagents]] | 两种范式：CodeAgent 把工具当 Python 函数在沙箱内调用；ToolCallingAgent 走原生 JSON function-calling（process_tool_calls/execute_tool_call）。工具定义=@tool 装饰器或 Tool 子类(forward())，自动从 type hints/docstring 生成 schema |
| [[strands\|Strands Agents]] | @tool 装饰器经 inspect+type hints+docstring_parser+Pydantic 自动生成 JSON schema；原生 function calling；支持目录热加载(load_tools_from_directory)、ToolProvider、agent-as-tool；默认并发执行 |
| [[swarm\|Swarm]] | 普通 Python 函数 → function_to_json 自动转 OpenAI tool schema；原生 function calling |
| [[swarmclaw\|SwarmClaw]] | 工具 = LangChain tool() + zod schema，运行时按 session 策略动态装配（buildSessionTools）；含 shell/file/web/email/image/delegate/subagent/memory/schedule/task 等；normalize-tool-args 容错；终端工具（memory_write/durable_wait/context_compaction）强制结束回合 |
| [[swarms\|Swarms]] | 普通 Python 函数（带 docstring/type hints）→ BaseTool.func_to_dict 自动转 OpenAI function schema；Pydantic 模型经 base_model_to_openai_function；原生 function calling，结果回灌对话 |
| [[transformers-agents\|Transformers Agents]] | Tool 抽象 + HF 工具箱（pipeline 封装）；支持代码调用与 JSON 调用 |
| [[upsonic\|Upsonic]] | @tool 装饰器 + ToolConfig(requires_confirmation/requires_user_input/external_execution/sequential/cache_results)；支持普通函数、ToolKit 类、agent-as-tool、MCP；统一经 ToolRegistry/ToolManager 归一化 schema |
| [[vectara-agentic\|vectara-agentic]] | 三类来源：① Vectara RAG/search 工具（tools.py:448 / tools.py:199）；② 任意 Python 函数 ToolsFactory.create_tool（tools.py:763）；③ LlamaIndex ToolSpecs 桥接 get_llama_index_tools（tools.py:784）。统一经 create_tool_from_dynamic_function（tool_utils.py:386）按签名+Pydantic schema 生成 VectaraTool；get_current_date 工具自动追加（agent.py:133） |
| [[voltagent\|VoltAgent]] | createTool/tool() 用 Zod schema 定义工具，编译为 AI SDK Tool；支持 lifecycle hooks(onStart/onEnd)、needsApproval(HITL 审批)、Toolkit 分组、tool routing(embedding 检索式选工具) |
