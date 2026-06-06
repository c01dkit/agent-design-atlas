---
title: "Open Multi-Agent"
aliases:
  - Open Multi-Agent
  - open-multi-agent
  - OMA
  - "@open-multi-agent/core"
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/open-multi-agent
  - lang/typescript
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/JackChen-me/open-multi-agent
license: MIT
stars: ~60
---

# Open Multi-Agent

> [!abstract] 一句话定位
> 一个 TypeScript-native 的多智能体编排框架，信条是 **"From a goal to a task DAG, automatically"**：一次 `runTeam(team, goal)` 调用，让临时 coordinator agent 用**一次 LLM 调用**把自然语言目标拆成任务 DAG，按依赖拓扑并行执行 worker，最后再合成最终答案；仅 3 个运行时依赖，可嵌入任意 Node.js 18+ 后端。

## 设计理念 / 顶层架构

OMA 的核心范式是 **goal-first（目标优先）的 coordinator 编排**，刻意与 LangGraph / Mastra 这类 **graph-first（先手画图）** 框架对立：你只描述结果，coordinator 在运行时构建 DAG，而不是手工枚举每个 node/edge。设计取舍：

- **Coordinator 模式是杀手锏**：`runTeam` 起一个临时 `coordinator` agent，把 goal + roster 喂进去，让它**一次性**输出 JSON 任务数组（title / description / assignee / dependsOn）；解析后灌入 `TaskQueue`，按依赖拓扑跑（独立任务并行、依赖任务等待），每个结果写入 `SharedMemory`，最后 coordinator 再做一次 synthesis（`src/orchestrator/orchestrator.ts:1070`）。
- **三种运行模式**：`runAgent()` 单 agent 一次性；`runTeam()` 给目标自动拆解并行；`runTasks()` 你自己定义任务图与依赖。另有 `planOnly` 预览 DAG + `createPlanArtifact` / `runFromPlan` 固化并重放计划（不再调 coordinator）。
- **薄内核 + 分层**：`Orchestrator`（顶层 API / 拆解 / 重试）→ `Team`（roster / MessageBus / SharedMemory）→ `AgentPool`（信号量并发 + 每 agent 互斥锁）→ `Agent`（生命周期）→ `AgentRunner`（对话+工具循环）→ `LLMAdapter`（12 内置 provider）/ `ToolRegistry`（6 内置工具 + delegate）。所有接口集中在 `src/types.ts` 避免循环依赖。
- **三依赖承诺**：`dependencies` 仅 `@anthropic-ai/sdk` + `openai` + `zod`；`@google/genai`、`@aws-sdk/client-bedrock-runtime`、`@modelcontextprotocol/sdk`、`ai`(Vercel) 都是 **optional peer**，靠动态 `import()` 懒加载（`src/llm/adapter.ts:76` 的 `createAdapter` 工厂里逐 `case` lazy-import）。
- **入口 API**：`import { OpenMultiAgent } from '@open-multi-agent/core'`，`new OpenMultiAgent(config).runTeam(team, goal)`（`src/index.ts:57`）。

最小示例（取自 README）：

