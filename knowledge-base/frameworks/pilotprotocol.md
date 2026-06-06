---
title: "Pilot Protocol"
aliases:
  - Pilot Protocol
  - pilotprotocol
  - pilot
  - pilotctl
tags:
  - knowledge-base
  - domain/agent-frameworks
  - framework/pilotprotocol
  - lang/go
  - paradigm/platform
date_created: 2026-06-05
date_updated: 2026-06-05
status: complete
repo: https://github.com/TeoSlayer/pilotprotocol
license: AGPL-3.0-or-later
stars: 未知
---

# Pilot Protocol

> [!abstract] 一句话定位
> Pilot Protocol **不是 agent 框架，而是 agent 的网络基础设施**：一套架在标准 UDP 之上的 overlay 网络栈，给每个 AI agent 一个永久的 48 位虚拟地址、端口、经认证加密的 UDP 隧道（X25519+Ed25519+AES-256-GCM）、NAT 穿透与双向互信握手。核心协议仅用 Go 标准库（零第三方依赖），让 agent 之间能像设备上互联网一样**直连点对点**，把中心化平台从数据路径里彻底拿掉。

## 设计理念 / 顶层架构

核心论点：今天的 agent 只能经中心化 API（HTTP）互相通信，平台看见全部流量、控制访问、是单点故障。Pilot 把这件事下沉到**网络层**——给 agent 互联网当年给设备的东西：地址、身份、可达性、信任。它明确声明"It is not an API. It is not a framework. It is infrastructure."（`README.md:48`）。

设计取舍：

- **守护进程 + 本地 IPC 模型**：你的 agent 不直接说协议，而是通过 Unix socket 跟本机 **daemon** 对话（`pilotctl` CLI 或 Node/Python/Swift SDK 经 libpilot FFI）。daemon 负责隧道加密、NAT 穿透、包路由、拥塞控制和内建服务。一个单一二进制带全部内建服务（`README.md:227`，`cmd/daemon/main.go`）。
- **rendezvous 只做发现，不在数据路径**：daemon 连一个轻量 **rendezvous**（registry :9000 + beacon :9001）做节点注册、对等发现、NAT 打洞；一旦隧道建立，数据**直连两个 daemon 之间**，rendezvous 退出（`README.md:67,227`）。公共 rendezvous 在 `34.71.57.205:9000`（`cmd/daemon/main.go:40`）。
- **严格分层栈（L1–L12）**：整个代码库按 OSI 式分层组织，`layers.yaml` 是单一事实来源，CI 静态检查器强制"只能向下 import"。L2 UDP I/O（`udpio`/`transport`）、L4 发现与路由/NAT（`routing`/`beacon`）、L5 密钥交换（`keyexchange`，X25519 ECDH + Ed25519 认证）、L6 加密信封（`envelope`，AEAD + 重放窗口）、L7 可靠流（`pkg/daemon`，TCP-over-UDP）、L8 registry 客户端、L9 IPC、L10 插件契约、L11 能力插件、L12 CLI 组合根（`layers.yaml:22-99`）。
- **能力插件模型**：daemon 内核（L7 `pkg/daemon`）只持 `pkg/coreapi` 接口；真正的服务是 L11 插件，在组合根 `cmd/daemon` 注册：`trustedagents`（互信）、`handshake`（互信握手，端口 444）、`skillinject`（给 AI 工具自动装 SKILL.md）、`dataexchange`（:1001）、`eventstream`（:1002）、`policy`、`webhook`（`cmd/daemon/main.go:202-247`）。
- **零依赖底座**：`go.mod` 第三方仅 `coder/websocket`（compat 模式）+ `expr-lang/expr`（policy 表达式）+ `golang.org/x/{net,sys}`，核心加密/传输全走 `crypto/ecdh`、`crypto/ed25519`、`crypto/aes`、`crypto/cipher` 标准库（`go.mod`，`keyexchange/derive.go:6-13`）。

最小示例（CLI，取自 README）：

```bash
# 1. 安装并启动 daemon（拿到地址 + 身份）
curl -fsSL https://pilotprotocol.network/install.sh | sh
pilotctl daemon start --hostname my-agent --email user@example.com

# 2. 跟对端建立互信（agent-alpha 是公共 demo 节点，自动批准）
pilotctl handshake agent-alpha "hello"
pilotctl trust                       # 几秒后确认互信已建立

# 3. 在隧道上互发消息（任意端口）
pilotctl send agent-alpha 1000 --data "hello"   # 发送端
pilotctl recv 1000 --count 5 --timeout 30s       # 接收端

pilotctl info     # 看自己的地址 0:0000.0000.0005 / hostname / 对端数
# 每条命令都支持 --json 结构化输出
```

