---
title: "Cordum"
aliases:
  - Cordum
  - cordum
  - Cordum Edge
  - CAP
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/cordum
  - lang/go
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/cordum-io/cordum
license: BUSL-1.1（2029-01-01 转 Apache-2.0）
stars: <未知>
---

# Cordum

> [!abstract] 一句话定位
> 一个**进程外的 AI Agent 治理控制面**（Go 编写，CAP v2 协议）：在任意框架/模型的 agent *执行动作之前* 拦截每一次工作请求，做声明式策略 enforcement（ALLOW/DENY/REQUIRE_APPROVAL/THROTTLE）、人工审批门、以及 HMAC 签名的防篡改审计哈希链——它本身**不写 agent**，而是治理别人的 agent。口号即 "Know What Your AI Agents Are Doing. Before They Do It."

## 设计理念 / 顶层架构

Cordum 不是一个 agent 框架，而是一个**治理基础设施 / 控制平面**——所以本笔记里绝大多数"agent 组件"（推理循环、规划、记忆、工具调用、模型抽象）都是 **N/A**：这些发生在被治理的 worker 内部，Cordum 看不见也不关心。它把"治理（policy/approval/constraint）"与"执行（worker）"彻底分离，用一条持久总线（NATS + 可选 JetStream）和稳定的线协议 **CAP v2**（`github.com/cordum-io/cap/v2`，由 `go.mod:8` 钉死）连接。设计取舍：

- **多服务微内核**：拆成独立部署的二进制（`cmd/` 下）：API Gateway（HTTP/WS/gRPC 入口）、Scheduler（路由 + 调度 + 治理 enforcement）、Safety Kernel（gRPC 纯策略服务）、Workflow Engine、Context Engine（可选记忆服务）、`cordumctl` CLI、MCP Server。架构见 `README.md:402`、`DESIGN.md:21`。
- **Before / During / Across 治理框架**：BEFORE=执行前策略评估+安全门+人审；DURING=实时监控+熔断+在途审批；ACROSS=车队健康+审计轨迹（`README.md:163`）。
- **指针优先的总线**：总线只传 pointer（`context_ptr`/`result_ptr`/`artifact_ptrs`），大负载（输入/输出/工件）存 Redis，审计时再解引用（`DESIGN.md:112`）。
- **契约即预算**：每个工作单元是带 budget + policy 约束的 `JobRequest`（`DESIGN.md:60`）；worker 靠 `Heartbeat` 持续广播算力，Scheduler 用内存 TTL 注册表（默认 30s）做无持久化 DB 的容量感知路由（`DESIGN.md:46`）。
- **fail-closed 默认**：Safety Kernel 没加载策略时一律 DENY（`core/controlplane/safetykernel/kernel.go:706`）；不支持非 `job.` topic 也 DENY（`kernel.go:724`）。
- **Cordum Edge**：把控制面下沉到本地——`cordumctl edge claude` 给 Claude Code 装命令 hook，本地起 `cordum-agentd`，危险动作执行前先过 Gateway evaluate（合规防火墙）。

最小示例（取自 README — 这是"写一个被治理的 worker"，不是写 agent 逻辑）：

```go
import (
    "log"
    "github.com/cordum/cordum/sdk/runtime"
)

type Input struct{ Prompt string `json:"prompt"` }
type Output struct{ Summary string `json:"summary"` }

func main() {
    agent := &runtime.Agent{Retries: 2}
    // 注册一个 CAP worker：订阅 job.summarize，执行业务逻辑
    runtime.Register(agent, "job.summarize", func(ctx runtime.Context, in Input) (Output, error) {
        return Output{Summary: in.Prompt}, nil // 真正的 agent/LLM 逻辑由你实现
    })
    if err := agent.Start(); err != nil { log.Fatal(err) }
    select {}
}
```

提交一个受治理的 job（治理在此发生，而非在 worker 内）：

