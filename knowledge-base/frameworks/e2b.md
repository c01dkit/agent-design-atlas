---
title: "E2B"
aliases:
  - E2B
  - e2b
  - e2b-dev
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/e2b
  - lang/typescript
  - lang/python
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/e2b-dev/e2b
license: Apache-2.0
stars: ~8k
---

# E2B

> [!abstract] 一句话定位
> E2B 不是一个完整的 agent 框架，而是为 AI/LLM 生成代码提供的**云端安全隔离沙箱运行时基础设施**：用一行 `Sandbox.create()` 在云上拉起一个 Linux 微虚拟机，把 LLM 产出的代码/命令丢进去执行，再把文件系统、进程、PTY、git、网络出口、快照等能力以 SDK 形式暴露给上层 agent。它解决的是"agent 怎么安全地跑别人/模型写的代码"，而非"agent 怎么推理"。

## 设计理念 / 顶层架构

E2B 的核心范式是 **platform / runtime 基础设施**——它本身不做推理、规划、记忆、工具编排，这些 agent 组件几乎全部 N/A；它的全部价值集中在 [[runtime-execution\|运行时执行]]：把"运行不可信代码"这件事产品化为云服务 + 多语言 SDK。设计取舍：

- **客户端是瘦 SDK，重活在云端 `envd`**：仓库内只有 SDK/CLI/spec，真正的隔离运行时（基于 Firecracker microVM 的 `envd` 守护进程）在另一个仓库 [e2b-dev/infra](https://github.com/e2b-dev/infra)。SDK 通过两套协议和沙箱通信——REST（控制面：创建/列出/暂停/杀死沙箱，`packages/*/api`）+ ConnectRPC/gRPC（数据面：文件系统、进程、PTY，`packages/js-sdk/src/envd/`）。
- **`Sandbox` 是唯一门面，挂四个能力模块**：`files`（Filesystem）、`commands`（Commands）、`pty`（Pty）、`git`（Git）。JS 端见 `packages/js-sdk/src/sandbox/index.ts:73`；Python 端同时提供 **sync / async 双实现**（`sandbox_sync/` 与 `sandbox_async/`，共享 `sandbox/` 里的基类与协议代码）。
- **monorepo 包结构**：`packages/js-sdk`（npm `e2b` 2.27.x）、`packages/python-sdk`（PyPI `e2b` 2.25.x，sync+async）、`packages/cli`（`@e2b/cli`，模板构建/沙箱管理）、`packages/connect-python`；`spec/` 用 OpenAPI + protobuf 生成 API client（`make codegen`）；`templates/`、`supabase/` 为基础设施。
- **入口 API**：`import Sandbox from 'e2b'` / `from e2b import Sandbox`，`Sandbox.create()` 返回沙箱实例，默认模板 `base`、默认超时 300s。代码执行（`runCode`/`run_code`）是另一个独立包 `@e2b/code-interpreter`（不在本仓库）。

最小示例（取自 README）：

```ts
import Sandbox from 'e2b'

const sandbox = await Sandbox.create()                       // 云端拉起隔离 Linux 沙箱
const result = await sandbox.commands.run('echo "Hello from E2B!"')
console.log(result.stdout)                                   // Hello from E2B!
// await sandbox.files.write('/app/main.py', code)           // 写入 LLM 产出的代码
// const exec = await sandbox.commands.run('python /app/main.py')
```

```python
from e2b import Sandbox

with Sandbox.create() as sandbox:                            # 上下文管理，退出即清理
    result = sandbox.commands.run('echo "Hello from E2B!"')
    print(result.stdout)                                     # Hello from E2B!
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **N/A**——E2B 不含任何 LLM 调用或推理循环；它是被 agent 调用的运行时，推理由上层框架负责。全仓库无 completion/ReAct/agent-loop 代码（"prompt" 仅指 CLI 的 inquirer 交互，"llm" 为偶发命名） | — |
| [[planning\|规划/任务分解]] | **N/A**——无规划器、无任务分解 | — |
| [[memory\|记忆(短/长/向量)]] | **N/A**——无会话记忆/向量库。沙箱内的"状态"是真实文件系统，靠 pause/snapshot 持久化（见状态/持久化） | — |
| [[tool-use\|工具调用]] | **N/A**（无 function-calling/工具 schema）。但 E2B 自身常被当作 agent 的"工具/能力"：暴露 `commands.run`、`files.*`，并可经 `mcp` 选项在沙箱内拉起 **mcp-gateway** 把沙箱能力作为 MCP server 暴露 | `js-sdk/src/sandbox/index.ts:314` (mcp gateway), `js-sdk/src/sandbox/mcp.d.ts` |
| [[model-abstraction\|模型抽象]] | **N/A**——不接触任何模型/provider | — |
| [[multi-agent-orchestration\|多智能体编排]] | **N/A**（无 agent 编排）。仅提供"多沙箱"管理：`Sandbox.list()` 分页列出、`connect(id)` 从任意进程/serverless 连回同一沙箱 | `js-sdk/src/sandbox/index.ts:236` (list), `:353` (connect) |
| [[context-engineering\|上下文工程]] | **N/A**——无 prompt/上下文构建 | — |
| [[skills-plugins\|技能/插件]] | **N/A**（无插件系统）。最接近的是**自定义模板**：用 Dockerfile/Template builder 预装依赖、定义就绪命令，构建出可复用沙箱镜像 | `js-sdk/src/template/index.ts:55` (TemplateBase), `js-sdk/src/template/dockerfileParser.ts` |
| [[observability-eval\|可观测/评估]] | 沙箱级遥测而非 agent 评估：`getMetrics()` 取 CPU/内存/磁盘，控制面 `/sandboxes/{id}/logs`、`/metrics` 端点；RPC 可挂 `createRpcLogger` 记录通信 | `js-sdk/src/sandbox/index.ts:736` (getMetrics), `js-sdk/src/logs.ts`, `python-sdk/.../sandboxes/get_sandboxes_sandbox_id_logs.py` |
| [[runtime-execution\|运行时/部署]] | **核心强项**。云端 Firecracker microVM 隔离运行时（`envd` 在 e2b-dev/infra）。SDK：`commands.run(cmd, {background,cwd,user,envs,timeoutMs,onStdout/onStderr,stdin})` 起进程并流式回传 stdout/stderr（底层走 `/bin/bash -l -c`，ConnectRPC 流）；`pty` 提供伪终端；`files` 提供 read/write/list/makeDir/rename/remove/exists/getInfo/watchDir；`git` 封装 clone/commit/push 等；网络出口经 `allowOut/denyOut/rules` 精细控制；可自托管（AWS/GCP, Terraform） | `js-sdk/src/sandbox/commands/index.ts:402,411` (run/start), `js-sdk/src/sandbox/filesystem/index.ts:226`, `js-sdk/src/sandbox/commands/pty.ts`, `js-sdk/src/sandbox/git/index.ts`, `js-sdk/src/sandbox/network.ts`; Python: `python-sdk/e2b/sandbox_sync/main.py:45` + `sandbox_async/` |
| [[human-in-the-loop-governance\|人在环/治理]] | 无审批/HITL 流程；治理体现为**隔离边界本身**：每个沙箱是独立 microVM；超时自动回收（默认 300s，可 `setTimeout`，Pro 上限 24h）；网络默认放行、可用 `allowOut/denyOut` 收紧出口；签名 URL（`download_url/upload_url` + `get_signature`）控制文件访问 | `js-sdk/src/sandbox/index.ts:468` (setTimeout), `:493` (updateNetwork), `python-sdk/e2b/sandbox/main.py:126,161,148` (download/upload/signature) |
| [[state-persistence\|状态/持久化]] | 沙箱文件系统即状态；持久化靠 **pause/resume + snapshot**：`pause()` 暂停沙箱以便后续 `Sandbox.connect(id)` 自动恢复；`createSnapshot()` 把当前文件系统+状态固化为快照，`Sandbox.create(snapshotId)` 从快照派生新沙箱（快照在沙箱删除后仍存活） | `js-sdk/src/sandbox/index.ts:531` (pause), `:567` (createSnapshot), `:581` (listSnapshots); `sandboxApi.ts:886,941,980` |

## 设计权衡与特性

- **运行时 vs 框架的清醒定位**：表中 12 个组件里 8 个是 N/A——这不是缺陷，而是 E2B 的定位。它与 [[connectonion\|ConnectOnion]] 这类"电池全包"的 agent 框架是**互补关系**：agent 框架负责推理/工具/记忆，E2B 负责"把模型写的代码安全地跑起来"。许多 agent 框架（含 Claude Code、各类 code-interpreter）把 E2B 当作执行后端。
- **强隔离是第一卖点**：相比"在本进程顺序执行工具、靠 approval 插件兜底"（ConnectOnion 的做法），E2B 用 **Firecracker microVM 物理隔离**——这是面对"运行 LLM 任意生成代码"场景更彻底的安全模型，代价是每次执行有云端冷启动/网络往返开销。
- **sync/async 双实现 + 多语言对等**：Python SDK 同时维护 `sandbox_sync/` 和 `sandbox_async/` 两套完整实现，且 CLAUDE.md 要求 JS 与 Python(sync+async) 改动必须对等——一致性成本高但 API 体验统一。
- **瘦客户端 + 代码生成**：SDK 大量代码是从 `spec/`（OpenAPI + protobuf）`make codegen` 生成的（Python 的 `api/client/` 整片是生成产物），手写部分集中在 `sandbox/` 门面，便于跟随后端协议演进。
- **可自托管**：支持 AWS / GCP 自部署（Terraform，见 e2b-dev/infra），Azure / 通用 Linux 尚未支持——对数据合规场景友好。
- **生态扩展点**：`mcp` 选项可在沙箱内起 MCP gateway；`@e2b/code-interpreter`（独立仓库）在此之上加 Jupyter 内核做 `runCode`；自定义模板（Dockerfile）是主要的"预装/复用"机制。
- **注意**：本仓库**不含**实际隔离运行时（`envd` / Firecracker 在 e2b-dev/infra），也**不含** `runCode` 代码执行（在 e2b-dev/code-interpreter）；本仓库 = SDK + CLI + spec。许可证为 Apache-2.0（`LICENSE`）。

## 关联

- [[component-taxonomy]] · [[runtime-execution]] · 同范式(platform/基础设施)：[[connectonion]] · 源码：`agents-example/e2b/`
</content>
</invoke>
