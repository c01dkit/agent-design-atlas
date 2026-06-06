---
title: "Upsonic"
aliases:
  - Upsonic
  - upsonic
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/upsonic
  - lang/python
  - paradigm/single
  - paradigm/multi
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/upsonic/upsonic
license: MIT (LICENCE 文件 + README + pyproject 三方一致)
stars: ~9k
---

# Upsonic

> [!abstract] 一句话定位
> 一个**以"可靠性"为卖点的生产级 Python agent 框架**（自我定位 "Agent Framework For Fintech"）：核心抽象是 `Agent` + `Task`，把单次 agent 执行拆成一条 **24 步显式 pipeline**，并在其中内置 reliability layer（verifier/editor 二次校验）、safety engine（策略式内容过滤）、MCP 集成、20+ 模型 provider、多后端 storage/memory、Team 多智能体与 Graph 工作流；同时提供 `AutonomousAgent`（带 workspace 沙箱的文件/shell 自治 agent，对标 Claude Code 类编码助手）。

## 设计理念 / 顶层架构

Upsonic 的取舍是 **"把一次 agent run 工程化成可插拔流水线"**，而不是一个薄 while 循环。主要特征：

- **Agent + Task 二元模型**：`Task`（`src/upsonic/tasks/tasks.py:21`，一个 pydantic `BaseModel`）承载 description / tools / skills / response_format / guardrail / cache 等"做什么"；`Agent`（`src/upsonic/agent/agent.py:150`，巨型构造器约 75 个参数）承载"谁来做、怎么做"。调用入口是 `agent.do(task)` / `agent.print_do(task)`（`agent.py:4074,4129`）。`Clanker` 与 `Direct` 只是 `Agent` 的别名/包装（`agent.py:5424` `Clanker = Agent`；`src/upsonic/direct.py:14`）。
- **显式 24 步 pipeline**：执行不在一个函数里，而是 `_create_direct_pipeline_steps()`（`agent.py:4629`）组装的有序 Step 列表——initialization→storage→cache→LLM→model-selection→tool-setup→memory→system-prompt→context(RAG)→chat-history→user-policy→user-input→message-assembly→**model-execution**→response→reflection→task-mgmt→**reliability**→agent-policy→cache-store→finalization→memory-save→call-mgmt。每个 Step 是 `src/upsonic/agent/pipeline/steps.py` 里一个类，统一发事件、查取消、产 `StepResult`。streaming 另有一条平行 pipeline（`agent.py:4703`）。
- **包结构（电池齐全）**：`agent/`（含 `pipeline/`、`context_managers/`、`autonomous_agent/`、`deepagent/`）是骨架；`tasks/` `tools/`（含 `mcp.py`/`hitl.py`）`models/`（provider 适配 + `model_registry.py`）`memory/`+`storage/`（多后端）`reliability_layer/` `safety_engine/`（策略库）`team/` `graph/`/`graphv2/`（工作流）`knowledge_base/`+`vectordb/`+`embeddings/`+`loaders/`+`text_splitter/`+`ocr/`（RAG 全家桶）`skills/` `canvas/` `eval/` `integrations/`（langfuse/otel/promptlayer）`prebuilt/`（开箱即用自治 agent）。
- **可选依赖切片**：核心依赖很薄（pydantic/httpx/openai/rich…），重依赖全在 `[project.optional-dependencies]`（`pyproject.toml:42`）按 extra 安装：`mcp` / `vectordb` / `storage` / `models` / `embeddings` / `loaders` / `tools` / `ocr` 等。
- **入口 API**：`from upsonic import Agent, Task`（顶层 `__init__.py` 用 `__getattr__` 懒加载，`src/upsonic/__init__.py:105`）。

最小示例（取自 README:77）：

