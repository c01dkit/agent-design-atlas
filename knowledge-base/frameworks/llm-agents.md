---
title: "llm-agents"
aliases:
  - llm-agents
  - llm_agents
  - mpaepper/llm_agents
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/llm-agents
  - lang/python
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/mpaepper/llm_agents
license: MIT (LICENSE 文件 + setup.py classifier 一致声明)
stars: ~1k
---

# llm-agents

> [!abstract] 一句话定位
> 一个极简（几百行）的教学型 single-agent 库，受 LangChain 启发、刻意"从零手搓"，用纯文本 prompt 脚手架 + 正则解析复刻经典 **ReAct（Thought / Action / Action Input / Observation）循环**，目的是让人用最少代码看懂"LLM 驱动的 agent 到底怎么跑起来"。

## 设计理念 / 顶层架构

llm-agents 的核心是 **"ReAct 的最小可读实现"**：作者明说 LangChain 很好但抽象层和文件太多，于是把"一个简单 agent 最重要的部分从零搓一遍"（`README.md:5-7`）。设计取舍：

- **Prompt 即控制流，正则即解析器**：没有 function-calling、没有 JSON schema、没有 graph。整个推理范式被压在一个文本模板 `PROMPT_TEMPLATE`（`llm_agents/agent.py:14`）里，要求 LLM 严格按 `Thought/Action/Action Input/Observation` 格式输出，再用一条正则 `r"Action: ...Action Input:..."`（`agent.py:88`）把动作和入参抠出来。
- **pydantic BaseModel 当骨架**：`Agent`、`ChatLLM`、`ToolInterface` 全是 `pydantic.BaseModel` 子类（`agent.py:36`、`llm.py:8`、`tools/base.py:3`），靠它做字段校验和默认值，没有自定义元类或依赖注入。
- **工具 = 实现 `use()` 的 BaseModel**：工具接口只有 `name` / `description` 两个字段和一个 `use(input_text)->str` 方法（`tools/base.py`），约定极弱、可读性极高。
- **薄 LLM 层**：`ChatLLM` 仅包了一层 `openai.ChatCompletion.create`（旧版 openai<1.0 API），默认 `gpt-3.5-turbo` + `temperature=0`，靠 `stop` 参数阻止 LLM 幻觉出 Observation（`llm.py:13`、`agent.py:42`）。
- **包结构**：`llm_agents/agent.py`（循环+解析）、`llm_agents/llm.py`（模型封装）、`llm_agents/tools/`（base + python_repl/search(SerpAPI)/google_search/searx/hackernews 五个具体工具）；顶层 `run_agent.py` 交互式入口。仅此而已。
- **入口 API**：`from llm_agents import Agent, ChatLLM, PythonREPLTool`，`agent.run(question)` 返回最终答案字符串（`agent.py:56`）。

最小示例（取自 README）：

