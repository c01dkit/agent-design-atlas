---
title: "smolagents"
aliases:
  - smolagents
  - CodeAgent
  - HuggingFace smolagents
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/smolagents
  - lang/python
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/huggingface/smolagents
license: Apache-2.0
stars: ~16k
---

# smolagents

> [!abstract] 一句话定位
> Hugging Face 出品的"极简内核"Python agent 库（核心逻辑约 1000 行），主打 **CodeAct 范式**——让 LLM 把动作写成 Python 代码而非 JSON 工具调用（`CodeAgent`），并配套 local/e2b/docker/modal/blaxel 多档执行沙箱；同时保留经典 JSON 工具调用的 `ToolCallingAgent`，模型与工具来源高度可插拔（任意 LLM、MCP/LangChain/Hub Space 工具）。

## 设计理念 / 顶层架构

smolagents 的核心信条是 **"Agents that think in code" + 抽象最小化**：作者刻意把主逻辑压在 `agents.py`（约 1800 行，含两种 agent + 多 agent + 序列化），鼓励用户"读源码、只取所需"。关键设计取舍：

- **CodeAct 优先**：`CodeAgent` 让模型在代码块（`<code>...</code>` 或 markdown python fence）里直接写 Python，工具即 Python 函数调用，循环、变量、组合天然可用。官方援引论文称比 JSON 工具调用少约 30% 步数、难基准上表现更好。代价是必须执行任意代码 → 安全责任转移到沙箱。
- **薄抽象 + 抽象基类继承**：`MultiStepAgent(ABC)`（`src/smolagents/agents.py:268`）实现统一的 ReAct 主循环、记忆、规划、多 agent；`CodeAgent`（`agents.py:1505`）与 `ToolCallingAgent`（`agents.py:1215`）只各自重写 `initialize_system_prompt()` 与 `_step_stream()`。扩展靠子类化而非事件/插件。
- **执行器是可插拔策略**：`PythonExecutor` 抽象（`local_python_executor.py:1677`）有 `send_tools/send_variables/__call__` 三方法；`LocalPythonExecutor`（同文件 `:1688`，AST 解释器，非安全边界）与 `RemotePythonExecutor` 子类（`remote_executors.py:53` → E2B/Docker/Modal/Blaxel 沙箱）可互换。
- **模型/工具来源全可插拔**：`Model` 基类（`models.py:452`）统一 `generate()/generate_stream()`，子类覆盖 InferenceClient/LiteLLM/OpenAI/Azure/Bedrock/Transformers/VLLM/MLX；工具可来自 `@tool` 装饰器、`Tool` 子类、MCP、LangChain、Gradio、Hub Space。
- **入口 API**：`from smolagents import CodeAgent, WebSearchTool, InferenceClientModel`，`agent.run(task)` 返回最终答案（`agents.py:436`）。

最小示例（取自 README）：

```python
from smolagents import CodeAgent, WebSearchTool, InferenceClientModel

model = InferenceClientModel()
agent = CodeAgent(tools=[WebSearchTool()], model=model, stream_outputs=True)

agent.run(
    "How many seconds would it take for a leopard at full speed "
    "to run through Pont des Arts?"
)
# CodeAgent 让模型写出 Python 代码调用 web_search() 等工具，
# 最终通过 final_answer(...) 返回；代码默认在 LocalPythonExecutor 中执行（非安全沙箱）
```

