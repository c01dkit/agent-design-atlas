---
title: "Ailoy"
aliases:
  - Ailoy
  - ailoy
  - ailoy-py
  - ailoy-node
  - ailoy-web
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/ailoy
  - lang/rust
  - paradigm/single
  - paradigm/local
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/brekkylab/ailoy
license: Apache-2.0
stars: ~300
---

# Ailoy

> [!abstract] 一句话定位
> 一个 **Rust 内核 + 多语言绑定（Python / Node.js / 浏览器 WASM）** 的 single-agent 框架，核心卖点是"AI 在哪都能跑"：通过内置 TVM 运行时（Vulkan/Metal/WebGPU）把开源模型（Qwen3）直接拉到**本地 GPU 甚至浏览器**里推理，同时也能一行切换到云 API（OpenAI/Claude/Gemini/Grok），并自带工具调用、MCP、RAG 等电池——目标是从云到边缘、从服务器到网页的"零后端"智能体。

## 设计理念 / 顶层架构

Ailoy 的取舍非常明确：**把一切重活下沉到 Rust，再用 FFI 薄壳暴露给三种宿主语言**。它不是某种语言的库，而是"一个 Rust crate + 三套 binding"。

- **单一 Rust 内核（`crate-type = ["rlib", "cdylib"]`，`src/lib.rs:1`）**：所有 agent / model / tool / knowledge / vector_store 逻辑都在 Rust 里实现一遍，靠 `#[cfg(feature=...)]`（`python` / `nodejs` / `wasm`）在同一份源码里挂出不同 binding（见 `Cargo.toml:28` features 段）。每个核心类型（`Agent`、`LangModel`、`Tool`…）都用 `#[cfg_attr(feature="python", pyclass)]` / `napi` / `wasm_bindgen` 三重宏修饰（`src/agent/base.rs:58`）。
- **Agent = LM + Tools + Knowledge 三件套编排器**：`Agent` 结构体只有三个字段 `lm / tools / knowledge`（`src/agent/base.rs:63`），自身就是一个 ReAct 式循环：调 LM → 若出 tool_call 就执行并回灌 → 重复直到无工具调用（`src/agent/base.rs:224` 的 `loop`）。**无 planner、无多智能体、无内置记忆**——刻意保持极薄。
- **模型抽象是个三态枚举**：`LangModel` 内部是 `Local`(TVM) / `StreamAPI`(云) / `Custom`(用户闭包)（`src/model/language_model.rs:184`）。本地与云在 `LangModelInference` trait 后面完全同构，agent 代码对二者无感知。
- **本地推理 = TVM Relax VM**：`LanguageModelInferencer`（`src/model/local/inferencer.rs:419`）加载编译好的 `rt.{dll/so/dylib/wasm}` 模块，按平台选 Vulkan / Metal / WebGPU 加速器（`src/model/local/inferencer.rs:41`），自管分页 KV-cache 与 LCP（最长公共前缀）复用（`src/model/local/inferencer.rs:551`）。模型权重经 `cache` 模块从 S3 按需下载并校验。
- **包结构**：`agent/`（编排）、`model/`（`local/` TVM + `api/` 云 + `custom`）、`tool/`（`function` / `builtin` / `mcp`）、`knowledge/` 与 `vector_store/`（RAG：Faiss 本地 + Chroma 云）、`value/`（Message/Part/Delta 等 wire 类型）、`cache/`（模型下载/持久化）、`ffi/`（py/node/web 三套桥）。
- **入口 API**：Python `ai.Agent(ai.LangModel.new_local_sync("Qwen/Qwen3-8B"))`，调用 `agent.run(...)` / `agent.run_delta(...)`（流式）。

最小示例（取自 README，本地模型一行起 agent）：

```python
import ailoy as ai

# 一行创建带本地模型的 agent（首次会自动下载并缓存 Qwen3 权重 + TVM 运行时）
agent = ai.Agent(ai.LangModel.new_local_sync("Qwen/Qwen3-8B"))

# run 返回流式输出；这里取最终消息的首个文本块
response = agent.run("Explain quantum computing in one sentence")
print(response.contents[0].text)
```

切到云 API 只需换构造函数（README 的 JS 版）：

```js
const lm = await ai.LangModel.newStreamAPI("OpenAI", "gpt-5", "YOUR_OPENAI_API_KEY");
const agent = new ai.Agent(lm);
```

