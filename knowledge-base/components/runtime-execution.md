---
title: "运行时与执行"
aliases:
  - Runtime
  - Execution
  - Sandbox
  - Deployment
tags:
  - knowledge-base
  - domain/agent-components
  - component/runtime-execution
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 运行时与执行

> [!abstract] 一句话总结
> agent 在哪里、以何种形态运行：代码执行沙箱、并发模型、部署形态（库 / 服务 / serverless / 桌面 / GitHub Actions）。尤其当 agent 会执行模型生成的代码时，安全沙箱是刚需。

## 它解决什么问题

agent 要真正做事——跑代码、调系统——就需要执行环境，并要在能力与安全之间权衡。部署形态决定它如何融入产品。

## 设计维度 / 实现谱系

- **代码执行**：直接本地执行（危险）↔ 受限沙箱 ↔ 远程隔离（[[e2b|e2b]] 微 VM）
- **并发**：同步 ↔ async ↔ 事件驱动（[[pipecat|Pipecat]] 流水线）
- **部署形态**：库（import 即用）↔ 服务/API（[[dust|Dust]]、[[agentfield|AgentField]]）↔ serverless（[[modus|Modus]]）↔ 桌面/Electron（[[swarmclaw|SwarmClaw]]）↔ GitHub Actions（[[aeon|Aeon]]）
- **多语言/边缘**：Go/Rust 基础设施、WASM 本地（[[ailoy|Ailoy]]）
- **资源治理**：超时、配额、隔离

## 关键要点

- CodeAct 类 agent（[[smolagents|smolagents]]）必须配安全沙箱，否则等于任意代码执行。
- 部署形态是框架 vs 平台的分界（库 vs 全托管服务）。
- 语言生态深刻影响运行时设计，见 [[language-ecosystem]]。

## 关联

