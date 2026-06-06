---
title: "Modus"
aliases:
  - Modus
  - modus
  - hypermode-modus
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/modus
  - lang/go
  - lang/assemblyscript
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/hypermodeinc/modus
license: Apache-2.0
stars: ~2k
---

# Modus

> [!abstract] 一句话定位
> Hypermode 出品的开源、**serverless / WebAssembly** 智能体与 AI 应用框架：用 Go 或 AssemblyScript 写普通导出函数，Modus 自动抽取元数据、编译为 WASM、缓存模块、按清单(manifest)注入模型与数据连接，并暴露为 GraphQL API；其 Agent 能力建立在 actor 模型(GoAkt)之上，是"把 agent / model / tool 当一等公民的通用应用框架"，而非内置 ReAct 推理回路的 agent SDK。

## 设计理念 / 顶层架构

Modus 的核心范式是 **platform / runtime**，不是某种固定的推理回路。它的世界观写在 README 里："agentic flows 本质上仍是 app"，所以框架优先做"函数→编译→缓存→生成 schema→激活端点"这条流水线，为 sub-second 响应做了大量取舍。主要设计取舍：

- **函数即端点**：你只写带类型签名的导出函数（`export function sayHello(name: string): string`），Modus 的 transform/extractor 抽取函数元数据(`sdk/assemblyscript/src/transform/src/extractor.ts`)，运行时据此生成 GraphQL schema 并激活端点。模型/数据库凭据由 host 注入，永不进入用户代码。
- **WASM 沙箱执行**：Runtime 用 Go 编写，靠 **Wazero** 执行 WASM 模块；每次调用加载编译好的模块到带独立内存的沙箱，跑完即释放。语言无关——目前支持 Go(经 TinyGo) 与 AssemblyScript，未来可扩展。
- **manifest 驱动的资源抽象**：`modus.json` 清单声明 `models` / `connections` / `endpoints`（`lib/manifest/manifest.go:31`）。模型只声明 `sourceModel`/`provider`/`connection`/`path`（`lib/manifest/model.go:8`），代码里按名字 `GetModel(name)` 取用，与具体 provider 解耦。
- **Agent = actor**：长期运行、有状态的 Agent 不在请求生命周期内，而是由 Runtime 用 **GoAkt** actor 系统托管（`runtime/actors/agents.go`、`runtime/actors/wasmagent.go`）。每个 agent 实例是一个 actor，有 ID、生命周期(starting→running→suspending→suspended→resuming→stopping→terminated)、空闲钝化(passivation) 与状态自动持久化。
- **入口 API 形态**：SDK 侧 `agents.Register(&MyAgent{})`（init 中注册）+ `agents.Start(name)` / `agents.SendMessage(id, msgName, ...)`；agent 实现 `Name/GetState/SetState/OnReceiveMessage` 等接口方法（`sdk/go/pkg/agents/agents.go:218`）。

最小示例（取自 README，AssemblyScript）：

```ts
// 你只写一个带类型签名的导出函数
export function sayHello(name: string): string {
  return `Hello, ${name}!`;
}
```

```graphql
# Modus 自动生成并激活的 GraphQL 端点
query SayHello {
  sayHello(name: "World")
}
```

Agent 形态（Go SDK，CounterAgent 精简版）：

