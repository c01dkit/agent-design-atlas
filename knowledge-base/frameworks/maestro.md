---
title: "Maestro"
aliases:
  - Maestro
  - maestro
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/maestro
  - lang/python
  - paradigm/multi
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/Doriandarko/maestro
license: MIT (README 声明；仓库内无 LICENSE 文件，待确认)
stars: ~4k
---

# Maestro

> [!abstract] 一句话定位
> 一个单文件、脚本式的 **multi-agent 编排 demo**：用强模型 (Claude Opus/Sonnet) 作 orchestrator 把目标拆成下一个子任务，派给弱模型 (Haiku/Sonnet) 子代理执行，循环到 orchestrator 宣布完成，最后再用强模型 refine 汇总成最终产物（含自动落盘代码工程）。核心价值是演示 "supervisor 编排 + 模型分层 (model stack)" 这一范式，而非生产级框架。

## 设计理念 / 顶层架构

Maestro 没有"框架"骨架——它是一组**顶层过程式脚本**，每个文件对应一个 LLM provider 变体 (`maestro.py` 走原生 Anthropic SDK，`maestro-anyapi.py` 走 LiteLLM 多 provider，另有 gpt4o/groq/ollama/lmstudio 变体)。设计取舍：

- **三角色三函数**：整个编排就是三个函数构成的 supervisor 模式——`opus_orchestrator()`(拆任务/判完成)、`haiku_sub_agent()`(执行单个子任务)、`opus_refine()`(汇总精炼)。无类、无抽象基类、无 agent 对象，全部是模块级函数 + 模块级 `while True` 主循环 (`maestro.py:226`)。
- **模型分层 (model stack)**：靠三个常量 `ORCHESTRATOR_MODEL` / `SUB_AGENT_MODEL` / `REFINER_MODEL` 分配不同价位模型 (`maestro.py:19-21`)，体现"贵模型做规划/汇总，便宜模型做执行"的成本取舍；附带 `calculate_subagent_cost()` 实时算花费 (`maestro.py:23`)。
- **靠魔法字符串收敛**：orchestrator 在 prompt 里被要求当目标完成时以 `"The task is complete:"` 开头，主循环用 `in` 判断该字符串决定是否退出 (`maestro.py:235`)——没有结构化的终止信号或状态机。
- **产物即文件**：refine 阶段用 prompt 强制模型输出 `<folder_structure>` JSON + `Filename: xxx` 代码块，再用正则解析并真实写盘建工程 (`maestro.py:264-279`)；全程交换日志存成时间戳 `.md` (`maestro.py:301`)。
- **入口形态**：无库 API，直接 `python maestro.py`，命令行 `input()` 交互式问目标/文件/是否搜索 (`maestro.py:203-221`)。

最小示例（取自 README）：