```python
from upsonic import Agent, Task
from upsonic.tools import tool

@tool
def sum_tool(a: float, b: float) -> float:
    """Add two numbers together."""
    return a + b

task = Task(description="Calculate 15 + 27", tools=[sum_tool])
agent = Agent(model="anthropic/claude-sonnet-4-5", name="Calculator Agent")
result = agent.print_do(task)
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 非单一 while 循环，而是 **24 步显式 pipeline**；LLM↔工具的迭代发生在 model-execution 步内（CallManager 驱动 process_response，达 `tool_call_limit`(默认100) 停止）；带 streaming 平行管线 | `agent/pipeline/steps.py:1570` (`ModelExecutionStep`), `agent.py:4629` (`_create_direct_pipeline_steps`), `agent.py:2311` (`_execute_tool_calls`) |
| [[planning\|规划/任务分解]] | 内核无强制 planner，规划交给 LLM；可选 `enable_thinking_tool`/`enable_reasoning_tool`（`agent.py:263`）；`deepagent` 子包带 planning_toolkit/`TodoList`(`tasks.py:11` 引用)；`Graph` 把多 Task 显式编排成 DAG/链 | `agent.py:263`, `src/upsonic/agent/deepagent/`, `src/upsonic/graph/graph.py:438` (`Graph.add`) |
| [[memory\|记忆(短/长/向量)]] | `Memory` 三种保存+三种加载开关：`full_session_memory`(对话历史)/`summary_memory`(会话摘要)/`user_analysis_memory`(用户画像，支持 `user_profile_schema`)；持久化走 storage 后端；向量记忆经 mem0/supermemory extra | `src/upsonic/storage/memory/memory.py:27,68`, pipeline `MemoryPrepareStep`/`MemorySaveStep` (`steps.py:749,2323`) |
| [[tool-use\|工具调用]] | `@tool` 装饰器 + `ToolConfig`(requires_confirmation/requires_user_input/external_execution/sequential/cache_results)；支持普通函数、`ToolKit` 类、agent-as-tool、MCP；统一经 `ToolRegistry`/`ToolManager` 归一化 schema | `src/upsonic/tools/config.py:141` (`tool`), `tools/config.py:17` (`ToolConfig`), `tools/base.py:53` (`Tool`), `tools/registry.py:33` |
| [[model-abstraction\|模型抽象]] | `provider/model` 字符串 → `infer_model()` 路由到具体 `Model`(`Runnable` 子类)；20+ provider(openai/anthropic/google/azure/bedrock/cohere/mistral/groq/xai/ollama/vllm…)；`model_registry.py` 带 benchmark/tier 元数据支持自动选型 | `src/upsonic/models/__init__.py:2064` (`infer_model`), `models/__init__.py:655` (`Model`), `models/model_registry.py:97` (`ModelMetadata`), `src/upsonic/providers/` |
| [[multi-agent-orchestration\|多智能体编排]] | `Team` 三种模式 `sequential`/`coordinate`(leader 协调)/`route`(router 分派)，`ask_other_team_members` 自动互为工具；`Graph` 做带 State 的 DAG/链工作流(可 `parallel_execution`)；agent 亦可作为工具被另一 agent 调用 | `src/upsonic/team/team.py:20,37` (`Team`, mode), `team/coordinator_setup.py`, `team/delegation_manager.py`, `graph/graph.py:392` (`Graph`) |
| [[context-engineering\|上下文工程]] | `context_management=True` 时中间件在接近 model 上下文上限时**剪枝工具历史 + 摘要旧消息**（保留 `context_management_keep_recent`(默认5) 条，可指定更大窗口的 `context_management_model`）；system_prompt 由 SystemPromptBuildStep 组装(role/goal/instructions/education/work_experience/culture/metadata) | `agent.py:246` (构造参数), `src/upsonic/agent/context_managers/context_management_middleware.py:80` (`ConversationSummary`), `pipeline/steps.py:854` (`SystemPromptBuildStep`) |
| [[skills-plugins\|技能/插件]] | `Skills` 系统：带 `SKILL.md`(YAML frontmatter) 的技能，内建 builtins(code-review/data-analysis/summarization)，含 loader/validator/dependency/cache/metrics；prebuilt 自治 agent 也以 skills 形式打包 | `src/upsonic/skills/skills.py`, `skills/skill.py`, `skills/builtins/`, `src/upsonic/prebuilt/` |
| [[observability-eval\|可观测/评估]] | `eval/` 子包：`AccuracyEvaluator`、performance、reliability 三类评测器(`.run()`)；可观测经 `integrations/` 接 Langfuse / OpenTelemetry(otel extra) / PromptLayer；core 依赖含 sentry-sdk[opentelemetry]；pipeline 每步发事件 | `src/upsonic/eval/accuracy.py:26` (`AccuracyEvaluator`), `eval/performance.py`, `eval/reliability.py`, `src/upsonic/integrations/langfuse.py`, `integrations/tracing.py` |
| [[runtime-execution\|运行时/部署]] | 纯库；sync 入口经常驻后台事件循环跑 async pipeline(`agent.py:21` `_get_bg_loop`)；`agent.as_mcp()` 把 agent 暴露为 FastMCP server(`agent.py:4214`)；`upsonic` CLI(`pyproject.toml:295`)；`AutonomousAgent` 提供 workspace 沙箱(文件/shell 限定在 `workspace`，路径越界即 raise)，可接 E2B 云沙箱 | `agent.py:4214` (`as_mcp`), `src/upsonic/agent/autonomous_agent/autonomous_agent.py:216`, `autonomous_agent/filesystem_toolkit.py:62` (`_validate_path` 沙箱), `src/upsonic/cli/main.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | HITL 经异常驱动暂停/恢复：`ConfirmationPause`/`UserInputPause`/`ExternalExecutionPause`(`tools/hitl.py:92,100,108`)，由 `ToolConfig.requires_confirmation` 等触发，`agent.continue_run()`(`agent.py:4946`) 恢复；治理经 **safety engine** 策略(user/agent/tool_pre/tool_post policy + feedback loop) + PII 匿名化 | `src/upsonic/tools/hitl.py:23` (`PausedToolCall`), `agent.py:4946` (`continue_run`), `src/upsonic/safety_engine/policies/`, `safety_engine/anonymization.py`, `pipeline/steps.py:292` (`UserPolicyStep`) |
| [[state-persistence\|状态/持久化]] | 多后端 storage 统一接口：In-Memory / JSON / SQLite / Redis / PostgreSQL / MongoDB / mem0(`src/upsonic/storage/`)，承载 session/memory/user-profile；`db=` 参数可整体接管(`agent.py:234`)；Task 级 cache(vector_search/llm_call，`tasks.py:49`) | `src/upsonic/storage/` (in_memory/json/redis/postgres/mongo/mem0), `storage/base.py`, `pipeline/steps.py:564` (`StorageConnectionStep`), `tasks.py:49` (cache) |

