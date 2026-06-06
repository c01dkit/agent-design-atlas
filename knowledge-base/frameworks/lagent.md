---
title: "Lagent"
aliases:
  - Lagent
  - lagent
  - InternLM/lagent
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/lagent
  - lang/python
  - paradigm/single
  - paradigm/general
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/InternLM/lagent
license: Apache-2.0
stars: ~2k
---

# Lagent

> [!abstract] 一句话定位
> InternLM 团队出品的**轻量级 LLM agent 框架**，借鉴 **PyTorch 的设计哲学**：`Agent` 就是一层"神经网络层"，开发者只需创建 layer 并定义 layer 间的消息传递（`AgentMessage`）。内核极薄——`Agent` 只负责 LLM 通信 + memory + 消息聚合/解析 + hooks；ReAct/工具调用/多智能体编排都靠组合（`Sequential`、子 agent 属性、Executor）而非继承堆叠出来。

## 设计理念 / 顶层架构

Lagent 的核心隐喻是 **"Models as Agents, Memory as State"**——把构建多智能体应用类比成搭神经网络。设计取舍：

- **薄内核 + 组合优于继承**：`Agent.__init__` 只装配五样东西——`llm`、`memory`(MemoryManager)、`aggregator`、`output_format`(parser)、`hooks`（`lagent/agents/agent.py:38`）。`__call__` 是固定模板：`before_agent` hooks → 写 memory → `forward` → 写 memory → `after_agent` hooks（`lagent/agents/agent.py:67`）；子类只重写 `forward`。
- **配置即对象（registry 风格）**：几乎所有组件都能用 `dict(type=Xxx, ...)` 声明，由 `create_object()` 实例化（继承自 OpenMMLab 体系）。如 `memory=dict(type=Memory)`、`actions=[dict(type='lagent.actions.PythonInterpreter')]`。
- **同步/异步/流式四象限**：通过 Mixin 组合出 `Agent` / `AsyncAgent` / `StreamingAgent` / `AsyncStreamingAgent`（`lagent/agents/agent.py:254,303,309,397`），`forward` 签名一致，只是返回值/生成器形态不同。
- **agent 作为属性即子 agent**：`__setattr__` 拦截，凡赋值为 `Agent` 的属性自动登记进 `_agents`（`lagent/agents/agent.py:114`），于是 `state_dict`/`reset`/`__repr__` 能像 `nn.Module` 那样递归遍历子模块。
- **包结构**：`agents/`（Agent 基类 + ReAct + stream(AgentForInternLM/MathCoder) + fc_agent + aggregator）；`actions/`（工具：BaseAction/ActionExecutor + 内置 Python/IPython/搜索/web/PPT/MCP）；`llms/`（GPTAPI/Claude/HF/vLLM/LMDeploy/Sensenova 等 wrapper）；`memory/`、`prompts/parsers/`、`hooks/`、`distributed/`（HTTP + Ray 服务化）。
- **入口 API**：`from lagent.agents import Agent`，agent 间用 `AgentMessage` 通信，`bot_msg = agent(user_msg)`。

最小示例（取自 README）：

