---
title: "Botpress"
aliases:
  - Botpress
  - botpress
  - LLMz
  - llmz
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/botpress
  - lang/typescript
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/botpress/botpress
license: MIT (根 LICENSE + readme.md + packages/llmz/README.md 一致声明)
stars: ~13k
---

# Botpress

> [!abstract] 一句话定位
> Botpress 是一个企业级 **chatbot/AI assistant 构建平台**（Botpress Cloud + Studio 可视化 flows），本仓库是其开源 monorepo（CLI / SDK / Client / 集成 / 示例 bots）。其中真正的 agent 内核是独立可用的 **LLMz**——一个"代码优先(code-first)"的 TypeScript agent 框架：让 LLM 直接生成并在 QuickJS/WASM 沙箱里执行 TypeScript 代码，用一次推理完成多工具编排与复杂逻辑，取代传统 JSON tool-calling 的多轮往返。

## 设计理念 / 顶层架构

Botpress 这个仓库其实是两层东西的叠加，理解时要拆开看：

- **平台层（Studio / Cloud / 集成生态）**：readme.md 写明仓库包含 Integrations（Hub 上的公开集成）、Devtools（`@botpress/cli`、`@botpress/sdk`、`@botpress/client`）、Bots（"bot as code" 示例）、Plugins。真正的可视化 flow 编辑器（Studio）是闭源 SaaS，**不在本仓库**；仓库里能看到的是构建/部署 bot 与 integration 的 SDK + CLI 原语。`bp init` / `bp deploy`（readme.md:59,75）是平台入口。
- **Agent 内核层（LLMz）**：`packages/llmz/` 是整个生态的"大脑"，README.md:7 自述"Powers millions of production agents at Botpress"。它的核心范式不是 ReAct-JSON，而是 **code generation**：LLM 输出一段 TypeScript（含 if/loop/try、多个工具调用、JSX 组件 yield），框架编译后丢进沙箱执行，一次推理顶传统框架的 N 轮。
- **配套包**：`packages/cognitive/`（LLM 调用抽象：模型偏好/best&fast 预设/降级回退/拦截器）、`packages/zui/`（Zod 超集，给工具/退出/组件做 schema 与 TS 类型生成）、`packages/zai/` `packages/vai/`（AI 辅助工具集）、`packages/sdk/`（构建 integration/bot/plugin 的定义+实现框架）、`packages/client/`（类型安全的 API 客户端）。
- **LLMz 入口 API**：`import { execute } from 'llmz'`，单一 `execute(props)` 跑一个循环直到命中 Exit / 等待用户输入 / 超过 loop 上限（`packages/llmz/src/index.ts:113`，循环体 `packages/llmz/src/llmz.ts:302`）。两种模式由是否传 `chat` 决定：传了=Chat Mode（可 yield UI 组件、自动有 ListenExit）；不传=Worker Mode（一次性计算/数据任务，用 DefaultExit）。

最小示例（取自 `packages/llmz/README.md` / 示例 11）——Worker 模式让 agent 自己写代码算数：

