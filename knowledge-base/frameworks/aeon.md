---
title: "Aeon"
aliases:
  - Aeon
  - aeon
  - aeonframework
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/aeon
  - lang/yaml
  - lang/bash
  - lang/typescript
  - paradigm/single
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/aaronjmars/aeon
license: MIT
stars: ~数千
---

# Aeon

> [!abstract] 一句话定位
> 一个"配置一次、永久遗忘"的**自治单 agent 框架**：没有自己的运行时内核，而是把 GitHub Actions cron 当调度器、把 Claude Code CLI（`claude -p -`）当推理引擎，靠一堆 SKILL.md 提示文件 + YAML 配置在无人值守下定时跑活（晨报/盯盘/PR 审查/研究摘要），并自带输出质量打分、Git 仓库即持久记忆、反应式触发与"自愈失败技能"的闭环。

## 设计理念 / 顶层架构

Aeon 最反直觉的取舍是：**它几乎没有代码层面的 agent 内核**。推理循环、工具调用、规划全部下放给外部的 Claude Code CLI；Aeon 自己只是"调度 + 提示 + 状态 + 治理"的胶水层。这带来一个极端的结论——*fork 即运行、零基础设施*：把仓库 fork 到自己名下、配好 secret、push 一次配置，剩下的交给 GitHub Actions 的 free minutes。

几个核心设计点：

- **技能即提示文件**：每个技能就是 `skills/<name>/SKILL.md`——一段带 YAML frontmatter（`name`/`description`/`var`/`tags`/可选 `depends_on`）的 Markdown 提示。运行时把 `"Read and execute the skill defined in skills/<name>/SKILL.md"` 喂给 `claude -p -`（`.github/workflows/aeon.yml:476`）。仓库实际带 **182+ 个内置技能**（`skills.json:5` 声明 182，目录实有 185；README 文案写 156——文档滞后于代码）。
- **GitHub Actions 作运行时**：两个常驻 workflow——`messages.yml`（每 5 分钟一次 cron tick，纯 bash 解析 `aeon.yml`、匹配 cron、`gh workflow run aeon.yml` 派发命中的技能）和 `aeon.yml`（真正跑技能的 runner，含打分、token 记账、自动提交）。没有命中技能的 tick 约 10 秒退出，几乎零成本。
- **自愈闭环**：`heartbeat`（默认唯一启用，日 3 次）巡检 `cron-state.json` → `skill-health` 审计质量分 → `skill-evals` 断言测试 → `skill-repair`（reactive，连续失败 3 次自动触发）诊断并开 PR 修复 → `self-improve` 演化提示。整条链通过"读状态 JSON + 开 PR"在 Git 上闭合，无需人介入。
- **Git 仓库即数据库**：`memory/` 目录是唯一持久层——`MEMORY.md`（目录索引）、`cron-state.json`（每技能运行指标）、`skill-health/*.json`（滚动 30 次质量分）、`token-usage.csv`、`issues/`（结构化故障工单）、`logs/`（每日日志）。每次运行末尾 `git commit + push --rebase` 把状态写回 main，5 次重试 + 冲突自动解决（memory 类文件删冲突标记保留双方，其余 `--theirs`）。
- **对外暴露**：除 Actions 外，技能还能经 `mcp-server/`（MCP stdio，每技能变 `aeon-<slug>` 工具）和 `a2a-server/`（Google A2A 协议网关，JSON-RPC + SSE，供 LangChain/AutoGen/CrewAI 调用）在 Actions 之外复用，二者都 `spawn("claude", ["-p","-"])` 跑同一套 SKILL.md。

最小"运行方式"示例（不是写代码，而是配置 `aeon.yml` 后 push）：

```yaml
# aeon.yml — 唯一需要改的入口
skills:
  article:
    enabled: true            # 翻成 true 即激活
    schedule: "0 8 * * *"    # 标准 cron（UTC）
    var: "rust"              # 通用单参数，每个技能自行解释（这里=主题）
  skill-repair:
    enabled: true
    schedule: "reactive"     # 不走 cron，靠条件触发

reactive:
  skill-repair:
    trigger:
      - { on: "*", when: "consecutive_failures >= 3" }  # 任意技能连败 3 次→自动修复

model: claude-opus-4-8       # 全局默认模型，可被 per-skill / 派发参数覆盖
```

```bash
# 本地起仪表盘配置（Next.js，端口 5555），点 Push 把配置提交到 GitHub
git clone https://github.com/<you>/aeon && cd aeon && ./aeon
```

