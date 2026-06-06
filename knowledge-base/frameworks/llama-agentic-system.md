---
title: "Llama Agentic System (llama-stack-apps)"
aliases:
  - llama-agentic-system
  - llama-stack-apps
  - Llama Stack Apps
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/llama-agentic-system
  - lang/python
  - paradigm/model-stack
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/meta-llama/llama-agentic-system
license: MIT
stars: ~4k
---

# Llama Agentic System (llama-stack-apps)

> [!abstract] 一句话定位
> Meta 官方的 Llama agentic 参考实现，已演进并改名为 **llama-stack-apps**：它本身是一组"客户端应用样例"，真正的 agentic 内核被下沉到 **Llama Stack** 这套标准化 API 平台——把 inference / safety(Llama Guard shields) / tool execution / 多步推理循环统一抽象为服务端 API，客户端只用 `llama-stack-client` SDK 的 `Agent` 即可拼出 RAG、ReAct、带安全护栏的 agent，model-stack 范式的代表。

## 设计理念 / 顶层架构

这个仓库的核心定位是 **model-stack（模型即栈）**：与 ConnectOnion/CrewAI 那种"框架自带 agent loop"不同，llama-stack-apps 自己几乎不实现 agent 逻辑——它是 **Llama Stack** 的"消费端"。设计取舍：

- **三层分离**：① `llama-stack`（服务端，独立仓库，跑在 `:8321`，提供 Agents/Inference/Safety/VectorIO/ToolRuntime 等 API）；② `llama-stack-client`（Python/Node/Swift/Kotlin SDK，封装 `Agent`、`ReActAgent`、`ClientTool`、`AgentEventLogger`）；③ 本仓库 `examples/`（hello/rag/react/multimodal 脚本 + `agent_store`/`interior_design_assistant` 等 Gradio/移动端样例）。`requirements.txt:6` 仅依赖 `llama-stack-client>=0.1.0`，证明 agent 运行时不在本仓库内（待确认：SDK 源码在 `llama-stack-client-python` 仓库，本地不可见）。
- **Distribution 概念**：README 强调各 API 的具体实现被"组装"成一个 **Llama Stack Distribution**，开发者只需把 app 指向 server URL（`examples/agents/simple_chat.py:25`）。
- **Agentic Loop 是服务端契约**：`docs/sequence-diagram.md` 给出权威时序——一个 Turn 内 Executor 串起 ShieldCallStep → InferenceStep →（ToolCallStep + Shield + Inference 的循环）→ 最终 Shield → 输出；**安全护栏(Shields)是与推理/工具同级的一等步骤**，这是本框架最鲜明的特征。
- **Tools 三态**：built-in（模型内建知识，如 `builtin::websearch`/`builtin::rag`）、zero-shot（in-context 传入的 client tool）、code interpreter；客户端工具用 `@client_tool` 装饰普通函数或继承 `ClientTool` 类实现。
- **入口 API**：`from llama_stack_client import LlamaStackClient, Agent, AgentEventLogger`，`agent.create_session()` → `agent.create_turn()`（`examples/agents/agent_with_tools.py:14,45,60,70`）。

最小示例（取自 README `examples/agents/hello` 风格，见 `examples/agents/simple_chat.py`）：

