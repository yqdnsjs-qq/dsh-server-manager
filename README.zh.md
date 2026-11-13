# dsh-server-manager（服务器管家）

<p align="center"><img src="icon.png" width="112" alt="dsh-server-manager logo"></p>

> 给 [DeepSeek Harness](https://www.deepseek.com/harness/) 用的多服务器运维插件：让 Agent 看见、登录、操作并部署到你的服务器，和左侧「服务器监控管理」页面共用同一套连接。

[English](README.md) · [详细文档](docs/) · [安全说明](SECURITY.md) · [更新记录](CHANGELOG.md)

插件分两半，共用一份配置：

- **Host 半片**——给 Agent 注册 10 个 `server_*` 工具（列表、状态、执行、传输、日志、服务、Docker、部署、回滚、配置），并给面板提供经过鉴权的 HTTP 接口。
- **浏览器半片**——DSH 左侧栏的一级页面 **服务器监控管理**（Server Deck）：集群统计、集群脉搏、健康环、容量趋势、资源水位、服务器列表、Docker 容器、Proxmox VE 虚拟机、增删改表单和命令台。

所有流量都从本机直连 SSH（`ssh2`），凭据只留在你机器上，**不会发给模型**。

## 为什么做这个

会写项目的 Agent，应该也能把项目发上去。这个插件把最后一段接上：

1. Agent 在工作区里写好、构建好项目；
2. `server_deploy` 本地打包 → SFTP 上传 → 解压到带时间戳的 release → 切换 `current` 软链 → 跑部署后命令 → 健康检查 → 清理旧版本；
3. `server_status` / `server_logs` 验证到底有没有起来；
4. 出问题 `server_rollback` 一键回到上一版。

不用搭 CI、不写流水线、不用手敲 `scp`。

## 功能

- **多服务器、一个指挥台**：集群统计、健康环、容量趋势、资源水位与每台节点详情；一键全部探测。
- **三种登录方式**：密码、私钥、SSH Agent；密码默认写入 AES-256-GCM 加密库（`vault:名称`），也支持 `env:变量名`、`file:路径` 引用。
- **实时健康**：运行时长、负载、CPU 占用、内存/交换、磁盘、Top 进程、Docker 容器（含权限错误提示）、systemd 失败单元、是否需要重启。
- **Docker 指挥台**：列出每个容器的状态、健康检查、端口、CPU/内存、compose 项目与 1Panel 来源；支持在新标签页直接打开网页、启动、停止、重启、暂停、看日志、按 compose 服务原地升级。登录用户没有 socket 权限时自动回退 `sudo docker`。
- **自动识别 1Panel**：每台服务器都会自动检测 1Panel（版本、端口、托管的应用/容器、应用商店更新）并提供入口链接，无需逐台配置；没有 1Panel 也能正常用。
- **识别 Proxmox VE**：只读展示 VM/CT 的状态、CPU、内存、磁盘、运行时长，以及节点和存储容量，并可一键跳转 PVE 控制台；开关机仍由 PVE 自己处理。
- **PVE 更新提醒**：读取各节点缓存的 apt 更新列表，显示待更新包、安全更新数量与最近检查时间；“检查更新”按钮会显式触发一次 `pvesh create …/apt/update`。
- **1Panel 应用商店面板**：只读读取 1Panel 本地应用数据库（必要时回退 `sudo`），列出已安装应用的当前/最新版本、可更新标记与容器状态；不调用 1Panel API，也不会替你升级。
- **Agent 直接执行**：多行脚本经 `bash -s` 执行，返回退出码、stdout、stderr、耗时；可选 `sudo -S`。
- **可回滚的部署**：release 目录 + `current` 软链、保留 N 个版本、本地构建命令、部署前后钩子、HTTP 或命令健康检查、远端部署清单。
- **回滚**：一条调用切回上一版，可重跑钩子与健康检查。
- **安全刹车**：按服务器只读、命令白/黑名单、内置危险命令拦截（`rm -rf /`、`mkfs`、`dd` 写盘、fork bomb、删库等）、所有变更操作写 JSONL 审计。
- **主机密钥固定（TOFU）**：首次连接记录 SHA-256 指纹，之后指纹变化直接拒绝，不会静默信任。
- **无运行时依赖**：`ssh2` 发布前已打成 ESM，浏览器半片也是原生 ESM。

## 安装

### 从本地目录装（插件管理器）

```text
plugin_manager install_bundle target=file:/绝对路径/dsh-server-manager
```

### 从 npm 装

```sh
dsh plugin --profile web add dsh-server-manager
```

装完刷新或重启 DSH，左侧栏会出现一级入口 **服务器监控管理**（与「插件」「自动化任务」「上下文洞察」「自媒体工作台」同级）。

> 需要 DSH ≥ 0.2.1，Node.js ≥ 20。

插件**没有任何运行时 npm 依赖**：`ssh2` 在发布前已被打成单个 ESM 文件，所以没有安装脚本、
不需要原生编译、也不需要 C++ 编译器。如果你是从源码目录 `npm install`，`ssh2` 只作为
devDependency 用于重新生成那个 bundle。

## 快速上手

1. 打开左侧 **服务器监控管理** → **添加服务器** → 填地址、用户名、密码（或私钥），保存；
2. 点 **刷新全部**，节点变绿并显示负载、内存、磁盘、运行时长；
3. 直接对 Agent 说：

   > 看看我所有服务器现在的状态，哪台不健康？

   它会调用 `server_status` 汇总。

4. 部署：

   > 把这个项目构建后部署到 prod 的 /opt/apps/shop，跑 `npm ci --omit=dev`，然后检查 http://127.0.0.1:3000/health；健康检查不过就回滚。

   Agent 会调 `server_deploy`、读步骤报告，必要时用 `server_rollback`。

## 工具一览

| 工具 | 作用 |
| --- | --- |
| `server_list` | 列出服务器、策略、主机密钥信任与缓存状态。 |
| `server_status` | 探测单台或全部（运行时长、负载、CPU、内存、磁盘、Docker、systemd）。 |
| `server_exec` | SSH 执行 shell 脚本，返回退出码/stdout/stderr。 |
| `server_transfer` | SFTP 上传或下载单个文件。 |
| `server_logs` | 看 journalctl、Docker 日志或文件日志，只读服务器也可用。 |
| `server_service` | 查看/操作 systemd 单元、Docker 容器、compose 项目。 |
| `server_docker` | 实时容器清单（状态、健康、端口、资源、compose 项目）；启停/重启/暂停、日志、compose 升级。 |
| `server_deploy` | 打包 → 上传 → 发布 → 钩子 → 健康检查 → 清理。 |
| `server_rollback` | 把 `current` 切回上一版。 |
| `server_manage` | 增/改/删/测服务器、导入旧配置、忘记主机密钥。 |

完整参数见 [docs/tools.md](docs/tools.md)。

## 配置

数据目录：`~/.dsh/server-manager/`（设置了 `$DSH_HOME` 时是 `$DSH_HOME/server-manager`）。

| 文件 | 用途 |
| --- | --- |
| `servers.json` | 服务器、默认值、策略（POSIX 下权限 600）。 |
| `known_hosts.json` | 固定的主机密钥指纹。 |
| `status-cache.json` | 每台最近一次探测结果。 |
| `audit.jsonl` | 只追加的审计日志，超过 5 MiB 轮转。 |

最小示例：

```json
{
  "version": 1,
  "servers": [
    {
      "id": "prod-web",
      "name": "生产 Web",
      "host": "203.0.113.10",
      "port": 22,
      "username": "deploy",
      "auth": "key",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "policy": { "readOnly": false }
    }
  ]
}
```

推荐用引用而不是明文：

```json
{ "password": "env:PROD_SSH_PASSWORD" }
{ "password": "file:~/.secrets/prod-web" }
```

字段与策略全文见 [docs/configuration.md](docs/configuration.md)。

## 安全模型

插件**有意**给 Agent 真实的 shell 能力——这就是它的用途。护栏是：

- **只读服务器**：禁止执行/传输/部署/服务操作，但允许看状态和日志。
- **危险命令规则**：命中「几乎总是灾难」的命令时默认拒绝，除非该服务器显式 `allowDangerous: true`。
- **白/黑名单**：可以让一台服务器只允许 `^systemctl status`，另一台完全开放。
- **主机密钥固定**：指纹变化直接失败，防中间人。
- **所有变更操作本地审计**：记录操作者、目标、命令、退出码、耗时。
- **密钥不进模型上下文**：工具只返回脱敏投影，凭据只在连接层解析。

把插件指向生产环境前，请先读 [docs/security.md](docs/security.md)。

## 开发

```sh
npm install --ignore-scripts
npm test          # node:test，无需网络
npm run check     # host 与 client 语法检查
```

目录：

```
src/        host 半片（配置、SSH、探测、部署、工具、路由）
client/     浏览器半片（Server Deck 全页仪表盘，原生 ESM）
test/       单测（使用假传输层，不需要真实服务器）
docs/       使用与维护文档
examples/   配置示例
```

参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 兼容性

已在 DSH 桌面版 `0.2.2-rc.x` + Windows 11 主机、Ubuntu 24.04 目标机（密码登录）上实测：状态探测、执行、上传下载、两次发布、回滚、只读拦截、危险命令拦截、主机密钥固定、审计均通过。密钥与 SSH Agent 走同一条 `ssh2` 路径，macOS/Linux 主机理论可用但验证较少，欢迎反馈。

## 许可证

[MIT](LICENSE) © dsh-server-manager contributors

仓库地址：[github.com/yqdnsjs-qq/dsh-server-manager](https://github.com/yqdnsjs-qq/dsh-server-manager)。
