---
title: "Cortex Memory"
aliases:
  - Cortex Memory
  - cortex-mem
  - cortex
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/cortex-mem
  - lang/rust
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/sopaco/cortex-mem
license: MIT
stars: ~300
---

# Cortex Memory

> [!abstract] 一句话定位
> 用 Rust 写的 **AI-native 长期记忆基础设施**（不是 agent 编排框架）：为任意 LLM 应用/agent 提供"提取 → 分层组织 → 向量检索 → 自动优化/遗忘"的完整记忆方案，以 `cortex://` 虚拟文件系统做持久层、Qdrant 做语义检索，并通过 REST API / MCP / CLI / Rig 库 / Web Dashboard 五种方式接入。

## 设计理念 / 顶层架构

Cortex Memory 的范式是 **memory-as-a-service / 记忆中间件**——它本身不跑 ReAct、不做规划、不编排多 agent，而是把"记忆"这一横切能力抽出来做成独立基础设施。核心设计取舍：

- **混合存储（Hybrid Storage）**：持久层是 `cortex://` 虚拟文件系统（markdown 文件，可版本控制、可移植，`filesystem/uri.rs:170` 解析 `cortex://{dimension}/{path}`，dimension = `session`/`user`/`agent`/`resources`）；检索层是 Qdrant 向量库（`vector_store/qdrant.rs`）。内容真相在文件系统，向量只是索引。
- **三层渐进披露（L0/L1/L2）**：每条记忆生成三个抽象层级——L0 Abstract(~100 token，粗定位) → L1 Overview(~500-2000 token，结构化摘要) → L2 Detail(全文)。检索时按意图加权组合三层（默认 `0.2/0.3/0.5`，`search/weight_model.rs:11`），只为真正需要的细节付 token。这是它对标 OpenClaw 内置记忆能"省 80% token"的核心。
- **事件驱动的自动优化**：记忆变更 → `MemoryEvent` → `MemoryEventCoordinator` → `CascadeLayerUpdater` 增量重算受影响的 L0/L1（`cascade_layer_updater.rs:183`）；配合 `LlmResultCache`(LRU+TTL) 与 cascade debouncer，把 LLM 调用降 50-75%、层更新降 70-90%。
- **艾宾浩斯遗忘曲线**：`MemoryCleanupService`（`memory_cleanup.rs:96`）按 `strength = confidence * exp(-0.1 * decay_days / consolidation_factor)`（`memory_index.rs:191`）自动归档/删除低强度记忆，控制长跑 agent 的存储膨胀；每访问 5 次提升一次巩固因子（`memory_index.rs:181`）。
- **包结构**：workspace 多 crate（`Cargo.toml:3`）。`cortex-mem-core` 是引擎（filesystem / layers / search / session / embedding / llm / automation / 增量更新 / 遗忘）；`-service`(Axum REST,8085) / `-mcp`(MCP stdio) / `-cli` / `-rig`(Rig 工具) / `-tools`(MCP schema) / `-config` 是接入面；`-insights` 是 Svelte 5 仪表盘。

最小示例（取自 README，CLI 入口）：

```bash
# 1. 起依赖：Qdrant + 配 config.toml(llm/embedding/qdrant/cortex)

# 2. 写入一条消息到会话线程（自动落 cortex:// 文件系统）
cortex-mem --config config.toml --tenant acme \
  add --thread thread-123 --role user "The user is interested in Rust programming."

# 3. 关闭会话 → 触发"提取 + L0/L1/L2 分层生成 + 向量索引"流水线
cortex-mem --config config.toml --tenant acme session close thread-123

# 4. 语义检索（L0/L1/L2 加权打分）
cortex-mem --config config.toml --tenant acme \
  search "what is the user interested in?" --thread thread-123 --limit 10
```

## 组件实现（横向逐项，无则标 N/A）

