---
title: "AgentField"
aliases:
  - AgentField
  - agentfield
  - af
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/agentfield
  - lang/go
  - lang/python
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/Agent-Field/agentfield
license: Apache-2.0
stars: 待确认
---

# AgentField

> [!abstract] 一句话定位
> 面向 AI 后端的"生产基础设施"：一个 Kubernetes 风格的无状态 Go control plane + 多语言 SDK（Python/Go/TypeScript），把任意函数变成可被前端/后端/其他 agent/定时任务直接 `curl` 的 REST 端点；同时为每个 agent 颁发密码学身份（W3C DID/VC，类 Okta 的 IAM）、做跨 agent 路由编排、记忆、异步执行、人审暂停与可验证审计——目标是"用框架证明行为，用 AgentField 把 agent 跑成生产系统"。

## 设计理念 / 顶层架构

AgentField 的范式是 **platform / control-plane**，而非单体 agent 库。它刻意把"写 agent 逻辑"与"跑 agent 生产化"分层，核心设计取舍：

- **控制平面与数据平面分离**：control plane 是一个 **无状态 Go 服务**（Gin + zerolog + Viper），agent 进程从任意位置（笔记本、Docker、K8s）连上来注册能力；所有跨 agent 调用都经控制平面路由、构建 workflow DAG、注入 metrics、强制策略——**禁止 agent 之间直连 HTTP**（`CLAUDE.md` "Agent-to-Agent Communication"）。
- **装饰器即端点**：SDK 侧用 `@app.reasoner()`（AI 判断）/ `@app.skill()`（确定性代码）装饰普通函数；`app.run()` 一行就把每个函数暴露为 `POST /api/v1/execute/{node}.{func}`，并在启动时自动向控制平面注册（service mesh，零配置）。最小侵入：无 DSL、无 YAML、无 graph wiring。
- **三层 monorepo**：`control-plane/`（Go：`internal/{handlers,services,storage,events,core,...}` + `cmd/agentfield-server`、`cmd/af` CLI + 嵌入式 React/TS web UI）；`sdk/{python,go,typescript}`（构建 agent 的库，Python 基于 FastAPI/Uvicorn）；web UI 经 Go `embed` 打进单一二进制。
- **存储可切换**：local 模式 SQLite+BoltDB（零外部依赖），cloud/PostgreSQL 模式（goose 迁移，生产就绪）；services 调统一 storage 接口，按 config 切后端。
- **身份内建**：每个 agent 自动获得 W3C DID + Ed25519 密钥，每次执行可产出可离线验证的 Verifiable Credential（`af vc verify audit.json`）。
- **入口 API**：`from agentfield import Agent, AIConfig`；核心动词 `app.ai()`（结构化 LLM）/`app.call()`（跨 agent）/`app.pause()`（人审）/`app.harness()`（多轮编码 agent）/`app.memory`/`app.discover()`/`app.note()`。

最小示例（取自 README）：

