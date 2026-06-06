---
title: "技能与插件"
aliases:
  - Skills
  - Plugins
  - Extensions
tags:
  - knowledge-base
  - domain/agent-components
  - component/skills-plugins
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
---

# 技能与插件

> [!abstract] 一句话总结
> 把能力打包成可复用、可分发、可热插拔的单元（skill / plugin / extension），让 agent 的能力像装 App 一样扩展。介于裸工具和完整 agent 之间的封装粒度。

## 它解决什么问题

单个 [[tool-use|工具]]太细，整个 agent 太重。技能/插件提供中等粒度的复用单元——一组相关工具 + prompt + 配置，可在项目/社区间共享。

## 设计维度 / 实现谱系

- **粒度**：单工具 ↔ 技能包（工具+prompt+状态）↔ 子 agent
- **分发**：内置 ↔ 本地目录约定 ↔ 注册表/市场
- **加载**：静态导入 ↔ 运行时动态加载 ↔ 自生成技能（[[aeon|Aeon]]、[[hive|Hive]]）
- **生命周期钩子**：是否提供 hooks（[[connectonion|ConnectOnion]] 的 12 个生命周期钩子）
- **隔离**：插件沙箱与权限

## 关键要点

- skill 一词在不同框架含义差异大（从单文件到完整能力包）。
- 自生成/自修复技能是自治 agent 的前沿方向。
- 与 [[tool-use]] 和子 agent 边界模糊。

## 关联

- [[tool-use]] · [[multi-agent-orchestration]] · [[runtime-execution]] · [[component-taxonomy]]

## 各框架实现对比

> 下表汇总 **30** 个实现了「技能 / 插件」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。