```bash
# 1. 安装依赖
pip install -r requirements.txt   # anthropic, rich (+可选 tavily/litellm/groq/ollama)

# 2. 在脚本里填入 API key：client = Anthropic(api_key="YOUR_API_KEY_HERE")

# 3. 运行，交互式输入目标
python maestro.py
# > Please enter your objective: Build a snake game in python
# > Do you want to add a text file? (y/n): n
# > Do you want to use search? (y/n): n
# Opus 拆任务 -> Haiku 执行 -> ... 循环 -> Opus refine -> 自动建工程 + 存交换日志.md
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | 非 ReAct；是 supervisor 式 orchestrate-execute-refine 循环：`while True` 反复调 orchestrator 拆出"下一个子任务"→交 sub-agent 执行→结果回灌，直到 orchestrator 输出含 `"The task is complete:"` 才 break；无工具调用环节 | `maestro.py:226` (主循环), `maestro.py:235` (终止判定) |
| [[planning\|规划/任务分解]] | 由 orchestrator LLM 隐式规划：每轮只产出"下一个子任务"的 prompt（增量式拆解，非一次性全计划），并自评目标是否达成 | `maestro.py:42` (`opus_orchestrator`), prompt 见 `maestro.py:52` |
| [[memory\|记忆(短/长/向量)]] | 短期=两个列表 `task_exchanges`/`haiku_tasks` 累积历史，作为 `previous_results` 喂回 orchestrator、作为 system_message 喂回 sub-agent；无长期/向量记忆 | `maestro.py:223-224,228,247`, sub-agent 注入 `maestro.py:94` |
| [[tool-use\|工具调用]] | 无原生 function calling。唯一"工具"是可选的 Tavily 网络搜索：orchestrator 生成 `search_query` JSON，sub-agent 执行 `tavily.qna_search()` 把结果拼进 prompt | `maestro.py:99-103` (`tavily.qna_search`), `maestro.py:56-57` (生成 query) |
| [[model-abstraction\|模型抽象]] | `maestro.py` 直接绑定 Anthropic SDK；跨 provider 抽象在 `maestro-anyapi.py` 经 LiteLLM `completion()` 统一 OpenAI-style 接口（Anthropic/OpenAI/Gemini/Cohere…），另有 groq/ollama/lmstudio 专用变体 | `maestro.py:2,59`, `maestro-anyapi.py:7,37` (`from litellm import completion`) |
| [[multi-agent-orchestration\|多智能体编排]] | 核心范式：1 个 orchestrator (强模型) + N 次 sub-agent (弱模型) 的 supervisor 编排；模型分层由 3 常量配置；orchestrator 串行派发，子代理无并发、不互相通信 | `maestro.py:19-21` (model stack), `maestro.py:42/89/138` (三角色函数) |
| [[context-engineering\|上下文工程]] | 纯 prompt 拼接：历史结果直接字符串 `join` 进 prompt/system；无压缩/摘要/裁剪。仅有的"上下文管理"是输出≥4000 token 时递归续写防截断 | `maestro.py:52,94`, 续写 `maestro.py:130-133` |
| [[skills-plugins\|技能/插件]] | N/A（无技能/插件机制） | N/A |
| [[observability-eval\|可观测/评估]] | 用 `rich` Console/Panel 彩色打印每步过程；逐次打印 input/output token 与按 `calculate_subagent_cost()` 估算的美元成本；全程交换日志写入时间戳 `.md`。无评估框架 | `maestro.py:23` (成本), `maestro.py:66-68`, 日志 `maestro.py:289-302` |
| [[runtime-execution\|运行时/部署]] | 纯脚本，同步阻塞执行，CLI `input()` 驱动；`create_folder_structure()` 直接在本地建工程目录/写代码文件（无沙箱）；`flask_app/` 提供一个调 `run_maestro()` 的极简 Web 包装 | `maestro.py:168-200` (建工程), `flask_app/app.py:17` |
| [[human-in-the-loop-governance\|人在环/治理]] | 仅启动时 CLI 交互（目标/是否加文件/是否搜索）；运行中全自动，无审批/中断/护栏；写文件无确认 | `maestro.py:203-221` |
| [[state-persistence\|状态/持久化]] | 运行态状态仅存内存列表，进程结束即丢；唯一持久化是结束时把完整交换日志写成 `{timestamp}_{objective}.md` + 生成的代码工程落盘 | `maestro.py:301-303` (日志), `maestro.py:194-196` (代码文件) |

## 设计权衡与特性

- **教学 demo 而非框架**：与 [[connectonion\|ConnectOnion]] 的"电池全包平台"截然相反——Maestro 刻意极简，单文件、过程式、无抽象层，目标是用最少代码讲清 "orchestrator + sub-agent + refine + 模型分层" 的 supervisor 范式。强项是直观可改；代价是没有任何工程化设施（无类型、无测试、无错误恢复、key 硬编码在脚本里）。
- **模型分层是核心卖点**：三常量分配不同价位模型 + 实时成本打印，把"贵模型规划、便宜模型干活"这一成本意识做成了可见的设计主张，这是它区别于多数 multi-agent demo 的地方。
- **靠 prompt 工程而非代码控制流**：终止靠魔法字符串 `"The task is complete:"`、产物结构靠 prompt 约束 + 正则解析 `<folder_structure>` / `Filename:`——脆弱但零依赖，体现"用 LLM 顺从性替代状态机"的取舍。
- **续写防截断**：sub-agent/refine 在输出逼近 max_tokens(4096) 时递归调用自身续写并拼接 (`maestro.py:130`)，是少见的朴素 long-output 处理；但 `maestro.py` 用 `output_tokens>=4000` 判断、`maestro-anyapi.py` 改用 `len(text)>=4000`（字符数，口径不一致，待确认是否刻意）。
- **多 provider 是文件复制而非抽象**：跨模型支持靠把整个脚本复制成 anyapi/gpt4o/groq/ollama/lmstudio 多个变体，而非一层 provider 抽象——DRY 缺失，维护时需多处同步。
- **安全坑**：API key 直接硬编码在源码占位符 (`maestro.py:11`, Tavily `maestro.py:101`)；生成代码直接写本地磁盘无沙箱/无确认；属 demo 级，勿直接生产使用。
- **待确认**：①License——README 声明 MIT，但本地源码目录无 `LICENSE` 文件；②各变体续写阈值口径 (token 数 vs 字符数) 不一致。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[multi-agent-orchestration]]
- 同范式(multi / supervisor 编排)：[[connectonion]] · 源码：`agents-example/maestro/`
