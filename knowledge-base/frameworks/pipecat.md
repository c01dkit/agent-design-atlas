---
title: "Pipecat"
aliases:
  - Pipecat
  - pipecat
  - pipecat-ai
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/pipecat
  - lang/python
  - paradigm/voice
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/pipecat-ai/pipecat
license: BSD-2-Clause
stars: ~6k（约数，未联网核实）
---

# Pipecat

> [!abstract] 一句话定位
> 一个开源的 **实时语音与多模态对话 AI 框架**（pyproject 自述 "framework for voice (and multimodal) assistants"）：把音频/视频、STT/LLM/TTS 服务、WebRTC/WebSocket 传输统一抽象成在 **Pipeline** 中单向流动的 **Frame**，由一串 **FrameProcessor** 事件驱动地逐级处理，专门解决实时语音对话里的低延迟、打断（barge-in）、轮次（turn）管理问题。

## 设计理念 / 顶层架构

Pipecat 的核心范式不是"agent 推理循环"，而是 **frame-based 流式管道（pipeline of frame processors）**——更接近 GStreamer / 数字音频工作站的数据流模型，而非 ReAct。设计取舍：

- **一切皆 Frame**：音频、文本、图像、控制信号都是 `Frame` dataclass（`src/pipecat/frames/frames.py` 定义 ~236 个 Frame 类型）。Frame 有方向：`DOWNSTREAM`（输入→输出，承载数据）与 `UPSTREAM`（确认/错误回传），见 `processors/frame_processor.py:56` 的 `FrameDirection`。
- **一切皆 FrameProcessor**：`FrameProcessor`（`processors/frame_processor.py:175`）是唯一处理单元；它接收 frame、处理、用 `push_frame()`（`:702`）推给下游。STT/LLM/TTS service、transport、aggregator、filter 全是它的子类。处理器用 `link()`（`:536`）串成链。
- **Pipeline 即处理器链**：`Pipeline`（`pipeline/pipeline.py:91`）把一个 processor 列表首尾相连，并自动在两端包上 `PipelineSource`/`PipelineSink`（`:21`/`:55`）。`ParallelPipeline`（`pipeline/parallel_pipeline.py:24`）让多条子管道并行。
- **Worker = 可运行单元（1.3.0 新模型）**：管道本身不自跑，要包进 `PipelineWorker`（`pipeline/worker.py:170`，`BaseWorker` 子类），由 `WorkerRunner`（`workers/runner.py:80`）驱动并管信号/优雅退出。旧的 `PipelineTask`（`pipeline/worker.py:1273`）/`PipelineRunner` 已弃用为别名。
- **事件驱动**：几乎所有对象继承 `BaseObject`，支持事件回调（如 transport 的 `@event_handler("on_client_connected")`）；打断、轮次开始/结束都通过特定 Frame 在管道里传播来驱动状态变化，而非集中式调度。
- **多 worker / bus（合并自 pipecat-subagents）**：单管道之外，多个 worker 可经 `WorkerBus`（`bus/bus.py`，默认 `AsyncQueueBus`，分布式可换 pgmq/redis）用 job RPC 协作。

最小示例（取自 `examples/getting-started/06-voice-agent.py`，典型 STT→LLM→TTS 语音回环）：

```python
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair, LLMUserAggregatorParams,
)
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.workers.runner import WorkerRunner

stt = DeepgramSTTService(api_key=...)
llm = OpenAILLMService(api_key=..., settings=OpenAILLMService.Settings(
    system_instruction="You are a helpful assistant in a voice conversation."))
tts = CartesiaTTSService(api_key=...)

context = LLMContext()
user_agg, assistant_agg = LLMContextAggregatorPair(
    context, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()))

pipeline = Pipeline([
    transport.input(),   # 传输层进帧（麦克风/WebRTC）
    stt,                 # 语音转文字
    user_agg,            # 聚合用户轮次
    llm,                 # 大模型
    tts,                 # 文字转语音
    transport.output(),  # 传输层出帧（扬声器）
    assistant_agg,       # 聚合助手轮次
])

worker = PipelineWorker(pipeline, params=PipelineParams(enable_metrics=True))
runner = WorkerRunner()
await runner.add_workers(worker)
await runner.run()
```