```go
func init() {
    agents.Register(&CounterAgent{}) // 注册，按名字 "Counter" 启动
}

type CounterAgent struct {
    agents.AgentBase // 内嵌，获得默认生命周期实现
    count int
}

func (a *CounterAgent) Name() string         { return "Counter" }
func (a *CounterAgent) GetState() *string     { s := strconv.Itoa(a.count); return &s }
func (a *CounterAgent) SetState(d *string)    { if d != nil { a.count, _ = strconv.Atoi(*d) } }

func (a *CounterAgent) OnReceiveMessage(msgName string, data *string) (*string, error) {
    if msgName == "increment" {
        a.count++
        a.PublishEvent(countUpdated{Count: a.count}) // 向订阅者发事件
        s := strconv.Itoa(a.count); return &s, nil
    }
    return nil, nil
}
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **框架不内置 ReAct/计划循环**；范式是"函数即端点 + actor 化 agent 的消息处理"。Agent 靠 `OnReceiveMessage(msgName, data)` 的 switch 分发处理消息(类 actor 收信)，多步推理需用户在函数内自行编排 model+tool 调用 | `sdk/go/pkg/agents/agents.go:258`(OnReceiveMessage), `sdk/go/examples/agents/counterAgent.go:103` |
| [[planning\|规划/任务分解]] | N/A —— 无内置 planner / 任务分解；规划交给用户代码或 LLM 自身 | N/A |
| [[memory\|记忆(短/长/向量)]] | 短期=agent 实例的结构体字段(active instance 私有)；长期=`GetState/SetState` 序列化字符串由 Runtime 自动落库(Postgres 或内置 modusDB)；向量=独立 `vectors` 工具包(余弦/点积等数学运算，非托管向量存储) | `sdk/go/examples/agents/counterAgent.go:46`, `runtime/db/agentstate.go:24`, `sdk/go/pkg/vectors/vectors.go` |
| [[tool-use\|工具调用]] | **无 agent 级自动工具回路**；工具调用走模型 API 层：OpenAI Chat 支持 `Tools`/`ToolChoice`/`ParallelToolCalls`，AS 侧 `Tool.forFunction(name, desc)` 声明工具，用户手动把 tool_calls 结果回灌(`ToolMessage`) | `sdk/go/pkg/models/openai/chat.go:154,225`, `sdk/assemblyscript/examples/textgeneration/assembly/toolcalling.ts:50` |
| [[model-abstraction\|模型抽象]] | 泛型接口 `Model[TIn,TOut]{Info();Invoke(in)}` + `GetModel[TModel](name)` 工厂；按 manifest 名解析，`Invoke` 经 host function `hostInvokeModel` 走 Runtime 调用 provider；内置 OpenAI/Anthropic/Gemini/Meta-Llama 及 experimental 分类/嵌入封装 | `sdk/go/pkg/models/models.go:27,60`, `sdk/assemblyscript/src/assembly/models.ts:63`, `lib/manifest/model.go:8` |
| [[multi-agent-orchestration\|多智能体编排]] | actor 间消息传递：`SendMessage`(同步阻塞带 timeout)/`SendMessageAsync`(timeout=0 异步)；agent 可在自身方法内 `Start`/`SendMessage` 其他 agent；底层 GoAkt 支持分布式(actor 可能在别的进程/机器) | `sdk/go/pkg/agents/agents.go:337,354`, `runtime/actors/agents.go:201`(SendAgentMessage) |
| [[context-engineering\|上下文工程]] | N/A —— 无上下文压缩/system-prompt 管理框架；prompt 由用户在调用模型时手工拼装(SystemMessage/UserMessage) | `sdk/assemblyscript/examples/textgeneration/assembly/toolcalling.ts:35` |
| [[skills-plugins\|技能/插件]] | 无"skill"概念；扩展点是 manifest 的 `connections`(HTTP/Postgres/MySQL/Neo4j/Dgraph 等数据/服务连接) 与 SDK 各功能包(http/graphql/dgraph/sql/auth…)，对 agent 是可调用能力而非插件系统 | `lib/manifest/manifest.go:35`(Connections), `lib/manifest/connection.go`, `sdk/go/pkg/`(各功能包) |
| [[observability-eval\|可观测/评估]] | `console` 包做结构化日志(debug/info/warn/error，经 host function 上报)；agent 经 `PublishEvent` 发事件→GoAkt topic actor→GraphQL Subscription 经 **SSE(text/event-stream)** 推送；集成 Sentry span 做分布式追踪。无内置 eval 框架 | `sdk/go/pkg/console/console.go:24`, `runtime/actors/agents.go:280`(PublishAgentEvent), `runtime/graphql/graphql.go:164`(SSE) |
| [[runtime-execution\|运行时/部署]] | serverless WASM：Go Runtime + Wazero 执行模块，按调用加载沙箱跑完即释放；`modus` CLI(`modus new/dev/build`) 脚手架与 fast-refresh 本地开发；可自托管或推 GitHub 由 Hypermode 自动构建部署到全球基础设施 | `runtime/actors/wasmagent.go:29`(wasmAgentActor), `cli/src/commands/`(new/dev/build), `README.md:53` |
| [[human-in-the-loop-governance\|人在环/治理]] | N/A 显式 HITL/审批框架；治理面体现为：JWT 鉴权(`auth` 包)、凭据由 host 注入永不暴露给用户代码、WASM 沙箱隔离、secrets 经 `GetSecretValue` 从 host 取(本地/Kubernetes) | `sdk/go/pkg/auth/jwt.go`, `sdk/go/pkg/secrets/secrets.go:11`, `runtime/secrets/kubernetes.go` |
| [[state-persistence\|状态/持久化]] | Agent 状态由 Runtime 自动管理：`GetState`序列化→`WriteAgentState` 落 Postgres 或内置 modusDB(modusgraph)；suspend/resume 自动保存恢复，passivation 空闲钝化后可从 DB 重建 actor；agent 状态表含 id/name/status/data/updated | `runtime/db/agentstate.go:24,33`, `runtime/actors/agents.go:208`(passivation+重建), `sdk/go/pkg/agents/agents.go:232`(GetState/SetState) |

## 设计权衡与特性

- **"通用 app 框架" vs "agent SDK"**：与 [[connectonion\|ConnectOnion]]/Swarm 这类"内置 ReAct 工具循环、两行起 agent"的框架方向相反——Modus **不替你跑推理回路**。它把 model/tool 当一等公民的 API 资源，多步 agentic 逻辑要你自己在函数/`OnReceiveMessage` 里编排。强项是"production 端点 + 资源注入 + 沙箱隔离"，不是开箱即用的认知架构。
- **WASM-first 带来的取舍**：以 Wazero 沙箱 + 凭据 host 注入换取强隔离、多语言、sub-second 冷启动；代价是受 WASM/TinyGo/AssemblyScript 的语言子集与生态限制(例如 Go 经 TinyGo 编译)。
- **Agent 即 actor(GoAkt)**：罕见地把 agent 建模为带生命周期、钝化、消息邮箱、可分布式的 actor，而非进程内对象。状态自动持久化(suspend/resume 无需用户保存)、空闲自动钝化省资源、可跨机器寻址，是它相对其他框架最"基础设施化"的设计。事件经 topic actor → GraphQL Subscription(SSE) 外推，可观测性走 Sentry。
- **manifest 解耦凭据与代码**：模型与外部连接只在 `modus.json` 声明、变量经 host 解析，代码零硬编码密钥——契合"securely queries data and AI models without exposing credentials"的安全模型。
- **双语言对等**：Go 与 AssemblyScript SDK 形态高度对称(register/start/sendMessage、Model/Invoke、Agent 生命周期接口一一对应)，AS 面向 web 开发者降低 WASM 门槛，Go 面向通用后端。
- **待确认/边界**：①README 自陈"仍在补齐 tools 的构建与调用能力"(`README.md:25`)，工具调用当前需手工回灌、无 agent 级自动回路；②无内置规划/上下文压缩/eval；③Agent 分布式语义依赖 GoAkt 集群配置，单机 example 默认本地 spawn。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]] · [[runtime-execution]]
- 同范式(platform/runtime)：[[connectonion]] · 源码：`agents-example/modus/`