```typescript
import { Client } from '@botpress/client'
import { execute } from 'llmz'

const client = new Client({ botId: '...', token: '...' })

const result = await execute({
  instructions: 'Calculate sum of integers 14-1078 divisible by 3, 9, or 5',
  client,
})

console.log(result.output) // 271575
// LLM 实际生成并在沙箱执行的代码：
// let sum = 0
// for (let i = 14; i <= 1078; i++) {
//   if (i % 3 === 0 || i % 9 === 0 || i % 5 === 0) sum += i
// }
// return { action: 'done', value: { success: true, result: sum } }
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **code-first 而非 ReAct-JSON**：`while(true)` 循环，每轮让 LLM 生成 TS 代码→编译→沙箱执行；命中 Exit 则成功返回，thinking/error/invalid-code 则 `continue` 重试，超 loop 上限抛 LoopExceededError。Chat 模式下 ListenExit=让位用户 | `packages/llmz/src/llmz.ts:302` (主循环), `packages/llmz/src/llmz.ts:416` (`executeIteration`), CLAUDE.md:31 |
| [[planning\|规划/任务分解]] | 无独立 planner；规划交给"生成代码"本身——LLM 用注释逐步思考、用 if/loop/多工具调用在一段代码里完成编排（CLAUDE.md:72 "Comments for Planning"）。`ThinkSignal`/`return {action:'think'}` 强制反思后再继续 | `packages/llmz/CLAUDE.md:72`, `packages/llmz/src/errors.ts:131` (`ThinkSignal`), `packages/llmz/src/context.ts:174` (`ThinkExit`) |
| [[memory\|记忆(短/长/向量)]] | 短期=`transcript`（对话历史）+ 跨迭代持久的 `variables`/Object properties；长期/向量记忆**非内核职责**，靠 Botpress File API（RAG 示例中 `client` 上传+语义检索）。框架本身无内置向量库=N/A | `packages/llmz/src/transcript.ts`, `packages/llmz/src/context.ts:388` (Iteration.variables), `packages/llmz/examples/20_chat_rag/index.ts:50` |
| [[tool-use\|工具调用]] | `new Tool({name,description,input,output,handler,retry})`，input/output 用 Zui schema 做校验+TS 类型生成；工具以**真实 async 函数签名**注入沙箱，LLM 直接 `await tool(args)` 调用；内置 retry 逻辑；`getTypings()` 生成给 prompt 的类型 | `packages/llmz/src/tool.ts:216` (class), `packages/llmz/src/tool.ts:719` (`execute`), `packages/llmz/src/tool.ts:766` (`getTypings`) |
| [[model-abstraction\|模型抽象]] | `Cognitive` 客户端封装多 provider：`best`/`fast`/`auto` 预设或 `integration:model-id` ModelRef；按 tag/价格/vendor 打分排序；provider 宕机自动标 degraded 并回退下一个模型（5 分钟）；统一 `generateContent` | `packages/cognitive/src/client.ts:235` (`generateContent`), `packages/cognitive/src/client.ts:143` (`_selectModel`), `packages/cognitive/readme.md:36` (preset/降级) |
| [[multi-agent-orchestration\|多智能体编排]] | 内核无固定多 agent 协议；用 **Exit 做 handoff** 实现：`MultiAgentOrchestrator` 把每个子 agent 暴露为 `handoff_<name>` Exit，`onExit` 钩子里切换 currentAgent 并防环路；可扩展到上百子 agent | `packages/llmz/examples/08_chat_multi_agent/orchestrator.ts:19`, `orchestrator.ts:72` (handoff exits), `orchestrator.ts:110` (`handleHandoffs`) |
| [[context-engineering\|上下文工程]] | 双模 prompt 系统（chat-mode/ vs worker-mode/，Markdown 模板编译成 TS）；运行时注入工具签名/schema/历史；`truncateWrappedContent` 按 token 上限智能截断（带 flex/minTokens 标记），保证不超模型窗口 | `packages/llmz/src/prompts/` (dual-modes.ts), `packages/llmz/src/llmz.ts:444` (截断调用), `packages/llmz/src/truncator.ts:8` |
| [[skills-plugins\|技能/插件]] | 两个层面：①平台层 `packages/sdk` 的 Plugin/Integration 体系（`bp init` 模板，`integration.definition.ts`+`src/index.ts`，readme.md:46）；②LLMz 层 `ObjectInstance` 把相关工具+变量打包成命名空间（`db.queryUsers()`）、`hooks` 注入自定义逻辑 | `packages/sdk/src/plugin`, `packages/llmz/src/objects.ts:48`, `packages/llmz/README.md:233` (Objects) |
| [[observability-eval\|可观测/评估]] | `onTrace` 非阻塞钩子接收每条 trace（llm_call_started、工具调用、错误、输出）；`packages/llmz/src/types.ts` 定义 Trace 类型；Cognitive 有 request/response interceptors 可埋点；测试用 Vitest+LLM 重试+快照序列化器 | `packages/llmz/src/llmz.ts:335` (onTrace 推送), `packages/llmz/src/types.ts` (Trace), `packages/cognitive/src/interceptors.ts` |
| [[runtime-execution\|运行时/部署]] | **双 VM 驱动**：默认 QuickJS(WASM) 沙箱（完全隔离、128MB 内存上限、超时中断、可 abort），失败回退 Node VM；浏览器/Lambda/CF Workers/Bun/Deno 全支持。平台侧经 `bp deploy` 部署到 Botpress Cloud 工作区 | `packages/llmz/src/vm.ts:79` (driver), `vm.ts:200` (memoryLimit), `vm.ts:204` (超时中断), `packages/llmz/README.md:73` (平台支持表) |
| [[human-in-the-loop-governance\|人在环/治理]] | 多重钩子做 guardrail：`onExit` 校验/拦截退出（如转账超额 throw）、`onBeforeExecution` 审查/改写生成代码（封禁危险操作）、`onBeforeTool`/`onAfterTool` 改 IO；Chat 模式 ListenExit 让位用户；平台侧有 HITL 插件（`plugins/hitl`） | `packages/llmz/README.md:358` (hooks 示例), `packages/llmz/src/llmz.ts:280` (钩子注入), `agents-example/botpress/plugins/hitl` |
| [[state-persistence\|状态/持久化]] | **Snapshot 暂停/恢复**：工具内 throw `SnapshotSignal` 即序列化当前执行状态→`Snapshot.toJSON()` 存库→后续 `execute({snapshot})` 从断点续跑（适合长流程/人工审批）；跨迭代 variables 持久 | `packages/llmz/src/snapshots.ts:110` (class), `snapshots.ts:154` (`fromSignal`), `packages/llmz/src/errors.ts:112` (`SnapshotSignal`), `packages/llmz/src/llmz.ts:384` (callback_requested) |

## 设计权衡与特性

- **code-first vs JSON tool-calling**：这是 LLMz 最核心的赌注。README.md:429 的对比表把 LangChain/CrewAI/MCP（多轮 JSON 往返、无法表达逻辑）和 LLMz（单次推理生成完整 TS、全语言能力、Zui 全类型）摆在一起。卖点是**成本**——引 Anthropic "code execution 降本 98.7%"作背书（README.md:59）。代价是必须信任沙箱、生成代码的可调试性依赖 source map 与 stack-trace 清洗（`packages/llmz/src/stack-traces.ts`）。
- **与 MCP 互补而非替代**：README.md:385 明确 LLMz 不取代 MCP——MCP 负责"如何暴露工具"，LLMz 负责"工具暴露后如何编排执行"，可把 MCP 工具包成 LLMz Tool 后用代码一次性调度。
- **沙箱是生产级隔离**：QuickJS-WASM 无文件系统/网络/host 访问、内存与超时双限、abort 信号（README.md:82）。CI/开发可切 Node VM（`VM_DRIVER` 环境变量），浏览器走原生——这套"哪都能跑"是它区别于 isolated-vm-only 方案的点。注：CLAUDE.md 提到 `isolated-vm`，但实际 `vm.ts` 已迁到 `quickjs-emscripten`（CLAUDE.md 此处略过时，**待确认**两者是否并存）。
- **平台 vs 库的双重身份**：仓库整体是 platform（Cloud/Studio/Hub 生态），但 LLMz 是可独立 `npm install llmz` 的库。本笔记 paradigm 取 platform 反映仓库定位，但读源码的价值集中在 LLMz 这个 agent 内核。
- **退出系统即控制流**：Exit（带 Zui schema）统一表达"成功完成/handoff/等待/思考"，`result.is(exit)` 做编译期类型收窄。多 agent、guardrail、HITL 全部复用这一套退出语义，而非各搞一套协议——是较克制的设计。
- **待确认**：①Studio 可视化 flow 引擎闭源、不在仓库，本仓库无法直接读到"对话流引擎"实现，提示里期望的"对话流引擎"实际对应 LLMz 的 execute 循环 + Exit 状态机，而非可视化 flow runtime；②`bots/` 下示例 bot（echo/hitl/hello-world 等）是 SDK 用法演示，非框架核心；③stars 数为估计值。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[tool-use]] · [[runtime-execution]]
- 同范式(platform/电池全包)：[[connectonion]] · 源码：`agents-example/botpress/`