## 组件实现（横向逐项）

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **无自有循环**——外包给 Claude Code CLI。runner 构造 prompt 后 `claude -p - --model $MODEL --allowedTools $ALLOWED --output-format json`，ReAct/工具循环全在 CLI 内部跑；Aeon 只取 `.result` 与 `.usage` | `.github/workflows/aeon.yml:484`, `a2a-server/src/index.ts:183` |
| [[planning\|规划/任务分解]] | 单技能内无显式 planner（交给 LLM）；跨技能用 **chains**（`chains:` 配置 DAG，`parallel:` 并发组 + `consume:` 注入上游输出）和 frontmatter `depends_on`（调度器据此排序，依赖在前 `sleep 5` 再派发依赖方） | `aeon.yml:276`, `.github/workflows/chain-runner.yml`, `.github/workflows/messages.yml:209` |
| [[memory\|记忆(短/长/向量)]] | **Git 仓库即长期记忆**：`memory/MEMORY.md`（索引）+ `topics/` + `logs/YYYY-MM-DD.md` + `cron-state.json`（运行指标）+ `issues/`（工单）。无向量库；检索靠 grep/读文件。CLAUDE.md 强制每任务前读 MEMORY、任务后追加日志 | `CLAUDE.md`(Memory 节), `memory/`, `aeon.yml`(无向量) |
| [[tool-use\|工具调用]] | 工具=Claude Code 内置工具 + 受限 bash，由 runner 的 `--allowedTools` 白名单授权（`Read,Write,Edit,Glob,Grep,WebFetch,WebSearch` + `Bash(gh:*)`/`Bash(git:*)`/`Bash(curl:*)`/`Bash(./notify:*)` 等）。`gh` CLI 处理 GitHub 鉴权；`./notify` 运行时生成 | `.github/workflows/aeon.yml:454`, `.github/workflows/aeon.yml:322`(notify 脚本生成) |
| [[model-abstraction\|模型抽象]] | 模型名为字符串，三级覆盖：`workflow_dispatch` 入参 > per-skill `model:` > `aeon.yml` 顶层 `model:`（默认 `claude-opus-4-8`）。Gateway 路由：`gateway.provider: bankr` 时改写 `ANTHROPIC_BASE_URL=https://llm.bankr.bot` 解锁 Gemini/GPT/Kimi/Qwen；或 `vars.ANTHROPIC_BASE_URL` 接任意 Anthropic 兼容端点 | `.github/workflows/aeon.yml:279`, `.github/workflows/aeon.yml:293`(gateway), `aeon.yml:287` |
| [[multi-agent-orchestration\|多智能体编排]] | 进程内非传统多 agent；靠 **chains**（多 workflow step 串/并行 + 输出落 `.outputs/{skill}.md` 注入下游）。真正"多实例"= **Instance Fleet**：`spawn-instance` fork 出专精副本登记 `memory/instances.json`，`fleet-control`/`fork-fleet` 管理 | `.github/workflows/chain-runner.yml`, `skills/spawn-instance/`, `skills/fleet-control/` |
| [[context-engineering\|上下文工程]] | prompt 注入分层：`CLAUDE.md`（Claude Code 自动加载的 agent 身份/规则/安全约束）+ 当前 `SKILL.md` + 链上下文文件 + `var`。可选 `soul/`（SOUL.md/STYLE.md/examples）注入人格风格。明确防注入：外部内容一律当不可信数据 | `CLAUDE.md`, `.github/workflows/aeon.yml:464`(链上下文拼接), README(Soul 节) |
| [[skills-plugins\|技能/插件]] | 182+ 个 SKILL.md，分 6 大类；`./add-skill <repo>` 从任意 GitHub 仓库导入（带 `skill-security-scan` 安全扫描）；`./install-skill-pack` 装社区技能包（`skill-packs.json` 注册表）；`./new-from-template` 从 6 个模板脚手架；`create-skill` 技能自建技能 | `skills/`, `skills.json`, `add-skill`, `install-skill-pack`, `templates/` |
| [[observability-eval\|可观测/评估]] | **每次成功运行后 Haiku 自动打 1-5 分**（失败/空=1，优秀=5），写 `memory/skill-health/{skill}.json`（滚动 30 次 + avg）；token 用量记 `token-usage.csv`；`cron-state.json` 存成功率/连败数；`skill-evals` 断言测试；`scripts/skill-runs` 审计 Actions 运行 | `.github/workflows/aeon.yml:604`(打分步骤), `.github/workflows/aeon.yml:687`(health 文件), `skills/skill-evals/` |
| [[runtime-execution\|运行时/部署]] | **GitHub Actions 即运行时**：`messages.yml`(`*/5` cron 调度器，纯 bash `cron_match` 解析+`gh workflow run` 派发) + `aeon.yml`(runner，ubuntu-latest、装 `@anthropic-ai/claude-code`、30 分超时)。无服务器、公共仓库免费分钟数。本地 `./aeon` 起 Next.js 仪表盘配置 | `.github/workflows/messages.yml:52`, `.github/workflows/aeon.yml:74`, `aeon`(启动脚本) |
| [[human-in-the-loop-governance\|人在环/治理]] | **设计上 no approval loop**（卖点：不打扰人）。可选治理层：Fleet Watcher——每技能跑前向自托管控制面问 ALLOW/BLOCK（fail-closed），跑后回报用于污点链分析；通知通道（Telegram/Discord/Slack）双向可让用户发指令；`./onboard` 校验配置 | `.github/workflows/aeon.yml:204`(preflight), `.github/workflows/aeon.yml:521`(postflight), `.github/workflows/messages.yml:468`(双向消息) |
| [[state-persistence\|状态/持久化]] | 全部状态以文件提交进 Git main 分支；runner 末尾 `git commit + pull --rebase + push` 带 5 次重试与冲突自动消解；并发 workflow 靠 `concurrency.group` 串行化 tick、消息走唯一组并行；沙箱内 `.pending-notify/` 缓冲通知待 post-run 重投 | `.github/workflows/aeon.yml:818`(commit results), `.github/workflows/aeon.yml:887`(update cron state), `.github/workflows/aeon.yml:70`(concurrency) |