浏览器内（WASM + WebGPU，无需后端）：

```typescript
const { supported } = await ai.isWebGPUSupported();
const agent = new ai.Agent(await ai.LangModel.newLocal("Qwen/Qwen3-0.6B"));
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 式 `loop`：流式调 LM 累积 delta → 若 assistant 消息含 `tool_calls` 则逐个执行并把结果作为 `Role::Tool` 消息回灌 → 否则 break；提供 `run`(聚合) 与 `run_delta`(流式) 两个入口 | `src/agent/base.rs:224` (`loop`), `src/agent/base.rs:206` (`run_delta`), `src/agent/base.rs:177` (`handle_tool_calls`) |
| [[planning\|规划/任务分解]] | N/A（无显式规划器，完全交给底层 LLM 的 think/tool-call 自驱；只有 `ThinkEffort` 开关控制推理强度） | `src/model/language_model.rs:31` (`ThinkEffort`) |
| [[memory\|记忆(短/长/向量)]] | 短期=调用方自持的 `Vec<Message>` 历史（每轮把 assistant/tool 消息 push 回 messages，`src/agent/base.rs:246`）；本地推理侧有 KV-cache 的 LCP 前缀复用（非语义记忆，`src/model/local/inferencer.rs:561`）；长期/向量"记忆"经 RAG knowledge 实现，框架本身不存对话 | `src/agent/base.rs:206`, `src/model/local/inferencer.rs:551` |
| [[tool-use\|工具调用]] | `Tool` 枚举三态：`Function`/`MCP`/`Knowledge`（`src/tool/base.rs:26`）。普通函数转工具：Python 侧用 `inspect`+type hints+Google docstring 自动生成 JSON schema（`bindings/python/ailoy/_patches.py:209` `get_json_schema`）；Rust 侧 `ToolFunc = dyn Fn(Value)->Future`（`src/tool/function.rs:17`）。内置工具：Terminal / WebSearch(DuckDuckGo) / WebFetch（`src/tool/builtin/mod.rs:14`） | `src/tool/base.rs:20` (`ToolBehavior`), `src/tool/function.rs`, `bindings/python/ailoy/_patches.py:242` |
| [[model-abstraction\|模型抽象]] | `LangModel` 包 `LangModelInner::{Local, StreamAPI, Custom}`（`src/model/language_model.rs:184`），统一 `LangModelInference` trait（`infer` / `infer_delta`，`src/model/language_model.rs:135`）。Local=TVM；StreamAPI 经 `APISpecification` 枚举支持 ChatCompletion/OpenAI(Responses)/Gemini/Claude/Grok（`src/model/api/mod.rs:36`）；EmbeddingModel 同构（本地/远程） | `src/model/language_model.rs:135,184`, `src/model/api/mod.rs:36`, `src/model/mod.rs` |
| [[multi-agent-orchestration\|多智能体编排]] | N/A（单 agent 框架，无子 agent / 编排原语；多 agent 需用户在宿主语言里自行组合多个 `Agent` 实例） | — |
| [[context-engineering\|上下文工程]] | 本地模型用 minijinja 渲染 chat template（`src/model/local/chat_template.rs`）；RAG 文档经 `DocumentPolyfill`（Qwen3 模板）注入 system/query 消息，适配"原生不支持知识输入"的模型（`src/model/polyfill.rs:13,42`）；推理参数 `LangModelInferConfig`（temperature/top_p/max_tokens/grammar/think_effort，`src/model/language_model.rs:101`） | `src/model/polyfill.rs:42`, `src/model/local/chat_template.rs`, `src/model/language_model.rs:101` |
| [[skills-plugins\|技能/插件]] | 扩展点=自定义工具(`new_function`/`new_custom` LM/`new_custom` knowledge) 与 MCP；MCP 客户端原生支持 stdio/streamable-HTTP 子进程传输（`src/tool/mcp/native.rs`，wasm 走 `wasm32.rs`），`MCPClient::get_tools()` 把远端工具批量转 `Tool`（`src/agent/base.rs:911` 测试演示）。无独立"skill/plugin 注册中心" | `src/tool/mcp/mod.rs`, `src/tool/mcp/native.rs`, `src/tool/base.rs:59` (`new_mcp`) |
| [[observability-eval\|可观测/评估]] | N/A / 弱：仅 `FinishReason::{Stop, Length, ToolCall, Refusal}`（`src/value/message.rs:463`）表征结束原因，**无 token usage / cost / trace 统计**；日志经 `utils/log.rs` 简单封装 | `src/value/message.rs:463`, `src/utils/log.rs` |
| [[runtime-execution\|运行时/部署]] | Rust crate 编译为 `cdylib`，三平台分发为 PyPI(`ailoy-py`)/npm(`ailoy-node`/`ailoy-web`)；本地推理走 TVM Relax VM（native 用 `tvm-runtime-rs`，wasm 用 `tvmjs_bridge`，`src/ffi/web/tvmjs_bridge.rs`）；按平台选 Vulkan/Metal/WebGPU（`src/model/local/inferencer.rs:41`）；支持同步/异步双 API（Python `run_sync`/`run`）。另有 `ailoy-model` CLI 管理模型（`src/cli/ailoy_model.rs`，feature-gated） | `src/model/local/inferencer.rs:13,41`, `src/ffi/web/tvmjs_bridge.rs`, `src/cli/mod.rs:1` |
| [[human-in-the-loop-governance\|人在环/治理]] | N/A（无审批/拦截机制；工具直接执行，内置 Terminal 工具无沙箱治理层） | `src/tool/builtin/terminal.rs` |
| [[state-persistence\|状态/持久化]] | 会话状态不持久化（messages 由调用方自管）；**持久化的是模型工件**：`cache` 模块用 manifest + 文件系统缓存把从 S3 下载的权重/`rt.*`/tokenizer 落盘并支持 checksum 校验、`download`/`remove`（`src/cache/mod.rs`, `src/model/local/local_language_model.rs:95,113`）；WASM 侧用 OPFS(FileSystem API) 缓存（`Cargo.toml:114` web-sys FileSystem*） | `src/cache/manifest.rs`, `src/cache/filesystem.rs`, `src/model/local/local_language_model.rs:64` |

## 设计权衡与特性

- **"一份 Rust 内核，三种宿主"是最大特色**：与绝大多数 Python-first 框架不同，Ailoy 把全部逻辑写在 Rust 里，通过 `cfg_attr` 同时产出 pyo3 / napi / wasm-bindgen 三套绑定。好处是行为一致、依赖极小、可进浏览器；代价是扩展只能用宿主语言写工具/自定义 LM，无法像 Python 框架那样随手 monkey-patch 内核。
- **真·本地与真·浏览器推理**：靠 brekkylab 自维护的 `tvm-runtime-rs` + 预编译模型工件，在 Windows/Linux(Vulkan)、macOS(Metal)、浏览器(WebGPU) 上跑 Qwen3。这是它区别于"调云 API 的本地库"的硬核之处——`isWebGPUSupported()` 后一行就能在网页里跑 0.6B 模型，无需后端。
- **本地 vs 云的对称抽象**：`LangModel` 三态枚举让"开源模型 ↔ 云服务"切换只改构造函数，agent/tool/RAG 代码零改动；RAG 也对称（Faiss 本地 / Chroma 云）。
- **刻意的极简单 agent**：没有 planner、没有多 agent、没有记忆系统、没有审批/治理、没有 token/cost 可观测。它把自己定位成"comprehensive **library**"而非"平台"——编排与治理留给使用者。
- **工具 schema 自动化但分宿主**：Python 侧复刻了 HuggingFace 风格的 docstring+type-hint→JSON schema（`_patches.py`，要求 Google 格式 docstring，否则报错）；Node/Web 侧需显式传 `ToolDesc`。MCP 是一等公民（stdio + HTTP）。
- **待确认/坑**：①仍处 active development，README 明确警告 API 会变（v0.2.5）；②本地模型目前仅官方支持 Qwen3 系列（需匹配预编译工件）；③`local_language_model.rs:240` 内有硬编码的 Qwen 特殊 token（`<tool_call>`/`<think>`/`<|im_end|>`），换模型家族需改解析；④本地推理注明"暂不支持并行 tool call"（`src/model/local/local_language_model.rs:286`）；⑤内置 Terminal 工具无沙箱，生产需自行约束。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[model-abstraction]] · [[runtime-execution]]
- 同范式（single + 本地/边缘推理）：[[smolagents]] · [[connectonion]] · 源码：`agents-example/ailoy/`