```typescript
import { OpenMultiAgent, type AgentConfig } from '@open-multi-agent/core'

const agents: AgentConfig[] = [
  { name: 'architect', model: 'claude-sonnet-4-6', systemPrompt: 'Design clean API contracts.', tools: ['file_write'] },
  { name: 'developer', model: 'claude-sonnet-4-6', systemPrompt: 'Implement runnable TypeScript.', tools: ['bash', 'file_read', 'file_write', 'file_edit'] },
  { name: 'reviewer',  model: 'claude-sonnet-4-6', systemPrompt: 'Review correctness and security.', tools: ['file_read', 'grep'] },
]

const orchestrator = new OpenMultiAgent({
  defaultModel: 'claude-sonnet-4-6',
  onProgress: (event) => console.log(event.type, event.task ?? event.agent ?? ''),
})

const team = orchestrator.createTeam('api-team', { name: 'api-team', agents, sharedMemory: true })

// 内置文件工具默认沙箱在 <cwd>/.agent-workspace
const result = await orchestrator.runTeam(
  team,
  `Create a REST API for a todo list in ${process.cwd()}/.agent-workspace/todo-api/`,
)

console.log(result.success, result.totalTokenUsage.output_tokens)
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | worker 层为 ReAct 式 `while(true)`：LLM→提取 `tool_use`→**并行**执行工具→回灌 `tool_result`→循环，直到无 tool_call 或达 `maxTurns`(默认 10)；团队层为 **plan-execute**：coordinator 一次拆解 → 队列分轮并行执行 → coordinator 合成 | `src/agent/runner.ts:761` (主循环), `src/agent/runner.ts:948` (并行工具执行), `src/orchestrator/orchestrator.ts:565` (`executeQueue` 分轮调度) |
| [[planning\|规划/任务分解]] | **goal→任务 DAG 的一次性 LLM 拆解**：coordinator 收 goal+roster，输出 ```json``` 任务数组；`parseTaskSpecs` 容错解析（fenced/裸数组），title 形式的 `dependsOn` 在 `loadSpecsIntoQueue` 中两遍映射为真实 task id；简单目标走 `isSimpleGoal` 短路只跑单 agent | `src/orchestrator/orchestrator.ts:1232` (parse), `src/orchestrator/orchestrator.ts:358` (`parseTaskSpecs`), `src/orchestrator/orchestrator.ts:1773` (`loadSpecsIntoQueue`), `src/orchestrator/orchestrator.ts:150` (`isSimpleGoal`) |
| [[memory\|记忆(短/长/向量)]] | 短期=`AgentRunner` 内 `conversationMessages`(单次 run) + `Agent.messageHistory`(跨 `prompt()` 多轮)；团队共享=`SharedMemory` 命名空间 KV(`<agentName>/<key>`)，可选 `ttlTurns` 过期、`getSummary()` 生成 markdown 注入；可插拔 `MemoryStore`(默认 `InMemoryStore`，可换 Redis/PG)。**无向量检索** | `src/agent/agent.ts:103` (history), `src/memory/shared.ts:64` (`SharedMemory`), `src/memory/store.ts` (`InMemoryStore`), `src/memory/shared.ts:266` (`getSummary`) |
| [[tool-use\|工具调用]] | `defineTool()` + Zod schema → 自研 `zodToJsonSchema` 转 JSON Schema 喂 LLM；`ToolRegistry` 注册、三层过滤(preset→allowlist→denylist)；6 内置(`bash`/`file_read`/`file_write`/`file_edit`/`grep`/`glob`)；工具错误**永不抛出**，捕获为 `ToolResult{isError:true}` | `src/tool/framework.ts:71` (`defineTool`), `src/tool/framework.ts:273` (`zodToJsonSchema`), `src/agent/runner.ts:591` (`resolveTools` 三层过滤), `src/tool/built-in/index.ts`, `src/agent/runner.ts:958` (错误兜底) |
| [[model-abstraction\|模型抽象]] | `LLMAdapter` 接口(`chat`+`stream`) + `createAdapter()` 懒加载工厂，按 provider 名路由；12 内置 provider + 任意 OpenAI 兼容端点(`baseURL`)；统一 `thinking` 配置映射到 Anthropic thinking / Gemini thinkingConfig / OpenAI reasoning_effort；Vercel AI SDK 经 `AISdkAdapter` 桥接 | `src/llm/adapter.ts:76` (`createAdapter`), `src/llm/adapter.ts:42` (`SupportedProvider` 联合), `src/llm/*.ts` (12 provider), `src/llm/ai-sdk.ts` (AI SDK 桥) |
| [[multi-agent-orchestration\|多智能体编排]] | **核心范式**：coordinator 拆 DAG → `TaskQueue` 拓扑解析(完成自动 unblock、失败级联) → `Scheduler` 自动分配(默认 `dependency-first`，另有 round-robin/least-busy/capability-match) → `AgentPool` 信号量并发执行；可选 `delegate_to_agent` 工具做同步子 agent 委派(带环检测/深度上限/池槽防死锁) | `src/orchestrator/orchestrator.ts:1070` (`runTeam`), `src/task/queue.ts:55` (`TaskQueue`), `src/orchestrator/scheduler.ts:96` (`Scheduler`), `src/agent/pool.ts` (`AgentPool`), `src/tool/built-in/delegate.ts:24` |
| [[context-engineering\|上下文工程]] | 4 种 `contextStrategy`：`sliding-window`(按 turn 边界保尾)、`summarize`(LLM 摘要旧消息+缓存)、`compact`(规则压缩、保留 tool_use/截断长文本)、`custom`；另 `compressToolResults` 压已消费工具输出；按 turn 边界切分避免孤立 `tool_use_id`；prompt 注入仅默认给"依赖任务输出"(default-deny)，`memoryScope:'all'` 才给全量 | `src/agent/runner.ts:547` (`applyContextStrategy`), `src/agent/runner.ts:442` (`summarizeMessages`), `src/agent/runner.ts:1126` (`compactMessages`), `src/orchestrator/orchestrator.ts:835` (`buildTaskPrompt` 默认仅注入依赖) |
| [[skills-plugins\|技能/插件]] | 无独立"skill/plugin"系统；扩展点为：①`defineTool()` 自定义工具；②`connectMCPTools()` 接 stdio MCP server 把其工具暴露给 agent；③实现 `LLMAdapter` 加 provider；④实现 `MemoryStore` 换后端 | `src/mcp.ts:5` (`connectMCPTools` 导出), `src/tool/mcp.ts`, `src/tool/framework.ts:71` (`defineTool`) |
| [[observability-eval\|可观测/评估]] | `onProgress` 结构化事件(task_start/complete/retry/skipped/budget_exceeded…) + `onTrace` span(llm_call/tool_call/task/agent/plan_ready/agent_stream) + 跑后 `renderTeamRunDashboard()` 生成纯 HTML 任务 DAG 仪表盘；密钥/token 经 `redaction.ts` 自动脱敏。无内置 eval 框架 | `src/orchestrator/orchestrator.ts:635` (progress 事件), `src/utils/trace.ts` (`emitTrace`/`generateRunId`), `src/dashboard/render-team-run-dashboard.ts:17`, `src/utils/redaction.ts` |
| [[runtime-execution\|运行时/部署]] | 纯 ESM 库，嵌入任意 Node 18+；并发由 `AgentPool` 的 `Semaphore` 控制(默认 `maxConcurrency:5`)；文件工具沙箱在 `<cwd>/.agent-workspace`(符号链接也解析进根，防 TOCTOU)，`bash` 不沙箱；JSON-first `oma` CLI 供 shell/CI；`tsc` 编译 src→dist | `src/agent/pool.ts`, `src/utils/semaphore.ts`, `src/tool/built-in/path-safety.ts:30` (`resolvePathWithinCwd`), `src/cli/oma.ts`, `package.json:65` (engines node>=18) |
| [[human-in-the-loop-governance\|人在环/治理]] | `onPlanReady(tasks)` 在任何 agent 执行前审批整份计划(返 false 中止)；`onApproval(completed,next)` 在每轮任务之间审批；`planOnly` 只看不跑；`AbortSignal` 运行中取消；`beforeRun`/`afterRun` 钩子改写 prompt / 后处理结果；`maxTokenBudget` 硬性封顶花费 | `src/orchestrator/orchestrator.ts:1290` (`onPlanReady`), `src/orchestrator/orchestrator.ts:800` (`onApproval` 门), `src/agent/agent.ts:328` (`beforeRun`), `src/agent/agent.ts:391` (`afterRun`) |
| [[state-persistence\|状态/持久化]] | 运行态全在内存：`TaskQueue` 持任务生命周期、`SharedMemory` 持跨 agent KV、`AgentPool` 每 run 临时(无跨 run 状态)；唯一可序列化产物是 `PlanArtifact`(纯 JSON，`createPlanArtifact`→`runFromPlan` 重放同一 DAG)。**无内置 durable checkpoint**(README 明确说明) | `src/orchestrator/orchestrator.ts:1413` (`createPlanArtifact`), `src/orchestrator/orchestrator.ts:1448` (`runFromPlan`), `src/task/queue.ts:55` (内存队列), `src/memory/store.ts` (`InMemoryStore`) |

## 设计权衡与特性

- **goal-first vs graph-first**：与 [[mastra\|Mastra]](显式 Supervisor 手工接线)、LangGraph JS(声明式编译图) 相反，OMA 让 coordinator 在运行时从一句目标生成 DAG——"工程师描述目标，而非图"。代价是拆解质量完全依赖 coordinator 一次 LLM 调用的输出；解析失败时退化为"每个 agent 一个任务"的兜底(`orchestrator.ts:1242`)。
- **极简依赖是卖点**：仅 3 个运行时依赖，所有重 SDK(Gemini/Bedrock/MCP/Vercel AI) 都靠动态 `import()` 懒加载成 optional peer——未用的 provider 永不 resolve。这是与 CrewAI(Python 重生态) 的主要差异：同等编排能力，选型只看语言栈。
- **默认沙箱收窄**：文件工具默认只能读写 `<cwd>/.agent-workspace`，而非整个 `process.cwd()`，避免刚配好的 agent 误读项目源码/`.env`/`.git`；符号链接全程 realpath 解析关闭 TOCTOU 窗口。但 `bash` 工具**不沙箱**(CLAUDE.md 明确点出的非显然不变量)，危险操作无强隔离。
- **委派的多重护栏**：`delegate_to_agent` 仅在 `runTeam`/`runTasks` 的池 worker 内注入(`runAgent` 与简单目标短路均不含)，拒绝自委派/成环/未知目标/深度>3/池槽耗尽；委派的 token 计入父预算，保证 `maxTokenBudget` 在委派链上仍准确。
- **失败语义分层**：工具错误→`ToolResult` 不抛出；任务失败→级联 `fail` 到下游依赖(独立任务继续)；LLM API 错误→向上抛给调用方。审批拒绝/取消→`skipRemaining` 把剩余任务标 `skipped` 并级联。
- **reasoning 跨 provider 取舍**：provider 原生 `ReasoningBlock` 默认在切换 adapter 时**静默丢弃**，除非开 `preserveReasoningAsText`(转成内联 `<thinking>` 文本，且永不反向解析回签名块)。
- **本地模型友好**：`text-tool-extractor` 仅在服务端无原生 `tool_calls` 时兜底解析(Ollama/vLLM/LM Studio 把 tool call 当纯文本发)，原生调用始终优先；`topK`/`minP` 等参数对云 OpenAI 自动忽略、仅转发兼容端点。
- **待注意**：①README 内 package 名为 `@open-multi-agent/core`、组织 repo 为 `open-multi-agent/open-multi-agent`，而本笔记记录的 repo 提示为 `JackChen-me/open-multi-agent`(原作者命名空间，README 提到旧包 `@jackchen_me/open-multi-agent` 已废弃)；②LICENSE 为 MIT 但版权年份写 2025，README 称 2026-04-01 发布，存在轻微不一致；③`Agent.prompt()` 的 TODO(#18) 尚未转发 trace context。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(TypeScript multi-agent / coordinator)：[[mastra]] · [[voltagent]] · 源码：`agents-example/open-multi-agent/`