| 框架 | 实现方式 |
|------|----------|
| [[aeon\|Aeon]] | 182+ 个 SKILL.md，分 6 大类；./add-skill <repo> 从任意 GitHub 仓库导入（带 skill-security-scan 安全扫描）；./install-skill-pack 装社区技能包（skill-packs.json 注册表）；./new-from-template 从 6 个模板脚手架；create-skill 技能自建技能 |
| [[ag2\|AG2]] | 两条路：①AgentCapability 子类经 add_to_agent() 给 Agent 加能力（teachability/vision/generate_images/transform_messages）；②interop/ 把 LangChain/CrewAI/PydanticAI 工具桥接为 AG2 Tool；mcp/ 作为 MCP client 接入外部工具 |
| [[agent-llm\|Agent-LLM (AGiXT)]] | extension 即插件体系：97+ 内置（agixt/extensions/），可自定义并经 Extensions Hub 从外部 git 仓库/本地路径热加载（EXTENSIONS_HUB 环境变量，ExtensionsHub.py）；extension 可带 SQLAlchemy 模型、FastAPI 路由、WebSocket、webhook、Desktop UI 包 |
| [[agentdock\|AgentDock]] | 通过 node 扩展实现：自定义能力=继承 BaseNode/BaseTool 的节点，经 NodeRegistry/ToolRegistry 注册（register-core-nodes.ts）；agent 在 nodes:[] 中按名启用。无独立 "skill/plugin" 概念，统一收敛到 node 系统 |
| [[agentfield\|AgentField]] | @app.skill() = 确定性代码端点（与 reasoner 对称）；MCP 集成（af add --mcp --url，控制平面 internal/mcp/）；harness 4 providers(Claude Code/Codex/Gemini CLI/OpenCode) 作为可插拔"超能力"经 factory 装配 |
| [[agentic-context-engine\|Agentic Context Engine (ACE)]] | "Skill"=Skillbook 条目(策略)，非可执行插件；可插拔性体现在：Step 协议(requires/provides)、Runner 经 extra_steps 扩展、learning_tail() 复用、optional extras(browser-use/langchain/mcp/dedup)。另含 Claude Code .claude/skills/kayba-pipeline/ 七阶段分析技能 |
| [[agentscope\|AgentScope]] | Skills=带 YAML frontmatter 的 SKILL.md 目录，LocalSkillLoader 扫描加载，注入提示告知"skill 不是 tool，需用 SkillViewer 读取再照做"(兼容 Claude Code 技能形态)；插件机制=middleware(钩子链)而非传统插件；工具组(ToolGroup)可动态激活 |
| [[ailoy\|Ailoy]] | 扩展点=自定义工具(new_function/new_custom LM/new_custom knowledge) 与 MCP；MCP 客户端原生支持 stdio/streamable-HTTP 子进程传输（src/tool/mcp/native.rs，wasm 走 wasm32.rs），MCPClient::get_tools() 把远端工具批量转 Tool（src/agent/base.rs:911 测试演示）。无独立"skill/plugin 注册中心" |
| [[astron\|Astron Agent]] | 插件工厂多态：LinkPluginFactory（讯飞开放平台工具）/McpPluginFactory（MCP server 列表→工具，远程 HTTP 调用）/WorkflowPluginFactory/SkillPluginFactory；Skill 兼容 Claude Code 风格：生成 read_skill_（读 SKILL.md + 相对路径资源）与 run_skill_（在 e2b 沙箱执行命令）两个工具 |
| [[botpress\|Botpress]] | 两个层面：①平台层 packages/sdk 的 Plugin/Integration 体系（bp init 模板，integration.definition.ts+src/index.ts，readme.md:46）；②LLMz 层 ObjectInstance 把相关工具+变量打包成命名空间（db.queryUsers()）、hooks 注入自定义逻辑 |
| [[connectonion\|ConnectOnion]] | plugin=事件处理函数列表；12 钩子(events.py)；Skills=带 YAML frontmatter 的 SKILL.md，三级自动发现(project→user→builtin)，/command 触发并临时授予工具权限(turn 结束清除)，兼容 Claude Code .claude/skills/ |
| [[cordum\|Cordum]] | Integration Packs：30+ CAP-native worker 包（Slack/GitHub/AWS/K8s/Terraform…），每个是带策略门工作流的 worker；cordumctl pack install 安装 |
| [[crewai\|CrewAI]] | skills/ 模块：发现并激活 Skill（discover_skills/activate_skill，YAML 元数据）；crewai_tools 独立包提供数百个工具；MCP 客户端把外部 MCP server 工具接入 |
| [[dust\|Dust]] | Skills=可复用的能力包（指令+数据源+工具集），挂到 agent 上；运行时 getSkillServers 把 skill 暴露为 MCP server（如 skill_knowledge_file_system），并把"已装备 skills"渲染进用户消息 |
| [[hcom\|hcom]] | 随仓库带 Claude Code skill hcom-agent-messaging（SKILL.md + references/scripts）与 plugin 清单（.claude-plugin/plugin.json）；用户脚本投到 ~/.hcom/scripts/ 自动发现、可覆盖内置（README:366） |
| [[hermes-agent\|Hermes Agent]] | Skills=带 YAML frontmatter 的 SKILL.md，progressive disclosure(list 看元数据→view 加载全文→按需读 references)，兼容 agentskills.io 开放标准；/<skill-name> 触发；agent 可自创/自改 skill 并由 curator 维护；插件体系覆盖 model-provider/gateway 平台/context-engine/MCP |
| [[hive\|Hive]] | Skills=带 YAML frontmatter 的 SKILL.md，三级发现(default/preset/community)+ trust gating + tool_gating（激活临时授权）；SkillsManager 统一加载并渲染 prompt；内建 6 个 default skill（error-recovery、context-preservation 等）+ preset（browser/linkedin/terminal/x 等） |
| [[lagent\|Lagent]] | 扩展点=Hook(4 钩子:before/after × agent/action) 与 actions(工具) 注册表；MCPClientAdapter 把外部 MCP server(stdio/sse/http) 暴露的工具接入为 BaseAction（待确认成熟度）。无独立"skill"概念 |
| [[loongflow\|LoongFlow]] | 复用 Claude Code 的 Skill 体系：ClaudeCodeAgent 默认放行 Skill/Task 工具并 setting_sources=["project"]，从仓库 .claude/skills/、.agents/skills/（如 skill-creator、code-analysis）加载技能；自定义工具经 create_sdk_mcp_server 包成 MCP server 注入；通用扩展点是 AgentBase 的 pre_/post_ 钩子 |
| [[mastra\|Mastra]] | Skills=SKILL.md（gray-matter frontmatter）文件，经 workspace/skills/ 发现（local/versioned/composite source + glob），由 SkillsProcessor 注入（eager 或 on-demand 发现），并暴露为 skill 工具；兼容 Claude Code ~/.claude/skills/（workspace/filesystem/local-filesystem.ts:83）。插件式扩展主要靠 processors + tools + storage domains，而非继承 |
| [[nanobot\|nanobot]] | Skills=带 YAML frontmatter 的 SKILL.md，三级发现（workspace→builtin，workspace 覆盖同名），requires.bins/env 决定可用性，always=true 强制注入，渐进式加载（先摘要后 read_file）；内置 skill 含 cron/long-goal/github/memory/skill-creator 等。工具插件经 entry_points("nanobot.tools") 扩展 |
| [[openclaw\|OpenClaw]] | Skills=带 YAML frontmatter 的 SKILL.md，递归发现、按 description 由模型自主选用、disable-model-invocation 可隐藏，兼容 Claude-Code 风格；Plugins/Extensions=extensions/ 包，经 manifest(openclaw 字段声明 extensions/skills/prompts/themes) 装卸；Hooks=生命周期钩子（bundled: session-memory、compaction-notifier、boot-md…） |
| [[pilotprotocol\|Pilot Protocol]] | 两层含义：①daemon 插件=L11 能力插件经 runtime.ServiceRegistry 注册（trustedagents/handshake/dataexchange/eventstream/policy/webhook/skillinject），内核只依赖 L10 pkg/coreapi 接口；②agent skill=skillinject 插件自动给检测到的 AI 编码工具写入 SKILL.md（KindMarker/Helper/PluginFile/PluginAllowList），周期性 reconcile，教 agent 怎么用 Pilot |
| [[praisonai\|PraisonAI]] | Skills=带 YAML frontmatter 的 SKILL.md，三级发现(project→user→builtin)，激活时按 allowed_tools 临时授权；兼容 Claude Code .claude/skills/（也认 .praisonai/skills/，向上递归祖先目录）；另有 hooks / middleware / 插件式扩展 |
| [[semantic-kernel\|Semantic Kernel]] | “Plugin” = 一组 KernelFunction 的命名集合(KernelPlugin/KernelPluginCollection)。KernelPluginFactory.CreateFromType<T>()/AddFromObject 把类方法变插件；另支持从 prompt 目录、OpenAPI、gRPC、Prompty、Markdown、Yaml 加载 |
| [[strands\|Strands Agents]] | 两层：Plugin(注册 hooks/装配 agent，plugins/) + typed hook 事件；AgentSkills vended plugin 把带 frontmatter 的 SKILL.md 注入 system prompt 并提供 skills 激活工具，按需加载；MCP=即插即用工具源 |
| [[swarmclaw\|SwarmClaw]] | Skills：YAML frontmatter 的 SKILL.md，三级发现（runtime-skill-resolver）+ prompt 预算（skill-prompt-budget）+ 资格过滤（skill-eligibility）；conversation→skill 学习：从成功回合提炼 learned skill 走审查上线；Extensions（前身 plugins）= 带 hooks 的能力单元；ClawHub 分发（openclaw skills install swarmclaw） |
| [[transformers-agents\|Transformers Agents]] | 自定义 Tool / Hub 上分享工具 |
| [[upsonic\|Upsonic]] | Skills 系统：带 SKILL.md(YAML frontmatter) 的技能，内建 builtins(code-review/data-analysis/summarization)，含 loader/validator/dependency/cache/metrics；prebuilt 自治 agent 也以 skills 形式打包 |
| [[voltagent\|VoltAgent]] | 扩展点为 hooks(onStart/onEnd/onToolStart…)、middleware(input/output 可重试)、guardrails、Toolkit、MCP/A2A 接入；Workspace 下有 SKILL（workspace/skills/，gray-matter 解析 SKILL.md frontmatter）；外部能力主要靠 MCP server |