等价的 Node SDK（`README.md:140`）：

```js
import { createPilot } from 'pilotprotocol';
const pilot = await createPilot();
const conn = await pilot.handshake('agent-alpha', 'hello'); // 互信握手
await conn.trust();
await conn.send(3000, Buffer.from('ping'));                 // 任意端口收发
const msgs = await conn.recv(3000, { count: 1, timeout: 10 });
```

## 组件实现（横向逐项，无则标 N/A）

> 这是 **agent 间通信的网络基础设施**，不含推理/规划/记忆等 agent 运行时概念，故多数 agent 组件为 N/A。下表把模板组件映射到它真正提供的网络层能力。

| 组件 | 实现方式 | 关键抽象 / 文件 |
|------|----------|-----------------|
| [[reasoning-loop\|推理循环/范式]] | **N/A**。无 LLM、无推理循环。它是网络栈，agent 自己的推理在别处。daemon 的"主循环"是 UDP 收包分发 + 可靠流状态机，不是 ReAct | — |
| [[planning\|规划/任务分解]] | **N/A**。不做任务分解 | — |
| [[memory\|记忆(短/长/向量)]] | **N/A**（无 agent 记忆）。仅有协议级持久状态：Ed25519 身份、trust.json 互信记录、beacon 缓存、registry 注册——原子落盘到 `~/.pilot/`，见状态/持久化行 | — |
| [[tool-use\|工具调用]] | **N/A**（不暴露工具给 LLM）。最接近的是 CLI/SDK 把网络能力（handshake/send/recv/stream/gateway）暴露给 agent 程序调用 | `cmd/pilotctl/main.go`, `README.md:130` |
| [[model-abstraction\|模型抽象]] | **N/A**。不接任何 LLM provider | — |
| [[multi-agent-orchestration\|多智能体编排]] | **核心**，但是"网络级编排"：①寻址=48 位虚拟地址 `N:NNNN.HHHH.LLLL` + 16 位端口 + hostname 发现；②互信=双向签名握手（端口 444，经 registry relay），节点默认私有；③发现/NAT=经 rendezvous 注册解析、STUN、打洞、relay 兜底。data flows 点对点直连 | 寻址 `README.md:163`; 互信 `cmd/daemon/main.go:233`+`plugins/trustedagents`; 发现/NAT `pkg/daemon/routing/routing.go:21`, `routing/relay.go` |
| [[context-engineering\|上下文工程]] | **N/A**（无 prompt/上下文概念） | — |
| [[skills-plugins\|技能/插件]] | 两层含义：①**daemon 插件**=L11 能力插件经 `runtime.ServiceRegistry` 注册（trustedagents/handshake/dataexchange/eventstream/policy/webhook/skillinject），内核只依赖 L10 `pkg/coreapi` 接口；②**agent skill**=`skillinject` 插件自动给检测到的 AI 编码工具写入 `SKILL.md`（KindMarker/Helper/PluginFile/PluginAllowList），周期性 reconcile，教 agent 怎么用 Pilot | `cmd/daemon/main.go:200-247`(插件注册), `cmd/pilotctl/skills.go:17`(skillinject), `layers.yaml:71-87`(L11) |
| [[observability-eval\|可观测/评估]] | 结构化 JSON 日志走 `slog`；`pilotctl info`/`--json` 暴露地址/对端/连接/uptime 等快照；Polo 公共 dashboard 展示全网节点/请求统计；1048 个测试（含大量拥塞控制/SACK/重放回归用例 `zz_*_bug_test.go`） | `README.md:111,188`, `pkg/daemon/services.go:10`(slog), `pkg/daemon/zz_info_snapshot_test.go` |
| [[runtime-execution\|运行时/部署]] | **核心**：单 daemon 二进制（`pilot-daemon`/`pilotctl`/`pilot-gateway`/`pilot-updater`），`daemon.New(cfg)`+`d.Start()` 起隧道与 IPC；systemd(Linux)/launchd(macOS) 系统服务托管 + 自动更新器每小时检查；gateway 把远程 agent 映射成本地 IP（`sudo pilotctl gateway start`）；compat 模式经 WSS 走 :443 穿透 UDP 封锁 | `cmd/daemon/main.go:152,257`, `pkg/daemon/daemon.go:414`(New),`:515`(Start), `README.md:281`(installer), `cmd/daemon/main.go:83`(compat) |
| [[human-in-the-loop-governance\|人在环/治理]] | **互信即治理**：节点默认私有，必须双向 handshake 才能被解析/连接（"no mutual trust"会拒绝 find）；`--trust-auto-approve` 可自动批准（demo 用），否则人工 `pilotctl trust` 审批；`policy` 插件用 `expr-lang` 表达式对 connect/dial/datagram/join/leave 等事件做策略判定 | `cmd/daemon/main.go:81,202,226`, `pkg/daemon/contract.go:38-45`(PolicyEvent*), `README.md:121` |
| [[state-persistence\|状态/持久化]] | 协议级状态原子落盘到 `~/.pilot/`：`config.json`、Ed25519 `identity`（`--identity` 跨重启稳定身份）、trust.json（互信记录，仅 IdentityPath 非空时加载/落盘）、beacon 缓存；registry 侧热备复制 + WAL（`README.md:189`）。**注意坑**：直接跑 daemon 而非 `pilotctl daemon start` 时若没自动加载 `~/.pilot/config.json`，IdentityPath 为空会静默丢失 trust 持久化（`cmd/daemon/main.go:96-111` 已修） | `cmd/daemon/main.go:62,96-111`, `pkg/daemon/daemon.go:1761`(RegisterTrustChecker), `README.md:189` |

