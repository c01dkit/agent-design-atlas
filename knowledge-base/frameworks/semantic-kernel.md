---
title: "Semantic Kernel"
aliases:
  - Semantic Kernel
  - semantic-kernel
  - SK
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/semantic-kernel
  - lang/csharp
  - paradigm/model-stack
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/microsoft/semantic-kernel
license: MIT
stars: ~25k
---

# Semantic Kernel

> [!abstract] 一句话定位
> 微软出品的 model-agnostic 企业级 Agent SDK：核心是一个充当依赖注入容器的 Kernel，把 LLM 服务（connector）、工具（plugin/function）、过滤器、记忆/向量库统一挂在上面；在此之上提供 ChatCompletionAgent 单 agent 与多种多 agent 编排（Concurrent/Sequential/GroupChat/Handoff/Magentic）。一套抽象多语言落地（dotnet/C# 为主，python 镜像），强调可观测、稳定 API。注：README 已声明 SK 的继任者为 Microsoft Agent Framework。

## 设计理念 / 顶层架构

Semantic Kernel 的核心范式是 “Kernel 即 DI 容器 + KernelFunction 即统一可调用单元”。它不是单一 ReAct 循环框架，而是一套分层抽象，agent 只是建在内核上的一层薄壳。设计取舍：

- **Kernel 是中枢状态对象**：`Kernel`（`dotnet/src/SemanticKernel.Abstractions/Kernel.cs:26`）本身只持有一个 `IServiceProvider`（模型服务、logger、selector 全走 DI）、一个 `KernelPluginCollection`（插件/工具）、三类过滤器集合（function / prompt / auto-function-invocation）和一个 ambient `Data` 字典。它会被传入每一次 function 调用，是“贯穿全流程的共享状态”。`Kernel.Clone()`（`Kernel.cs:111`）做浅拷贝以支持 agent 级隔离。
- **一切皆 KernelFunction**：原生 C# 方法、prompt 模板、OpenAPI 操作、gRPC、其它 agent 都被归一成 `KernelFunction`（`dotnet/src/SemanticKernel.Abstractions/Functions/KernelFunction.cs:30`，继承 `Microsoft.Extensions.AI` 的 `AIFunction`）。多个 function 组成一个 `KernelPlugin`。
- **Connector = 模型抽象**：所有 LLM 厂商被收敛到 `IChatCompletionService`（`dotnet/src/SemanticKernel.Abstractions/AI/ChatCompletion/IChatCompletionService.cs:14`）等接口，OpenAI/AzureOpenAI/Google/Mistral/Ollama/HuggingFace/Onnx/Amazon 各为独立 `Connectors.*` 包，并逐步向 `Microsoft.Extensions.AI.IChatClient` 收敛。
- **过滤器取代旧 events**：横切关注点（鉴权、审批、改写、日志、HITL 终止）通过 `IFunctionInvocationFilter` / `IPromptRenderFilter` / `IAutoFunctionInvocationFilter` 注入，旧的 `FunctionInvoking/Invoked` 事件已 `[Obsolete]`（`Kernel.cs:617`）。
- **Planner 已被淘汰**：旧的 Stepwise/Handlebars planner 从 `dotnet/src` 主源码移除（仅剩 `InternalUtilities/planning/` 的工具类与 samples 里的迁移示例），“规划”现在交给 LLM 的 native function calling 自动循环（`FunctionCallsProcessor`）。
- **入口 API**：`Kernel.CreateBuilder()` → fluent 配置 connector/plugin → `Build()`；agent 侧 `new ChatCompletionAgent { Kernel = kernel, Instructions = ... }`，`agent.InvokeAsync(...)` 返回 `IAsyncEnumerable<AgentResponseItem<...>>`。

最小示例（取自 README，.NET）：

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;

var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(deployment, endpoint, apiKey); // 注册一个 connector 到 DI
var kernel = builder.Build();