```python
from lagent.agents import Agent
from lagent.schema import AgentMessage
from lagent.llms import VllmModel, INTERNLM2_META

llm = VllmModel(
    path='Qwen/Qwen2-7B-Instruct',
    meta_template=INTERNLM2_META,
    tp=1, top_k=1, temperature=1.0,
    stop_words=['<|im_end|>'], max_new_tokens=1024,
)
agent = Agent(llm, '你的回答只能从“典”、“孝”、“急”三个字中选一个。')  # 第二参数 = system_prompt/template

user_msg = AgentMessage(sender='user', content='今天天气情况')
bot_msg = agent(user_msg)            # 输入/输出都自动写入 agent.memory
print(bot_msg)                       # content='急' sender='Agent' ...
print(agent.state_dict()['memory'])  # 像 nn.Module 一样导出状态
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 多种范式并存：基础 `Agent` 是单次 LLM 调用；`ReAct` 用 `for _ in range(max_turn)` 循环 select_agent→检查 finish_condition→执行 actions(默认 max_turn=5)；`AgentForInternLM`/`MathCoder` 是 InternLM 原生工具循环；`FunctionCallAgent` 是 select/env 双 agent 的 while 循环 | `agents/react.py:59` (ReAct.forward), `agents/stream.py:100` (AgentForInternLM.forward), `agents/fc_agent.py:78` |
| [[planning\|规划/任务分解]] | 无独立 planner 模块；规划隐含在 ReAct 的 thought 字段里（prompt 要求模型输出 `thought_process`/`thought`），由 LLM 自身边想边做。N/A（无显式 plan-then-execute） | `agents/react.py:117` (ActionFormat.thought_process), `agents/stream.py:118` (get_steps role='thought') |
| [[memory\|记忆(短/长/向量)]] | 短期=按 session_id 分桶的 `Memory`（一个 `List[AgentMessage]`），`MemoryManager` 管理多会话；`recent_n` 截断 + `filter_func` 过滤；可 `save()`/`load()` 序列化。**无长期/向量记忆** | `memory/base_memory.py:7`, `memory/manager.py:7`, `agents/agent.py:63` (update_memory) |
| [[tool-use\|工具调用]] | 两条路：①`@tool_api` 装饰器 + `ToolMeta` 元类，用 griffe 解析 typehint+docstring 自动生成 schema，`BaseAction` 可单函数(run)或多 API toolkit；`ActionExecutor` 按 `name.api` 路由调用并裹 ActionReturn；②`fc_agent` 走 LLM 原生 function calling（`get_tool_prompt` 转 OpenAI tools schema） | `actions/base_action.py:27` (tool_api), `actions/base_action.py:236` (ToolMeta), `actions/action_executor.py:12`, `agents/fc_agent.py:30` (get_tool_prompt) |
| [[model-abstraction\|模型抽象]] | `BaseLLM`/`AsyncBaseLLM` 定义 `chat`/`generate`/`stream_chat`；`LMTemplateParser` 用 meta_template 把对话拼成模型专属字符串；多 provider wrapper：GPTAPI、ClaudeAPI、HFTransformer、VllmModel、LMDeploy*、Sensenova；`AsyncOpenAIWrapper.chat` 直接返回原生 `ChatCompletion`(含 tool_calls) | `llms/base_llm.py:96` (BaseLLM), `llms/base_llm.py:5` (LMTemplateParser), `llms/openai.py:31` (GPTAPI), `llms/openai.py:823` (AsyncOpenAIWrapper) |
| [[multi-agent-orchestration\|多智能体编排]] | 组合式：`Sequential` 容器按顺序串接 agent 并可 `exit_at` 提前退出；`AgentList`/`AgentDict` 把 agent 当容器元素；任意 agent 赋值为属性即成递归子 agent（`_agents`）。无中心调度器/角色协议 | `agents/agent.py:409` (Sequential), `agents/agent.py:550` (AgentList/AgentDict), `agents/agent.py:114` (__setattr__ 收集子 agent) |
| [[context-engineering\|上下文工程]] | `Aggregator` 负责把 memory 拼成 OpenAI message：`DefaultAggregator` 合并 system+历史，`InternLMToolAggregator` 处理工具步骤；`output_format`(parser) 用 `format_instruction()` 注入格式要求、`parse_response()` 抽取 thought/action 存入 `AgentMessage.formatted` | `agents/aggregator/default_aggregator.py`, `prompts/parsers/tool_parser.py:24` (ToolParser), `prompts/parsers/tool_parser.py:93` (MixedToolParser), `agents/agent.py:104` (forward 调用 aggregate) |
| [[skills-plugins\|技能/插件]] | 扩展点=`Hook`(4 钩子:before/after × agent/action) 与 actions(工具) 注册表；`MCPClientAdapter` 把外部 MCP server(stdio/sse/http) 暴露的工具接入为 BaseAction（待确认成熟度）。无独立"skill"概念 | `hooks/hook.py:7` (Hook 4 钩子), `actions/mcp_client.py:14` (ServerType stdio/sse/http), `agents/agent.py:158` (register_hook) |
| [[observability-eval\|可观测/评估]] | `MessageLogger` hook 给每条 AgentMessage 按 sender 着色打印到日志（可选文件 handler）；`get_steps()` 把工具循环展开成 thought/tool/environment 轨迹。**无内建 token/cost 统计与评估框架** | `hooks/logger.py:9` (MessageLogger), `agents/stream.py:114` (get_steps) |
| [[runtime-execution\|运行时/部署]] | 纯库；可经 `distributed/` 服务化——`HTTPAgentServer`/`Client`(subprocess 起 FastAPI + `/chat_completion`、`/memory/{session_id}`、`/health_check`) 与 `AgentRayActor`(Ray 分布式)；工具执行无沙箱，IPython/Python 解释器靠子进程+timeout 隔离 | `distributed/http_serve/api_server.py:14`, `distributed/ray_serve/ray_warpper.py`, `actions/ipython_interpreter.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | N/A：无审批/中断授权机制。最接近的是 `EnvAgent` 工具执行的 tenacity 重试(3 次) 与 `_scroll_buffer` 的 abort/resume 续跑逻辑，属容错而非人审 | `agents/fc_agent.py:117` (retry 机制), `agents/agent.py:202` (_scroll_buffer abort/resume) |
| [[state-persistence\|状态/持久化]] | `state_dict()`/`load_state_dict()` 仿 PyTorch 递归导出/载入各（子）agent 的 memory，键带 `__model_spec__` 以重建 AgentMessage 子类；HTTP server 经 `/memory/{session_id}` 暴露会话状态。落盘格式由调用方决定（无内建 DB） | `agents/agent.py:121` (state_dict), `agents/agent.py:135` (load_state_dict), `memory/base_memory.py:60` (save/load) |

