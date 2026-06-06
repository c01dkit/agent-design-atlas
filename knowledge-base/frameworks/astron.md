---
title: "Astron Agent"
aliases:
  - Astron Agent
  - astron
  - astron-agent
  - 星辰 Agent
  - 讯飞星辰
  - SuperAgent
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/astron
  - lang/python
  - lang/java
  - lang/go
  - lang/typescript
  - paradigm/platform
  - paradigm/multi
  - paradigm/rag
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/iflytek/astron-agent
license: Apache-2.0（仓库 LICENSE 文件确认）
stars: 待确认（README 用 GitHub Stars 徽章，未写死数值）
---

# Astron Agent

> [!abstract] 一句话定位
> 科大讯飞开源的**企业级、商业友好的 Agentic Workflow 开发平台**（对应商用产品「讯飞星辰 / SuperAgent」），不是单包 SDK 而是一整套**多语言微服务系统**：React 控制台 + Java Spring Boot 后端 + 一组 Python/Go 核心微服务（agent 执行引擎、workflow DAG 编排、knowledge RAG、memory、tenant 多租户）+ 插件体系（AI 工具 / MCP / RPA / Link / Skill），靠 Docker Compose / Helm 一键高可用部署，目标是让企业「从决策到行动」闭环地搭出可商用的智能体应用。

## 设计理念 / 顶层架构

Astron 的取舍是「**平台化而非库化**」：核心价值不是一个优雅的 Agent 类，而是把「编排 + 模型管理 + 工具生态 + RPA + 多租户 + 部署运维」整合成一个可私有化部署的生产平台。

- **分层多语言微服务**（`docs/PROJECT_MODULES_zh.md`）：
  - UI 层 `console/frontend/`：React 18 + TS + Vite + Ant Design + ReactFlow（工作流可视化编辑器）。
  - 后端聚合层 `console/backend/`：Java 21 + Spring Boot 3.5，子模块 `hub`/`toolkit`/`commons`，对前端出 REST + SSE。
  - 核心微服务层 `core/`：`agent`（Python/FastAPI，Agent 执行引擎，DDD 分层 api/service/domain/engine）、`workflow`（Python/FastAPI，Spark Flow DAG 编排引擎）、`knowledge`（Python/FastAPI，RAG）、`memory`（Python，会话/记忆 DB 服务）、`tenant`（**Go 1.23 + Gin**，多租户/配额）、`plugin/`（aitools/rpa/link）、`common`（Python 基础设施抽象）。
- **通信方式**：前端→后端 HTTP/REST+SSE；后端→核心服务 HTTP/REST；**核心服务之间走 Kafka 事件驱动**（topic `workflow-events`/`knowledge-events`/`agent-events`），数据面 MySQL + Redis + MinIO。
- **两个「Agent」语义并存**：①`core/agent` 是单体 Agent 执行引擎，内部是 **ReAct 式 CoT 文本推理循环**（Chat / CoT / CoT-Process 三种 runner）；②`core/workflow` 是 **DAG 工作流引擎**，把 agent、llm、decision、iteration、loop、rpa、mcp、knowledge 等当作节点编排——多智能体/复杂流程靠 workflow 这层完成。
- **入口 API 形态**：对外是 OpenAI 兼容的 chat completion 流式接口（`agent/api/v1/workflow_agent.py`，`StreamingResponse`），输入是结构化 `CustomCompletionInputs`（模型配置 + instruction + plugin 列表 + knowledge），由 `WorkflowAgentRunnerBuilder.build()` 组装 runner 后流式返回 `ReasonChatCompletionChunk`。

最小用法（取自 README，平台部署而非 import 库）：

```bash
# 克隆仓库
git clone https://github.com/iflytek/astron-agent.git
cd docker/astronAgent

# 配置环境变量
cp .env.example .env
vim .env

# 一键起全部服务（含 Casdoor 鉴权）
docker compose -f docker-compose-with-auth.yaml up -d

# 访问：前端 http://localhost/  ；Casdoor 控制台 http://localhost:8000（admin/123）
```

Agent 执行引擎内部的 ReAct 循环骨架（`core/agent/engine/nodes/cot/cot_runner.py:305`）：