kernel.Plugins.Add(KernelPluginFactory.CreateFromType<MenuPlugin>()); // 类的 [KernelFunction] 方法 -> 工具

ChatCompletionAgent agent = new()
{
    Name = "SK-Assistant",
    Instructions = "You are a helpful assistant.",
    Kernel = kernel,
    // 开启 FunctionChoiceBehavior.Auto() 后，模型可自动选择并调用插件函数
    Arguments = new KernelArguments(new PromptExecutionSettings { FunctionChoiceBehavior = FunctionChoiceBehavior.Auto() })
};

await foreach (AgentResponseItem<ChatMessageContent> response in agent.InvokeAsync("What is the price of the soup special?"))
    Console.WriteLine(response.Message);

sealed class MenuPlugin
{
    [KernelFunction, System.ComponentModel.Description("Provides the price of the requested menu item.")]
    public string GetItemPrice([System.ComponentModel.Description("The name of the menu item.")] string menuItem) => "$9.99";
}
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 非显式 ReAct；核心是 native function-calling 自动循环：模型返回 `FunctionCallContent`→`FunctionCallsProcessor` 查表执行→结果回灌 ChatHistory→再次请求模型，直到无工具调用或达上限。Agent 层把每轮新增的 tool/assistant 消息回写线程 | `dotnet/src/InternalUtilities/connectors/AI/FunctionCalling/FunctionCallsProcessor.cs:25`, `dotnet/src/Agents/Core/ChatCompletionAgent.cs:331` |
| [[planning\|规划/任务分解]] | 内核无独立 planner（旧 Stepwise/Handlebars planner 已从主源码移除，仅余 `InternalUtilities/planning/` 与 samples 迁移示例）。规划=模型自身多步 function calling；多步业务流程交给 Process 框架；Magentic manager 内含动态计划账本 | `dotnet/src/InternalUtilities/planning/PlannerInstrumentation.cs`, `dotnet/src/Agents/Magentic/MagenticProgressLedger.cs`, `dotnet/src/Experimental/Process.Core/ProcessBuilder.cs:517` |
| [[memory\|记忆(短/长/向量)]] | 短期=`ChatHistory`/`AgentThread`（多轮消息）；上下文压缩=`ChatHistorySummarizationReducer` / `ChatHistoryTruncationReducer`；向量长期记忆=独立 `VectorData.*` 连接器（AzureAISearch/Chroma/Qdrant/Redis/PgVector/Pinecone/Milvus/Weaviate…）+ 旧 `ISemanticTextMemory`(已弱化) | `dotnet/src/SemanticKernel.Core/AI/ChatCompletion/ChatHistorySummarizationReducer.cs:20`, `dotnet/src/SemanticKernel.Abstractions/Memory/`, `dotnet/src/VectorData/` |
| [[tool-use\|工具调用]] | 三种来源统一为 `KernelFunction`：① C# 方法+`[KernelFunction]` 经 `KernelFunctionFromMethod` 反射生成 schema；② prompt 模板 `KernelFunctionFromPrompt`；③ OpenAPI/gRPC 导入。`FunctionChoiceBehavior.Auto/Required/None` 控制模型选择；工具可经 `[FromKernelServices]` 注入 DI 服务 | `dotnet/src/SemanticKernel.Core/Functions/KernelFunctionFromMethod.cs:62`, `dotnet/src/SemanticKernel.Abstractions/AI/FunctionChoiceBehaviors/FunctionChoiceBehavior.cs:62`, `dotnet/src/Functions/Functions.OpenApi/Extensions/OpenApiKernelExtensions.cs:30` |
| [[model-abstraction\|模型抽象]] | `IChatCompletionService`（及 `ITextGeneration`/`IEmbeddingGenerator`/`ITextToImage` 等）为统一接口，每厂商一个 `Connectors.*` 包；`IAIServiceSelector`(默认 `OrderedAIServiceSelector`) 按 serviceId/modelId 选服务；正向 `Microsoft.Extensions.AI.IChatClient` 收敛（`AsChatCompletionService()` 桥接） | `dotnet/src/SemanticKernel.Abstractions/AI/ChatCompletion/IChatCompletionService.cs:14`, `dotnet/src/Connectors/Connectors.OpenAI/`, `dotnet/src/Agents/Core/ChatCompletionAgent.cs:261` |
| [[multi-agent-orchestration\|多智能体编排]] | 两代并存：① 旧 `AgentGroupChat`/`AgentChat`（轮转+终止策略）；② 新 `AgentOrchestration<TIn,TOut>` 基类下的 Concurrent / Sequential / GroupChat / Handoff / Magentic 五种模式，跑在 actor `Runtime` 上；GroupChat 由 `GroupChatManager`(SelectNextAgent/ShouldTerminate/ShouldRequestUserInput) 编排；agent 亦可作为另一 agent 的 plugin | `dotnet/src/Agents/Orchestration/AgentOrchestration.cs:39`, `dotnet/src/Agents/Orchestration/GroupChat/GroupChatManager.cs:30`, `dotnet/src/Agents/Orchestration/Handoff/HandoffOrchestration.cs:17`, `dotnet/src/Agents/Magentic/MagenticOrchestration.cs` |
| [[context-engineering\|上下文工程]] | system prompt 经 `IPromptTemplate`(Handlebars/Liquid/SK 语法)渲染并注入变量；`AggregateAIContextProvider` 在每轮调用前聚合多个 `AIContextProvider` 的额外指令/函数注入到 kernel(`AddFromAIContext`)；ChatHistory reducer 控制 token 预算 | `dotnet/src/SemanticKernel.Abstractions/Memory/AggregateAIContextProvider.cs:76`, `dotnet/src/Agents/Core/ChatCompletionAgent.cs:84`, `dotnet/src/Extensions/PromptTemplates.Handlebars/` |
| [[skills-plugins\|技能/插件]] | “Plugin” = 一组 `KernelFunction` 的命名集合(`KernelPlugin`/`KernelPluginCollection`)。`KernelPluginFactory.CreateFromType<T>()`/`AddFromObject` 把类方法变插件；另支持从 prompt 目录、OpenAPI、gRPC、Prompty、Markdown、Yaml 加载 | `dotnet/src/SemanticKernel.Abstractions/Functions/KernelPlugin.cs`, `dotnet/src/SemanticKernel.Core/Functions/KernelPluginFactory.cs`, `dotnet/src/SemanticKernel.Core/KernelExtensions.cs:511`, `dotnet/src/Functions/Functions.Prompty/` |
| [[observability-eval\|可观测/评估]] | 内建 OpenTelemetry：`KernelFunction` 自带 `ActivitySource("Microsoft.SemanticKernel")` + `Meter`(invocation/streaming duration histogram)；agent 调用经 `ModelDiagnostics.StartAgentInvocationActivity`；过滤器+结构化日志(`LoggerMessage`)。评估无内建框架，依赖外部 | `dotnet/src/SemanticKernel.Abstractions/Functions/KernelFunction.cs:41`, `dotnet/src/Agents/Core/ChatCompletionAgent.cs:352`, `dotnet/src/SemanticKernel.Abstractions/Filters/` |
| [[runtime-execution\|运行时/部署]] | 纯 SDK/库，宿主自管(async/IAsyncEnumerable 流式)。多 agent 编排跑在 `Agents/Runtime`(InProcess actor runtime)；Process 框架可 InProcess 或 Dapr 分布式运行(`Process.Runtime.Dapr`)；无内建沙箱，工具在宿主进程执行 | `dotnet/src/Agents/Runtime/InProcess/`, `dotnet/src/Experimental/Process.LocalRuntime/`, `dotnet/src/Experimental/Process.Runtime.Dapr/` |
| [[human-in-the-loop-governance\|人在环/治理]] | ① `IAutoFunctionInvocationFilter` 在工具自动调用前后拦截，可设 `context.Terminate=true` 中止循环、把结果交还用户审批(`FunctionCallsProcessor.cs:205/225/366` 消费)；② 编排层 `OrchestrationInteractiveCallback` / GroupChatManager `ShouldRequestUserInput` 请求人工输入；③ `FunctionChoiceBehavior.None` 让模型只建议不执行 | `dotnet/src/SemanticKernel.Abstractions/Filters/AutoFunctionInvocation/IAutoFunctionInvocationFilter.cs`, `dotnet/src/SemanticKernel.Abstractions/Filters/AutoFunctionInvocation/AutoFunctionInvocationContext.cs:16`, `dotnet/src/Agents/Orchestration/GroupChat/GroupChatManager.cs:77` |
| [[state-persistence\|状态/持久化]] | 会话状态在 `AgentThread`(如 `ChatHistoryAgentThread`，含 `OnSuspendAsync/OnResumeAsync` 生命周期)；旧式 `AgentChat` 用 `AgentChatSerializer` 序列化/恢复整个多 agent 对话；`ChatCompletionAgent.RestoreChannelAsync` 从 JSON 恢复 channel；Process 框架有 `KernelProcessStateMetadata` 检查点 | `dotnet/src/Agents/Abstractions/AgentThread.cs:18`, `dotnet/src/Agents/Abstractions/AgentChatSerializer.cs:16`, `dotnet/src/Agents/Core/ChatCompletionAgent.cs:253` |