## 组件实现（横向逐项，无则标 N/A）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **非 ReAct**；范式是 frame-based 流式管道：Frame 沿 processor 链单向流动，每个 `FrameProcessor.process_frame()` 处理后 `push_frame()` 给下游；推理本身委托给 LLM service（function-calling 多轮由 `run_function_calls` 把结果回灌进 `LLMContext` 再触发下一轮 inference） | `processors/frame_processor.py:615` (`process_frame`), `:702` (`push_frame`), `services/llm_service.py:888` (`run_function_calls`) |
| [[planning\|规划/任务分解]] | 框架内核无显式 planner；任务分解交给 LLM 自身或上层应用。结构化"分解"体现在管道编排（`Pipeline`/`ParallelPipeline`）与多 worker job RPC（`@job` + `job_group` 扇出），而非自动 plan | `pipeline/pipeline.py:91`, `pipeline/parallel_pipeline.py:24`, `pipeline/job_decorator.py` |
| [[memory\|记忆(短/长/向量)]] | 短期=`LLMContext` 累积对话消息（`add_message`/`get_messages`）；长期/向量=可选 `Mem0MemoryService`（`FrameProcessor`，接 mem0ai 向量记忆，extra `mem0`）；亦有 `persistent-context` 示例做会话落盘 | `processors/aggregators/llm_context.py:93,372`, `services/mem0/memory.py:35` |
| [[tool-use\|工具调用]] | LLM service 上 `register_function(name, handler)` 注册函数，handler 收 `FunctionCallParams`；支持 direct function、并行/顺序执行、`cancel_on_interruption`、超时；外部工具经 `MCPClient.register_tools(llm)` 把 MCP server 工具批量注册 | `services/llm_service.py:754` (`register_function`), `:136` (`FunctionCallParams`), `:888` (`run_function_calls`), `services/mcp_service.py:146` |
| [[model-abstraction\|模型抽象]] | 服务基类体系 `AIService`→`LLMService`/`STTService`/`TTSService`/`VisionService`；60+ provider 实现（openai/anthropic/google/groq…）；`BaseLLMAdapter`（泛型）把统一 `LLMContext`/`ToolsSchema` 转成各家 provider 的 messages/tools 格式 | `services/llm_service.py:245` (`LLMService`), `services/ai_service.py`, `adapters/base_llm_adapter.py:33,94,129` |
| [[multi-agent-orchestration\|多智能体编排]] | 两路：①进程内 `ParallelPipeline` 并行多条管道；②多 **worker** 经 `WorkerBus` 协作——`@job(name=, sequential=)` 暴露 handler，调用方 `async with self.job(name)` / `self.job_group(*names)` 发请求并等 `JobStatus`；`WorkerRegistry` 跟踪本地/远程 worker（pgmq/redis 可跨进程） | `pipeline/parallel_pipeline.py:24`, `pipeline/job_context.py`, `pipeline/job_decorator.py`, `bus/bus.py`, `registry/` |
| [[context-engineering\|上下文工程]] | `LLMContext` 为单一上下文真相，由 `LLMContextAggregatorPair` 拆成 user/assistant 两个 aggregator 在管道里增量聚合；`system_instruction` 经 service 注入并可 `append_system_instruction`；`LLMContextSummaryRequestFrame` 触发上下文摘要（context-summarization 示例） | `processors/aggregators/llm_context.py:93`, `processors/aggregators/llm_response_universal.py` (`LLMContextAggregatorPair`), `services/llm_service.py:476,638` |
| [[skills-plugins\|技能/插件]] | 无独立"skill/plugin"系统；扩展点即"写一个 `FrameProcessor` 子类"或"新增一个 service（扩展对应 base 类）"。第三方框架以 processor 形式接入：`processors/frameworks/`（LangChain、Strands Agents、RTVI） | `processors/frame_processor.py:175`, `processors/frameworks/langchain.py`, `processors/frameworks/strands_agents.py` |
| [[observability-eval\|可观测/评估]] | `BaseObserver` 旁路监听 frame 流（`on_process_frame`/`on_push_frame`），不改管道；内置 turn/latency/startup observer；`PipelineParams(enable_metrics=, enable_usage_metrics=)` 收集 token/延迟；OpenTelemetry 追踪经 `TurnTraceObserver` + `utils/tracing/`（extra `tracing`），Sentry 集成 | `observers/base_observer.py`, `observers/turn_tracking_observer.py`, `pipeline/worker.py:135` (`PipelineParams`), `utils/tracing/turn_trace_observer.py:36` |
| [[runtime-execution\|运行时/部署]] | `PipelineWorker` 包管道，`WorkerRunner.run()` 异步驱动并管 SIGINT/SIGTERM 优雅退出（`auto_end=True` 时根 worker 跑完即结束，长驻服务用 `False`）；`pipecat.runner`（extra `runner`：uvicorn+fastapi）提供 dev 服务器与 `create_transport`；可部署到 Pipecat Cloud | `workers/runner.py:80,160,195`, `pipeline/worker.py:170`, `workers/base_worker.py:102,321`, `runner/run.py`, `runner/utils.py` |
| [[human-in-the-loop-governance\|人在环/治理]] | 实时交互而非审批治理：**打断/barge-in**——`InterruptionFrame`（携 `asyncio.Event`，到 sink 时 set）由用户轮次开始策略触发；**轮次管理**——`UserTurnStrategies`（start: VAD+转写; stop）判定用户起止说话；`RTVIProcessor` 作为客户端↔管道协议桥接收文本/音频/函数结果 | `turns/user_turn_strategies.py:55`, `turns/user_start/vad_user_turn_start_strategy.py`, `processors/frameworks/rtvi/processor.py:49` |
| [[state-persistence\|状态/持久化]] | 运行态在 `LLMContext`（消息）+ worker 内部状态；`EndFrame`/`StopFrame` 为 uninterruptible（打断也不丢）；序列化主要面向 **wire 传输**：`FrameSerializer.serialize/deserialize`（Twilio/Plivo/Vonage/Telnyx/Exotel/Genesys/protobuf）把 frame 转电话/WebSocket 协议；跨 worker 状态走 bus 的 `BusMessage` | `serializers/base_serializer.py:23,80,92`, `serializers/twilio.py`, `frames/frames.py`, `bus/messages.py` |