```python
import os
from llama_stack_client import LlamaStackClient, Agent, AgentEventLogger

# 1. 连接到 Llama Stack server (须先单独启动 server)
client = LlamaStackClient(
    base_url="http://localhost:8321",
    provider_data={"tavily_search_api_key": os.getenv("TAVILY_SEARCH_API_KEY")},
)

# 2. Llama Guard shields 作为输入/输出安全护栏(一等步骤)
available_shields = [s.identifier for s in client.shields.list()]

agent = Agent(
    client,
    model="meta-llama/Llama-3.1-8B-Instruct",
    instructions="You are a helpful assistant.",
    tools=["builtin::websearch"],          # 服务端内建工具
    input_shields=available_shields,        # 输入护栏
    output_shields=available_shields,       # 输出护栏
)

session_id = agent.create_session("test-session")
response = agent.create_turn(
    messages=[{"role": "user", "content": "Hello"}],
    session_id=session_id,
)
for log in AgentEventLogger().log(response):   # 流式打印 inference/shield/tool 步骤
    log.print()
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 服务端 Agentic Loop：一个 Turn 内 Executor 串 Shield→Inference→(Tool+Inference 循环)→Shield→输出；客户端经 `create_turn` 触发，`AgentEventLogger` 流式回放 inference/shield/tool_execution 步骤。另有 `ReActAgent` 提供 ReAct 范式(JSON schema 约束输出) | `docs/sequence-diagram.md:1`, `examples/agents/agent_with_tools.py:70`, `examples/agents/react_agent.py:55` |
| [[planning\|规划/任务分解]] | 无独立 planner；多步推理交给模型自身(README "breaking a task down and performing multi-step reasoning")。`ReActAgent` 用 `ReActOutput` schema 引导"思考-行动"结构化分解 | `examples/agents/react_agent.py:12,55,59`, `README.md:7` |
| [[memory\|记忆(短/长/向量)]] | 短期=服务端 session(`enable_session_persistence`，`create_session`/`create_turn` 维持多轮)；长期/向量=`builtin::rag` + VectorIO API，`vector_dbs.register` 建库、`tool_runtime.rag_tool.insert` 灌库(all-MiniLM-L6-v2/384 维)；`agent_store` 还有 "live memory bank" 动态写入 | `examples/agents/rag_agent.py:63,72,80`, `examples/agent_store/api.py:67,259` |
| [[tool-use\|工具调用]] | 三态：built-in(`builtin::websearch`/`builtin::rag/knowledge_search`)、client tool(`@client_tool` 装饰函数 / 继承 `ClientTool` 实现 `get_params_definition`+`run_impl`)、code interpreter。工具以 list 传入 `Agent(tools=[...])` | `examples/client_tools/calculator.py:9`, `examples/client_tools/web_search.py:155`, `examples/agents/agent_with_tools.py:52` |
| [[model-abstraction\|模型抽象]] | 模型抽象在服务端 Inference API；客户端按 `model_id` 字符串选模型，`client.models.list()` 发现可用模型(区分 `model_type=="llm"` 与含 "guard" 的安全模型)。模型族=Llama 3.1/3.2 等 | `examples/agents/utils.py:5,24`, `examples/agent_store/api.py:35`, `README.md:5` |
| [[multi-agent-orchestration\|多智能体编排]] | 无框架级编排原语；`agent_store` 做应用层"多 agent + 路由"：注册 WebSearch / Memory 两个独立 Agent，由 UI dropdown 选择派发(`AgentChoice` 枚举)。无 agent 间自动通信/委派 | `examples/agent_store/api.py:27,52,208`, `examples/agent_store/app.py:45` |
| [[context-engineering\|上下文工程]] | `instructions`(system prompt) + `sampling_params`(top_p/greedy)；document/attachment 注入(`agent.create_turn(documents=...)`)，RAG `query_config`(max_chunks/max_tokens_in_context) 控制召回上下文长度；首轮注入 system message 的手动管理 | `examples/agents/chat_with_documents.py:83,90`, `examples/agent_store/api.py:100,216`, `examples/agents/agent_with_tools.py:49` |
| [[skills-plugins\|技能/插件]] | 无 skills/plugin 体系；扩展点是 toolgroups(`builtin::*`) 与 client tools。能力以"工具组"形态从服务端 provider 暴露 | N/A（`examples/agent_store/api.py:96` 仅 toolgroups） |
| [[observability-eval\|可观测/评估]] | 可观测=`AgentEventLogger`/`EventLogger` 流式打印每步(shield_call/inference/tool_execution)，turn.steps 可遍历 step_type；评估=`llama-stack-client eval run_scoring` CLI + `agent_store/eval/bulk_generate.py` 批量跑数据集生成答案再打分 | `examples/agents/react_agent.py:73`, `examples/agent_store/api.py:250`, `examples/agent_store/eval/bulk_generate.py:25,53` |
| [[runtime-execution\|运行时/部署]] | C/S 架构：server 单独启动(`llama stack run`，uvicorn `:8321`)，client app 经 HTTP 连接。部署形态多样：CLI 脚本(`python -m examples.agents.*`)、Gradio web(`agent_store`/`interior_design_assistant`)、桌面(DocQA .dmg/PyInstaller)、移动端(android/iOS 样例) | `README.md:52,107`, `examples/agent_store/app.py:151`, `examples/DocQA/app.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | 治理核心=**Llama Guard Shields**：`input_shields`/`output_shields` 在推理前后做安全过滤(ShieldCallStep)，含 code/cybersec shield 拦截工具调用代码；`client.shields.list()` 发现。无审批/打断式 HITL，但有人工反馈("Ingest into Memory Bank"点赞写回) | `examples/agents/simple_chat.py:30,50`, `docs/sequence-diagram.md:14`, `examples/agent_store/app.py:66` |
| [[state-persistence\|状态/持久化]] | 服务端会话持久化(`enable_session_persistence=True`)；agent_id/session_id 由 server 分配并复用；向量库 register 后持久；客户端侧仅缓存 chat_history/context(内存字典) | `examples/agent_store/api.py:131,156,169`, `examples/agents/simple_chat.py:53`, `examples/agent_store/app.py:18` |

## 设计权衡与特性

- **平台/栈优先 vs 库优先**：最大特征是"agent 逻辑在服务端"。优点：多语言客户端(py/node/swift/kotlin)共享同一 server 契约、Distribution 可换实现、安全/工具/向量统一标准化；代价：必须先跑起一个 Llama Stack server 才能用，本仓库脱离 server 不可独立运行，学习曲线在"理解 Stack API"而非读本仓库代码。
- **安全是一等公民**：Shields(Llama Guard) 被设计成与 inference/tool 同级的循环步骤(`docs/sequence-diagram.md`)，并区分 prompt shield / code-cybersec shield / output shield——这是多数 agent 框架缺失的、Meta 主打的差异化卖点。
- **样例仓库的本质**：本仓库代码量小、几乎全是 `examples/`，真正可复用的抽象(`Agent`/`ReActAgent`/`ClientTool`/`AgentEventLogger`)都来自 `llama-stack-client` SDK。要理解内核需读 SDK 与 `llama-stack` server 两个外部仓库。
- **绑定 Llama 生态**：默认面向 Llama 3.1/3.2 系列与 Llama Guard，模型发现/选择都假设 Llama Stack 后端；虽 Inference API 理论上可接其它 provider，但本仓库样例未展示。
- **待确认**：① 本地 commit `10eff82`(2025-08-05)，仓库已改名 `llama-stack-apps`，README/import 与原 `llama-agentic-system` 名称已不一致(框架名为历史名)；② SDK 内部的真实 reasoning loop/记忆/模型路由实现不在本地源码内，表中相关条目据 examples 调用方式与官方时序图推断，SDK 行级实现待确认；③ `agent_store/api.py:204` 残留旧 `client.memory.insert` API 与新 `tool_runtime.rag_tool.insert` 并存，存在版本漂移。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[human-in-the-loop-governance]]
- 同范式(model-stack/平台契约)：[[semantic-kernel]] · [[haystack]] · 源码：`agents-example/llama-agentic-system/`