## 设计权衡与特性

- **DI 容器式内核 vs 极简函数式**：与 ConnectOnion/Swarm 把 agent 做成一个轻量对象不同，SK 把 `Kernel` 设计成 `Microsoft.Extensions.DependencyInjection` 之上的服务容器——模型、selector、logger、filter 全经 DI 解析。优点是与 ASP.NET/企业栈无缝融合、可测试、可替换；代价是上手心智负担重、样板较多、抽象层数深。
- **归一化抽象的力量**：把 prompt、原生方法、OpenAPI、gRPC、甚至“另一个 agent”全部塞进 `KernelFunction` 这一个类型，使工具调用、规划、组合高度统一；正持续向 `Microsoft.Extensions.AI` 的 `IChatClient`/`AIFunction` 标准收敛，未来与整个 .NET AI 生态互通。
- **Planner 之死**：早期 SK 以 Stepwise/Handlebars planner 闻名，现已判定“模型 native function calling 足以替代显式 planner”，主源码删除 planner，仅保留迁移示例。这是该框架一次明显的范式转向。
- **编排模式齐全**：Concurrent/Sequential/GroupChat/Handoff/Magentic 五种 + 旧 AgentGroupChat 覆盖了从扇出聚合到动态 manager 主导(Magentic，借鉴 AutoGen Magentic-One)的主流多 agent 拓扑，且统一跑在可换 InProcess/Dapr 的 actor runtime 上。
- **过滤器 = 治理面**：HITL、审批、改写、限流都收敛到三类 filter 上，`Terminate` 标志让“工具调用前人工拍板”成为一等公民，比事件模型更可组合。
- **多语言一致性**：dotnet 与 python 镜像同一套概念(`kernel.py`/`agents/`/`connectors/`/`processes/`/`filters/`/`memory/`)，java 单独仓库。本笔记以 dotnet/C# 为准，python 命名几乎一一对应。
- **待确认/注意**：① 大量 agent/orchestration/process API 标 `[Experimental("SKEXP...")]`，签名可能变；② README 顶部明确 SK 的继任者是 Microsoft Agent Framework(MAF 1.0)，新项目需权衡选型；③ Process / Dapr 运行时与 VectorData 连接器多为预览/实验包。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]] · [[model-abstraction]]
- 同范式(model-stack/multi/企业 SDK)：[[connectonion]] · 源码：`agents-example/semantic-kernel/`