- [[tool-use]] · [[skills-plugins]] · [[human-in-the-loop-governance]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **49** 个实现了「运行时」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | GitHub Actions 即运行时：messages.yml(/5 cron 调度器，纯 bash cron_match 解析+gh workflow run 派发) + aeon.yml(runner，ubuntu-latest、装 @anthropic-ai/claude-code、30 分超时)。无服务器、公共仓库免费分钟数。本地 ./aeon 起 Next.js 仪表盘配置 |
| [[ag2\|AG2]] | 纯库，同步为主（多数 API 有 a_ 异步孪生）。run() 在后台线程跑对话返回 RunResponse 事件流，run_iter() 可逐事件步进；代码执行器可插拔：local/docker/jupyter/daytona/yepcode/remyx 等（沙箱程度各异）；a2a/ag_ui 暴露协议端点 |
| [[agency-swarm\|Agency Swarm]] | 纯库；async 优先（get_response / get_response_stream），get_response_sync 为同步包装。部署：run_fastapi()（REST + 可选 AG-UI）、run_mcp()（暴露为 MCP server）、copilot_demo()（Web UI）、tui()（终端，watchfiles 热重载） |
| [[agent-llm\|Agent-LLM (AGiXT)]] | FastAPI + uvicorn 服务（app.py:220），Docker/docker-compose.yml 部署；危险代码经 safeexecute（Docker 沙箱执行库，见 requirements）隔离；agixt start CLI 一键起服务，ngrok 内网穿透可选 |
| [[agentdock\|AgentDock]] | 纯库（agentdock-core，tsup 打包，含 .+/server 两个 export，区分 edge/Node）；自身不起服务，由 Next.js 客户端（Vercel 一键部署）或宿主后端驱动；流式执行依赖 Vercel AI SDK，serverless 下用 @vercel/functions waitUntil 跑后台任务 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | 纯库（pip/uv 安装），无服务进程；ace CLI 做交互式配置/模型校验，ace-mcp 起 MCP server 供 IDE 集成，kayba 是云端 CLI(上传 trace/拉取洞见)；RR 的代码执行在 TraceSandbox(SIGALRM 超时, 仅 Unix; Windows 不强制超时) |
| [[agentscope\|AgentScope]] | 纯异步库可直接嵌入；沙箱化工作区 workspace/：LocalWorkspace/DockerWorkspace/E2BWorkspace + Offloader 把大上下文/工具结果卸载；生产侧 app/ 提供 FastAPI 多租户、多会话 agent 服务(create_app)、调度器(apscheduler)、AG-UI 协议、Redis 存储；支持本地/Serverless/K8s + OTel |
| [[agentset\|Agentset]] | Next.js 应用(maxDuration=120, region iad1，chat/route.ts:54)；摄取/删除经 Trigger.dev durable task(processDocument maxDuration 3h、并发 90，jobs/tasks/process-document.ts:72)，解析调外部 Partition API，批次经 Redis、向量化经 embedMany 后 upsert |
| [[agentverse\|AgentVerse]] | 纯 Python 库 + CLI；环境 run() 同步驱动、每个 step 内 asyncio.gather 并发跑多 agent 的 astep（simulation_env/basic.py:67）；4 个 console_scripts 入口（simulation / simulation-gui / tasksolving / benchmark，setup.py:48）；GUI 经 gradio，Pokemon demo 经 FastAPI+uvicorn(pokemon_server.py) + 前端(ui/) |
| [[ailoy\|Ailoy]] | Rust crate 编译为 cdylib，三平台分发为 PyPI(ailoy-py)/npm(ailoy-node/ailoy-web)；本地推理走 TVM Relax VM（native 用 tvm-runtime-rs，wasm 用 tvmjs_bridge，src/ffi/web/tvmjs_bridge.rs）；按平台选 Vulkan/Metal/WebGPU（src/model/local/inferencer.rs:41）；支持同步/异步双 API（Python run_sync/run）。另有 ailoy-model CLI 管理模型（src/cli/ailoy_model.rs，feature-gated） |
| [[astron\|Astron Agent]] | 多进程微服务 + 异步：各 Python 服务 FastAPI/uvicorn，workflow 引擎 asyncio 并发跑 DAG 节点；代码节点 code_node 支持多 executor（e2b 沙箱 / ifly / local / langchain）；部署 Docker Compose（docker/astronAgent）或 Helm（开发中），鉴权用 Casdoor，数据面 MySQL+Redis+Kafka+MinIO |
| [[autogen\|AutoGen]] | AgentRuntime Protocol 多实现：SingleThreadedAgentRuntime(单进程异步事件队列)；分布式 gRPC worker/host runtime（autogen-ext，跨 .NET/Python，见 protos/）；agent 经 register_factory 惰性实例化；code executor 经 autogen-ext(Docker/本地)沙箱执行 |
| [[botpress\|Botpress]] | 双 VM 驱动：默认 QuickJS(WASM) 沙箱（完全隔离、128MB 内存上限、超时中断、可 abort），失败回退 Node VM；浏览器/Lambda/CF Workers/Bun/Deno 全支持。平台侧经 bp deploy 部署到 Botpress Cloud 工作区 |
| [[connectonion\|ConnectOnion]] | 纯库；同步执行，工具在本进程顺序执行(无沙箱)；host() 起 uvicorn ASGI(HTTP+WS) 服务，配置在 .co/host.yaml；co create/init/deploy CLI 脚手架 |
| [[cordum\|Cordum]] | 多服务部署：Docker Compose / Helm chart（cordum-helm/）/ K8s（deploy/k8s/）；镜像 cosign keyless 签名（README.md:251）；TLS mTLS 默认；端口 8081 Gateway / 8082 Dashboard / 50051 Safety Kernel gRPC（README.md:312）。一键起栈 tools/scripts/quickstart.sh |
| [[cortex-mem\|Cortex Memory]] | 五种接入：① REST 服务(Axum,默认 8085,service/src/main.rs:134 Router /api/v2)；② MCP server(stdio)；③ CLI 二进制；④ Rust 库直接嵌入(CortexMemBuilder builder.rs:74 build)；⑤ Rig 工具集。Tokio 异步运行时 |
| [[crewai\|CrewAI]] | 纯库；crew.kickoff() 同步执行(支持 kickoff_async/kickoff_for_each/stream)，async task 用 ThreadPool 并行；CLI crewai create/run/install；AMP 云控制面做生产部署 |
| [[dust\|Dust]] | 服务化平台：front=Next.js(Pages Router+SSR)，agent loop 跑在 Temporal 持久化工作流(可取消/中断/优雅停止)；core=Rust 多二进制(core-api/oauth/sqlite-worker)；docker-compose 编排 + Postgres/Qdrant/Elasticsearch；工具可在 E2B 沙箱内以非 root 执行 |
| [[e2b\|E2B]] | 核心强项。云端 Firecracker microVM 隔离运行时（envd 在 e2b-dev/infra）。SDK：commands.run(cmd, {background,cwd,user,envs,timeoutMs,onStdout/onStderr,stdin}) 起进程并流式回传 stdout/stderr（底层走 /bin/bash -l -c，ConnectRPC 流）；pty 提供伪终端；files 提供 read/write/list/makeDir/rename/remove/exists/getInfo/watchDir；git 封装 clone/commit/push 等；网络出口经 allowOut/denyOut/rules 精细控制；可自托管（AWS/GCP, Terraform） |
| [[haystack\|Haystack]] | 纯 Python 库；Pipeline.run() 同步顺序执行，AsyncPipeline.run_async() 让无依赖分支并行（asyncio）；warm_up() 钩子做模型/连接的重初始化；本进程执行无沙箱；生产部署经 Hayhooks(独立项目) 把 pipeline 包成 REST API / MCP server / OpenAI 兼容端点 |
| [[hcom\|hcom]] | 单 Rust 二进制，无常驻服务。被挂 agent 跑在 PTY 包装里（run_pty，src/main.rs:69；pty/mod.rs），暴露 TCP inject/state 端口；spawn 用真实终端模拟器（kitty/wezterm/tmux/zellij/iterm…）或 --headless 后台（terminal.rs, integration_spec.rs:82 BackgroundMode）。装机：brew / curl installer / pip/uv |
| [[hermes-agent\|Hermes Agent]] | 六种终端后端：local/Docker/SSH/Singularity/Modal/Daytona(TERMINAL_ENV 选；Modal/Daytona 提供 idle 休眠的 serverless 持久化)；code_execution 工具让脚本经 UDS/文件 RPC 回调 Hermes 工具，把多步流水线压成零上下文成本一轮；可 $5 VPS 长驻 |
| [[hive\|Hive]] | uv workspace；async 执行，节点可并行；headless 24/7 运行（docs/key_concepts/worker_agent.md）；AgentHost/colony_runtime 管 colony 生命周期；webhook/timer/event triggers；framework.cli:main(hive 命令) + 浏览器 dashboard |
| [[lagent\|Lagent]] | 纯库；可经 distributed/ 服务化——HTTPAgentServer/Client(subprocess 起 FastAPI + /chat_completion、/memory/{session_id}、/health_check) 与 AgentRayActor(Ray 分布式)；工具执行无沙箱，IPython/Python 解释器靠子进程+timeout 隔离 |
| [[langchain\|LangChain]] | 纯库；create_agent 产出可 invoke/stream/astream 的 CompiledStateGraph（factory.py:714），运行时为 LangGraph Pregel；debug=/cache=/transformers= 透传；生产部署指向 LangSmith Deployment（README） |
| [[llama-agentic-system\|Llama Agentic System (llama-stack-apps)]] | C/S 架构：server 单独启动(llama stack run，uvicorn :8321)，client app 经 HTTP 连接。部署形态多样：CLI 脚本(python -m examples.agents.)、Gradio web(agent_store/interior_design_assistant)、桌面(DocQA .dmg/PyInstaller)、移动端(android/iOS 样例) |
| [[llamaindex\|LlamaIndex]] | 纯库；agent 是 async Workflow，agent.run() 返回 WorkflowHandler(可 await / 流式迭代)；步骤并发由 Workflow 引擎(外部 workflows 包)调度；无内置 server，部署/服务化交给 LlamaDeploy / LlamaAgents(仓库外) |
| [[llm-agents\|llm-agents]] | 纯库，同步单进程顺序执行；pip install -e . 安装，python run_agent.py 交互式提问运行；无服务化/异步/沙箱 |
| [[loongflow\|LoongFlow]] | 纯 Python 库（pip install -e .，需 3.12+）；全异步 asyncio；进化任务由 run_general.sh/run_math.sh/run_ml.sh 脚本以 --background 后台跑并写 run.log；代码执行隔离靠 multiprocessing 子进程 + timeout（非容器沙箱）；ClaudeCodeAgent 默认 permission_mode="acceptEdits" 直接读写真实文件系统 |
| [[maestro\|Maestro]] | 纯脚本，同步阻塞执行，CLI input() 驱动；create_folder_structure() 直接在本地建工程目录/写代码文件（无沙箱）；flask_app/ 提供一个调 run_maestro() 的极简 Web 包装 |
| [[mastra\|Mastra]] | 库 + 服务双形态：agent.stream() 流式（基于 ReadableStream + MastraModelOutput）；嵌入 React/Next/Node 或经 @mastra/deployer/server-adapters 部署为独立 HTTP 服务；create-mastra 脚手架 + playground 本地调试 UI；engines.node>=22.13；工具默认本进程执行，可控并发（toolCallConcurrency） |
| [[metagpt\|MetaGPT]] | 纯库 + typer CLI（metagpt/software_company.py 的 generate_repo/startup）；全异步（asyncio）；产物落盘到 workspace/ 经 ProjectRepo/GitRepository（含 archive git 提交）；代码执行经 RunCode Action / Data Interpreter 在本地执行（无强沙箱）；提供 Dockerfile |
| [[modus\|Modus]] | serverless WASM：Go Runtime + Wazero 执行模块，按调用加载沙箱跑完即释放；modus CLI(modus new/dev/build) 脚手架与 fast-refresh 本地开发；可自托管或推 GitHub 由 Hypermode 自动构建部署到全球基础设施 |
| [[nanobot\|nanobot]] | 纯 asyncio 库 + CLI；三种入口：CLI nanobot agent、网关 nanobot gateway（WebSocket 多路复用 + 内置 WebUI，打进 wheel）、OpenAI 兼容 HTTP API；shell 工具带 sandbox 后端与 allow-list；Docker / docker-compose / Linux service / macOS LaunchAgent 部署 |
| [[open-multi-agent\|Open Multi-Agent]] | 纯 ESM 库，嵌入任意 Node 18+；并发由 AgentPool 的 Semaphore 控制(默认 maxConcurrency:5)；文件工具沙箱在 <cwd>/.agent-workspace(符号链接也解析进根，防 TOCTOU)，bash 不沙箱；JSON-first oma CLI 供 shell/CI；tsc 编译 src→dist |
| [[openclaw\|OpenClaw]] | 常驻 Gateway daemon（launchd/systemd user service）作为单一控制平面；CLI openclaw onboard/gateway/agent/message/cron/...；Node 24(推荐)/22.19+；Docker / docker-compose / fly.toml / render.yaml 多种部署；companion apps（Windows Hub、macOS menu bar、iOS/Android node）；built-in runtime id=openclaw，auto 可切换到插件 harness |
| [[pilotprotocol\|Pilot Protocol]] | 核心：单 daemon 二进制（pilot-daemon/pilotctl/pilot-gateway/pilot-updater），daemon.New(cfg)+d.Start() 起隧道与 IPC；systemd(Linux)/launchd(macOS) 系统服务托管 + 自动更新器每小时检查；gateway 把远程 agent 映射成本地 IP（sudo pilotctl gateway start）；compat 模式经 WSS 走 :443 穿透 UDP 封锁 |
| [[pipecat\|Pipecat]] | PipelineWorker 包管道，WorkerRunner.run() 异步驱动并管 SIGINT/SIGTERM 优雅退出（auto_end=True 时根 worker 跑完即结束，长驻服务用 False）；pipecat.runner（extra runner：uvicorn+fastapi）提供 dev 服务器与 create_transport；可部署到 Pipecat Cloud |
| [[praisonai\|PraisonAI]] | 纯 Python 库，同步/异步(astart/achat)双轨；可选 sandbox/ 隔离代码执行；praisonai CLI(TUI/auto/interactive/chat)、praisonai claw Dashboard(13 页, :8082)、praisonai flow(Langflow :7861)、praisonai ui、ACP server、Docker |
| [[semantic-kernel\|Semantic Kernel]] | 纯 SDK/库，宿主自管(async/IAsyncEnumerable 流式)。多 agent 编排跑在 Agents/Runtime(InProcess actor runtime)；Process 框架可 InProcess 或 Dapr 分布式运行(Process.Runtime.Dapr)；无内建沙箱，工具在宿主进程执行 |
| [[smolagents\|smolagents]] | 纯库 + 多档代码执行：local(AST 解释器，进程内，非安全)、e2b/modal/blaxel(云沙箱)、docker(容器隔离)；GradioUI 提供 web 界面；smolagent/webagent CLI；push_to_hub 导出为 HF Space |
| [[strands\|Strands Agents]] | 纯库；agent() 同步(run_async 跨线程跑 event loop)，invoke_async/stream_async 异步流式；工具默认并发执行；agent.cancel() 线程安全优雅取消；experimental.bidi 提供语音双向流式 runtime；并发调用默认抛 ConcurrencyException |
| [[swarm\|Swarm]] | 纯库，同步；工具在本进程直接执行（无沙箱） |
| [[swarmclaw\|SwarmClaw]] | Next.js 16 standalone server（npm i -g→CLI 起服务，端口 3456）；Electron 桌面 app 把 standalone server 当子进程 spawn（ELECTRON_RUN_AS_NODE）；心跳 60s tick + 调度器 60s tick；Docker / fly / railway / render 部署配置齐全；sandbox 浏览器走独立 Docker 镜像 |
| [[swarms\|Swarms]] | 纯库；同步为主，Concurrent/run_agents_concurrently 用 ThreadPoolExecutor，另有 arun/arun_stream 异步与 asyncio 版；aop.py(Agent-as-server)、cron_job.py(schedule)、batch_agent_execution；autosave 落盘状态；swarms CLI 入口 |
| [[transformers-agents\|Transformers Agents]] | 代码工具在受限 Python 解释器执行（安全沙箱有限）；库内调用 |
| [[upsonic\|Upsonic]] | 纯库；sync 入口经常驻后台事件循环跑 async pipeline(agent.py:21 _get_bg_loop)；agent.as_mcp() 把 agent 暴露为 FastMCP server(agent.py:4214)；upsonic CLI(pyproject.toml:295)；AutonomousAgent 提供 workspace 沙箱(文件/shell 限定在 workspace，路径越界即 raise)，可接 E2B 云沙箱 |
| [[vectara-agentic\|vectara-agentic]] | 纯 Python 库；chat() 用 asyncio.run 包裹 achat()（agent.py:547）。内置 OpenAI 兼容 HTTP 端点：create_app() 基于 FastAPI 暴露 /chat、/v1/completions、/v1/chat（X-API-Key 鉴权），start_app() 用 uvicorn 起服务（agent_endpoint.py:95,240）；附 Dockerfile |
| [[voltagent\|VoltAgent]] | 库 + server provider 模式：@voltagent/server-hono/server-elysia/serverless-hono(Cloudflare/边缘) 把 agents/workflows 暴露为 HTTP(默认 :3141)；代码沙箱适配器 sandbox-e2b/sandbox-daytona/sandbox-blaxel；create-voltagent-app 脚手架、@voltagent/cli |