```python
from agentfield import Agent, AIConfig
from pydantic import BaseModel

app = Agent(
    node_id="claims-processor",
    version="2.1.0",                                  # 支持 canary / A-B / blue-green
    ai_config=AIConfig(model="anthropic/claude-sonnet-4-20250514"),
)

class Decision(BaseModel):
    action: str        # "approve" | "deny" | "escalate"
    confidence: float
    reasoning: str

@app.reasoner(tags=["insurance", "critical"])
async def evaluate_claim(claim: dict) -> dict:
    decision = await app.ai(                          # 结构化 AI 判断，返回 typed Pydantic
        system="Insurance claims adjuster. Evaluate and decide.",
        user=f"Claim #{claim['id']}: {claim['description']}",
        schema=Decision,
    )
    if decision.confidence < 0.85:
        await app.pause(                             # 人审：挂起执行，webhook 通知，批准后恢复
            approval_request_id=f"claim-{claim['id']}",
            approval_request_url=f"https://internal.acme.com/approvals/claim-{claim['id']}",
            expires_in_hours=48,
        )
    await app.call("notifier.send_decision", input={ # 跨 agent 调用，经控制平面 traced
        "claim_id": claim["id"],
        "decision": decision.model_dump(),
    })
    return decision.model_dump()

app.run()
# 暴露：POST /api/v1/execute/claims-processor.evaluate_claim
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 框架本身**不强制** ReAct 内循环；单次推理是 `app.ai()` 一发 LLM 调用。当传 `tools=` 时进入 discover→call 工具循环（`execute_tool_call_loop`，默认 `max_tool_calls=25`）；更"自治"的多轮循环交给外部 harness（Claude Code/Codex 等）。控制平面则把多步建成 workflow DAG | `sdk/python/agentfield/tool_calling.py:394` (`execute_tool_call_loop`), `tool_calling.py:48` (`max_tool_calls`), `agent_ai.py:257` (`ai`) |
| [[planning\|规划/任务分解]] | 无内建 planner；规划交给 LLM 自身或外部 harness。系统级"分解"体现为跨 agent `app.call()` 编排成 DAG，以及 harness 的 `permission_mode="plan"` 计划模式 | `agent.py:3710` (`call`), `harness/providers/claude.py:28` (`_PERMISSION_MAP` plan), `agent.py:3324` (`harness`) |
| [[memory\|记忆(短/长/向量)]] | 控制平面托管的分布式记忆，**四作用域** global / session / actor / workflow(run)，读时按 workflow→session→actor→global 由窄到宽回退；KV + 向量检索（`/memory/vector` set/search，余弦 top_k，含 metadata filter），**零外部依赖**（内建于控制平面，无需 Redis） | `sdk/python/agentfield/memory.py:1`(作用域文档), `control-plane/internal/handlers/memory.go`, `control-plane/internal/handlers/vector_memory.go:31` (`VectorSearchRequest`) |
| [[tool-use\|工具调用]] | 两类原语：`@app.reasoner`(AI)/`@app.skill`(确定性) 经装饰器自动转 REST 端点；`app.ai(tools=...)` 支持 raw OpenAI tool schema 或 `tools="discover"` 让 LLM 自动发现并调用 mesh 内其他 agent；底层用 LiteLLM function calling + 工具循环执行 | `decorators.py:49` (`reasoner`), `agent.py:1701` (`reasoner`), `agent.py:2573` (`skill`), `tool_calling.py:334` (`_build_tool_config`), `agent_ai.py:559`(tools 分支) |
| [[model-abstraction\|模型抽象]] | 经 **LiteLLM** 统一 100+ LLM provider（`AIConfig(model="anthropic/...")`）；`app.ai(schema=...)` 通过 system prompt 注入 schema 指令 + LiteLLM `response_format=json_schema` 双保险得到 typed 输出；支持 stream、多模态(image/audio)、temperature 等 | `agent_ai.py:26` (`_get_litellm`), `agent_ai.py:403`(schema 注入), `agent_ai.py:546`(`response_format`), `litellm_adapters.py` |
| [[multi-agent-orchestration\|多智能体编排]] | 核心卖点：`app.call("node.func")` 经控制平面路由（绝不直连），自动传播 workflow/session/actor 上下文并构建 DAG；版本路由用加权轮询做 canary（5%→50%→100%），回 `X-Routed-Version`；`AgentRouter(prefix=...)` 做命名空间 | `agent.py:3710` (`call`), `control-plane/internal/handlers/execute.go:1567` (`selectVersionedAgent` 加权轮询), `execute.go:310` (`X-Routed-Version`), `router.py` (`AgentRouter`) |
| [[context-engineering\|上下文工程]] | 自动上下文传播（Workflow/Session/Actor/Execution ID 经 header 转发，`X-Workflow-ID`/`X-Execution-ID`）；`app.ai` 的 system/user/schema 拼装；harness 支持 `system_prompt` 覆盖与 `env` 注入。无内建 token 压缩/auto-compact（依赖外部 harness 自管） | `agent.py:34` (`ExecutionContext`), `execution_context.py`, `agent_ai.py:402`(prompt 拼装), `agent.py:3335`(harness `system_prompt`) |
| [[skills-plugins\|技能/插件]] | `@app.skill()` = 确定性代码端点（与 reasoner 对称）；MCP 集成（`af add --mcp --url`，控制平面 `internal/mcp/`）；harness 4 providers(Claude Code/Codex/Gemini CLI/OpenCode) 作为可插拔"超能力"经 factory 装配 | `agent.py:2573` (`skill`), `harness/providers/_factory.py` (`build_provider`), `harness/providers/{claude,codex,gemini,opencode}.py`, `control-plane/internal/mcp/` |
| [[observability-eval\|可观测/评估]] | 自动 workflow DAG 可视化（`GET /api/v1/workflows/{id}/dag`）；Prometheus `/metrics`（discovery 等用 promauto 埋点）；结构化 JSON 日志；执行时间线；`/health`+`/ready`(K8s)；`app.note()` 写审计日志。形式化 eval N/A（靠 VC 审计而非 eval 框架） | `control-plane/internal/handlers/workflow_dag.go`, `control-plane/internal/handlers/discovery.go:18`(promauto), `agent.py:4190` (`note`), `control-plane/internal/handlers/execution_notes.go` |
| [[runtime-execution\|运行时/部署]] | 无状态 Go 控制平面，水平扩展；同步 `POST /execute`、异步 fire-and-forget(`/execute/async`)+webhook(HMAC-SHA256 签名)、SSE 流(`/execute/stream`)；**无超时上限**（可跑数小时/天）；PostgreSQL 持久队列 + 租约原子处理、自动重试指数退避、背压/熔断；Docker/K8s ready | `control-plane/internal/handlers/execute.go:1` , `control-plane/cmd/agentfield-server/main.go`, `control-plane/internal/services/webhook_dispatcher.go`, `control-plane/internal/storage/` |
| [[human-in-the-loop-governance\|人在环/治理]] | **双重**：①执行级 `app.pause()` 把执行转 "waiting"，注册 future 后等审批 webhook 回调或超时恢复，crash-safe 可持久（`execute_pause.go`/`webhook_approval.go`）；②访问治理 = 类 Okta IAM：tag-based ALLOW/DENY 访问策略（按 priority 降序求值）+ tag VC 校验 + 跨 agent 调用 Ed25519 签名 | `agent.py:4369` (`pause`), `control-plane/internal/handlers/execute_pause.go`, `control-plane/internal/services/access_policy_service.go:68` (`EvaluateAccess`), `control-plane/internal/services/tag_vc_verifier.go` |
| [[state-persistence\|状态/持久化]] | 控制平面统一持久层：local=SQLite+BoltDB / cloud=PostgreSQL(goose 迁移)；执行记录、workflow execution、记忆四作用域、配置存储(`POST /api/v1/configs/:key`)、payload store 均落库；身份与 VC 链持久化可离线验证 | `control-plane/internal/storage/`, `control-plane/migrations/`, `control-plane/internal/services/payload_store.go`, `control-plane/internal/services/vc_storage.go` |

## 设计权衡与特性

- **"AI 后端"定位 vs 框架**：作者明确把 LangChain/CrewAI/PydanticAI/OpenAI Agents SDK 归为"证明行为"的框架，把 Temporal/Airflow 归为工作流引擎，把 n8n/Zapier 归为可视化搭建——AgentField 自定位为三者之上的"运行层"。它**不**和你写 agent 逻辑的框架竞争，而是接管"路由、协调、抗故障、策略治理、审计"。可与任意框架组合。
- **编排类 Kubernetes，身份类 Okta**：控制平面像 K8s（无状态、声明能力、健康状态机 pending→starting→ready→degraded→offline、加权流量路由）；身份像 Okta（每个 agent 一个 DID 而非共享 API key，VC 三级层次 Platform→Node→Function，tag 策略由基础设施而非 prompt 强制）。这套"给 agent 做 IAM"的设计在同类里少见。
- **多语言对等 SDK**：Python（FastAPI 基座，DX 最全）、Go、TypeScript 都能注册 reasoner/skill；控制平面语言无关。Harness 编排（多轮编码 agent，Claude Code/Codex/Gemini CLI/OpenCode + schema 约束 + 成本/turn 上限 + 多层输出恢复）是较独特的"把 coding agent 当一等公民调度"能力。
- **可验证审计是一等公民**：每次执行可产 tamper-proof VC，离线可验，配合 `app.note()` 与非否认签名，面向金融/保险/安全等合规场景（README 示例多为 claims/security/audit）。
- **强项 / tradeoff**：强在"生产化"(异步/重试/canary/HITL/审计/服务发现)与零依赖记忆；tradeoff 是必须运行控制平面这一中心组件（所有跨 agent 流量过它），且推理智能本身较薄——复杂 agent 行为要靠 `app.ai` 自拼或外部 harness，框架不替你做 ReAct/planning。
- **待确认**：① GitHub stars 数（README badge 动态、未在源码内固化）= 待确认；② TypeScript SDK 细节本次未逐文件核验（README/CLAUDE.md 声明存在）；③ `app.ai` 的 schema 既走 prompt 指令又走 `response_format`，对不支持 json_schema 的 provider 的回退行为本次未深入核验。
- **一致性**：License 在 LICENSE 文件、README badge、Python `pyproject.toml`（`license = {text = "Apache-2.0"}`）三处一致为 **Apache-2.0**；版本 `VERSION`/`pyproject` 一致（0.1.89）。

## 关联

- [[component-taxonomy]] · [[multi-agent-orchestration]] · [[single-vs-multi-agent]]
- 同范式(platform/控制平面+电池)：[[connectonion]] · 源码：`agents-example/agentfield/`