CodeAct 的实质（`agents.py:1638` `CodeAgent._step_stream`）：模型输出文本 → `parse_code_blobs()` 抽取代码块 → 包装成名为 `python_interpreter` 的 `ToolCall` → `self.python_executor(code_action)` 执行 → 捕获 print 日志与最后表达式值作为 observation 回灌记忆；当代码里调用 `final_answer(x)` 时执行器抛 `FinalAnswerException`（`local_python_executor.py:1633`）从而结束循环。

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | ReAct 多步循环：while not final and step<=max_steps，每步 think→act→observe；CodeAct 变体下 act=执行 Python 代码。子类只实现 `_step_stream` | `agents.py:540` (`_run_stream`), `agents.py:1638` (CodeAgent step), `agents.py:1276` (ToolCalling step) |
| [[planning\|规划/任务分解]] | 可选周期性规划：`planning_interval` 触发独立 planning step，首步生成 initial_plan、之后 update_plan（summary_mode 重写记忆）；计划存为 `PlanningStep` 注入记忆，非强制 | `agents.py:550` (调度), `agents.py:639` (`_generate_planning_step`), `prompts/code_agent.yaml` (planning 模板) |
| [[memory\|记忆(短/长/向量)]] | 短期=`AgentMemory.steps`（TaskStep/ActionStep/PlanningStep 列表）每步 `write_memory_to_messages()` 重放为 chat 消息；无内建长期/向量记忆（N/A，可经 callback/外部工具自接） | `memory.py:214` (`AgentMemory`), `agents.py:758` (`write_memory_to_messages`), `memory.py:50` (`ActionStep`) |
| [[tool-use\|工具调用]] | **两种范式**：CodeAgent 把工具当 Python 函数在沙箱内调用；ToolCallingAgent 走原生 JSON function-calling（`process_tool_calls`/`execute_tool_call`）。工具定义=`@tool` 装饰器或 `Tool` 子类(`forward()`)，自动从 type hints/docstring 生成 schema | `tools.py:106` (`Tool`), `tools.py:228` (`forward`), `agents.py:1361` (`process_tool_calls`), `agents.py:1453` (`execute_tool_call`) |
| [[model-abstraction\|模型抽象]] | `Model` 基类统一 `generate()/generate_stream()`，`_prepare_completion_kwargs` 把消息归一为 OpenAI 格式 + tools schema；子类覆盖各 provider，支持 stop/structured output/vision | `models.py:452` (`Model`), `models.py:1456` (`InferenceClientModel`), `models.py:1205` (`LiteLLMModel`), `models.py:1646` (`OpenAIModel`), `models.py:860` (`TransformersModel`) |
| [[multi-agent-orchestration\|多智能体编排]] | 层级式：把子 agent 放进 `managed_agents`，框架给它套上 name/description/inputs 使其"像工具一样可被调用"；父 agent 经 `agent(task=...)`(`__call__`) 调用，子 agent 跑完整 run 返回报告。注意：远程沙箱执行器不支持 managed agents | `agents.py:369` (`_setup_managed_agents`), `agents.py:868` (`__call__`), `agents.py:1608` (远程执行器禁用 managed) |
| [[context-engineering\|上下文工程]] | system_prompt 由 Jinja 模板 `populate_template` 注入 tools/managed_agents/authorized_imports/instructions；每步把记忆重放为消息；planning summary_mode 裁剪历史；observation/输出经 `truncate_content` 截断。无自动压缩 | `agents.py:1620` (`initialize_system_prompt`), `prompts/code_agent.yaml`, `agents.py:684` (summary_mode) |
| [[skills-plugins\|技能/插件]] | 无独立"技能/插件"系统；扩展点是**工具生态**：`ToolCollection.from_mcp`（MCP 服务器）、`Tool.from_hub/from_space/from_langchain/from_gradio`，以及 `step_callbacks` 回调注册表 | `tools.py:951` (`from_mcp`), `tools.py:517` (`from_hub`), `tools.py:763` (`from_langchain`), `memory.py:280` (`CallbackRegistry`) |
| [[observability-eval\|可观测/评估]] | `Monitor` 经 ActionStep callback 累计 token/步时长；`AgentLogger`(Rich) 分级日志；`memory.replay()` 回放；`return_full_result` 返回 `RunResult`(token_usage/steps/timing/state)；`telemetry` extra 接 OpenTelemetry/Arize Phoenix | `monitoring.py:81` (`Monitor`), `monitoring.py:100` (`update_metrics`), `agents.py:196` (`RunResult`), `memory.py:248` (`replay`) |
| [[runtime-execution\|运行时/部署]] | 纯库 + 多档代码执行：local(AST 解释器，进程内，非安全)、e2b/modal/blaxel(云沙箱)、docker(容器隔离)；`GradioUI` 提供 web 界面；`smolagent`/`webagent` CLI；`push_to_hub` 导出为 HF Space | `agents.py:1598` (`create_python_executor`), `remote_executors.py:335` (E2B), `remote_executors.py:551` (Docker), `cli.py`, `agents.py:1160` (`push_to_hub`) |
| [[human-in-the-loop-governance\|人在环/治理]] | 无内建审批/拦截机制；`final_answer_checks` 可在接受答案前跑校验函数；`agent.interrupt()` 可中断；`GradioUI` 提供人机对话与文件上传；危险代码靠**沙箱隔离**而非逐步批准 | `agents.py:613` (`_validate_final_answer`), `agents.py:754` (`interrupt`), `gradio_ui.py:279` (`GradioUI`) |
| [[state-persistence\|状态/持久化]] | 运行态=`agent.state` 字典(additional_args 注入沙箱变量)；`reset=False` 可跨 run 续接记忆；序列化经 `to_dict/from_dict/save/from_hub/push_to_hub` 把 agent+tools+prompt 落盘/上 Hub；`AGENT_REGISTRY` 限制反序列化类防 RCE | `agents.py:331` (`state`), `agents.py:892` (`save`), `agents.py:970` (`to_dict`), `agents.py:1810` (`AGENT_REGISTRY`) |