## 设计权衡与特性

- **"可靠性"是一等公民**：与多数框架"跑通即止"不同，Upsonic 把 verify/edit 做成 pipeline 固定步骤——`ReliabilityProcessor`(`reliability_layer/reliability_layer.py:204`) 对输出做 URL/数字/代码的可疑度校验与多轮修正，`reflection` 步另做质量自评。这是它面向 fintech/生产的核心差异点。
- **显式 pipeline vs 隐式循环**：24 步管线把缓存、策略、记忆、RAG、工具、可靠性、可观测全部位点化，可读性/可插拔性强，但**复杂度也外溢到使用者**——`Agent.__init__` 约 75 个参数、Task 又一大堆字段，学习曲线陡，属于"重内核 + 全家桶"路线（与 [[swarm]] 的极简内核相反，与 [[connectonion]] 同属"电池全包"阵营但更企业向）。
- **安全/治理内建**：safety_engine 提供成体系的领域策略库（adult/crypto/financial/fraud/insider-threat/legal/medical/phishing/cybersecurity…）+ 可逆 PII 匿名化 + tool 前后双策略 + feedback loop；`AutonomousAgent` 的 workspace 沙箱用 `Path.resolve()+relative_to` 做路径越界拦截（`filesystem_toolkit.py:83`），比"靠 LLM 自觉"更硬。
- **MCP 原生**：`tools/mcp.py` 同时支持 stdio / SSE / streamable-http 三种传输（`mcp.py:30,43`），`MCPHandler`/`MultiMCPHandler` 管理多 server，且对 stdio 会发"运行任意进程"安全警告（`mcp.py:68`）；`agent.as_mcp()` 反向把自身变成 MCP server。
- **RAG/OCR 全栈**：KnowledgeBase 串起 vectordb(chroma/qdrant/milvus/weaviate/pinecone/faiss/pgvector/supermemory) + embeddings + loaders + text_splitter + 分层 OCR(EasyOCR/RapidOCR/Tesseract/PaddleOCR/DeepSeek)，是少见的把文档摄取链路也内置的 agent 框架。
- **待确认/坑**：①顶层导出的 `Clanker` 实为 `Agent` 的别名（`agent.py:5424`），并非独立 agent 类；②`graph` 与 `graphv2` 并存，二者职责/取舍边界未在源码层面读全（**待确认**新旧关系）；③README 宣称对标 "OpenClaw / Claude Cowork"，但这些是市场叙事，实际能力以 `AutonomousAgent` + prebuilt 为准；④构造参数极多，部分默认值（如 `context_management` 文档串注释写 default True，签名实为 `False`，`agent.py:246` vs:320 docstring）存在文档与签名不一致——**以签名为准，docstring 待确认**。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]] · [[reasoning-loop]]
- 同范式（重内核 + 电池/平台、生产向）：[[connectonion]] · 源码：`agents-example/upsonic/`