```text
# CoT system prompt 强制文本格式（cot_prompt.py），模型按此循环输出：
Thought:       <评估当前状态>
Action:        <从 {tool_names} 里选一个工具>
Action Input:  <一行 JSON 参数>
Observation:   <工具返回，由引擎回灌>
... (循环 max_loop 次，默认 30)
Thought:       <信息足够>
Final Answer:  <最终回答>
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **ReAct 式 CoT**：非原生 function-calling，而是 prompt 约定 `Thought/Action/Action Input/Observation/Final Answer` 文本格式，`while max_loop>loop_count` 循环：流式读 LLM→字符串切分解析出 action→执行 plugin→把 Observation 写回 scratchpad→重灌再问 | `engine/nodes/cot/cot_runner.py:305` (`run`), `:316` (while 循环), `:101` (`parse_cot_step`), `engine/nodes/cot/cot_prompt.py:1` |
| [[planning\|规划/任务分解]] | 单体 agent 无显式 planner，规划隐式交给 LLM 的 CoT；**显式编排在 workflow 层**：`decision` 节点用 router prompt 做意图分流/分支，`iteration`/`loop` 节点做循环分解，整个 DAG 由 DSL 描述 | `core/workflow/engine/nodes/decision/router_prompt.py`, `nodes/iteration/`, `nodes/loop/`, `engine/dsl_engine.py:786` (`WorkflowEngine`) |
| [[memory\|记忆(短/长/向量)]] | 短期=`chat_history` 直接拼进 user prompt（`RunnerBase.create_history_prompt`）+ `Scratchpad` 累积步骤；长期=独立 **memory 微服务**（DB 化会话存储，暴露 create/ddl/dml/drop 等 DB 操作 API，前缀 `/xingchen-db/v1`）；向量记忆走 knowledge/RAG 服务 | `engine/nodes/base.py:28,139` (`Scratchpad`), `core/memory/database/api/router.py:15`, `core/knowledge/` |
| [[tool-use\|工具调用]] | 工具=`BasePlugin`（name/description/`schema_template`/typ/`run` callable）；schema 以**文本模板**注入 system prompt 的 `{tools}`，非 JSON function schema；执行时按 action 名字符串匹配 plugin 并 `await plugin.run(action_input)`；找不到返回 400 占位 | `service/plugin/base.py:15` (`BasePlugin`), `cot_runner.py:367` (`run_plugin`), `cot_runner.py:44` (schema 注入) |
| [[model-abstraction\|模型抽象]] | `BaseLLMModel`（默认走 OpenAI 兼容 `AsyncOpenAI.chat.completions`）+ `ProviderLLMModel` 子类按 provider 适配：`AnthropicLLMModel`（/v1/messages + SSE 归一化）、`GoogleLLMModel`（generateContent SSE）；OpenAI 兼容白名单含 deepseek/doubao/qwen/zhipu/moonshot/minimax 等；`create_model()` 按 provider 字符串分发 | `domain/models/base.py:15,141,205,332`, `service/builder/base_builder.py:274` (`create_model`), `:46` (`OPENAI_COMPATIBLE_PROVIDERS`) |
| [[multi-agent-orchestration\|多智能体编排]] | **靠 workflow DAG 引擎**而非 agent 间直接通信：`agent` 节点把一个完整 agent 嵌入工作流；`flow` 节点可嵌套调用其它 workflow（`WorkflowPlugin` 让 CoT 把别的 workflow 当工具调）；节点间靠 `VariablePool` 传值，引擎用 `asyncio.create_task` 并发调度依赖就绪的节点 | `core/workflow/engine/nodes/agent/agent_node.py`, `nodes/flow/flow_node.py`, `service/plugin/workflow.py`, `dsl_engine.py:786,1414` |
| [[context-engineering\|上下文工程]] | 模板拼装式：system prompt 由 `{now}/{instruct}/{knowledge}/{tools}/{tool_names}/{r1_more}` 占位替换（对 `xdeepseekr1` 模型走专用模板分支），user prompt 拼 `{chat_history}+{question}+{scratchpad}`；knowledge 检索结果（含图片/表格引用替换）作为背景注入 | `cot_runner.py:44` (`create_system_prompt`), `cot_prompt.py:1`, `workflow_agent_builder.py:210` (引用替换) |
| [[skills-plugins\|技能/插件]] | 插件工厂多态：`LinkPluginFactory`（讯飞开放平台工具）/`McpPluginFactory`（MCP server 列表→工具，远程 HTTP 调用）/`WorkflowPluginFactory`/`SkillPluginFactory`；**Skill 兼容 Claude Code 风格**：生成 `read_skill_*`（读 SKILL.md + 相对路径资源）与 `run_skill_*`（在 e2b 沙箱执行命令）两个工具 | `service/builder/base_builder.py:81` (`build_plugins`), `service/plugin/mcp.py:90`, `service/plugin/skill.py:26` (`SkillPluginFactory`), `service/plugin/skill_sandbox.py` |
| [[observability-eval\|可观测/评估]] | 全链路 OpenTelemetry：`common/otlp`，每步 `span.start(...)` + `add_info_events`，结构化 `NodeLog`/`NodeTraceLog`/`Usage`（token 计数）逐节点落 trace；接入 DeepWiki 徽章。无内置自动化 eval 框架（评估口径 待确认） | `core/common/otlp/`, `cot_runner.py:225` (`NodeLog` append), `engine/nodes/base.py:36` (`model_general_stream` trace) |
| [[runtime-execution\|运行时/部署]] | 多进程微服务 + 异步：各 Python 服务 FastAPI/uvicorn，workflow 引擎 `asyncio` 并发跑 DAG 节点；代码节点 `code_node` 支持多 executor（**e2b 沙箱** / ifly / local / langchain）；部署 Docker Compose（`docker/astronAgent`）或 Helm（开发中），鉴权用 Casdoor，数据面 MySQL+Redis+Kafka+MinIO | `core/workflow/engine/dsl_engine.py:786`, `engine/nodes/code/executor/e2b/e2b_executor.py`, `docker/`, `helm/` |
| [[human-in-the-loop-governance\|人在环/治理]] | workflow 的 `question_answer` 节点做人在环：中断工作流等待用户，靠 `EventRegistry` 注册中断事件，支持 **resume / ignore / abort** 三种恢复事件；治理侧有 `core/common/audit_system`（审计）+ `tenant` 服务（多租户/空间隔离/配额）+ Casdoor 鉴权 | `core/workflow/engine/nodes/question_answer/question_answer_node.py:174,321` (`EventRegistry`), `core/common/audit_system/`, `core/tenant/` |
| [[state-persistence\|状态/持久化]] | 运行态：workflow `VariablePool` + `WorkflowEngineCtx`（节点状态/链路）；DAG 引擎用 `pickle` 序列化做跨节点传递；持久化：MySQL（结构化）、Redis（缓存/会话/`EventRegistry` 注册表）、MinIO（文件）、memory 服务（会话 DB）、workflow 用 alembic 管理 schema 版本 | `dsl_engine.py:49` (`WorkflowEngineCtx`), `engine/entities/variable_pool.py`, `core/workflow/alembic/`, `core/memory/database/alembic/` |

## 设计权衡与特性

- **平台 > 框架**：与 [[connectonion]]/[[swarm]] 这类「import 一个类就跑」的库相反，Astron 的最小单位是一套要 `docker compose up` 的微服务系统。代价是上手重（要起 MySQL/Redis/Kafka/MinIO/Casdoor），收益是开箱即得高可用、多租户、可视化编排、RPA、审计——直接对标 Dify / Coze 这类企业平台而非 LangChain。
- **文本 ReAct 而非原生 tool-calling**：CoT runner 用 prompt 约定的 `Thought/Action/Action Input/Observation` 文本格式 + 字符串切分解析（`cot_runner.py:80-147`），而非 OpenAI function calling 的结构化 tool_calls。好处是模型无关（任何能跟格式的 LLM 都能用，含 deepseek-r1 走专用模板），坏处是**解析脆弱**——格式跑偏即抛 `CotFormatIncorrectExc`，对弱指令模型不稳。
- **两层 Agent 分工清晰**：单体推理循环（`core/agent`）专注「一个 agent + 一组工具」的 ReAct；真正的编排/分支/循环/多 agent 协作上移到 workflow DAG（`core/workflow`），workflow 还能把另一个 workflow 当工具回灌给 agent——形成「agent ⊂ workflow，workflow 又可作为 agent 的 tool」的互嵌结构。
- **企业基建齐全**：Kafka 事件驱动解耦、Go 写的 tenant 服务追求高性能多租户、OTLP 全链路追踪、audit_system 审计、Casdoor 鉴权、e2b 代码沙箱、MaaS 私有化模型部署——这些是「企业级」的真实重量，也是它与玩具框架的分水岭。
- **讯飞生态深绑**：Link 插件直连讯飞开放平台海量工具，RPA 插件接讯飞 RPA 执行器，默认模型路径走 MaaS（`MaasAuth` 取 sk），workflow 引擎命名 Spark Flow / iflytek_spark provider——开源版可换模型，但生态默认面向讯飞。
- **待确认**：①stars 实际数值（README 仅徽章）；②是否有内置自动化 eval/回归框架（仅见 OTLP trace，未见 eval harness）；③Helm 部署「under development」，生产 K8s 路径尚未稳定。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]] · [[runtime-execution]]
- 同范式（企业级平台/可视化编排）：[[dust]] · [[botpress]] · 源码：`agents-example/astron/`