## 设计权衡与特性

- **CodeAct 是最大卖点**：与主流"LLM 吐 JSON 工具调用"路线相反，smolagents 让模型直接写 Python，循环/条件/变量复用/多工具一次性编排都天然支持（README 示例：一个代码块里 for 循环跑多次 web_search）。这是它区别于 [[connectonion|ConnectOnion]]、LangChain 等的核心范式差异。
- **安全是显式 tradeoff**：`LocalPythonExecutor` **明确不是安全沙箱**（README、源码 docstring 反复警告）——它用自写 AST 解释器（`evaluate_ast`）+ 导入白名单(`BASE_BUILTIN_MODULES` + `additional_authorized_imports`) + 危险模块/函数黑名单(`DANGEROUS_MODULES`/`DANGEROUS_FUNCTIONS`，`local_python_executor.py:130/143`) + 操作计数 + 超时做"尽力而为"防护，但可被绕过。生产跑不可信代码**必须**切到 e2b/docker/modal/blaxel 远程沙箱。
- **极简内核 vs 电池齐全**：与"把审批/压缩/skills/托管全内置"的 ConnectOnion 相反，smolagents 把内核压到最小，复杂能力（长期记忆、审批、压缩）需用户自接 callback/工具——换来的是可读性与"按需取用"的 hackability。
- **两种 agent 各取所需**：`CodeAgent`(代码动作，性能更优但需沙箱) 与 `ToolCallingAgent`(标准 JSON 工具调用，更保守安全) 共享同一内核，可按场景切换。
- **来源无关性强**：模型 7+ provider，工具可从 MCP/LangChain/Gradio/Hub Space 导入，多模态(文本/图像/视频/音频)输入；agent 本身可 `push_to_hub` 分享为 Space。
- **多 agent 较轻量**：仅层级式 managed_agents（子 agent 当工具调），无去中心化 handoff/swarm 网络；且远程沙箱模式下 managed agents 被禁用（`agents.py:1608`）。
- **规划是可选的**：默认不规划，设 `planning_interval` 才周期性插入计划步——不是强制 plan-execute。
- **待确认**：长期/向量记忆、人在环逐步审批均无内建实现，需自行经工具或 step_callbacks 扩展（非框架原生能力）。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[reasoning-loop]] · [[runtime-execution]]
- 同范式(single + model-driven/CodeAct)：[[connectonion]] · 源码：`agents-example/smolagents/`