## 设计权衡与特性

- **基础设施 vs 框架的根本分野**：与 [[connectonion]]、Swarm 这类"agent 运行时框架"完全正交。Pilot 不关心 agent 怎么想、怎么调工具，只解决"两个 agent 凭什么、怎样能直接、安全地把字节送到对方"。在知识库里它是 `paradigm/platform` 里最纯粹的"管道层"，多数 agent 组件 N/A 是**预期内的**，不是缺陷。
- **去中心化数据路径**：最大卖点是把平台移出数据路径——rendezvous 只在发现/打洞阶段出现，确立隧道后流量端到端直连且 AES-256-GCM 加密，平台看不到也拦不住内容。代价是需要每端跑常驻 daemon + 一个（可自建的）rendezvous。
- **零依赖 + 标准库密码学**：核心协议只用 Go stdlib，密钥派生是 HKDF-SHA256（info=`"pilot-tunnel-v1"`）从 X25519 共享密钥导出 AES-256-GCM key，中间密钥材料用后清零（`keyexchange/derive.go:19,44-54`）；Ed25519 身份绑定进 AEAD AAD（H3 fix，`envelope/envelope.go:80`）。审计面小、可移植性强。
- **对真实网络的防御性工程**：256-nonce 滑动窗口重放检测、salvage 环（rekey 时重放近期发送）、连续 AEAD 失败/越窗阈值触发重握手（`keyexchange/crypto.go:11-65`）；L4 路由含黑洞探测、对称 NAT 自动 relay 翻转、ICMP-unreachable 计数（`routing/routing.go:5-49`）。`zz_*_bug_test.go` 里大量拥塞控制（AIMD/快重传/SACK/RFC6298）回归用例显示这是被认真打磨过的传输实现。
- **IETF 化雄心**：有 Wire Spec、Whitepaper、两份 IETF Internet-Draft（problem statement + protocol spec），目标是把"agent 需要网络层基础设施"标准化（`README.md:312-317`）。
- **license 与商业化**：**AGPL-3.0-or-later**（每个源文件首行 `SPDX-License-Identifier`，`README.md:341`），强 copyleft；同时提供 npm/PyPI/Swift SDK 与"private network / enterprise support"商业入口（`README.md:333`）。集成方需注意 AGPL 的网络分发义务。
- **待确认/坑**：①README 标了"core uses Go standard library only"，但完整 daemon 仍 vendor 了 `coder/websocket`（compat 模式）与 `expr-lang/expr`（policy）——"零依赖"仅指**核心协议层**，非整个二进制；②`PILOT_REGISTRY`/`PILOT_BEACON` 环境变量能覆盖编译期默认 rendezvous，daemon 会 warn 提示防篡改（`cmd/daemon/main.go:145-150`）；③直跑 daemon 的 trust 持久化坑见上表。

## 关联

- [[component-taxonomy]] · [[multi-agent-orchestration]]
- 对照（agent 运行时框架，非基础设施）：[[connectonion]] · 源码：`agents-example/pilotprotocol/`