```bash
curl -X POST https://localhost:8081/api/v1/jobs \
  -H "X-API-Key: $CORDUM_API_KEY" -H "X-Tenant-ID: default" \
  -d '{"topic":"job.default","prompt":"hello"}'
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **N/A**——治理控制面本身不推理。推理发生在被治理的 worker 内部，Cordum 仅在 `JobRequest`→`JobResult` 边界上做治理。控制面自身的"循环"是 Scheduler 订阅总线→查策略→路由的调度循环 | （N/A）调度循环见 `core/controlplane/scheduler/engine.go` |
| [[planning\|规划/任务分解]] | 仅有 **Workflow Engine** 把声明式工作流拆成多个 `JobRequest` 步骤并推进（loop/parallel/subworkflow），非 LLM 规划 | `core/workflow/engine.go`, `engine_steps_loop.go`, `engine_steps_parallel.go` |
| [[memory\|记忆(短/长/向量)]] | 非 agent 记忆。**Context Engine**（可选 gRPC 服务）做指针化上下文/记忆存储，写入时强制治理校验（policy/trust/directive 类写入必须带审批引用）；向量检索 N/A | `core/contextwindow/engine/service.go`, `core/contextwindow/engine/governance_write.go:54` |
| [[tool-use\|工具调用]] | **N/A**（控制面不调工具）。但通过 **MCP Bridge / Gateway** 治理 *worker 的* MCP 工具调用：`McpGate` 在 action-gate 流水线里按策略放行/拦截工具 | `core/policy/actiongates/mcp_gate.go`；MCP 见 `docs/mcp-server.md` |
| [[model-abstraction\|模型抽象]] | **N/A**——Cordum 框架/模型无关（framework-agnostic via CAP），不内置任何 LLM provider。模型由被治理的 worker 自己持有 | （N/A）`README.md:564` "Framework agnostic ✅ Any via CAP" |
| [[multi-agent-orchestration\|多智能体编排]] | 这是核心：Scheduler 按 `Heartbeat`（算力/能力/pool/labels）做容量感知路由到 worker 池或直连 worker，靠内存 TTL 注册表（无持久 DB）；策略可做 pool segmentation（敏感数据只进可信池） | `DESIGN.md:124`, `core/controlplane/scheduler/registry_memory.go`, `scheduler/routing.go`, `scheduler/strategy_least_loaded.go` |
| [[context-engineering\|上下文工程]] | 指针化：Gateway 把输入 context JSON 写 Redis 设 `context_ptr`，总线只带指针；Safety Kernel 评估时按需解引用做内容级扫描（如 PII/payload 字段提取） | `DESIGN.md:112`, `core/controlplane/scheduler/safety_client.go:185` (`loadInputContent`) |
| [[skills-plugins\|技能/插件]] | **Integration Packs**：30+ CAP-native worker 包（Slack/GitHub/AWS/K8s/Terraform…），每个是带策略门工作流的 worker；`cordumctl pack install` 安装 | `README.md:504`, `core/controlplane/gateway/packs/`, `docs/pack.md` |
| [[observability-eval\|可观测/评估]] | **重点**。① 防篡改审计：HMAC-SHA256 签名的 per-tenant 哈希链（Redis Stream + CAS Lua）`core/audit/chain.go:265`，链校验 `chain_verify.go`；② SIEM 导出（webhook/syslog/Datadog/CloudWatch/SOC2）`core/audit/exporter.go:283`；③ DecisionLog 记录每次策略裁决 `scheduler/decision_log_adapter.go`；④ OTel metrics/trace `core/infra/otel/`；⑤ Policy Simulator 拿历史数据预演规则（`kernel.go:623` `Simulate`）+ shadow eval `safetykernel/shadow_eval.go` | `core/audit/chain.go:265`, `core/audit/exporter.go`, `core/controlplane/safetykernel/shadow_eval.go` |
| [[runtime-execution\|运行时/部署]] | 多服务部署：Docker Compose / Helm chart（`cordum-helm/`）/ K8s（`deploy/k8s/`）；镜像 cosign keyless 签名（`README.md:251`）；TLS mTLS 默认；端口 8081 Gateway / 8082 Dashboard / 50051 Safety Kernel gRPC（`README.md:312`）。一键起栈 `tools/scripts/quickstart.sh` | `cmd/`（各服务 main）, `docker-compose.yml`, `cordum-helm/`, `README.md:402` |
| [[human-in-the-loop-governance\|人在环/治理]] | **核心重点**。① Safety Kernel 返回 5 类裁决 ALLOW/DENY/REQUIRE_HUMAN/THROTTLE/ALLOW_WITH_CONSTRAINTS（`safety_client.go:235`），Scheduler 在 dispatch 前据此分流：REQUIRE_APPROVAL→置 `JobStateApproval` 阻塞等待人审（`engine.go:1596`）、DENY→入 DLQ（`engine.go:1608`）、THROTTLE→延迟重排（`engine.go:1549`）；② DENY-uncrossable 优先级（Global 不可被 Workflow 放宽）`safetykernel/global_policy_tiers.go:92`；③ 服务端 risk-tag 派生防客户端伪造低危标签（`kernel.go:741`）；④ Edge 审批生命周期 pending/approved/rejected/expired/invalidated（`core/edge/approval.go`）；⑤ **ProvenanceGate**：销毁性动作/`requires_provenance` 标签必须有已解析的审批记录+匹配审计事件，"approved by CFO" 之类纯文本声明一律 DENY（`core/policy/actiongates/provenance_gate.go:68`）；⑥ Velocity/速率治理 `safetykernel/velocity.go`；⑦ fail-open 旁路会发专门审计事件 `engine.go:1580` | `engine.go:1596,1608,1549`, `safetykernel/kernel.go:706`, `actiongates/provenance_gate.go:68`, `core/edge/approval.go` |
| [[state-persistence\|状态/持久化]] | Redis 存工作流状态、job 元数据、指针负载；job 生命周期状态机（Succeeded/Approval/Denied… 见 `engine.go` setJobState）；审批存储 Redis（`core/edge/approval_store_redis.go`）；安全裁决落 jobStore（`engine.go:2213` `SetSafetyDecision`，带 JobHash 防过期请求重放）；审计哈希链 head 指针 CAS 持久于 Redis | `DESIGN.md:31`, `core/edge/approval_store_redis.go`, `scheduler/engine.go:2210`, `core/audit/chain.go:245` |

## 设计权衡与特性

- **"治理 vs 执行"彻底解耦**：与 [[connectonion\|ConnectOnion]] / [[swarm\|Swarm]] 这类"在进程内写 agent"的框架是正交的——Cordum 是**进程外、网络层**的治理面，README 明确对比 MCP（agent *内* 调工具）vs CAP（agent *上* 的治理）："you need both"。所以它能治理任何框架/模型的 agent，代价是要部署一整套基础设施（Gateway+Scheduler+Safety Kernel+NATS+Redis）。
- **确定性治理叠加概率性心智**：核心卖点是给"概率性的 AI 大脑"加一层"确定性治理层"——执行前 enforcement，而非事后过滤（对比表里嘲讽 Guardrails AI 是 post-generation、NeMo 只做 dialog rails，`README.md:558`）。
- **防篡改审计是一等公民**：HMAC-SHA256 哈希链（含 PrevHash 前向级联，任何前驱被改/重排都让后续全部失效），HMAC key 短于 32 字节直接 panic（`chain.go:125` 拒绝静默降级），常量时间比较防时序侧信道（`chain.go:467`）。ProvenanceGate 甚至不信任审批存储本身，要求审计链里有匹配的已解析审批事件。
- **fail-closed 为默认，fail-open 需显式且留痕**：无策略=DENY；Safety Kernel 不可达时默认 fail-closed 重排，仅在显式配置 per-tenant/全局 fail-open 时放行，且必发专门审计事件供 SIEM 检测旁路（`engine.go:1566-1588`）。
- **无持久 worker DB 的容量路由**：靠 30s TTL 的内存 `Heartbeat` 注册表做分布式路由决策，避免 worker 状态库——但意味着控制面重启/网络抖动时容量视图会短暂失真（DispatchGate 用 session-token 信任态部分缓解，见 `scheduler/dispatch.go`）。
- **企业能力在核心、按 license 解锁**：SSO/SAML/OIDC、SCIM、高级 RBAC、SIEM 导出、legal hold、velocity、agent identity 都在 core，靠 entitlement 解锁（`README.md:528`）；former `cordum-enterprise` 仓库已于 2026-04-23 退役并合入。
- **许可证坑**：**BUSL-1.1**（非 OSI 开源）——可自托管/内部使用/改并回馈，但**不可作为竞争性托管服务**；Change Date 2029-01-01 自动转 Apache-2.0（`LICENSE:1`, `README.md:574`）。

## 关联

- [[component-taxonomy]] · [[human-in-the-loop-governance]] · [[observability-eval]] · [[multi-agent-orchestration]]
- 同范式(platform/治理基础设施)：[[connectonion]]（单体内置治理插件，对比 Cordum 的进程外控制面） · 协议：CAP v2 / MCP
- 源码：`agents-example/cordum/`