## 设计权衡与特性

- **PyTorch 心智模型是最大卖点**：`Agent`≈`nn.Module`，子 agent 自动登记、`state_dict`/`load_state_dict`/`reset`/`__repr__` 递归遍历，熟悉 PyTorch 的人几乎零成本上手。代价是把"agent 编排"降维成"层堆叠"，缺少图/事件驱动那种显式控制流。
- **轻量但电池可选**：内核依赖很克制（pydantic/openai/tenacity/griffe…），重型能力（vLLM、LMDeploy、transformers、torch、搜索、PPT）放在 `optional` extras，按需安装——契合"lightweight framework"定位。
- **范式不统一是双刃剑**：仓库里同时存在 ReAct(prompt+JSONParser)、AgentForInternLM/MathCoder(InternLM 原生 `<|action_start|>` 标记)、FunctionCallAgent(OpenAI 原生 tool_calls) 三套并行的工具循环实现，灵活但学习曲线陡、概念冗余（DRY 偏弱）。
- **深度绑定 InternLM 生态**：`INTERNLM2_META`、InterpreterParser/PluginParser 的 `<|interpreter|>`/`<|plugin|>` 特殊 token、`MathCoder` 等都是为 InternLM 系模型量身定制；用别的模型时这部分价值打折。
- **工具 schema 自动化做得扎实**：`@tool_api`+`ToolMeta` 用 griffe 解析 google-style docstring 自动产出 name/parameters/required，且支持单函数工具与多 API toolkit 两种形态，`explode_return` 还能展开 dict 返回值。
- **RL/rollout 友好的细节**：`AgentMessage.finish_reason='abort'` + `_scroll_buffer` 支持中断后按 uid 续跑、`SESSION_OUT_OF_LIMIT` 时自动删末尾消息——透露出它也服务于 InternLM 的 agent RL 训练采样场景。
- **待确认**：①治理/人在环基本缺位，工具执行无沙箱（Python/IPython 仅靠 timeout）；②MCP 客户端较新，成熟度待确认；③无内建可观测的 token/cost 与评估 harness，需自行外挂。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[reasoning-loop]] · [[tool-use]]
- 同范式(轻量 single/general)：[[connectonion]] · 源码：`agents-example/lagent/`