```python
from llm_agents import Agent, ChatLLM, PythonREPLTool, HackerNewsSearchTool, SerpAPITool

agent = Agent(llm=ChatLLM(), tools=[PythonREPLTool(), SerpAPITool(), HackerNewsSearchTool()])
result = agent.run("Your question to the agent")

print(f"Final answer is {result}")
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 经典文本式 **ReAct**：`run()` 里 `while num_loops < max_loops(默认15)` 循环——把累积的 `previous_responses` 填回 prompt → LLM 生成 Thought+Action → 正则解析出工具 → 执行 → 把 `Observation: <result>` 拼回去；命中 `Final Answer:` 即返回 | `agent.py:56` (`run`), `agent.py:14` (`PROMPT_TEMPLATE`), `agent.py:80` (`decide_next_action`) |
| [[planning\|规划/任务分解]] | 无显式 planner，规划完全交给 LLM 在 Thought 步自行推演；prompt 仅提示"Thought/Action 重复 N 次直到确定答案"，无分解/子任务结构 | `agent.py:14` (PROMPT_TEMPLATE 内 `... repeats N times`) |
| [[memory\|记忆(短/长/向量)]] | 仅"短期"=本次 `run` 的 `previous_responses` 列表（每轮把 generated+Observation 追加，整段塞回 prompt）；无跨会话/长期/向量记忆 | `agent.py:57,76,78` (`previous_responses`) |
| [[tool-use\|工具调用]] | 文本协议而非原生 function-calling：工具实现 `ToolInterface.use(input_text)->str`；`tool_description`/`tool_names`/`tool_by_names` 把工具列表渲染进 prompt 供 LLM 选；解析后按名查表调用，未知工具抛 `ValueError`。内置 PythonREPL/SerpAPI/Google/Searx/HackerNews | `tools/base.py:3` (`ToolInterface`), `agent.py:44-54,73-75`, `tools/python_repl.py:34` |
| [[model-abstraction\|模型抽象]] | 单一 `ChatLLM` pydantic 类，硬编码调用 OpenAI 旧版 `openai.ChatCompletion.create`；只暴露 `model`/`temperature`，无多 provider 路由、无统一消息抽象（单条 user message） | `llm.py:8` (`ChatLLM`), `llm.py:13` (`generate`) |
| [[multi-agent-orchestration\|多智能体编排]] | N/A——纯 single-agent，无子 agent、无 agent 间通信 | N/A |
| [[context-engineering\|上下文工程]] | 极简：每轮把全部历史 `'\n'.join(previous_responses)` 原样拼回 prompt（无摘要/压缩/裁剪）；唯一"工程"手段是 `stop_pattern=['\nObservation:', ...]` 防止 LLM 续写假 Observation | `agent.py:69` (拼接), `agent.py:42` (`stop_pattern`) |
| [[skills-plugins\|技能/插件]] | 无插件系统；"扩展"=自定义继承 `ToolInterface` 的工具类传入 `tools=[...]`（README 明示可自建工具） | `tools/base.py:3`, `README.md:57` |
| [[observability-eval\|可观测/评估]] | 仅靠 `print()`：开头打印渲染后的 prompt、每轮打印 generated+Observation（`agent.py:66,77`）；无结构化 trace、无 token/cost 统计、无 eval 框架。`tests/` 目录仅含 setup 校验与空 unit/integration 包 | `agent.py:66,77` (print), `tests/test_setup_validation.py` |
| [[runtime-execution\|运行时/部署]] | 纯库，同步单进程顺序执行；`pip install -e .` 安装，`python run_agent.py` 交互式提问运行；无服务化/异步/沙箱 | `setup.py:3`, `run_agent.py:3`, `README.md:28-44` |
| [[human-in-the-loop-governance\|人在环/治理]] | 唯一"人在环"是 `run_agent.py` 启动时 `input()` 收集一次问题；无审批/拦截/危险操作治理——PythonREPL 直接 `exec()` 任意代码，无沙箱（安全风险） | `run_agent.py:4`, `tools/python_repl.py:21` (`exec`) |
| [[state-persistence\|状态/持久化]] | N/A——状态仅存活于单次 `run()` 的内存列表，进程结束即丢失，无任何落盘/恢复 | N/A (`agent.py:57` runtime-only) |

## 设计权衡与特性

- **教学优先，刻意不抽象**：与 [[connectonion\|ConnectOnion]] 那类"电池全包"的生产框架相反，llm-agents 的全部价值就在"短到能一口气读完"。它把 ReAct 范式裸露在一个 prompt 模板和一条正则里，是理解 LangChain 早期 `ZeroShotAgent` 内部机制的最佳读物（多个工具文件头部直接注明 "Based on/Taken from hwchase17/langchain"）。
- **文本协议 vs function-calling**：用 `Action:/Action Input:` 文本格式 + 正则解析，而非 OpenAI 原生 tool calling。优点是模型无关、直观；代价是脆弱——LLM 一旦不按格式输出，`_parse` 直接抛 `ValueError`（`agent.py:91`），没有重试/纠错。
- **强项是"可读性"，短板是"健壮性/生产性"**：无记忆持久化、无多 agent、无可观测、无沙箱、无错误恢复；PythonREPL 用裸 `exec()` 执行 LLM 生成代码属明显安全隐患，仅适合本地学习实验。
- **依赖已显陈旧**：基于 2023 年代码，`llm.py` 调用的是 `openai<1.0` 的 `openai.ChatCompletion`/全局 `openai.api_key` 写法，在新版 openai SDK 下需改写；`pydantic` 仍按 v1 风格（`name = "..."` 类级赋值、`Field(alias=...)`）使用。
- **待确认**：`__init__.py` 导出 `SearxSearchTool`/`GoogleSearchTool`，但 README 示例与默认 `run_agent.py` 仅用 PythonREPL/SerpAPI/HackerNews，这两个搜索工具是否经常被实际使用待确认；`stars ~1k` 为约数，具体以仓库为准。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[reasoning-loop]]
- 同范式(single / 教学极简)：[[connectonion]] · 源码：`agents-example/llm-agents/`