## 设计权衡与特性

- **为"实时语音"而生，不是通用 agent harness**：与 [[connectonion\|ConnectOnion]] 这类 single-agent ReAct 框架正交——Pipecat 的一等公民是音频流、延迟、打断、轮次，而不是"思考-行动循环"。LLM 在这里只是管道中一个 processor，function-calling 多轮是 service 内部行为。
- **frame/processor 抽象的代价与收益**：统一成 ~236 个 Frame + 单一 `FrameProcessor` 接口，换来极强的可组合性（任意 STT/LLM/TTS/transport 自由拼接、并行、加 filter/observer），但学习曲线偏陡——必须理解 frame 方向、push 时机、打断时 `frame.complete()` 的契约（不向下游传 `InterruptionFrame` 的处理器**必须**调 `complete()`，否则会卡住等待者）。
- **打断处理是核心难点的一等抽象**：`InterruptionFrame` 携带 `asyncio.Event`、uninterruptible frame（`EndFrame`/`StopFrame`）、VAD 触发的用户轮次开始策略，共同构成低延迟 barge-in 机制——这是语音框架区别于文本 agent 框架的关键工程点。
- **极广的 provider 生态**：pyproject 列了 60+ 可选 extra（STT/TTS/LLM/传输/电话/avatar），全部走统一 base 类 + adapter，换 provider 基本只改构造行。
- **新 worker/bus 模型（1.3.0）**：把"pipeline task"重构为 `BaseWorker`/`WorkerRunner`，并内置多 worker job RPC（本地 AsyncQueueBus，分布式 pgmq/redis），向"多协作 worker"演进；旧 `PipelineTask`/`PipelineRunner` 保留为弃用别名。
- **待确认/坑**：①star 数为约数，本次未联网核实；②`PipelineTask`/`PipelineRunner`/`tool_resources`/`pipeline_task` 等大量 1.2–1.3 弃用别名仍在，跟教程时注意版本；③不少能力靠 optional extra，缺装会 import 失败。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[tool-use]]
- 范式（voice / 流式管道）：本库唯一 · 源码：`agents-example/pipecat/`