> 注：Cortex Memory 是记忆基础设施而非编排框架，agent 推理/规划/多智能体等"编排类"组件天然 N/A；记忆/检索/存储类组件为其核心，详写。

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | N/A —— 不含 agent 推理循环；仅在记忆提取/层生成时一次性调用 LLM `complete`，无 ReAct/迭代。检索侧可选用 LLM 做查询意图分析(`enable_intent_analysis`) | N/A（接入方自带循环；提取调用见 `session/extraction.rs:183`） |
| [[planning\|规划/任务分解]] | N/A —— 无任务规划/分解概念 | N/A |
| [[memory\|记忆(短/长/向量)]] | **核心**。短期=会话消息时间线(`session/manager.rs`,`session/timeline.rs`)；长期=LLM 提取的结构化记忆(preferences/entities/events/cases/personal_info/work_history/relationships/goals 八类，带 confidence 评分)；向量=Qdrant 三层(L0/L1/L2)语义索引 | `session/extraction.rs:170` (`extract`), `session/extraction.rs:15` (`ExtractedMemories`), `layers/generator.rs:24` (L0/L1 生成), `search/vector_engine.rs:353` (`layered_semantic_search`) |
| [[tool-use\|工具调用]] | 反向——它是"被 agent 当工具调用"的一方：`cortex-mem-rig` 暴露 11 个 Rig Tool(abstract/overview/read/search/find/ls/explore/store…)，MCP server 暴露 search/recall/store/commit/ls/explore/abstract/overview/content 等工具 | `cortex-mem-rig/src/lib.rs:26-61`, `cortex-mem-mcp/src/service.rs:486` (`search`),`:537` (`recall`),`:582` (`store`) |
| [[model-abstraction\|模型抽象]] | `LLMClient` trait(`llm/client.rs`) + `EmbeddingClient`(`embedding/client.rs:334` `embed`,`:364` `embed_batch`)，均走 OpenAI 兼容 HTTP 端点；底层依赖 `rig-core 0.31`(`Cargo.toml:41`)；模型在 config.toml 配 `model_efficient`/`model_reasoning` | `llm/client.rs:184` (`extract_memories`), `embedding/client.rs:334`, `Cargo.toml:41` |
| [[multi-agent-orchestration\|多智能体编排]] | N/A —— 不编排 agent。多 agent 仅体现为"记忆隔离"：`agent/` 维度 + 多租户 collection 命名，让不同 agent 各有独立记忆空间 | N/A（隔离见 `memory_index.rs` `MemoryScope`、租户 collection 见 `vector_store/qdrant.rs`） |
| [[context-engineering\|上下文工程]] | **核心卖点**。三层渐进披露按查询意图动态加权(EntityLookup 偏 L2 0.7、Relational 偏 L1 0.5 等，`search/weight_model.rs:45` `weights_for_intent`)，让接入方只加载所需粒度，省 token | `search/weight_model.rs:11,45`, `search/vector_engine.rs:353`, `layers/generator.rs:56` (`estimate_tokens`) |
| [[skills-plugins\|技能/插件]] | N/A —— 无技能/插件系统（社区扩展如 MemClaw/Cortex TARS 是外部应用，非插件机制） | N/A |
| [[observability-eval\|可观测/评估]] | `tracing` 结构化日志(`logging.rs`)；REST `/health`+`/health/ready` 健康检查；`stats` 统计与 `UpdateStats`/`CacheStats`(skip_rate/cache_hit_rate)；Svelte 仪表盘(insights) 可视化；LoCoMo10 基准脚本 `examples/locomo-evaluation` | `cortex-mem-core/src/logging.rs`, `cascade_layer_updater.rs:44,52`, `cortex-mem-service/src/main.rs:135`, `examples/locomo-evaluation/` |
| [[runtime-execution\|运行时/部署]] | 五种接入：① REST 服务(Axum,默认 8085,`service/src/main.rs:134` Router `/api/v2`)；② MCP server(stdio)；③ CLI 二进制；④ Rust 库直接嵌入(`CortexMemBuilder` `builder.rs:74` `build`)；⑤ Rig 工具集。Tokio 异步运行时 | `cortex-mem-service/src/main.rs:134`, `cortex-mem-mcp/src/service.rs`, `cortex-mem-core/src/builder.rs:74`, `Cargo.toml:24` |
| [[human-in-the-loop-governance\|人在环/治理]] | 多租户隔离(`--tenant`/`X-Tenant-ID`，tenant 后缀 collection)做数据边界；本地优先、零云依赖(MemClaw 主打隐私)。无审批/权限审查流 | `cortex-mem-cli/src/commands/tenant.rs`, `cortex-mem-service/src/routes`(tenants 路由), `config` 模块租户覆盖 |
| [[state-persistence\|状态/持久化]] | **核心**。混合持久化：`cortex://` 虚拟文件系统(markdown 真相源,`filesystem/operations.rs`,`filesystem/uri.rs:170`) + Qdrant 向量索引(`vector_store/qdrant.rs`)；`VectorSyncManager` 维护二者一致；`MemoryIndex` 做版本/元数据追踪 | `filesystem/uri.rs:170`, `filesystem/operations.rs`, `vector_store/qdrant.rs`, `vector_sync_manager.rs`, `memory_index.rs` |

## 设计权衡与特性

- **"记忆中间件"而非"agent 框架"**：与 [[connectonion\|ConnectOnion]] 这类"自带推理循环+工具+托管"的 agent 平台正交。Cortex Memory 只解决"记住"，把推理/编排留给接入方(Rig/MCP 客户端/任意 HTTP 调用方)。它在 component-taxonomy 里属于 **platform / 基础设施层**。
- **三层 L0/L1/L2 + 意图加权是核心差异化**：相比"把整段历史塞进向量库"的朴素方案，渐进披露让检索从 ~100 token 摘要起步，按意图(EntityLookup/Factual/Temporal/Relational/Search/General)动态调三层权重。README 基准称 LoCoMo10 上 68.42%、对 OpenClaw+LanceDB 约 11× 更少 token、18× 更高 score/token——基准数据来自作者自评，需谨慎看待。
- **事件驱动自动优化 + 遗忘曲线**：增量层更新(`CascadeLayerUpdater`) + LLM 缓存(`LlmResultCache` LRU/TTL) + debounce 把 LLM 成本压下来；艾宾浩斯遗忘(`MemoryCleanupService`)让长跑 agent 不会无限膨胀——这两点是多数向量记忆库缺失的"运维侧"能力。
- **文件系统做真相源**：记忆是可读 markdown + `cortex://` URI，天然可 git diff/可移植/可人工编辑，向量库可随时从文件重建(`automation/index-all`)。代价是写路径较重(每次关会话要跑提取+三层生成+索引)。
- **Rust + Qdrant 的部署门槛**：需 Rust 1.86+、Qdrant 1.7+、OpenAI 兼容 LLM 与 Embedding 端点各一。非 Rust 项目通常经 REST/MCP 接入而非嵌库。
- **license 一致**：Cargo.toml(`license = "MIT"`)、README、badge 三处均为 MIT，无 ConnectOnion 那种声明冲突。
- **版本**：workspace `version = 2.7.1`(`Cargo.toml:15`)，README 提及功能演进到 v5/v2.6(遗忘机制)，文档与代码版本号体系略有错位，以源码为准。

## 关联

- [[component-taxonomy]] · 记忆专题：[[memory]] · [[context-engineering]] · [[state-persistence]]
- 对比(agent 平台，正交)：[[connectonion]] · 源码：`agents-example/cortex-mem/`
