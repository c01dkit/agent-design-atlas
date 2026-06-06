---
title: "模型抽象层"
aliases:
  - Model Abstraction
  - LLM Provider
tags:
  - knowledge-base
  - domain/agent-components
  - component/model-abstraction
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 模型抽象层

> [!abstract] 一句话总结
> 用统一接口屏蔽不同 LLM provider（OpenAI / Anthropic / 本地模型 / 国产模型…）的差异：聊天、流式、函数调用、多模态、token 计数。让上层 agent 逻辑与具体模型解耦、可切换。

## 它解决什么问题

各家 API 形态不一、能力不一。抽象层让你"一次编写、多模型运行"，并便于做成本/质量权衡与回退。

## 设计维度 / 实现谱系

- **覆盖广度**：单一 provider ↔ 几家主流 ↔ 100+（[[praisonai\|PraisonAI]] 借 LiteLLM）
- **能力面**：纯文本 ↔ 流式 ↔ 原生 function calling ↔ 多模态 ↔ 结构化输出
- **本地/边缘**：是否支持本地推理 / WASM 浏览器内运行（[[ailoy\|Ailoy]]）
- **统一程度**：薄封装（暴露原始差异）↔ 厚抽象（统一消息/工具格式）
- **回退/路由**：失败切换、按任务路由到不同模型

## 关键要点

- 很多框架直接复用 LiteLLM 等聚合层，而非自己适配每家。
- 是否支持**原生 function calling** 显著影响 [[tool-use|工具调用]]的可靠性。
- 本地/WASM 支持是"随处运行"类框架的差异化点。

## 关联

- [[tool-use]] · [[reasoning-loop]] · [[component-taxonomy]] · [[language-ecosystem]]

## 各框架实现对比