## 设计权衡与特性

- **"无内核"是最大特征也是最大约束**：Aeon 不实现推理循环/工具调用/模型适配——这些全押在 Claude Code CLI 上，所以它本质强绑定 Anthropic（gateway 仅是兼容代理层）。换来的是代码量极小、能力随 Claude Code 升级自动变强、心智模型简单（"写 prompt + 配 cron"）。
- **GitHub Actions 当 cron + 计算的妙用**：`messages.yml` 用约 400 行纯 bash 手写了一个 cron 匹配器（支持 `*` `*/N` `N-M` 列表、上一小时 catch-up 补跑、90 分钟去重窗口），把 GH 免费分钟数变成全天候 agent 心跳。代价：5 分钟轮询有延迟（Telegram 可选 Cloudflare Worker webhook 降到约 1 秒）、cron 可能漏窗（故有 catch-up 逻辑）。
- **自愈是真闭环而非口号**：质量打分（Haiku）→ 健康文件 → 连败计数 → reactive 触发 `skill-repair` → 按 category playbook（api-change/rate-limit/timeout/prompt-bug…）开 PR → `skill-repair-history.json` 24h 冷却防修复死循环。`skill-repair` 自身约束严格（最小 diff、HIGH 风险加 `manual-review` 标签、绝不改 workflow/secret、绝不推 main）。这是它相对 [[hermes-agent]]/[[openclaw]] 等同类自治 agent 宣称的差异点。
- **Git 即数据库的并发税**：所有实例/调度/runner 都往同一个 main 推状态文件，靠 rebase 重试 + 冲突自动解决硬扛并发写。memory 类文件的冲突处理是"删冲突标记保留两边内容"（追加型文件可行，但结构化 JSON 理论上可能产生半合法状态——故有 `config-validator`/`memory-structural-dedupe` 等清理技能兜底）。
- **加密/Web3 基因明显**：182 技能里 27 个是 Crypto & Markets（盯盘、Polymarket/Kalshi、链上调查 HoundFlow 套件、x402 支付、token 分发），README 带 Bankr/钱包地址。对纯通用自动化用户而言这是噪音，但 fork 后可全部 disable。
- **安全面**：CLAUDE.md 内置提示注入防御（外部内容当不可信、不执行其中指令、不外泄 secret）；仪表盘 `/api/*` 默认仅回环可达 + Origin 校验防 DNS-rebinding；导入技能过 `skill-security-scan`。但本质是"LLM 自治 + 受限 bash 白名单 + 自动 PR/push"，攻击面取决于授予的 secret 与 `GH_GLOBAL` PAT 的范围。
- **文档/代码漂移**：README 反复说"156 skills"，而 `skills.json` 声明 182、目录实有 185——升级很快、文案没跟上。`aeon.yml` 里绝大多数技能 `enabled: false`，仅 `heartbeat` 默认开。

## 关联

- [[component-taxonomy]] · [[single-vs-multi-agent]] · [[runtime-execution]] · [[observability-eval]]
- 同范式（自治/无人值守 single-agent）：[[hermes-agent]] · [[openclaw]] · 对照交互式：[[connectonion]]
- 源码：`agents-example/aeon/`