> 下表汇总 **46** 个实现了「模型抽象」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 模型名为字符串，三级覆盖：workflow_dispatch 入参 > per-skill model: > aeon.yml 顶层 model:（默认 claude-opus-4-8）。Gateway 路由：gateway.provider: bankr 时改写 ANTHROPIC_BASE_URL=https://llm.bankr.bot 解锁 Gemini/GPT/Kimi/Qwen；或 vars.ANTHROPIC_BASE_URL 接任意 Anthropic 兼容端点 |
| [[ag2\|AG2]] | ModelClient 是 Protocol（须实现 create/message_retrieval/cost/get_usage）；OpenAIWrapper 按 config 的 api_type 路由到各 provider client（openai/azure/anthropic/gemini/bedrock/mistral/groq/cohere/ollama/together/cerebras/deepseek 等）；统一以 OpenAI ChatCompletion 格式为内部协议；支持 config_list 故障转移与 register_model_client 自定义 |
| [[agency-swarm\|Agency Swarm]] | 直接复用 SDK 的 Model/ModelSettings；默认 gpt-5.4-mini，OpenAI 走 OpenAIResponsesModel，其它厂商（Claude/Gemini/Grok/Azure/OpenRouter）经可选 LitellmModel（litellm extra）路由 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | provider = CATEGORY="AI Provider" 的 extension，按 services()（llm/tts/image/embeddings/vision…）分类自动发现；get_providers_by_service 路由；内置 OpenAI/Anthropic/Gemini/Azure/DeepSeek/HuggingFace/ezlocalai 等（extensions/.py） |
| [[agentdock\|AgentDock]] | CoreLLM 统一封装 Vercel AI SDK LanguageModel，暴露 generateText/streamText/generateObject 等；createLLM 工厂 + ProviderRegistry 按 provider 路由 adapter（anthropic/openai/google/groq/deepseek/cerebras）；支持 primary+fallback 双 LLM |
| [[agentfield\|AgentField]] | 经 LiteLLM 统一 100+ LLM provider（AIConfig(model="anthropic/...")）；app.ai(schema=...) 通过 system prompt 注入 schema 指令 + LiteLLM response_format=json_schema 双保险得到 typed 输出；支持 stream、多模态(image/audio)、temperature 等 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 经 PydanticAI 统一；resolve_model() 把 LiteLLM 风格模型名路由到 PydanticAI 原生 provider 或 litellm: 代理（100+ provider：OpenAI/Anthropic/Google/Bedrock/Groq…）；可按角色分别配模型(ACEModelConfig) |
| [[agentscope\|AgentScope]] | ChatModelBase 抽象 async __call__(messages, tools, tool_choice)，统一 stream/重试/count_tokens/context_size；8 家实现(Anthropic/DashScope/DeepSeek/Gemini/Ollama/OpenAIChat/OpenAIResponse/XAI/Moonshot)；各家配套 formatter/ 把 Msg+block 转 provider 报文；credential/ 解耦密钥 |
| [[agentset\|Agentset]] | 全栈基于 Vercel AI SDK（generateText/streamText/embed/generateObject）；LLM 经 Azure 网关按名映射(gpt-4.1/gpt-5)，embedding 工厂支持 Azure/OpenAI/Voyage/Google，按 namespace 配置动态 import |
| [[agentverse\|AgentVerse]] | BaseLLM 抽象（generate_response/agenerate_response/get_spend，统一返回 LLMResult）+ llm_registry；主实现 OpenAIChat（含 Azure 分支）；本地模型经 vLLM / FSChat 走 OpenAI 兼容端点，LOCAL_LLMS/LOCAL_LLMS_MAPPING 列表登记 |
| [[ailoy\|Ailoy]] | LangModel 包 LangModelInner::{Local, StreamAPI, Custom}（src/model/language_model.rs:184），统一 LangModelInference trait（infer / infer_delta，src/model/language_model.rs:135）。Local=TVM；StreamAPI 经 APISpecification 枚举支持 ChatCompletion/OpenAI(Responses)/Gemini/Claude/Grok（src/model/api/mod.rs:36）；EmbeddingModel 同构（本地/远程） |
| [[astron\|Astron Agent]] | BaseLLMModel（默认走 OpenAI 兼容 AsyncOpenAI.chat.completions）+ ProviderLLMModel 子类按 provider 适配：AnthropicLLMModel（/v1/messages + SSE 归一化）、GoogleLLMModel（generateContent SSE）；OpenAI 兼容白名单含 deepseek/doubao/qwen/zhipu/moonshot/minimax 等；create_model() 按 provider 字符串分发 |
| [[autogen\|AutoGen]] | ChatCompletionClient 抽象基类定义 create/create_stream/model_info（ModelInfo TypedDict 描述 vision/function-calling/family 等能力）；统一 LLMMessage（System/User/Assistant/FunctionExecutionResult）与 CreateResult；具体 OpenAI/Azure/Anthropic 等 client 在 autogen-ext |
| [[botpress\|Botpress]] | Cognitive 客户端封装多 provider：best/fast/auto 预设或 integration:model-id ModelRef；按 tag/价格/vendor 打分排序；provider 宕机自动标 degraded 并回退下一个模型（5 分钟）；统一 generateContent |
| [[connectonion\|ConnectOnion]] | LLM 抽象基类 + create_llm() 工厂按模型名前缀路由；OpenAI/Anthropic/Gemini/Groq/Grok/Mistral/OpenRouter/OpenOnion(co/)；OpenAI message 格式为 lingua franca，统一 ToolCall dataclass |
| [[cortex-mem\|Cortex Memory]] | LLMClient trait(llm/client.rs) + EmbeddingClient(embedding/client.rs:334 embed,:364 embed_batch)，均走 OpenAI 兼容 HTTP 端点；底层依赖 rig-core 0.31(Cargo.toml:41)；模型在 config.toml 配 model_efficient/model_reasoning |
| [[crewai\|CrewAI]] | BaseLLM 抽象基类 + LLM.__new__ 工厂按 provider/model 前缀路由：openai/anthropic/azure/bedrock/gemini 走原生 SDK，其余回退 LiteLLM；create_llm 统一构造 |
| [[dust\|Dust]] | 两层：新 front 原生 LLM router getLLM 按 modelId 路由到各 provider 客户端（Anthropic/OpenAI/Google/Mistral/xAI/Fireworks/Noop）；旧 core 的 LLM trait + provider 实现（迁移中） |
| [[haystack\|Haystack]] | 基于 Protocol（鸭子类型）而非基类：ChatGenerator 协议仅要求 run(messages)->dict、返回 replies: list[ChatMessage]；OpenAI/Azure/HF 内置，其余厂商在 haystack-core-integrations；ChatMessage/ToolCall 为统一数据格式；FallbackChatGenerator 多模型故障转移 |
| [[hermes-agent\|Hermes Agent]] | 声明式 ProviderProfile dataclass(auth/endpoint/api_mode/quirks)，插件式注册(plugins/model-providers/<name>/，用户插件 last-writer-wins 可覆盖内置)；底座是 OpenAI SDK，另带 anthropic/bedrock/gemini-native/codex-responses 等专属 adapter；hermes model 一条切换、credential pool 多 key 轮换、无代码改动 |
| [[hive\|Hive]] | LLMProvider ABC（acomplete/stream，统一 LLMResponse 含 token/cost）；实现：LiteLLM(100+ provider，含 ollama 本地)、原生 Anthropic、Antigravity、Mock；model_catalog.py 管定价 |
| [[lagent\|Lagent]] | BaseLLM/AsyncBaseLLM 定义 chat/generate/stream_chat；LMTemplateParser 用 meta_template 把对话拼成模型专属字符串；多 provider wrapper：GPTAPI、ClaudeAPI、HFTransformer、VllmModel、LMDeploy、Sensenova；AsyncOpenAIWrapper.chat 直接返回原生 ChatCompletion(含 tool_calls) |
| [[langchain\|LangChain]] | BaseChatModel(core) 为统一接口，暴露 invoke/stream/bind_tools/with_structured_output；init_chat_model("provider:model") 按前缀懒加载 partner 实现（_BUILTIN_PROVIDERS 表覆盖 anthropic/openai/google/groq/ollama…）；模型可整体互换 |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | 模型抽象在服务端 Inference API；客户端按 model_id 字符串选模型，client.models.list() 发现可用模型(区分 model_type=="llm" 与含 "guard" 的安全模型)。模型族=Llama 3.1/3.2 等 |
| [[llamaindex\|LlamaIndex]] | BaseLLM→LLM→FunctionCallingLLM 三层抽象；统一 ChatMessage/ChatResponse 与 block 化多模态；achat_with_tools/get_tool_calls_from_response/predict_and_call 抹平各家 function calling；300+ provider 在 integrations 包；Settings.llm 全局默认 |
| [[llm-agents\|llm-agents]] | 单一 ChatLLM pydantic 类，硬编码调用 OpenAI 旧版 openai.ChatCompletion.create；只暴露 model/temperature，无多 provider 路由、无统一消息抽象（单条 user message） |
| [[loongflow\|LoongFlow]] | BaseLLMModel 抽象 + LiteLLMModel 默认实现，底层走 LiteLLM，统一 CompletionRequest/CompletionResponse，async generator 支持流式；from_config 读 model/url/api_key，默认 provider=openai（如 openai/gemini-3-pro-preview）；ClaudeCodeAgent 另走 Anthropic 兼容端点 |
| [[maestro\|Maestro]] | maestro.py 直接绑定 Anthropic SDK；跨 provider 抽象在 maestro-anyapi.py 经 LiteLLM completion() 统一 OpenAI-style 接口（Anthropic/OpenAI/Gemini/Cohere…），另有 groq/ollama/lmstudio 专用变体 |
| [[mastra\|Mastra]] | 字符串 provider/model 经 ModelRouterLanguageModel 解析（gateway-resolver + provider-registry.json，覆盖 40+ provider），统一为 AI SDK v5/v6 LanguageModelV2；也接受直接传入 AI SDK model 实例；resolveModelConfig 兜底 v4 包装；支持 model fallbacks / retries |
| [[metagpt\|MetaGPT]] | BaseLLM 抽象基类（aask/acompletion/acompletion_text）+ @register_provider 按 LLMType 注册，create_llm_instance 工厂按 api_type 路由；内置 OpenAI/Azure/Anthropic/Gemini/Ollama/Bedrock/Qianfan/Zhipu/Spark/Dashscope/Ark 等十余 provider；统一 OpenAI message 格式 |
| [[modus\|Modus]] | 泛型接口 Model[TIn,TOut]{Info();Invoke(in)} + GetModel[TModel](name) 工厂；按 manifest 名解析，Invoke 经 host function hostInvokeModel 走 Runtime 调用 provider；内置 OpenAI/Anthropic/Gemini/Meta-Llama 及 experimental 分类/嵌入封装 |
| [[nanobot\|nanobot]] | LLMProvider ABC（OpenAI message 为通用格式，统一 LLMResponse/ToolCallRequest）；factory.make_provider 按 provider backend 路由：openai_compat/anthropic/azure/bedrock/github_copilot/openai_codex/openai_responses；FallbackProvider 做多模型 failover，原生 openai+anthropic SDK（已弃用 litellm） |
| [[open-multi-agent\|Open Multi-Agent]] | LLMAdapter 接口(chat+stream) + createAdapter() 懒加载工厂，按 provider 名路由；12 内置 provider + 任意 OpenAI 兼容端点(baseURL)；统一 thinking 配置映射到 Anthropic thinking / Gemini thinkingConfig / OpenAI reasoning_effort；Vercel AI SDK 经 AISdkAdapter 桥接 |
| [[openclaw\|OpenClaw]] | 两层：packages/llm-core 定义统一 Model 接口(api/provider/cost/contextWindow/thinkingLevelMap) 与 StreamFn；packages/llm-runtime/api-registry.ts 按 model.api 注册/路由 provider 适配器；src/llm/providers/ 实现 OpenAI(completions/responses/chatgpt)/Anthropic/Google(+Vertex)/Mistral/Azure/Copilot 等；OAuth 订阅(ChatGPT/Codex)走 src/llm/oauth.ts，支持 auth profile 轮换与 failover |
| [[pipecat\|Pipecat]] | 服务基类体系 AIService→LLMService/STTService/TTSService/VisionService；60+ provider 实现（openai/anthropic/google/groq…）；BaseLLMAdapter（泛型）把统一 LLMContext/ToolsSchema 转成各家 provider 的 messages/tools 格式 |
| [[praisonai\|PraisonAI]] | LLM 类包一层 LiteLLM，覆盖 100+ provider(OpenAI/Anthropic/Gemini/Ollama/Groq/Bedrock/Vertex…)；drop_params/modify_params 抹平差异；ModelRouter.select_model() 按任务能力/预算自动路由到最便宜可用模型；failover / rate_limiter / cost 计量 |
| [[semantic-kernel\|Semantic Kernel]] | IChatCompletionService（及 ITextGeneration/IEmbeddingGenerator/ITextToImage 等）为统一接口，每厂商一个 Connectors. 包；IAIServiceSelector(默认 OrderedAIServiceSelector) 按 serviceId/modelId 选服务；正向 Microsoft.Extensions.AI.IChatClient 收敛（AsChatCompletionService() 桥接） |
| [[smolagents\|smolagents]] | Model 基类统一 generate()/generate_stream()，_prepare_completion_kwargs 把消息归一为 OpenAI 格式 + tools schema；子类覆盖各 provider，支持 stop/structured output/vision |
| [[strands\|Strands Agents]] | 框架核心：Model ABC 仅需 stream/structured_output/get_config；13+ provider，默认 BedrockModel(Claude Sonnet)；传 str 走 Bedrock model-id，传实例走自定义；stateful 属性标记服务端托管会话 |
| [[swarm\|Swarm]] | 仅 OpenAI，硬编码 OpenAI() client，无抽象层 |
| [[swarmclaw\|SwarmClaw]] | buildChatModel：Anthropic 用 ChatAnthropic，其余 23+ provider 全部 OpenAI 兼容（patch baseURL→streamOpenAiChat/ChatOpenAI）；含 DeepSeek reasoning bridge、Ollama local/cloud、OpenClaw endpoint、gateway profile |
| [[swarms\|Swarms]] | 不自研 provider：LiteLLM 包装类持有模型名/参数，run() 内组装 completion_params 调 litellm.completion；自动探测 vision/reasoning 支持，映射 reasoning_effort/thinking_tokens |
| [[transformers-agents\|Transformers Agents]] | llm_engine（HfApiEngine / TransformersEngine / 兼容 OpenAI 等） |
| [[upsonic\|Upsonic]] | provider/model 字符串 → infer_model() 路由到具体 Model(Runnable 子类)；20+ provider(openai/anthropic/google/azure/bedrock/cohere/mistral/groq/xai/ollama/vllm…)；model_registry.py 带 benchmark/tier 元数据支持自动选型 |
| [[vectara-agentic\|vectara-agentic]] | get_llm(role, config)（llm_utils.py:174）按 provider 枚举工厂式实例化 LlamaIndex LLM；支持 OpenAI/Anthropic/Gemini/Together/GROQ/Bedrock/Cohere/Private(OpenAILike)。主 LLM 与工具 LLM 可分别配置（LLMRole.MAIN/TOOL，types.py:52）；带 LLM 实例缓存与各 provider 默认模型表 |
| [[voltagent\|VoltAgent]] | 直接复用 Vercel AI SDK 的 LanguageModel/EmbeddingModel（OpenAI/Anthropic/Google/Groq/Mistral/xAI/Bedrock/Vertex/Ollama 等十余 provider 作 deps）；另有 model-provider-registry 把字符串模型名经 models.dev API 解析为 provider，按 env 自动选 + 本地缓存 |
