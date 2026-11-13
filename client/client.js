/**
 * dsh-server-manager — browser half.
 *
 * Registers a first-class left-sidebar entry (the same rail that hosts
 * "Plugins", "Automation tasks" and "Self-media workspace") and renders the
 * SERVER DECK dashboard as a full main-pane page. All data comes from the
 * host half under /api/server-manager; nothing here talks to SSH directly.
 */
window.__ModuleLoader__.load({
  id: "dsh-server-manager",
  factory: (require) => {
    const React = require("react");
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    const NS = "serverManager";
    const PANEL_ID = "server-manager";
    const API = "/api/server-manager";
    const LOGO_URL = `${API}/logo`;
    const HISTORY_KEY = "serverManager.history.v1";
    const AUTO_KEY = "serverManager.auto";
    const SELECTED_KEY = "serverManager.selected";
    const MAX_POINTS = 48;

    /* ------------------------------------------------------------------ */
    /* i18n                                                               */
    /* ------------------------------------------------------------------ */

    const zh = {
      "panel.title": "服务器监控管理",
      "panel.subtitle": "服务器指挥台",
      "action.add": "添加服务器",
      "action.refresh": "刷新全部",
      "action.refreshing": "探测中…",
      "action.settings": "设置",
      "action.save": "保存",
      "action.saving": "保存中…",
      "action.cancel": "取消",
      "action.close": "关闭",
      "action.edit": "编辑",
      "action.delete": "删除",
      "action.test": "测试连接",
      "action.testing": "测试中…",
      "action.probe": "刷新",
      "action.probing": "刷新中…",
      "action.forget": "忘记主机密钥",
      "action.audit": "审计日志",
      "action.run": "执行",
      "action.running": "执行中…",
      "action.retry": "重试",
      "status.online": "在线",
      "status.offline": "离线",
      "status.unchecked": "未检测",
      "status.attention": "需处理",
      "status.unknown": "未知",
      "deck.eyebrow": "SSH 控制中心",
      "deck.desc": "集中管理服务器清单、实时状态、命令执行与项目部署，让 Agent 直接操作远端机器。",
      "deck.auto": "实时",
      "deck.manual": "手动",
      "deck.nodes": "节点",
      "deck.updated": "更新于 {time}",
      "stats.servers": "服务器",
      "stats.online": "在线",
      "stats.offline": "离线",
      "stats.unchecked": "未检测",
      "rail.title": "服务器",
      "rail.default": "默认",
      "rail.empty": "还没有服务器",
      "rail.add": "添加第一台服务器",
      "rail.agentHint": "Agent 可读取状态、执行命令并部署项目；写操作建议保留审批。",
      "rail.hintTitle": "Agent 接入",
      "pulse.title": "集群脉搏",
      "pulse.live": "实时",
      "pulse.liveLabel": "LIVE / 集群延迟",
      "pulse.justNow": "刚刚",
      "pulse.secondsAgo": "{n} 秒前",
      "pulse.minutesAgo": "{n} 分钟前",
      "pulse.hoursAgo": "{n} 小时前",
      "pulse.daysAgo": "{n} 天前",
      "pulse.headline": "{online}/{total} 台服务器在线",
      "pulse.sub": "整个集群的实时可达性与资源水位。",
      "pulse.rate": "在线率",
      "pulse.latency": "平均延迟",
      "pulse.samples": "采样点",
      "pulse.last": "最近采样",
      "pulse.never": "尚未探测",
      "health.title": "集群健康",
      "health.sub": "在线、离线与未检测机器一览。",
      "capacity.title": "容量脉冲",
      "capacity.sub": "在线服务器的 CPU、内存和磁盘平均压力。",
      "capacity.waiting": "等待下一次采样…",
      "capacity.note": "每 {sec} 秒自动采样一次，浏览器本地保留最近 {n} 个点。",
      "capacity.cpu": "CPU",
      "capacity.memory": "内存",
      "capacity.disk": "磁盘",
      "waterline.title": "资源水位",
      "waterline.sub": "在线服务器的平均利用率。",
      "waterline.cpu": "CPU",
      "waterline.memory": "内存",
      "waterline.disk": "磁盘",
      "detail.title": "节点详情",
      "detail.empty": "从左侧选择一台服务器查看详情。",
      "detail.queue": "命中队列",
      "detail.target": "连接",
      "detail.latency": "延迟",
      "detail.uptime": "运行时长",
      "detail.hostname": "主机名",
      "detail.system": "系统",
      "detail.load": "负载",
      "detail.memory": "内存",
      "detail.disk": "磁盘",
      "detail.docker": "容器",
        "detail.systemInfo": "系统信息",
        "detail.kernel": "内核",
        "detail.arch": "架构",
        "detail.ip": "IP 地址",
        "detail.timezone": "时区",
      "detail.processes": "进程",
      "detail.warnings": "告警",
      "detail.failedUnits": "失败单元",
      "detail.reboot": "系统要求重启",
      "detail.noWarnings": "运行正常，没有告警。",
      "detail.console": "命令台",
      "detail.consolePlaceholder": "输入要在这台服务器上执行的命令…",
      "detail.output": "输出",
      "detail.exitCode": "退出码 {code}",
      "detail.duration": "耗时 {ms} ms",
      "detail.runHint": "命令以登录用户执行；只读策略会拦截写操作，危险命令会被拒绝。",
      "detail.hostKey": "主机密钥",
      "detail.transport": "通道",
      "detail.transportSsh": "SSH",
      "detail.transportQnap": "QTS 网页",
      "detail.transportSynology": "群晖 DSM 网页",
      "detail.transportFnos": "飞牛 fnOS 网页",
      "detail.openQts": "打开 QTS 控制台",
      "detail.openDsm": "打开 DSM 控制台",
      "detail.openFnos": "打开 fnOS 控制台",
      "detail.qnapReadOnly": "NAS 为只读接入，不执行 shell。",
      "detail.webReadOnly": "NAS 为只读监控接入，不执行 shell。",
      "detail.fnosStatus": "fnOS 系统状态",
      "detail.fnosVersion": "系统版本",
      "detail.fnosLatest": "最新版本",
      "detail.fnosNetwork": "网络",
      "detail.fnosUpToDate": "已是最新",
      "detail.fnosUpdateAvailable": "有可用更新",
      "detail.fnosUpdateHint": "请到 fnOS 控制台执行系统更新。",
      "detail.fnosApps": "应用",
      "detail.fnosAppStatus": "状态",
      "detail.fnosOpenApp": "打开",
      "detail.fnosNoApps": "没有已安装应用",
      "detail.fnosUpdateLink": "打开 fnOS 更新",
      "detail.trusted": "已记录",
      "detail.untrusted": "未记录",
      "detail.forgetHint": "改动过服务器或重装系统后，再忘记旧指纹。",
      "detail.tags": "标签",
      "detail.notes": "备注",
      "detail.readOnly": "只读",
      "detail.unrestricted": "可写",
      "detail.sudo": "sudo",
      "detail.noDocker": "Docker 不可用",
      "detail.noProcesses": "没有进程数据。",
      "detail.noStatus": "还没有探测过，点刷新获取状态。",
      "detail.offline": "连接失败",
      "detail.truncated": "输出已截断",
      "detail.noOutput": "（没有输出）",
      "detail.agentDeploy": "让 Agent 部署：把当前项目直接部署到这台服务器，说一句话即可。",
      "group.default": "默认",
      "form.addTitle": "添加服务器",
      "form.editTitle": "编辑服务器",
      "form.id": "标识",
      "form.idHint": "留空则按名称生成；只允许字母、数字、- 和 _。",
      "form.name": "名称",
      "form.host": "主机",
      "form.port": "端口",
      "form.username": "用户名",
      "form.auth": "登录方式",
      "form.password": "密码",
      "form.passwordHint": "支持明文，或 env:VAR / file:path 引用；留空表示保持原值。",
      "form.key": "私钥路径",
      "form.keyHint": "例如 ~/.ssh/id_ed25519 或 file:C:\\keys\\id_ed25519。",
      "form.passphrase": "私钥口令",
      "form.passphraseHint": "可选；留空表示保持原值。",
      "form.sudoPassword": "sudo 密码",
      "form.sudoHint": "可选；和登录密码不同时填写。",
      "form.group": "分组",
      "form.tags": "标签",
      "form.tagsHint": "用逗号分隔。",
      "form.notes": "备注",
      "form.policy": "安全策略",
      "form.readOnly": "只读模式（拦截写命令）",
      "form.allowDangerous": "允许危险命令",
      "form.allowCommands": "命令白名单（每行一个正则）",
      "form.denyCommands": "命令黑名单（每行一个正则）",
      "form.hostKeyPolicy": "主机密钥策略",
      "form.acceptNew": "accept-new（首次记录）",
      "form.strict": "strict（只信已记录）",
      "form.insecure": "insecure（不校验，不建议）",
      "form.progress": "保存后建议立刻测试连接，确认凭据可用。",
      "form.authPassword": "密码",
      "form.authKey": "私钥",
      "form.authAgent": "SSH Agent",
      "form.transport": "连接方式",
      "form.transportSsh": "SSH（Linux / PVE）",
      "form.transportQnap": "QNAP QTS 网页",
      "form.transportSynology": "群晖 DSM 网页",
      "form.transportFnos": "飞牛 fnOS 网页",
      "form.baseUrl": "网页地址",
      "form.baseUrlHint": "可选；例如 http://203.0.113.28:88。留空按主机和端口拼。",
      "form.required": "必填",
      "settings.title": "设置",
      "settings.auto": "自动刷新",
      "settings.off": "关闭",
      "settings.dataDir": "数据目录",
      "settings.configFile": "配置文件",
      "settings.version": "版本",
      "settings.nodes": "服务器数量",
      "settings.audit": "审计日志",
      "settings.auditHint": "所有写操作与部署记录。",
      "settings.docs": "文档",
      "settings.docsHint": "用法、配置与部署场景见仓库 docs/。",
      "audit.title": "审计日志",
      "audit.empty": "还没有审计记录。",
      "audit.time": "时间",
      "audit.action": "动作",
      "audit.server": "服务器",
      "audit.ok": "结果",
      "audit.yes": "成功",
      "audit.no": "失败",
      "empty.title": "服务器监控管理还没有服务器",
      "empty.desc": "添加第一台服务器后，这里会显示实时状态、容量趋势与部署入口。",
      "empty.cta": "添加服务器",
      "toast.saved": "配置已保存",
      "toast.deleted": "服务器已删除",
      "toast.tested": "连接正常（{ms} ms）",
      "toast.testFailed": "连接失败",
      "toast.probed": "状态已刷新",
      "toast.probeFailed": "探测失败",
      "toast.execDone": "命令执行完成",
      "toast.forgot": "主机密钥已忘记",
      "toast.loadFailed": "读取服务器清单失败",
      "toast.saveFailed": "保存失败",
      "toast.deleteFailed": "删除失败",
      "toast.execFailed": "命令执行失败",
      "toast.forgetFailed": "操作失败",
      "confirm.delete": "确定删除服务器 “{name}”？",
      "confirm.deleteHint": "只删除本地配置，不会改动远端机器。",
      "docker.title": "Docker 容器",
      "docker.live": "实时",
      "docker.realtime": "每 5 秒刷新",
      "docker.engine": "引擎 {version}",
      "docker.containers": "容器",
      "docker.running": "运行中",
      "docker.stopped": "已停止",
      "docker.cpu": "CPU",
      "docker.mem": "内存",
      "docker.ports": "端口",
      "docker.open": "打开网页",
      "docker.openHint": "在新窗口打开 {url}",
      "docker.noWebPort": "这个容器没有对外发布端口",
      "docker.notRunning": "容器未运行，先启动再打开",
      "docker.actions": "操作",
      "docker.start": "启动",
      "docker.stop": "停止",
      "docker.restart": "重启",
      "docker.pause": "暂停",
      "docker.unpause": "继续",
      "docker.upgrade": "升级",
      "docker.logs": "日志",
      "docker.logsTitle": "{name} 的日志",
      "docker.noLogs": "没有日志输出。",
      "docker.empty": "这台服务器上没有找到容器。",
      "docker.noEngine": "Docker 不可用：{error}",
      "docker.loading": "正在读取容器…",
      "docker.refresh": "刷新容器",
      "docker.failed": "读取容器失败",
      "docker.actionFailed": "操作失败",
      "docker.done": "{action} 完成",
      "docker.confirmStop": "停止容器 “{name}”？",
      "docker.confirmRestart": "重启容器 “{name}”？",
      "docker.confirmUpgrade": "升级 “{name}” 会拉取最新镜像并重建该服务，期间会短暂中断。继续？",
      "docker.notCompose": "这个容器不是 compose 管理的，不能自动升级。",
      "docker.project": "项目",
      "docker.state": "状态",
      "docker.sudoHint": "Docker 需要 sudo，已自动提权。",
      "docker.onePanel": "1Panel",
      "docker.onePanelVersion": "1Panel {version}",
      "docker.onePanelPort": "端口 {port}",
      "docker.onePanelApps": "{count} 个应用容器",
      "docker.openPanel": "打开 1Panel",
      "docker.onePanelHint": "1Panel 检测为只读；请在服务器配置里填入完整入口地址后再打开。",
      "docker.filterAll": "全部",
      "docker.filterRunning": "运行中",
      "docker.filterStopped": "已停止",
      "docker.noMatch": "没有匹配的容器。",
      "docker.updated": "容器状态已更新",
      "docker.upgrading": "正在升级 {name}…",
      "docker.service": "服务",
      "form.onepanel": "1Panel 入口地址",
      "form.onepanelHint": "可选，例如 http://203.0.113.33:33333/entrance；留空则按检测到的端口生成。",
      "pve.title": "PVE 虚拟化",
      "pve.readonly": "只读",
      "pve.version": "PVE {version}",
      "pve.open": "打开 PVE 控制台",
      "pve.nodes": "{count} 节点",
      "pve.vms": "{count} 台虚拟机",
      "pve.running": "运行中",
      "pve.stopped": "已停止",
      "pve.loading": "正在读取 PVE…",
      "pve.failed": "读取 PVE 失败",
      "pve.unavailable": "PVE 不可用：{error}",
      "pve.noGuests": "这台 PVE 上没有虚拟机。",
      "pve.vmid": "VMID",
      "pve.name": "名称",
      "pve.type": "类型",
      "pve.state": "状态",
      "pve.cpu": "CPU",
      "pve.memory": "内存",
      "pve.disk": "磁盘",
      "pve.uptime": "运行时长",
      "pve.storage": "存储",
      "pve.summary": "{host} · {version}",
      "pve.hint": "只读视图，开关机请到 PVE 控制台操作。",
      "pve.template": "模板",
      "pve.refresh": "刷新 PVE",
      "pve.cpuLine": "{percent}% · {cores} 核",
      "pve.memLine": "{used} / {total}",
      "pve.storageLine": "{used} / {total} · {percent}%",
      "pve.typeQemu": "VM",
      "pve.typeLxc": "CT",
      "pve.updates": "{count} 个更新",
      "pve.upToDate": "已是最新",
      "pve.checkUpdates": "检查更新",
      "pve.checking": "检查中…",
      "pve.updatesTitle": "PVE 更新提醒",
      "pve.updatesHint": "基于 PVE 本地 apt 列表；点“检查更新”会执行一次 apt update。",
      "pve.noUpdates": "暂无可用更新。",
      "pve.security": "安全",
      "pve.checkedAt": "检查于 {time}",
      "pve.updateFailed": "检查更新失败",
      "onepanel.title": "1PANEL 应用商店",
      "onepanel.apps": "{count} 个应用",
      "onepanel.updates": "{count} 个可更新",
      "onepanel.running": "{count} 个运行中",
      "onepanel.latest": "已是最新",
      "onepanel.refresh": "刷新应用信息",
      "onepanel.open": "打开 1Panel",
      "onepanel.loading": "正在读取 1Panel 应用…",
      "onepanel.failed": "读取 1Panel 应用失败",
      "onepanel.unavailable": "未检测到 1Panel 应用商店数据库",
      "onepanel.app": "应用",
      "onepanel.current": "当前版本",
      "onepanel.candidate": "最新版本",
      "onepanel.status": "状态",
      "onepanel.container": "容器",
      "onepanel.noUpdates": "全部应用已是最新。",
      "onepanel.checkedAt": "缓存 {time}",
      "onepanel.statsApps": "应用",
      "onepanel.statsUpdates": "可更新",
      "onepanel.statsRunning": "运行中",
      "onepanel.statsChecked": "最近检查",
      "onepanel.hint": "数据来自 1Panel 本地应用商店缓存；升级请到 1Panel 应用商店操作。",
      "onepanel.updateAvailable": "可更新",
      "onepanel.error": "错误：{error}",
    };

    const en = {
      "panel.title": "服务器监控管理",
      "panel.subtitle": "Server command deck",
      "action.add": "Add server",
      "action.refresh": "Refresh all",
      "action.refreshing": "Probing…",
      "action.settings": "Settings",
      "action.save": "Save",
      "action.saving": "Saving…",
      "action.cancel": "Cancel",
      "action.close": "Close",
      "action.edit": "Edit",
      "action.delete": "Delete",
      "action.test": "Test connection",
      "action.testing": "Testing…",
      "action.probe": "Refresh",
      "action.probing": "Refreshing…",
      "action.forget": "Forget host key",
      "action.audit": "Audit log",
      "action.run": "Run",
      "action.running": "Running…",
      "action.retry": "Retry",
      "status.online": "Online",
      "status.offline": "Offline",
      "status.unchecked": "Unchecked",
      "status.attention": "Needs attention",
      "status.unknown": "Unknown",
      "deck.eyebrow": "SSH CONTROL CENTER",
      "deck.desc": "One deck for servers, live health, remote commands and project deploys — so an agent can operate the fleet directly.",
      "deck.auto": "Live",
      "deck.manual": "Manual",
      "deck.nodes": "nodes",
      "deck.updated": "Updated {time}",
      "stats.servers": "Servers",
      "stats.online": "Online",
      "stats.offline": "Offline",
      "stats.unchecked": "Unchecked",
      "rail.title": "Servers",
      "rail.default": "Default",
      "rail.empty": "No servers yet",
      "rail.add": "Add the first server",
      "rail.agentHint": "The agent can read status, run commands and deploy here. Keep approvals on for writes.",
      "rail.hintTitle": "Agent access",
      "pulse.title": "Cluster pulse",
      "pulse.live": "Live",
      "pulse.liveLabel": "LIVE / cluster latency",
      "pulse.justNow": "just now",
      "pulse.secondsAgo": "{n}s ago",
      "pulse.minutesAgo": "{n}m ago",
      "pulse.hoursAgo": "{n}h ago",
      "pulse.daysAgo": "{n}d ago",
      "pulse.headline": "{online}/{total} servers online",
      "pulse.sub": "Reachability and resource level for the whole fleet.",
      "pulse.rate": "Online rate",
      "pulse.latency": "Avg latency",
      "pulse.samples": "Samples",
      "pulse.last": "Last sample",
      "pulse.never": "Not probed yet",
      "health.title": "Cluster health",
      "health.sub": "Online, offline and unchecked machines at a glance.",
      "capacity.title": "Capacity pulse",
      "capacity.sub": "Average CPU, memory and disk pressure of online servers.",
      "capacity.waiting": "Waiting for the next sample…",
      "capacity.note": "Sampled every {sec}s and kept in this browser (last {n} points).",
      "capacity.cpu": "CPU",
      "capacity.memory": "Memory",
      "capacity.disk": "Disk",
      "waterline.title": "Resource waterline",
      "waterline.sub": "Average utilisation of online servers.",
      "waterline.cpu": "CPU",
      "waterline.memory": "Memory",
      "waterline.disk": "Disk",
      "detail.title": "Node detail",
      "detail.empty": "Pick a server on the left to inspect it.",
      "detail.queue": "Hit queue",
      "detail.target": "Target",
      "detail.latency": "Latency",
      "detail.uptime": "Uptime",
      "detail.hostname": "Hostname",
      "detail.system": "System",
      "detail.load": "Load",
      "detail.memory": "Memory",
      "detail.disk": "Disk",
      "detail.docker": "Containers",
        "detail.systemInfo": "System",
        "detail.kernel": "Kernel",
        "detail.arch": "Arch",
        "detail.ip": "IP address",
        "detail.timezone": "Time zone",
      "detail.processes": "Processes",
      "detail.warnings": "Warnings",
      "detail.failedUnits": "Failed units",
      "detail.reboot": "Reboot required",
      "detail.noWarnings": "All clear, no warnings.",
      "detail.console": "Console",
      "detail.consolePlaceholder": "Run a command on this server…",
      "detail.output": "Output",
      "detail.exitCode": "Exit code {code}",
      "detail.duration": "Took {ms} ms",
      "detail.runHint": "Runs as the login user; read-only policy blocks writes and dangerous commands are refused.",
      "detail.hostKey": "Host key",
      "detail.transport": "Transport",
      "detail.transportSsh": "SSH",
      "detail.transportQnap": "QTS web",
      "detail.transportSynology": "Synology DSM web",
      "detail.transportFnos": "fnOS web",
      "detail.openQts": "Open QTS console",
      "detail.openDsm": "Open DSM console",
      "detail.openFnos": "Open fnOS console",
      "detail.qnapReadOnly": "NAS access is read-only; no shell is executed.",
      "detail.webReadOnly": "NAS access is read-only monitoring; no shell is executed.",
      "detail.fnosStatus": "fnOS system status",
      "detail.fnosVersion": "System version",
      "detail.fnosLatest": "Latest version",
      "detail.fnosNetwork": "Network",
      "detail.fnosUpToDate": "Up to date",
      "detail.fnosUpdateAvailable": "Update available",
      "detail.fnosUpdateHint": "Run the system update in the fnOS console.",
      "detail.fnosApps": "Apps",
      "detail.fnosAppStatus": "Status",
      "detail.fnosOpenApp": "Open",
      "detail.fnosNoApps": "No installed apps",
      "detail.fnosUpdateLink": "Open fnOS updates",
      "detail.trusted": "Pinned",
      "detail.untrusted": "Not pinned",
      "detail.forgetHint": "Forget the old fingerprint after rebuilding or reinstalling the host.",
      "detail.tags": "Tags",
      "detail.notes": "Notes",
      "detail.readOnly": "Read-only",
      "detail.unrestricted": "Writable",
      "detail.sudo": "sudo",
      "detail.noDocker": "Docker unavailable",
      "detail.noProcesses": "No process data.",
      "detail.noStatus": "Not probed yet. Hit refresh to collect status.",
      "detail.offline": "Connection failed",
      "detail.truncated": "output truncated",
      "detail.noOutput": "(no output)",
      "detail.agentDeploy": "Ask the agent to deploy the current project to this server — one sentence is enough.",
      "group.default": "Default",
      "form.addTitle": "Add server",
      "form.editTitle": "Edit server",
      "form.id": "Id",
      "form.idHint": "Generated from the name when empty; letters, digits, - and _ only.",
      "form.name": "Name",
      "form.host": "Host",
      "form.port": "Port",
      "form.username": "Username",
      "form.auth": "Authentication",
      "form.password": "Password",
      "form.passwordHint": "Plain text, env:VAR or file:path. Empty keeps the stored value.",
      "form.key": "Private key path",
      "form.keyHint": "For example ~/.ssh/id_ed25519 or file:C:\\keys\\id_ed25519.",
      "form.passphrase": "Key passphrase",
      "form.passphraseHint": "Optional; empty keeps the stored value.",
      "form.sudoPassword": "sudo password",
      "form.sudoHint": "Optional; fill when it differs from the login password.",
      "form.group": "Group",
      "form.tags": "Tags",
      "form.tagsHint": "Comma separated.",
      "form.notes": "Notes",
      "form.policy": "Safety policy",
      "form.readOnly": "Read-only mode (block writes)",
      "form.allowDangerous": "Allow dangerous commands",
      "form.allowCommands": "Command allow-list (one regex per line)",
      "form.denyCommands": "Command deny-list (one regex per line)",
      "form.hostKeyPolicy": "Host key policy",
      "form.acceptNew": "accept-new (pin on first use)",
      "form.strict": "strict (pinned only)",
      "form.insecure": "insecure (no verification, discouraged)",
      "form.progress": "Test the connection right after saving to confirm the credentials.",
      "form.authPassword": "Password",
      "form.authKey": "Private key",
      "form.authAgent": "SSH agent",
      "form.transport": "Connection",
      "form.transportSsh": "SSH (Linux / PVE)",
      "form.transportQnap": "QNAP QTS web",
      "form.transportSynology": "Synology DSM web",
      "form.transportFnos": "fnOS web",
      "form.baseUrl": "Web address",
      "form.baseUrlHint": "Optional, for example http://203.0.113.28:88. Built from host and port when empty.",
      "form.required": "Required",
      "settings.title": "Settings",
      "settings.auto": "Auto refresh",
      "settings.off": "Off",
      "settings.dataDir": "Data directory",
      "settings.configFile": "Config file",
      "settings.version": "Version",
      "settings.nodes": "Servers",
      "settings.audit": "Audit log",
      "settings.auditHint": "Every write and deploy action is recorded.",
      "settings.docs": "Docs",
      "settings.docsHint": "Usage, configuration and deploy scenarios live in docs/.",
      "audit.title": "Audit log",
      "audit.empty": "No audit entries yet.",
      "audit.time": "Time",
      "audit.action": "Action",
      "audit.server": "Server",
      "audit.ok": "Result",
      "audit.yes": "ok",
      "audit.no": "failed",
      "empty.title": "No servers yet",
      "empty.desc": "Add the first server and this deck will show live health, capacity trends and deploy entry points.",
      "empty.cta": "Add server",
      "toast.saved": "Configuration saved",
      "toast.deleted": "Server deleted",
      "toast.tested": "Connection ok ({ms} ms)",
      "toast.testFailed": "Connection failed",
      "toast.probed": "Status refreshed",
      "toast.probeFailed": "Probe failed",
      "toast.execDone": "Command finished",
      "toast.forgot": "Host key forgotten",
      "toast.loadFailed": "Cannot load the server list",
      "toast.saveFailed": "Save failed",
      "toast.deleteFailed": "Delete failed",
      "toast.execFailed": "Command failed",
      "toast.forgetFailed": "Action failed",
      "confirm.delete": "Delete server “{name}”?",
      "confirm.deleteHint": "Only the local configuration is removed; the remote host is untouched.",
      "docker.title": "Docker containers",
      "docker.live": "Live",
      "docker.realtime": "Refreshes every 5 seconds",
      "docker.engine": "Engine {version}",
      "docker.containers": "Containers",
      "docker.running": "Running",
      "docker.stopped": "Stopped",
      "docker.cpu": "CPU",
      "docker.mem": "Memory",
      "docker.ports": "Ports",
      "docker.open": "Open web UI",
      "docker.openHint": "Open {url} in a new tab",
      "docker.noWebPort": "This container publishes no host port",
      "docker.notRunning": "Container is not running; start it first",
      "docker.actions": "Actions",
      "docker.start": "Start",
      "docker.stop": "Stop",
      "docker.restart": "Restart",
      "docker.pause": "Pause",
      "docker.unpause": "Resume",
      "docker.upgrade": "Upgrade",
      "docker.logs": "Logs",
      "docker.logsTitle": "Logs for {name}",
      "docker.noLogs": "No log output.",
      "docker.empty": "No containers were found on this server.",
      "docker.noEngine": "Docker unavailable: {error}",
      "docker.loading": "Loading containers…",
      "docker.refresh": "Refresh containers",
      "docker.failed": "Could not read containers",
      "docker.actionFailed": "Action failed",
      "docker.done": "{action} finished",
      "docker.confirmStop": "Stop container “{name}”?",
      "docker.confirmRestart": "Restart container “{name}”?",
      "docker.confirmUpgrade": "Upgrading “{name}” pulls the latest image and recreates the service, causing a brief outage. Continue?",
      "docker.notCompose": "This container is not managed by compose, so it cannot be upgraded automatically.",
      "docker.project": "Project",
      "docker.state": "State",
      "docker.sudoHint": "Docker needs sudo; elevated automatically.",
      "docker.onePanel": "1Panel",
      "docker.onePanelVersion": "1Panel {version}",
      "docker.onePanelPort": "port {port}",
      "docker.onePanelApps": "{count} app containers",
      "docker.openPanel": "Open 1Panel",
      "docker.onePanelHint": "1Panel was detected. Add its full entrance URL in the server settings to open it from here.",
      "docker.filterAll": "All",
      "docker.filterRunning": "Running",
      "docker.filterStopped": "Stopped",
      "docker.noMatch": "No containers match this filter.",
      "docker.updated": "Containers updated",
      "docker.upgrading": "Upgrading {name}…",
      "docker.service": "Service",
      "form.onepanel": "1Panel entrance URL",
      "form.onepanelHint": "Optional, e.g. http://203.0.113.33:33333/entrance. Leave empty to derive the URL from the detected port.",
      "pve.title": "Proxmox VE",
      "pve.readonly": "Read-only",
      "pve.version": "PVE {version}",
      "pve.open": "Open PVE console",
      "pve.nodes": "{count} nodes",
      "pve.vms": "{count} guests",
      "pve.running": "Running",
      "pve.stopped": "Stopped",
      "pve.loading": "Loading PVE…",
      "pve.failed": "Could not read PVE",
      "pve.unavailable": "PVE unavailable: {error}",
      "pve.noGuests": "No guests on this PVE host.",
      "pve.vmid": "VMID",
      "pve.name": "Name",
      "pve.type": "Type",
      "pve.state": "State",
      "pve.cpu": "CPU",
      "pve.memory": "Memory",
      "pve.disk": "Disk",
      "pve.uptime": "Uptime",
      "pve.storage": "Storage",
      "pve.summary": "{host} · {version}",
      "pve.hint": "Read-only view. Use the PVE console to start or stop guests.",
      "pve.template": "template",
      "pve.refresh": "Refresh PVE",
      "pve.cpuLine": "{percent}% · {cores} cores",
      "pve.memLine": "{used} / {total}",
      "pve.storageLine": "{used} / {total} · {percent}%",
      "pve.typeQemu": "VM",
      "pve.typeLxc": "CT",
      "pve.updates": "{count} updates",
      "pve.upToDate": "Up to date",
      "pve.checkUpdates": "Check updates",
      "pve.checking": "Checking…",
      "pve.updatesTitle": "PVE update alerts",
      "pve.updatesHint": "Based on the local PVE apt lists; “Check updates” runs apt update once.",
      "pve.noUpdates": "No package updates available.",
      "pve.security": "security",
      "pve.checkedAt": "Checked {time}",
      "pve.updateFailed": "Update check failed",
      "onepanel.title": "1PANEL APP STORE",
      "onepanel.apps": "{count} apps",
      "onepanel.updates": "{count} updatable",
      "onepanel.running": "{count} running",
      "onepanel.latest": "Up to date",
      "onepanel.refresh": "Refresh app data",
      "onepanel.open": "Open 1Panel",
      "onepanel.loading": "Reading 1Panel apps…",
      "onepanel.failed": "Could not read 1Panel apps",
      "onepanel.unavailable": "1Panel app-store database not detected",
      "onepanel.app": "App",
      "onepanel.current": "Current",
      "onepanel.candidate": "Latest",
      "onepanel.status": "Status",
      "onepanel.container": "Container",
      "onepanel.noUpdates": "All apps are up to date.",
      "onepanel.checkedAt": "cache {time}",
      "onepanel.statsApps": "apps",
      "onepanel.statsUpdates": "updatable",
      "onepanel.statsRunning": "running",
      "onepanel.statsChecked": "checked",
      "onepanel.hint": "Data comes from the local 1Panel app-store cache; upgrade in the 1Panel app store.",
      "onepanel.updateAvailable": "update",
      "onepanel.error": "Error: {error}",
    };

    let boundT = (key) => key;

    function t(key, params) {
      let value;
      try {
        value = boundT(key);
      } catch {
        value = undefined;
      }
      if (value === undefined || value === null || value === key) value = zh[key] ?? en[key] ?? key;
      if (!params) return value;
      return String(value).replace(/\{(\w+)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]),
      );
    }

    /* ------------------------------------------------------------------ */
    /* helpers                                                            */
    /* ------------------------------------------------------------------ */

    async function request(path, options = {}) {
      const init = { credentials: "same-origin", ...options };
      if (init.body !== undefined) {
        init.headers = { "content-type": "application/json", ...(init.headers || {}) };
        init.body = JSON.stringify(init.body);
      }
      const response = await fetch(API + path, init);
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const message = payload && payload.error ? payload.error : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload;
    }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage is best effort */
      }
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function levelOf(server) {
      if (!server || !server.status) return "unknown";
      if (server.status.reachable === false) return "offline";
      return server.status.level || "ok";
    }

    function levelText(level) {
      if (level === "ok") return t("status.online");
      if (level === "warn" || level === "critical") return t("status.attention");
      if (level === "offline") return t("status.offline");
      return t("status.unchecked");
    }

    function fmtPct(value) {
      return value === null || value === undefined ? "—" : `${Math.round(value)}%`;
    }

    function fmtMs(value) {
      if (value === null || value === undefined) return "—";
      if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
      return `${Math.round(value)} ms`;
    }

    function fmtMb(value) {
      if (value === null || value === undefined) return "—";
      if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
      return `${Math.round(value)} MiB`;
    }

    function fmtGb(value) {
      if (value === null || value === undefined) return "—";
      return `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB`;
    }

    function fmtRate(value) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
      let rate = Math.max(0, Number(value));
      const units = ["B/s", "KB/s", "MB/s", "GB/s"];
      let unit = 0;
      while (rate >= 1024 && unit < units.length - 1) {
        rate /= 1024;
        unit += 1;
      }
      return `${rate >= 10 || unit === 0 ? Math.round(rate) : rate.toFixed(1)} ${units[unit]}`;
    }

    function fmtUptime(seconds) {
      if (seconds === null || seconds === undefined) return "—";
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    }

    function timeAgo(iso) {
      if (!iso) return t("pulse.never");
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return t("pulse.never");
      const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
      if (seconds < 8) return t("pulse.justNow");
      if (seconds < 60) return t("pulse.secondsAgo", { n: seconds });
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return t("pulse.minutesAgo", { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t("pulse.hoursAgo", { n: hours });
      return t("pulse.daysAgo", { n: Math.floor(hours / 24) });
    }

    function clockText(date) {
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
    }

    function rootDisk(status) {
      if (!status || !Array.isArray(status.disks) || status.disks.length === 0) return null;
      const root = status.disks.find((disk) => disk.mount === "/") ?? status.disks[0];
      return root && Number.isFinite(root.percent) ? root.percent : null;
    }

    function aggregate(servers) {
      const list = Array.isArray(servers) ? servers : [];
      const checked = list.filter((server) => server.status);
      const online = checked.filter((server) => server.status.reachable !== false);
      const offline = checked.filter((server) => server.status.reachable === false);
      const unchecked = list.filter((server) => !server.status);
      const attention = online.filter((server) => server.status.level === "warn" || server.status.level === "critical");
      const mean = (pick) => {
        const values = online.map(pick).filter((value) => Number.isFinite(value));
        if (values.length === 0) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      };
      const latencyValues = online.map((server) => server.status.latencyMs).filter((value) => Number.isFinite(value));
      const lastChecked = checked
        .map((server) => server.status.checkedAt)
        .filter(Boolean)
        .sort()
        .pop();
      return {
        total: list.length,
        online: online.length,
        offline: offline.length,
        unchecked: unchecked.length,
        attention: attention.length,
        cpu: mean((server) => (server.status.load ? server.status.load.percent : null)),
        mem: mean((server) => (server.status.memory ? server.status.memory.percent : null)),
        disk: mean((server) => rootDisk(server.status)),
        latency: latencyValues.length
          ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
          : null,
        containers: online.reduce((sum, server) => sum + (server.status.docker?.running ?? 0), 0),
        failedUnits: online.reduce((sum, server) => sum + (server.status.systemd?.failed?.length ?? 0), 0),
        lastChecked: lastChecked ?? null,
      };
    }

    function sortServers(servers) {
      return [...servers].sort((left, right) => {
        const group = String(left.group || "").localeCompare(String(right.group || ""));
        if (group !== 0) return group;
        return String(left.name || left.id).localeCompare(String(right.name || right.id));
      });
    }

    /* ------------------------------------------------------------------ */
    /* icons                                                              */
    /* ------------------------------------------------------------------ */

    const Svg = (props) =>
      h(
        "svg",
        {
          width: props.size ?? 18,
          height: props.size ?? 18,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        props.children,
      );

    const IconServer = (props) =>
      h(
        Svg,
        props,
        h("rect", { key: "a", x: 3, y: 4, width: 18, height: 7, rx: 2 }),
        h("rect", { key: "b", x: 3, y: 13, width: 18, height: 7, rx: 2 }),
        h("path", { key: "c", d: "M7 7.5h.01M7 16.5h.01" }),
      );

    const LogoMark = (props = {}) =>
      h("img", {
        className: "smx-logo-img",
        src: LOGO_URL,
        alt: "",
        width: props.size || 24,
        height: props.size || 24,
        loading: "lazy",
        draggable: "false",
      });

    const IconCheck = (props) =>
      h(Svg, props, h("path", { key: "a", d: "M5 12.5l4 4L19 6.5" }));

    const IconAlert = (props) =>
      h(
        Svg,
        props,
        h("path", { key: "a", d: "M12 3.8 2.9 19.5h18.2L12 3.8Z" }),
        h("path", { key: "b", d: "M12 9.5v4.2M12 17.2h.01" }),
      );

    const IconClock = (props) =>
      h(
        Svg,
        props,
        h("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }),
        h("path", { key: "b", d: "M12 7.5V12l3 2" }),
      );

    const IconRefresh = (props) =>
      h(
        Svg,
        props,
        h("path", { key: "a", d: "M20 5.5v5h-5" }),
        h("path", { key: "b", d: "M19.3 10.5a7.5 7.5 0 1 0 1 4" }),
      );

    const IconPlus = (props) => h(Svg, props, h("path", { key: "a", d: "M12 5v14M5 12h14" }));

    const IconGear = (props) =>
      h(
        Svg,
        props,
        h("circle", { key: "a", cx: 12, cy: 12, r: 3 }),
        h("path", {
          key: "b",
          d: "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.4.4.75.75.98.3.2.66.3 1.01.3H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.72Z",
        }),
      );

    const IconTerminal = (props) =>
      h(
        Svg,
        props,
        h("rect", { key: "a", x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }),
        h("path", { key: "b", d: "M7.5 9.5l3 2.5-3 2.5M13 15h3.5" }),
      );

    const IconChevron = (props) => h(Svg, props, h("path", { key: "a", d: "M9 6l6 6-6 6" }));

    const IconShield = (props) =>
      h(
        Svg,
        props,
        h("path", { key: "a", d: "M12 3.5 5 6v5.4c0 4.4 3 7.6 7 9.1 4-1.5 7-4.7 7-9.1V6l-7-2.5Z" }),
        h("path", { key: "b", d: "M9.2 12.2l2 2 3.6-4" }),
      );

    const IconKey = (props) =>
      h(
        Svg,
        props,
        h("circle", { key: "a", cx: 8, cy: 15.5, r: 3.5 }),
        h("path", { key: "b", d: "M10.8 13.2 19 5M15.5 8.5l2 2M18 6l2 2" }),
      );

    const IconBox = (props) =>
      h(
        Svg,
        props,
        h("path", { key: "a", d: "M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" }),
        h("path", { key: "b", d: "M4 7.5l8 4.5 8-4.5M12 12v9" }),
      );

    /* ------------------------------------------------------------------ */
    /* atoms                                                              */
    /* ------------------------------------------------------------------ */

    function StatusDot({ level }) {
      return h("i", { className: `smx-dot is-${level}`, "aria-hidden": "true" });
    }

    function Button({ variant, className, children, ...rest }) {
      return h("button", { type: "button", className: `smx-btn ${variant ? `is-${variant}` : ""} ${className || ""}`, ...rest }, children);
    }

    function Meter({ label, percent, detail }) {
      const value = percent === null || percent === undefined ? null : clamp(percent, 0, 100);
      const tone = value === null ? "dim" : value >= 90 ? "red" : value >= 75 ? "gold" : "green";
      return h(
        "div",
        { className: "smx-meter" },
        h(
          "div",
          { className: "smx-meter-head" },
          h("span", null, label),
          h("b", { className: `tone-${tone}` }, fmtPct(value)),
        ),
        h("div", { className: "smx-meter-track" }, h("i", { className: `tone-${tone}`, style: { width: `${value ?? 0}%` } })),
        detail ? h("div", { className: "smx-meter-detail" }, detail) : null,
      );
    }

    function Gauge({ label, value }) {
      const safe = value === null || value === undefined ? null : clamp(value, 0, 100);
      const tone = safe === null ? "dim" : safe >= 90 ? "red" : safe >= 75 ? "gold" : "green";
      return h(
        "div",
        { className: "smx-gauge-wrap" },
        h(
          "div",
          { className: `smx-gauge tone-${tone}`, style: { "--smx-gauge": `${safe ?? 0}%` } },
          h("div", { className: "smx-gauge-hole" }, h("b", null, fmtPct(safe))),
        ),
        h("span", { className: "smx-gauge-label" }, label),
      );
    }

    function Panel({ index, title, right, children, className }) {
      return h(
        "section",
        { className: `smx-card ${className || ""}` },
        h(
          "header",
          { className: "smx-card-head" },
          h("div", { className: "smx-card-title" }, index ? h("span", { className: "smx-card-num" }, index) : null, h("h2", null, title)),
          right ? h("div", { className: "smx-card-right" }, right) : null,
        ),
        children,
      );
    }

    function LiveChip({ live }) {
      return h("span", { className: `smx-live ${live ? "is-on" : ""}` }, h("i"), live ? t("deck.auto") : t("deck.manual"));
    }

    function Donut({ segments, total }) {
      const radius = 54;
      const circumference = 2 * Math.PI * radius;
      let offset = 0;
      const rings = segments.map((segment, index) => {
        const fraction = total > 0 ? segment.value / total : 0;
        const length = fraction * circumference;
        const ring = h("circle", {
          key: index,
          cx: 70,
          cy: 70,
          r: radius,
          fill: "none",
          stroke: segment.color,
          strokeWidth: 13,
          strokeDasharray: `${Math.max(0, length - 2)} ${circumference}`,
          strokeDashoffset: -offset,
          strokeLinecap: "butt",
          opacity: segment.value > 0 ? 1 : 0,
        });
        offset += length;
        return ring;
      });
      return h(
        "div",
        { className: "smx-donut" },
        h(
          "svg",
          { viewBox: "0 0 140 140", role: "img", "aria-label": String(total) },
          h("circle", { cx: 70, cy: 70, r: radius, fill: "none", stroke: "rgba(255,255,255,.07)", strokeWidth: 13 }),
          h("g", { transform: "rotate(-90 70 70)" }, rings),
        ),
        h("div", { className: "smx-donut-center" }, h("b", null, total), h("span", null, t("stats.servers"))),
      );
    }

    function TrendChart({ points }) {
      const width = 620;
      const height = 190;
      const pad = 14;
      const count = points.length;
      const x = (index) => (count <= 1 ? width - pad : pad + (index * (width - pad * 2)) / (count - 1));
      const y = (value) => height - pad - (clamp(value ?? 0, 0, 100) / 100) * (height - pad * 2);
      const series = [
        { key: "cpu", color: "#7aa2ff" },
        { key: "mem", color: "#3ddc97" },
        { key: "disk", color: "#d9b36c" },
      ];
      const grid = [0, 25, 50, 75, 100].map((value) =>
        h("line", {
          key: value,
          x1: pad,
          x2: width - pad,
          y1: y(value),
          y2: y(value),
          stroke: "rgba(255,255,255,.07)",
          strokeWidth: 1,
          vectorEffect: "non-scaling-stroke",
        }),
      );
      const area =
        count >= 2
          ? h("polygon", {
              points: `${x(0)},${height - pad} ${points.map((point, index) => `${x(index)},${y(point.cpu)}`).join(" ")} ${x(count - 1)},${height - pad}`,
              fill: "url(#smx-area)",
            })
          : null;
      const lines = series.map((item) =>
        count >= 2
          ? h("polyline", {
              key: item.key,
              points: points.map((point, index) => `${x(index)},${y(point[item.key])}`).join(" "),
              fill: "none",
              stroke: item.color,
              strokeWidth: 2.2,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              vectorEffect: "non-scaling-stroke",
            })
          : null,
      );
      return h(
        "div",
        { className: "smx-chart" },
        h(
          "div",
          { className: "smx-yaxis" },
          [100, 75, 50, 25, 0].map((value) => h("span", { key: value }, `${value}%`)),
        ),
        h(
          "svg",
          { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" },
          h(
            "defs",
            null,
            h(
              "linearGradient",
              { id: "smx-area", x1: "0", y1: "0", x2: "0", y2: "1" },
              h("stop", { offset: "0%", stopColor: "#7aa2ff", stopOpacity: 0.26 }),
              h("stop", { offset: "100%", stopColor: "#7aa2ff", stopOpacity: 0 }),
            ),
          ),
          grid,
          area,
          lines,
        ),
        count < 2
          ? h("div", { className: "smx-chart-empty" }, h("span", null, t("capacity.waiting")))
          : null,
      );
    }

    function LatencyBars({ points }) {
      const values = points.map((point) => point.latency).filter((value) => Number.isFinite(value));
      const max = Math.max(80, ...values);
      if (values.length === 0) {
        return h("div", { className: "smx-latbars is-empty" }, h("span", null, t("pulse.never")));
      }
      return h(
        "div",
        { className: "smx-latbars", "aria-hidden": "true" },
        values.slice(-26).map((value, index) =>
          h("i", {
            key: index,
            className: value > max * 0.7 ? "is-warm" : "",
            style: { height: `${clamp((value / max) * 100, 12, 100)}%` },
          }),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* server form                                                        */
    /* ------------------------------------------------------------------ */

    const WEB_DEFAULT_PORTS = { qnap: "88", synology: "5000", fnos: "5666" };
    const WEB_NAME = { qnap: "Qnap", synology: "Synology", fnos: "Fnos" };

    function emptyForm(server) {
      const source = server || {};
      const transport = source.transport || "ssh";
      const isWeb = transport !== "ssh";
      return {
        id: source.id || "",
        name: source.name || "",
        transport,
        host: source.host || "",
        port: String(source.port || (isWeb ? WEB_DEFAULT_PORTS[transport] : 22)),
        baseUrl: source.baseUrl || "",
        username: source.username || (isWeb ? "admin" : "root"),
        auth: isWeb ? "password" : source.auth || "password",
        password: "",
        passphrase: "",
        sudoPassword: "",
        privateKeyPath: source.privateKeyPath || "",
        group: source.group || "",
        tags: Array.isArray(source.tags) ? source.tags.join(", ") : "",
        notes: source.notes || "",
        readOnly: Boolean(source.policy?.readOnly),
        allowDangerous: Boolean(source.policy?.allowDangerous),
        allowCommands: Array.isArray(source.policy?.allowCommands) ? source.policy.allowCommands.join("\n") : "",
        denyCommands: Array.isArray(source.policy?.denyCommands) ? source.policy.denyCommands.join("\n") : "",
        hostKeyPolicy: source.hostKey?.policy || "accept-new",
        onepanelUrl: source.onepanel?.url || "",
      };
    }

    function slugify(value) {
      return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    }

    function ServerForm({ mode, server, onSubmit, onClose, saving }) {
      const [form, setForm] = useState(() => emptyForm(server));
      const [error, setError] = useState("");
      const set = (field) => (event) => {
        const target = event.target;
        const value = target.type === "checkbox" ? target.checked : target.value;
        setForm((prev) => ({ ...prev, [field]: value }));
      };
      const setTransport = (event) => {
        const transport = event.target.value;
        const web = transport !== "ssh";
        setForm((prev) => {
          const oldDefault = prev.transport === "ssh" ? "22" : WEB_DEFAULT_PORTS[prev.transport];
          return {
            ...prev,
            transport,
            auth: web ? "password" : prev.auth || "password",
            port: prev.port === "" || prev.port === oldDefault
              ? (web ? WEB_DEFAULT_PORTS[transport] : "22")
              : prev.port,
          };
        });
      };

      const submit = async (event) => {
        event.preventDefault();
        setError("");
        if (!form.host.trim()) {
          setError(`${t("form.host")}: ${t("form.required")}`);
          return;
        }
        if (!form.username.trim()) {
          setError(`${t("form.username")}: ${t("form.required")}`);
          return;
        }
        if (form.transport !== "ssh" && mode === "add" && !form.password.trim()) {
          setError(`${t("form.password")}: ${t("form.required")}`);
          return;
        }
        const lines = (value) =>
          String(value || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        const isWeb = form.transport !== "ssh";
        const payload = {
          id: form.id.trim() || slugify(form.name || form.host),
          name: form.name.trim() || form.host.trim(),
          transport: form.transport,
          host: form.host.trim(),
          port: Number(form.port) || (isWeb ? Number(WEB_DEFAULT_PORTS[form.transport]) : 22),
          username: form.username.trim(),
          auth: isWeb ? "password" : form.auth,
          group: form.group.trim(),
          tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          notes: form.notes.trim(),
          policy: {
            readOnly: isWeb ? true : Boolean(form.readOnly),
            allowDangerous: isWeb ? false : Boolean(form.allowDangerous),
            allowCommands: isWeb ? [] : lines(form.allowCommands),
            denyCommands: isWeb ? [] : lines(form.denyCommands),
          },
        };
        if (isWeb) {
          payload.baseUrl = form.baseUrl.trim() || null;
        } else {
          payload.hostKey = { policy: form.hostKeyPolicy };
          payload.onepanel = { url: form.onepanelUrl.trim() || null };
        }
        if (form.auth === "key" && form.privateKeyPath.trim()) payload.privateKeyPath = form.privateKeyPath.trim();
        if (form.password.trim()) payload.password = form.password.trim();
        if (form.passphrase.trim()) payload.passphrase = form.passphrase.trim();
        if (form.sudoPassword.trim()) payload.sudoPassword = form.sudoPassword.trim();
        await onSubmit(payload, mode === "edit" ? server.id : undefined);
      };

      const isWeb = form.transport !== "ssh";
      const portPlaceholder = isWeb ? WEB_DEFAULT_PORTS[form.transport] : "22";
      const usernamePlaceholder = isWeb ? "admin" : "root";

      const field = (label, control, hint) =>
        h(
          "label",
          { className: "smx-field" },
          h("span", null, label),
          control,
          hint ? h("small", null, hint) : null,
        );

      return h(
        "form",
        { className: "smx-form", onSubmit: submit },
        h(
          "div",
          { className: "smx-form-grid" },
          field(t("form.name"), h("input", { value: form.name, onChange: set("name"), placeholder: "prod-1", autoFocus: true })),
          field(t("form.id"), h("input", { value: form.id, onChange: set("id"), placeholder: "prod-1", disabled: mode === "edit" }), t("form.idHint")),
          field(
            t("form.transport"),
            h(
              "select",
              { value: form.transport, onChange: setTransport },
              h("option", { value: "ssh" }, t("form.transportSsh")),
              h("option", { value: "qnap" }, t("form.transportQnap")),
              h("option", { value: "synology" }, t("form.transportSynology")),
              h("option", { value: "fnos" }, t("form.transportFnos")),
            ),
          ),
          field(t("form.host"), h("input", { value: form.host, onChange: set("host"), placeholder: "192.0.2.10" })),
          field(t("form.port"), h("input", { value: form.port, onChange: set("port"), inputMode: "numeric", placeholder: portPlaceholder })),
          field(t("form.username"), h("input", { value: form.username, onChange: set("username"), placeholder: usernamePlaceholder })),
          isWeb
            ? field(t("form.baseUrl"), h("input", { value: form.baseUrl, onChange: set("baseUrl"), placeholder: form.transport === "synology" ? "https://203.0.113.26:5001" : form.transport === "fnos" ? "http://203.0.113.69:5666" : "http://203.0.113.28:88" }), t("form.baseUrlHint"))
            : field(
                t("form.auth"),
                h(
                  "select",
                  { value: form.auth, onChange: set("auth") },
                  h("option", { value: "password" }, t("form.authPassword")),
                  h("option", { value: "key" }, t("form.authKey")),
                  h("option", { value: "agent" }, t("form.authAgent")),
                ),
              ),
        ),
        isWeb
          ? h(
              "div",
              { className: "smx-form-grid" },
              field(t("form.password"), h("input", { type: "password", value: form.password, onChange: set("password"), autoComplete: "new-password", placeholder: "NAS admin password" }), t("form.passwordHint")),
              field(t("form.group"), h("input", { value: form.group, onChange: set("group"), placeholder: "NAS" })),
              field(t("form.tags"), h("input", { value: form.tags, onChange: set("tags"), placeholder: form.transport === "synology" ? "synology, nas" : form.transport === "fnos" ? "fnos, nas" : "qnap, nas" }), t("form.tagsHint")),
            )
          : h(
              "div",
              { className: "smx-form-grid" },
              form.auth === "password"
                ? field(t("form.password"), h("input", { type: "password", value: form.password, onChange: set("password"), autoComplete: "new-password", placeholder: "env:PROD_PASSWORD" }), t("form.passwordHint"))
                : form.auth === "key"
                  ? field(t("form.key"), h("input", { value: form.privateKeyPath, onChange: set("privateKeyPath"), placeholder: "~/.ssh/id_ed25519" }), t("form.keyHint"))
                  : field(t("form.authAgent"), h("input", { value: form.privateKeyPath, onChange: set("privateKeyPath"), placeholder: "~/.ssh/id_ed25519" }), t("form.keyHint")),
              form.auth === "key"
                ? field(t("form.passphrase"), h("input", { type: "password", value: form.passphrase, onChange: set("passphrase"), autoComplete: "new-password", placeholder: "env:KEY_PASSPHRASE" }), t("form.passphraseHint"))
                : null,
              field(t("form.sudoPassword"), h("input", { type: "password", value: form.sudoPassword, onChange: set("sudoPassword"), autoComplete: "new-password", placeholder: "env:SUDO_PASSWORD" })),
              field(t("form.group"), h("input", { value: form.group, onChange: set("group"), placeholder: "prod" })),
              field(t("form.tags"), h("input", { value: form.tags, onChange: set("tags"), placeholder: "web, eu" }), t("form.tagsHint")),
              field(
                t("form.hostKeyPolicy"),
                h(
                  "select",
                  { value: form.hostKeyPolicy, onChange: set("hostKeyPolicy") },
                  h("option", { value: "accept-new" }, t("form.acceptNew")),
                  h("option", { value: "strict" }, t("form.strict")),
                  h("option", { value: "insecure" }, t("form.insecure")),
                ),
              ),
              field(t("form.onepanel"), h("input", { value: form.onepanelUrl, onChange: set("onepanelUrl"), placeholder: "http://203.0.113.33:33333/entrance" }), t("form.onepanelHint")),
            ),
        h("div", { className: "smx-form-grid is-wide" },
          field(t("form.notes"), h("textarea", { rows: 2, value: form.notes, onChange: set("notes") })),
        ),
        isWeb
          ? null
          : h(
              "div",
              null,
              h("h3", { className: "smx-form-section" }, t("form.policy")),
              h(
                "div",
                { className: "smx-form-checks" },
                h("label", { className: "smx-check" }, h("input", { type: "checkbox", checked: form.readOnly, onChange: set("readOnly") }), h("span", null, t("form.readOnly"))),
                h("label", { className: "smx-check" }, h("input", { type: "checkbox", checked: form.allowDangerous, onChange: set("allowDangerous") }), h("span", null, t("form.allowDangerous"))),
              ),
              h(
                "div",
                { className: "smx-form-grid" },
                field(t("form.allowCommands"), h("textarea", { rows: 3, value: form.allowCommands, onChange: set("allowCommands"), placeholder: "^systemctl status" })),
                field(t("form.denyCommands"), h("textarea", { rows: 3, value: form.denyCommands, onChange: set("denyCommands"), placeholder: "^rm -rf" })),
              ),
            ),
        error ? h("p", { className: "smx-form-error" }, error) : null,
        h("p", { className: "smx-form-hint" }, t("form.progress")),
        h(
          "div",
          { className: "smx-form-actions" },
          h(Button, { onClick: onClose, disabled: saving }, t("action.cancel")),
          h(Button, { variant: "accent", type: "submit", disabled: saving }, saving ? t("action.saving") : t("action.save")),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* docker board                                                       */
    /* ------------------------------------------------------------------ */

    const DOCKER_REFRESH_MS = 10000;

    function containerLabel(container) {
      if (container.health === "healthy") return `${t("docker.running")} · healthy`;
      if (container.health === "unhealthy") return `${t("docker.running")} · unhealthy`;
      if (container.state === "running") return t("docker.running");
      if (container.state === "paused") return t("docker.pause");
      return t("docker.stopped");
    }

    function DockerBoard({ server, notify }) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const [sudo, setSudo] = useState(false);
      const [busy, setBusy] = useState("");
      const [filter, setFilter] = useState("all");
      const [logsFor, setLogsFor] = useState(null);
      const [logs, setLogs] = useState(null);
      const [logsLoading, setLogsLoading] = useState(false);
      const aliveRef = useRef(true);
      const inFlightRef = useRef(false);

      const load = useCallback(
        async (silent, force = false) => {
          if (inFlightRef.current && !force) return;
          inFlightRef.current = true;
          if (!silent) setLoading(true);
          try {
            const response = await request(`/docker?id=${encodeURIComponent(server.id)}${silent ? "&refresh=1" : ""}`);
            if (!aliveRef.current) return;
            setData(response.data || null);
            setSudo(Boolean(response.sudo));
            setError("");
          } catch (cause) {
            if (aliveRef.current) setError(cause.message);
          } finally {
            inFlightRef.current = false;
            if (aliveRef.current) setLoading(false);
          }
        },
        [server.id],
      );

      useEffect(() => {
        aliveRef.current = true;
        setData(null);
        setFilter("all");
        void load(false);
        const timer = window.setInterval(() => {
          if (!document.hidden) void load(true);
        }, DOCKER_REFRESH_MS);
        return () => {
          aliveRef.current = false;
          window.clearInterval(timer);
        };
      }, [load]);

      const act = async (container, action) => {
        if (action === "stop" && !window.confirm(t("docker.confirmStop", { name: container.name }))) return;
        if (action === "restart" && !window.confirm(t("docker.confirmRestart", { name: container.name }))) return;
        if (action === "upgrade" && !window.confirm(t("docker.confirmUpgrade", { name: container.name }))) return;
        setBusy(`${container.name}:${action}`);
        notify(action === "upgrade" ? t("docker.upgrading", { name: container.name }) : t("docker.done", { action }), "ok");
        try {
          const response = await request("/docker", {
            method: "POST",
            body: { id: server.id, action, container: container.name },
          });
          if (!response.ok) throw new Error((response.stderr || "").trim() || `exit ${response.code}`);
          await load(true);
          notify(t("docker.done", { action }), "ok");
        } catch (cause) {
          notify(`${t("docker.actionFailed")}: ${cause.message}`, "bad");
        } finally {
          setBusy("");
        }
      };

      const openLogs = async (container) => {
        setLogsFor(container);
        setLogs(null);
        setLogsLoading(true);
        try {
          const response = await request("/docker", {
            method: "POST",
            body: { id: server.id, action: "logs", container: container.name, lines: 300 },
          });
          const lines = response.data?.logs ?? String(response.stdout || "").split(/\r?\n/);
          setLogs(lines);
        } catch (cause) {
          setLogs([`${t("docker.actionFailed")}: ${cause.message}`]);
        } finally {
          setLogsLoading(false);
        }
      };

      const containers = useMemo(() => {
        const list = Array.isArray(data?.containers) ? data.containers : [];
        if (filter === "running") return list.filter((item) => item.state === "running");
        if (filter === "stopped") return list.filter((item) => item.state !== "running");
        return list;
      }, [data, filter]);

      const running = (data?.containers ?? []).filter((item) => item.state === "running").length;
      const total = data?.containers?.length ?? 0;
      const stale = busy !== "";

      const onePanel = data?.onepanel;
      const panelUrl = server.onepanel?.url
        || (onePanel?.port ? `http://${server.host}:${onePanel.port}/` : null);

      const filters = [
        { key: "all", label: t("docker.filterAll"), count: total },
        { key: "running", label: t("docker.filterRunning"), count: running },
        { key: "stopped", label: t("docker.filterStopped"), count: total - running },
      ];

      const head = h(
        "div",
        { className: "smx-docker-head" },
        h(
          "div",
          { className: "smx-docker-title" },
          h("h3", null, h(IconBox, { size: 16 }), t("docker.title")),
          h("span", { className: "smx-docker-live" }, h("i", null), t("docker.realtime")),
        ),
        h(
          "div",
          { className: "smx-docker-meta" },
          data?.engine?.version ? h("span", { className: "smx-chip" }, t("docker.engine", { version: data.engine.version })) : null,
          h("span", { className: "smx-chip" }, `${running} / ${total} ${t("docker.running")}`),
          sudo ? h("span", { className: "smx-chip is-warn" }, "sudo") : null,
          h(
            Button,
            { className: "smx-icon-btn", title: t("docker.refresh"), onClick: () => load(true), disabled: loading },
            h(IconRefresh, { size: 14 }),
          ),
        ),
      );

      const panelStrip = onePanel?.installed
        ? h(
            "div",
            { className: "smx-onepanel" },
            h("span", { className: "smx-onepanel-logo" }, "1P"),
            h(
              "div",
              { className: "smx-onepanel-text" },
              h("b", null, t("docker.onePanelVersion", { version: onePanel.version || "—" })),
              h(
                "span",
                null,
                [
                  onePanel.port ? t("docker.onePanelPort", { port: onePanel.port }) : null,
                  onePanel.containers ? t("docker.onePanelApps", { count: onePanel.containers }) : null,
                ].filter(Boolean).join(" · ") || "—",
              ),
            ),
            panelUrl
              ? h("a", { className: "smx-btn", href: panelUrl, target: "_blank", rel: "noreferrer" }, t("docker.openPanel"))
              : h("span", { className: "smx-muted" }, t("docker.onePanelHint")),
          )
        : null;

      const body = loading && !data
        ? h("p", { className: "smx-muted" }, t("docker.loading"))
        : data?.engine?.available === false
          ? h("p", { className: "smx-warn-line" }, t("docker.noEngine", { error: data.warnings?.[0] || "docker not found" }))
          : h(
              "div",
              null,
              h(
                "div",
                { className: "smx-docker-filters" },
                filters.map((item) =>
                  h(
                    "button",
                    {
                      key: item.key,
                      type: "button",
                      className: `smx-filter ${filter === item.key ? "is-active" : ""}`,
                      onClick: () => setFilter(item.key),
                    },
                    item.label,
                    h("b", null, item.count),
                  ),
                ),
              ),
              containers.length === 0
                ? h("p", { className: "smx-muted" }, t("docker.noMatch"))
                : h(
                    "div",
                    { className: "smx-docker-table" },
                    h(
                      "div",
                      { className: "smx-docker-row is-head" },
                      h("span", null, t("docker.project")),
                      h("span", null, t("docker.title")),
                      h("span", null, t("docker.state")),
                      h("span", null, t("docker.cpu")),
                      h("span", null, t("docker.mem")),
                      h("span", null, t("docker.ports")),
                      h("span", null, t("docker.actions")),
                    ),
                    containers.map((container) => {
                      const key = `${container.name}:${container.state}`;
                      const containerBusy = busy.startsWith(`${container.name}:`);
                      const service = container.compose?.service;
                      const canUpgrade = Boolean(service);
                      const webUrl = container.webUrl || null;
                      const canOpen = Boolean(webUrl) && container.state === "running";
                      const webTitle = !webUrl
                        ? t("docker.noWebPort")
                        : container.state === "running"
                          ? (container.webUrls?.length > 1
                            ? container.webUrls.map(item => item.url).join("\n")
                            : t("docker.openHint", { url: webUrl }))
                          : t("docker.notRunning");
                      return h(
                        "div",
                        { className: `smx-docker-row ${container.state === "running" ? "is-on" : ""}`, key },
                        h(
                          "span",
                          { className: "smx-docker-project smx-mono", title: container.compose?.workingDir || "" },
                          container.compose?.project || (container.onepanel ? "1panel" : "—"),
                          container.onepanel ? h("i", { className: "smx-mini-tag" }, "1P") : null,
                        ),
                        h(
                          "span",
                          { className: "smx-docker-name" },
                          h("b", null, container.name),
                          h("small", { title: container.image }, container.image),
                        ),
                        h("span", { className: "smx-docker-state" }, h(StatusDot, { level: container.state === "running" ? (container.health === "unhealthy" ? "warn" : "ok") : "offline" }), containerLabel(container)),
                        h(
                          "span",
                          { className: "smx-docker-cpu" },
                          h("i", { style: { width: `${clamp(Number(container.stats?.cpuPercent) || 0, 0, 100)}%` } }),
                          h(
                            "small",
                            null,
                            container.stats?.cpuPercent === null || container.stats?.cpuPercent === undefined
                              ? "—"
                              : `${Number(container.stats.cpuPercent) < 1
                                ? Number(container.stats.cpuPercent).toFixed(2)
                                : Number(container.stats.cpuPercent).toFixed(1)}%`,
                          ),
                        ),
                        h("span", { className: "smx-docker-mem smx-mono" }, container.stats?.memoryUsage || "—"),
                        h("span", { className: "smx-docker-ports smx-mono", title: container.ports }, container.ports || "—"),
                        h(
                          "span",
                          { className: "smx-docker-actions" },
                          canOpen
                            ? h(
                                "a",
                                {
                                  className: "smx-docker-open",
                                  href: webUrl,
                                  target: "_blank",
                                  rel: "noopener noreferrer",
                                  title: webTitle,
                                  "aria-label": t("docker.open"),
                                },
                                "↗",
                              )
                            : h(
                                "button",
                                {
                                  type: "button",
                                  className: "smx-docker-open",
                                  disabled: true,
                                  title: webTitle,
                                },
                                "↗",
                              ),
                          container.state === "running"
                            ? h("button", { type: "button", title: t("docker.stop"), disabled: containerBusy, onClick: () => act(container, "stop") }, "■")
                            : null,
                          container.state === "paused"
                            ? h("button", { type: "button", title: t("docker.unpause"), disabled: containerBusy, onClick: () => act(container, "unpause") }, "▷")
                            : null,
                          container.state === "running"
                            ? h("button", { type: "button", title: t("docker.restart"), disabled: containerBusy, onClick: () => act(container, "restart") }, "↻")
                            : h("button", { type: "button", title: t("docker.start"), disabled: containerBusy, onClick: () => act(container, "start") }, "▶"),
                          h("button", { type: "button", title: t("docker.logs"), onClick: () => openLogs(container) }, "≡"),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "is-gold",
                              title: canUpgrade ? t("docker.upgrade") : t("docker.notCompose"),
                              disabled: containerBusy || !canUpgrade,
                              onClick: () => act(container, "upgrade"),
                            },
                            "↑",
                          ),
                        ),
                      );
                    }),
                  ),
                );

      return h(
        "section",
        { className: "smx-card smx-docker" },
        head,
        panelStrip,
        error ? h("p", { className: "smx-form-error" }, `${t("docker.failed")}: ${error}`) : null,
        body,
        logsFor
          ? h(
              Modal,
              { title: t("docker.logsTitle", { name: logsFor.name }), onClose: () => setLogsFor(null), wide: true },
              h(
                "pre",
                { className: "smx-docker-logs" },
                logsLoading ? t("docker.loading") : logs && logs.length > 0 ? logs.join("\n") : t("docker.noLogs"),
              ),
            )
          : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* proxmox ve board                                                   */
    /* ------------------------------------------------------------------ */

    const PVE_REFRESH_MS = 30000;

    function PveBoard({ server }) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [checking, setChecking] = useState(false);
      const [error, setError] = useState("");
      const [checkError, setCheckError] = useState("");
      const aliveRef = useRef(true);

      const load = useCallback(
        async (silent) => {
          if (!silent) setLoading(true);
          try {
            const response = await request(`/pve?id=${encodeURIComponent(server.id)}${silent ? "&refresh=1" : ""}`);
            if (!aliveRef.current) return;
            setData(response.data || null);
            setError("");
          } catch (cause) {
            if (aliveRef.current) setError(cause.message);
          } finally {
            if (aliveRef.current) setLoading(false);
          }
        },
        [server.id],
      );

      const checkUpdates = useCallback(async () => {
        if (checking) return;
        setChecking(true);
        setCheckError("");
        try {
          await request("/pve", {
            method: "POST",
            body: { id: server.id, action: "refresh-updates" },
          });
          await load(true);
        } catch (cause) {
          if (aliveRef.current) setCheckError(cause.message);
        } finally {
          if (aliveRef.current) setChecking(false);
        }
      }, [checking, load, server.id]);

      useEffect(() => {
        aliveRef.current = true;
        setData(null);
        void load(false);
        const timer = window.setInterval(() => {
          if (!document.hidden) void load(true);
        }, PVE_REFRESH_MS);
        return () => {
          aliveRef.current = false;
          window.clearInterval(timer);
        };
      }, [load]);

      // The endpoint also answers for ordinary Linux hosts; stay silent unless
      // this really is a Proxmox VE node.
      if (loading && !data) return null;
      if (!data?.installed) return null;

      const webUrl = data.webUrl || `https://${server.host}:${data.webPort || 8006}`;
      const guests = Array.isArray(data.guests) ? data.guests : [];

      return h(
        "section",
        { className: "smx-card smx-pve" },
        h(
          "div",
          { className: "smx-pve-head" },
          h(
            "div",
            { className: "smx-pve-title" },
            h("h3", null, h(IconServer, { size: 16 }), t("pve.title")),
            data.shortVersion ? h("span", { className: "smx-chip" }, t("pve.version", { version: data.shortVersion })) : null,
            h("span", { className: "smx-chip is-warn" }, t("pve.readonly")),
            data.updateCount > 0
              ? h("span", { className: "smx-chip is-warn" }, t("pve.updates", { count: data.updateCount }))
              : h("span", { className: "smx-chip is-good" }, t("pve.upToDate")),
          ),
          h(
            "div",
            { className: "smx-docker-meta" },
            h("span", { className: "smx-chip" }, t("pve.nodes", { count: data.nodeCount })),
            h("span", { className: "smx-chip" }, t("pve.vms", { count: data.guestCount })),
            h(
              Button,
              { className: "smx-icon-btn", title: t("pve.checkUpdates"), onClick: checkUpdates, disabled: checking || loading },
              checking ? h(IconClock, { size: 14 }) : h(IconRefresh, { size: 14 }),
            ),
            h(
              Button,
              { className: "smx-icon-btn", title: t("pve.refresh"), onClick: () => load(true), disabled: loading },
              h(IconRefresh, { size: 14 }),
            ),
            h("a", { className: "smx-btn is-accent", href: webUrl, target: "_blank", rel: "noreferrer" }, t("pve.open")),
          ),
        ),
        error ? h("p", { className: "smx-form-error" }, `${t("pve.failed")}: ${error}`) : null,
        checkError ? h("p", { className: "smx-form-error" }, `${t("pve.updateFailed")}: ${checkError}`) : null,
        h(
          "div",
          { className: "smx-pve-stats" },
          h("div", null, h("span", null, t("pve.running")), h("b", null, `${data.running} / ${data.guestCount}`)),
          h("div", null, h("span", null, t("pve.stopped")), h("b", null, String(data.stopped))),
          h("div", null, h("span", null, t("pve.cpu")), h("b", null, fmtPct(data.cpuPercent))),
          h(
            "div",
            null,
            h("span", null, t("pve.memory")),
            h("b", null, `${fmtMb(data.memoryUsedMb)} / ${fmtMb(data.memoryTotalMb)}`),
          ),
        ),
        h(
          "div",
          { className: "smx-pve-updates" },
          h(
            "div",
            { className: "smx-pve-updates-head" },
            h("b", null, t("pve.updatesTitle")),
            h("small", { className: "smx-muted" }, t("pve.checkedAt", { time: timeAgo(data.updatesCheckedAt || data.fetchedAt) })),
          ),
          data.updates?.length
            ? h(
                "div",
                { className: "smx-pve-update-list" },
                data.updates.slice(0, 8).map((item) =>
                  h(
                    "div",
                    { className: "smx-pve-update-row", key: `${item.node}/${item.package}` },
                    h(
                      "span",
                      { className: "smx-pve-update-pkg" },
                      h("b", null, item.package),
                      item.security ? h("i", { className: "smx-mini-tag is-warn" }, t("pve.security")) : null,
                    ),
                    h("span", { className: "smx-mono" }, `${item.currentVersion || "—"} → ${item.candidateVersion || "—"}`),
                    h("span", { className: "smx-muted" }, item.node || "—"),
                  ),
                ),
                data.updates.length > 8
                  ? h("p", { className: "smx-muted" }, `+${data.updates.length - 8}`)
                  : null,
              )
            : h("p", { className: "smx-ok" }, t("pve.noUpdates")),
          h("p", { className: "smx-hint-line" }, t("pve.updatesHint")),
        ),
        guests.length === 0
          ? h("p", { className: "smx-muted" }, t("pve.noGuests"))
          : h(
              "div",
              { className: "smx-pve-table" },
              h(
                "div",
                { className: "smx-pve-row is-head" },
                h("span", null, t("pve.vmid")),
                h("span", null, t("pve.name")),
                h("span", null, t("pve.type")),
                h("span", null, t("pve.state")),
                h("span", null, t("pve.cpu")),
                h("span", null, t("pve.memory")),
                h("span", null, t("pve.disk")),
                h("span", null, t("pve.uptime")),
              ),
              guests.map((guest) =>
                h(
                  "div",
                  { className: `smx-pve-row ${guest.status === "running" ? "is-on" : ""}`, key: guest.vmid },
                  h("span", { className: "smx-mono" }, guest.vmid),
                  h(
                    "span",
                    { className: "smx-pve-guest" },
                    h("b", null, guest.name || `guest-${guest.vmid}`),
                    guest.template ? h("i", { className: "smx-mini-tag" }, t("pve.template") || "template") : null,
                  ),
                  h("span", null, h("i", { className: "smx-mini-tag" }, guest.type === "lxc" ? t("pve.typeLxc") : t("pve.typeQemu"))),
                  h(
                    "span",
                    { className: "smx-pve-state" },
                    h(StatusDot, { level: guest.status === "running" ? "ok" : "offline" }),
                    guest.status === "running" ? t("pve.running") : t("pve.stopped"),
                  ),
                  h("span", { className: "smx-mono" }, `${guest.cpuPercent}%`),
                  h("span", { className: "smx-mono" }, `${fmtMb(guest.memoryUsedMb)} / ${fmtMb(guest.memoryTotalMb)}`),
                  h("span", { className: "smx-mono" }, fmtGb(guest.diskTotalGb)),
                  h("span", { className: "smx-mono" }, guest.status === "running" ? fmtUptime(guest.uptimeSeconds) : "—"),
                ),
              ),
            ),
        data.storage?.length
          ? h(
              "div",
              { className: "smx-pve-storage" },
              h("span", { className: "smx-pve-storage-label" }, t("pve.storage")),
              data.storage.map((store) =>
                h(
                  "span",
                  { className: "smx-pve-store", title: `${store.type} · ${store.content}`, key: `${store.node}/${store.name}` },
                  h("b", null, store.name),
                  h("small", null, t("pve.storageLine", { used: fmtGb(store.usedGb), total: fmtGb(store.totalGb), percent: store.percent })),
                ),
              ),
            )
          : null,
        h("p", { className: "smx-hint-line" }, t("pve.hint")),
      );
    }

    /* ------------------------------------------------------------------ */
    /* 1panel app store board                                             */
    /* ------------------------------------------------------------------ */

    const ONEPANEL_REFRESH_MS = 60000;

    function OnePanelAppsBoard({ server }) {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const aliveRef = useRef(true);

      const load = useCallback(
        async (silent) => {
          if (!silent) setLoading(true);
          try {
            const response = await request(`/onepanel?id=${encodeURIComponent(server.id)}${silent ? "&refresh=1" : ""}`);
            if (!aliveRef.current) return;
            setData(response.data || null);
            setError("");
          } catch (cause) {
            if (aliveRef.current) setError(cause.message);
          } finally {
            if (aliveRef.current) setLoading(false);
          }
        },
        [server.id],
      );

      useEffect(() => {
        aliveRef.current = true;
        setData(null);
        void load(false);
        const timer = window.setInterval(() => {
          if (!document.hidden) void load(true);
        }, ONEPANEL_REFRESH_MS);
        return () => {
          aliveRef.current = false;
          window.clearInterval(timer);
        };
      }, [load]);

      if (loading && !data) return null;
      if (!data?.installed) return null;

      const apps = Array.isArray(data.apps) ? data.apps : [];
      const portal = server.onepanel?.url || (data.port ? `http://${server.host}:${data.port}` : "");

      return h(
        "section",
        { className: "smx-card smx-apps-card" },
        h(
          "div",
          { className: "smx-onepanel-head" },
          h(
            "div",
            { className: "smx-onepanel-title" },
            h("h3", null, h(IconBox, { size: 16 }), t("onepanel.title")),
            data.version ? h("span", { className: "smx-chip" }, data.version) : null,
            h("span", { className: "smx-chip" }, t("onepanel.apps", { count: data.appCount })),
            data.updateCount > 0
              ? h("span", { className: "smx-chip is-warn" }, t("onepanel.updates", { count: data.updateCount }))
              : h("span", { className: "smx-chip is-good" }, t("onepanel.latest")),
            h("span", { className: "smx-chip" }, t("onepanel.running", { count: data.runningCount })),
          ),
          h(
            "div",
            { className: "smx-docker-meta" },
            h(
              Button,
              { className: "smx-icon-btn", title: t("onepanel.refresh"), onClick: () => load(true), disabled: loading },
              h(IconRefresh, { size: 14 }),
            ),
            portal
              ? h("a", { className: "smx-btn is-accent", href: portal, target: "_blank", rel: "noreferrer" }, t("onepanel.open"))
              : null,
          ),
        ),
        error ? h("p", { className: "smx-form-error" }, `${t("onepanel.failed")}: ${error}`) : null,
        data.error
          ? h("p", { className: "smx-form-error" }, t("onepanel.error", { error: data.error }))
          : null,
        h(
          "div",
          { className: "smx-onepanel-stats" },
          h("div", null, h("span", null, t("onepanel.statsApps")), h("b", null, String(data.appCount))),
          h("div", null, h("span", null, t("onepanel.statsUpdates")), h("b", null, String(data.updateCount))),
          h("div", null, h("span", null, t("onepanel.statsRunning")), h("b", null, String(data.runningCount))),
          h("div", null, h("span", null, t("onepanel.statsChecked")), h("b", null, timeAgo(data.checkedAt))),
        ),
        apps.length === 0
          ? h("p", { className: "smx-muted" }, t("onepanel.noUpdates"))
          : h(
              "div",
              { className: "smx-onepanel-table" },
              h(
                "div",
                { className: "smx-onepanel-row is-head" },
                h("span", null, t("onepanel.app")),
                h("span", null, t("onepanel.current")),
                h("span", null, t("onepanel.candidate")),
                h("span", null, t("onepanel.status")),
                h("span", null, t("onepanel.container")),
              ),
              apps.map((app) =>
                h(
                  "div",
                  { className: `smx-onepanel-row ${app.updateAvailable ? "is-update" : ""}`, key: app.id ?? `${app.key}/${app.name}` },
                  h(
                    "span",
                    { className: "smx-onepanel-app" },
                    h("b", null, app.name),
                    app.updateAvailable ? h("i", { className: "smx-mini-tag is-warn" }, t("onepanel.updateAvailable")) : null,
                  ),
                  h("span", { className: "smx-mono" }, app.version || "—"),
                  h("span", { className: `smx-onepanel-latest ${app.updateAvailable ? "is-update" : ""}` }, app.latestVersion || "—"),
                  h(
                    "span",
                    { className: "smx-pve-state" },
                    h(StatusDot, { level: app.status.toLowerCase() === "running" ? "ok" : "offline" }),
                    app.status.toLowerCase() === "running" ? t("pve.running") : app.status.toLowerCase() === "stopped" ? t("pve.stopped") : (app.status || "—"),
                  ),
                  h("span", { className: "smx-mono smx-ellipsis", title: app.container }, app.container || "—"),
                ),
              ),
            ),
        h("p", { className: "smx-hint-line" }, t("onepanel.hint")),
      );
    }

    /* ------------------------------------------------------------------ */
    /* server detail                                                      */
    /* ------------------------------------------------------------------ */

    function ServerDetail({ server, busy, onProbe, onTest, onForget, onEdit, onDelete, notify }) {
      const status = server.status;
      const level = levelOf(server);
      const transportName = server.transport || "ssh";
      const isSsh = transportName === "ssh";
      const transportLabel = isSsh
        ? t("detail.transportSsh")
        : t(`detail.transport${WEB_NAME[transportName] || "Qnap"}`);
      const openLabel = transportName === "synology"
        ? t("detail.openDsm")
        : transportName === "fnos"
          ? t("detail.openFnos")
          : t("detail.openQts");
      const [command, setCommand] = useState("");
      const [running, setRunning] = useState(false);
      const [result, setResult] = useState(null);
      const [error, setError] = useState("");
      const [diskIndex, setDiskIndex] = useState(0);

      const run = async () => {
        if (!command.trim() || running) return;
        setRunning(true);
        setError("");
        setResult(null);
        try {
          const response = await request("/exec", { method: "POST", body: { server: server.id, command } });
          setResult(response);
        } catch (cause) {
          setError(cause.message);
        } finally {
          setRunning(false);
        }
      };

      const disks = Array.isArray(status?.disks) ? status.disks : [];
      const selectedDisk = disks.length === 0
        ? null
        : disks[Math.min(diskIndex, disks.length - 1)];
      const disk = selectedDisk?.percent ?? null;
      const memory = status?.memory;
      const load = status?.load;
      const channels = server.policy?.readOnly ? t("detail.readOnly") : t("detail.unrestricted");

      const header = h(
        "div",
        { className: "smx-detail-head" },
        h(
          "div",
          { className: "smx-detail-id" },
          h(StatusDot, { level }),
          h(
            "div",
            null,
            h("h2", null, server.name || server.id),
            h("p", { className: "smx-mono" }, `${server.username}@${server.host}:${server.port}`),
          ),
        ),
        h(
          "div",
          { className: "smx-detail-actions" },
          h(Button, { onClick: () => onProbe(server), disabled: Boolean(busy) }, busy ? t("action.probing") : t("action.probe")),
          h(Button, { onClick: () => onTest(server), disabled: Boolean(busy) }, t("action.test")),
          h(Button, { onClick: () => onEdit(server) }, t("action.edit")),
          h(Button, { variant: "danger", onClick: () => onDelete(server) }, t("action.delete")),
        ),
      );

      const chips = h(
        "div",
        { className: "smx-chips" },
        h("span", { className: "smx-chip" }, server.group || t("group.default")),
        h("span", { className: "smx-chip" }, transportLabel),
        h("span", { className: "smx-chip" }, server.auth === "password" ? t("form.authPassword") : server.auth === "key" ? t("form.authKey") : t("form.authAgent")),
        h("span", { className: `smx-chip is-${level}` }, levelText(level)),
        h("span", { className: "smx-chip" }, `${t("detail.target")} ${server.port}`),
        h("span", { className: "smx-chip" }, channels),
        server.hostKey?.fingerprint
          ? h("span", { className: "smx-chip is-mono", title: server.hostKey.fingerprint }, `${t("detail.hostKey")} ${server.hostKey.trusted ? t("detail.trusted") : t("detail.untrusted")}`)
          : null,
      );

      if (!status) {
        return h(
          "section",
          { className: "smx-card smx-detail" },
          header,
          chips,
          h("p", { className: "smx-muted" }, t("detail.noStatus")),
        );
      }

      if (status.reachable === false) {
        return h(
          "section",
          { className: "smx-card smx-detail" },
          header,
          chips,
          h(
            "div",
            { className: "smx-offline" },
            h("b", null, t("detail.offline")),
            h("p", { className: "smx-mono" }, status.error || "unknown error"),
            h(Button, { onClick: () => onProbe(server), variant: "accent" }, t("action.retry")),
          ),
        );
      }

      const uptime = fmtUptime(status.uptimeSeconds);
      const docker = status.docker;
      const processes = Array.isArray(status.processes) ? status.processes.slice(0, 7) : [];
      const warnings = Array.isArray(status.warnings) ? status.warnings : [];
      const failedUnits = status.systemd?.failed ?? [];

      return h(
        "section",
        { className: "smx-card smx-detail" },
        header,
        chips,
        h(
          "div",
          { className: "smx-detail-strip" },
          h("div", null, h("span", null, t("detail.uptime")), h("b", null, uptime)),
          h("div", null, h("span", null, t("detail.latency", { ms: "" }) || "Latency"), h("b", null, fmtMs(status.latencyMs))),
          h("div", null, h("span", null, t("detail.hostname")), h("b", null, status.system?.hostname || "—")),
          h("div", null, h("span", null, t("detail.system")), h("b", { title: status.system?.os }, (status.system?.os || "—").replace(/^Ubuntu /, "Ubuntu "))),
          h("div", null, h("span", null, t("detail.load")), h("b", null, load ? (isSsh ? `${load.percent}% · ${(load.average?.[0] ?? 0).toFixed(2)}` : `${load.percent}%`) : "—")),
        ),
        h(
          "div",
          { className: "smx-detail-grid" },
          h(
            "div",
            { className: "smx-block" },
            h("h3", null, t("detail.memory")),
            h(Meter, {
              label: memory ? `${fmtMb(memory.usedMb)} / ${fmtMb(memory.totalMb)}` : t("detail.memory"),
              percent: memory?.percent ?? null,
              detail: memory ? `swap ${fmtPct(memory.swapPercent)}` : null,
            }),
            disks.length > 1
              ? h(
                  "div",
                  { className: "smx-disk-chips", role: "tablist", "aria-label": t("detail.disk") },
                  disks.map((entry, index) =>
                    h(
                      "button",
                      {
                        type: "button",
                        role: "tab",
                        key: `${entry.mount}-${index}`,
                        className: `smx-disk-chip ${index === Math.min(diskIndex, disks.length - 1) ? "is-active" : ""}`,
                        "aria-selected": index === Math.min(diskIndex, disks.length - 1),
                        onClick: () => setDiskIndex(index),
                        title: `${fmtGb(entry.usedGb)} / ${fmtGb(entry.totalGb)}`,
                      },
                      entry.mount || `${t("detail.disk")} ${index + 1}`,
                    ),
                  ),
                )
              : null,
            h(Meter, {
              label: `${t("detail.disk")} ${selectedDisk?.mount || ""}`,
              percent: disk,
              detail: selectedDisk ? `${fmtGb(selectedDisk.usedGb)} / ${fmtGb(selectedDisk.totalGb)}` : null,
            }),
          ),
          h(
            "div",
            { className: "smx-block" },
            h("h3", null, t("detail.systemInfo")),
            h(
              "dl",
              { className: "smx-kv" },
              h("dt", null, t("detail.kernel")),
              h("dd", { className: "smx-mono" }, status.system?.kernel || "—"),
              h("dt", null, t("detail.arch")),
              h("dd", null, status.system?.arch || "—"),
              h("dt", null, t("detail.ip")),
              h("dd", { className: "smx-mono" }, status.system?.ip || "—"),
              h("dt", null, t("detail.timezone")),
              h("dd", null, status.system?.timezone || "—"),
            ),
          ),
          h(
            "div",
            { className: "smx-block" },
            h("h3", null, t("detail.warnings")),
            warnings.length === 0 && failedUnits.length === 0
              ? h("p", { className: "smx-ok" }, t("detail.noWarnings"))
              : h(
                  "ul",
                  { className: "smx-warn-list" },
                  warnings.map((warning, index) => h("li", { key: `w${index}` }, warning)),
                  failedUnits.map((unit) => h("li", { key: unit.unit }, `${t("detail.failedUnits")}: ${unit.unit}`)),
                ),
            status.rebootRequired ? h("p", { className: "smx-warn-line" }, t("detail.reboot")) : null,
          ),
        ),
        isSsh ? h(OnePanelAppsBoard, { server }) : null,
        isSsh ? h(PveBoard, { server }) : null,
        isSsh ? h(DockerBoard, { server, notify }) : null,
        isSsh
          ? null
          : h(
              "div",
              { className: "smx-block" },
              h("h3", null, transportLabel),
              h("p", { className: "smx-muted" }, t("detail.webReadOnly")),
              status.fnos?.note ? h("p", { className: "smx-muted" }, status.fnos.note) : null,
              h(
                "a",
                {
                  className: "smx-btn is-accent",
                  style: { textDecoration: "none", display: "inline-flex", alignItems: "center" },
                  href: server.baseUrl || `${server.port === 5001 ? "https" : "http"}://${server.host}:${server.port}`,
                  target: "_blank",
                  rel: "noopener noreferrer",
                },
                openLabel,
              ),
            ),
        status.fnos
          ? h(
              "div",
              { className: "smx-block" },
              h(
                "div",
                { className: "smx-fnos-head" },
                h("h3", null, t("detail.fnosStatus")),
                h(
                  "a",
                  {
                    className: "smx-btn is-accent",
                    style: { textDecoration: "none", display: "inline-flex", alignItems: "center" },
                    href: status.fnos.webUrl || server.baseUrl || `http://${server.host}:${server.port}`,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  t("detail.fnosUpdateLink"),
                ),
              ),
              h(
                "div",
                { className: "smx-fnos-meta" },
                h("span", null, `${t("detail.fnosVersion")}：`, h("b", null, status.fnos.version || "—")),
                h("span", null, `${t("detail.fnosLatest")}：`, h("b", null, status.fnos.latestVersion || "—")),
                h(
                  "span",
                  { className: status.fnos.updateAvailable ? "smx-mini-tag is-warn" : "smx-mini-tag is-good" },
                  status.fnos.updateAvailable ? t("detail.fnosUpdateAvailable") : t("detail.fnosUpToDate"),
                ),
                status.network
                  ? h(
                      "span",
                      null,
                      `${t("detail.fnosNetwork")} ↓ ${fmtRate(status.network.rxBytesPerSec)} ↑ ${fmtRate(status.network.txBytesPerSec)}`,
                    )
                  : null,
              ),
              status.fnos.updateAvailable
                ? h("p", { className: "smx-muted" }, t("detail.fnosUpdateHint"))
                : null,
              (status.fnos.apps || []).length === 0
                ? h("p", { className: "smx-muted" }, t("detail.fnosNoApps"))
                : h(
                    "div",
                    { className: "smx-fnos-apps" },
                    (status.fnos.apps || []).map((app, index) =>
                      h(
                        "div",
                        { className: "smx-fnos-app", key: `${app.key || app.name}-${index}` },
                        h("span", { className: "smx-ellipsis", title: app.name }, app.name),
                        h("span", null, app.status || "—"),
                        app.url
                          ? h(
                              "a",
                              { href: app.url, target: "_blank", rel: "noopener noreferrer" },
                              t("detail.fnosOpenApp"),
                            )
                          : h("span", { className: "smx-muted" }, "—"),
                      ),
                    ),
                  ),
            )
          : null,
        processes.length > 0
          ? h(
              "div",
              { className: "smx-block" },
              h("h3", null, t("detail.processes")),
              h(
                "div",
                { className: "smx-table" },
                h(
                  "div",
                  { className: "smx-tr is-head" },
                  h("span", null, "PID"),
                  h("span", null, "CPU"),
                  h("span", null, "MEM"),
                  h("span", null, "COMMAND"),
                ),
                processes.map((process) =>
                  h(
                    "div",
                    { className: "smx-tr", key: process.pid },
                    h("span", { className: "smx-mono" }, process.pid),
                    h("span", null, `${process.cpu}%`),
                    h("span", null, `${process.mem}%`),
                    h("span", { className: "smx-ellipsis smx-mono", title: process.command }, process.command),
                  ),
                ),
              ),
            )
          : null,
        isSsh ? h("div", null,
        h("p", { className: "smx-hint-line" }, t("detail.hostKey"), ": ",          h("code", { className: "smx-mono" }, server.hostKey?.fingerprint || "—"),
          h(Button, { className: "smx-inline-btn", onClick: () => onForget(server) }, t("action.forget")),
        ),
        h("p", { className: "smx-muted" }, t("detail.forgetHint")),
        h(
          "div",
          { className: "smx-console" },
          h("div", { className: "smx-console-head" }, h(IconTerminal, { size: 15 }), h("span", null, t("detail.console"))),
          h("textarea", {
            value: command,
            rows: 2,
            placeholder: t("detail.consolePlaceholder"),
            onChange: (event) => setCommand(event.target.value),
            onKeyDown: (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") run();
            },
          }),
          h(
            "div",
            { className: "smx-console-actions" },
            h("small", null, t("detail.runHint")),
            h(Button, { variant: "accent", onClick: run, disabled: running }, running ? t("action.running") : t("action.run")),
          ),
          error ? h("p", { className: "smx-form-error" }, error) : null,
          result
            ? h(
                "div",
                { className: "smx-output" },
                h(
                  "div",
                  { className: "smx-output-head" },
                  h("span", null, t("detail.exitCode", { code: result.code })),
                  h("span", null, t("detail.duration", { ms: result.durationMs })),
                  result.truncated ? h("span", { className: "is-warn" }, t("detail.truncated")) : null,
                ),
                h("pre", null, [result.stdout, result.stderr].filter(Boolean).join("\n") || t("detail.noOutput")),
              )
            : null,
        ),
        ) : null,
        h("p", { className: "smx-muted" }, t("detail.agentDeploy")),
      );
    }

    /* ------------------------------------------------------------------ */
    /* modals                                                            */
    /* ------------------------------------------------------------------ */

    function Modal({ title, children, onClose, wide }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [onClose]);
      return h(
        "div",
        { className: "smx-modal-backdrop", onClick: onClose, role: "presentation" },
        h(
          "div",
          { className: `smx-modal ${wide ? "is-wide" : ""}`, role: "dialog", "aria-modal": "true", onClick: (event) => event.stopPropagation() },
          h(
            "header",
            { className: "smx-modal-head" },
            h("h2", null, title),
            h("button", { type: "button", className: "smx-close", onClick: onClose, "aria-label": t("action.close") }, "×"),
          ),
          children,
        ),
      );
    }

    function SettingsModal({ snap, auto, setAuto, onClose, onAudit }) {
      const options = [0, 30, 60, 120];
      return h(
        Modal,
        { title: t("settings.title"), onClose },
        h(
          "div",
          { className: "smx-settings" },
          h("h3", null, t("settings.auto")),
          h(
            "div",
            { className: "smx-segmented" },
            options.map((value) =>
              h(
                "button",
                { key: value, type: "button", className: auto === value ? "is-on" : "", onClick: () => setAuto(value) },
                value === 0 ? t("settings.off") : `${value}s`,
              ),
            ),
          ),
          h(
            "dl",
            { className: "smx-kv" },
            h("dt", null, t("settings.version")),
            h("dd", { className: "smx-mono" }, snap?.version ? `v${snap.version}` : "—"),
            h("dt", null, t("settings.nodes")),
            h("dd", null, String(snap?.servers?.length ?? 0)),
            h("dt", null, t("settings.dataDir")),
            h("dd", { className: "smx-mono" }, snap?.dataDir || "—"),
            h("dt", null, t("settings.configFile")),
            h("dd", { className: "smx-mono" }, snap?.configFile || "—"),
          ),
          h("h3", null, t("settings.audit")),
          h("p", { className: "smx-muted" }, t("settings.auditHint")),
          h(Button, { onClick: onAudit }, t("action.audit")),
          h("h3", null, t("settings.docs")),
          h("p", { className: "smx-muted" }, t("settings.docsHint")),
          snap?.errors?.length
            ? h("div", { className: "smx-errors" }, snap.errors.map((message) => h("p", { key: message }, message)))
            : null,
        ),
      );
    }

    function AuditModal({ onClose }) {
      const [entries, setEntries] = useState(null);
      const [error, setError] = useState("");
      useEffect(() => {
        let alive = true;
        request("/audit?limit=80")
          .then((data) => {
            if (alive) setEntries(data.entries || []);
          })
          .catch((cause) => {
            if (alive) setError(cause.message);
          });
        return () => {
          alive = false;
        };
      }, []);
      return h(
        Modal,
        { title: t("audit.title"), onClose, wide: true },
        error ? h("p", { className: "smx-form-error" }, error) : null,
        entries === null
          ? h("p", { className: "smx-muted" }, t("action.refreshing"))
          : entries.length === 0
            ? h("p", { className: "smx-muted" }, t("audit.empty"))
            : h(
                "div",
                { className: "smx-table smx-audit" },
                h(
                  "div",
                  { className: "smx-tr is-head" },
                  h("span", null, t("audit.time")),
                  h("span", null, t("audit.action")),
                  h("span", null, t("audit.server")),
                  h("span", null, t("audit.ok")),
                ),
                entries.map((entry, index) =>
                  h(
                    "div",
                    { className: "smx-tr", key: index },
                    h("span", { className: "smx-mono" }, entry.at ? new Date(entry.at).toLocaleString() : "—"),
                    h("span", null, entry.action || entry.op || "—"),
                    h("span", { className: "smx-mono" }, entry.server || entry.target || "—"),
                    h("span", { className: entry.ok === false ? "smx-bad" : "smx-ok" }, entry.ok === false ? t("audit.no") : t("audit.yes")),
                  ),
                ),
              ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* dashboard                                                          */
    /* ------------------------------------------------------------------ */

    function Dashboard() {
      const [snap, setSnap] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const [probing, setProbing] = useState(false);
      const [busy, setBusy] = useState({});
      const [selected, setSelected] = useState(() => {
        const stored = readJson(SELECTED_KEY, null);
        return typeof stored === "string" ? stored : null;
      });
      const [auto, setAutoState] = useState(() => {
        const stored = readJson(AUTO_KEY, 60);
        return typeof stored === "number" ? stored : 60;
      });
      const [history, setHistory] = useState(() => {
        const stored = readJson(HISTORY_KEY, []);
        return Array.isArray(stored) ? stored.slice(-MAX_POINTS) : [];
      });
      const [editor, setEditor] = useState(null);
      const [saving, setSaving] = useState(false);
      const [confirming, setConfirming] = useState(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [auditOpen, setAuditOpen] = useState(false);
      const [toast, setToast] = useState(null);
      const [clock, setClock] = useState(() => new Date());
      const busyRef = useRef(false);
      const toastTimer = useRef(null);
      const lastPointRef = useRef(0);

      const notify = useCallback((message, tone) => {
        setToast({ message, tone: tone || "ok", id: Date.now() });
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 3600);
      }, []);

      useEffect(() => {
        const timer = window.setInterval(() => setClock(new Date()), 1000);
        return () => window.clearInterval(timer);
      }, []);

      const setAuto = useCallback((value) => {
        setAutoState(value);
        writeJson(AUTO_KEY, value);
      }, []);

      const applySnapshot = useCallback((next) => {
        setSnap(next);
        const servers = Array.isArray(next?.servers) ? next.servers : [];
        setSelected((prev) => (servers.some((server) => server.id === prev) ? prev : servers[0]?.id ?? null));
      }, []);

      const reload = useCallback(async () => {
        const next = await request("/servers");
        applySnapshot(next);
        return next;
      }, [applySnapshot]);

      useEffect(() => {
        let alive = true;
        request("/servers")
          .then((next) => {
            if (alive) {
              applySnapshot(next);
              setError("");
            }
          })
          .catch((cause) => {
            if (alive) setError(cause.message);
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
        return () => {
          alive = false;
        };
      }, [applySnapshot]);

      useEffect(() => {
        if (selected) writeJson(SELECTED_KEY, selected);
      }, [selected]);

      const probeAll = useCallback(
        async (silent) => {
          if (busyRef.current) return;
          busyRef.current = true;
          setProbing(true);
          try {
            await request("/probe", { method: "POST", body: {} });
            await reload();
            if (!silent) notify(t("toast.probed"));
          } catch (cause) {
            notify(`${t("toast.probeFailed")}: ${cause.message}`, "bad");
          } finally {
            busyRef.current = false;
            setProbing(false);
          }
        },
        [notify, reload],
      );

      useEffect(() => {
        if (!auto) return undefined;
        const timer = window.setInterval(() => {
          void probeAll(true);
        }, auto * 1000);
        return () => window.clearInterval(timer);
      }, [auto, probeAll]);

      const probeOne = useCallback(
        async (server) => {
          setBusy((prev) => ({ ...prev, [server.id]: true }));
          try {
            await request("/probe", { method: "POST", body: { id: server.id } });
            await reload();
          } catch (cause) {
            notify(`${t("toast.probeFailed")}: ${cause.message}`, "bad");
          } finally {
            setBusy((prev) => {
              const next = { ...prev };
              delete next[server.id];
              return next;
            });
          }
        },
        [notify, reload],
      );

      const testServer = useCallback(
        async (server) => {
          setBusy((prev) => ({ ...prev, [server.id]: true }));
          try {
            const result = await request("/servers", { method: "POST", body: { action: "test", ref: server.id } });
            if (result.ok) notify(t("toast.tested", { ms: result.latencyMs }), "ok");
            else notify(`${t("toast.testFailed")}${result.error ? `: ${result.error}` : ""}`, "bad");
          } catch (cause) {
            notify(`${t("toast.testFailed")}: ${cause.message}`, "bad");
          } finally {
            setBusy((prev) => {
              const next = { ...prev };
              delete next[server.id];
              return next;
            });
          }
        },
        [notify],
      );

      const saveServer = useCallback(
        async (payload, ref) => {
          setSaving(true);
          try {
            const body = ref ? { action: "save", ref, server: payload } : { action: "save", server: payload };
            const next = await request("/servers", { method: "POST", body });
            applySnapshot(next);
            setSelected(payload.id);
            setEditor(null);
            notify(t("toast.saved"));
          } catch (cause) {
            notify(`${t("toast.saveFailed")}: ${cause.message}`, "bad");
          } finally {
            setSaving(false);
          }
        },
        [applySnapshot, notify],
      );

      const removeServer = useCallback(async () => {
        if (!confirming) return;
        const target = confirming;
        setConfirming(null);
        try {
          const next = await request("/servers", { method: "POST", body: { action: "delete", ref: target.id } });
          applySnapshot(next);
          notify(t("toast.deleted"));
        } catch (cause) {
          notify(`${t("toast.deleteFailed")}: ${cause.message}`, "bad");
        }
      }, [applySnapshot, confirming, notify]);

      const forgetKey = useCallback(
        async (server) => {
          try {
            await request("/servers", { method: "POST", body: { action: "forget-host-key", ref: server.id } });
            notify(t("toast.forgot"));
            await reload();
          } catch (cause) {
            notify(`${t("toast.forgetFailed")}: ${cause.message}`, "bad");
          }
        },
        [notify, reload],
      );

      const servers = useMemo(() => sortServers(snap?.servers ?? []), [snap]);
      const agg = useMemo(() => aggregate(servers), [servers]);
      const selectedServer = useMemo(() => servers.find((server) => server.id === selected) ?? null, [servers, selected]);

      useEffect(() => {
        if (!snap || agg.total === 0) return;
        const now = Date.now();
        if (now - lastPointRef.current < 5000) return;
        lastPointRef.current = now;
        const point = {
          ts: now,
          cpu: agg.cpu,
          mem: agg.mem,
          disk: agg.disk,
          latency: agg.latency,
          online: agg.online,
          total: agg.total,
        };
        setHistory((prev) => {
          const next = [...prev, point].slice(-MAX_POINTS);
          writeJson(HISTORY_KEY, next);
          return next;
        });
      }, [agg, snap]);

      const groups = useMemo(() => {
        const map = new Map();
        for (const server of servers) {
          const key = server.group || "";
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(server);
        }
        return [...map.entries()];
      }, [servers]);

      const stats = [
        { key: "servers", value: agg.total, icon: IconServer, tone: "blue" },
        { key: "online", value: agg.online, icon: IconCheck, tone: "green" },
        { key: "offline", value: agg.offline, icon: IconAlert, tone: "red" },
        { key: "unchecked", value: agg.unchecked, icon: IconClock, tone: "gold" },
      ];

      const autoSeconds = auto;
      const lastPoint = history[history.length - 1];

      return h(
        "div",
        { className: "smx", "data-server-manager": "" },
        h("div", { className: "smx-inner" },
          h(
            "header",
            { className: "smx-top" },
            h(
              "div",
              { className: "smx-brand" },
              h("div", { className: "smx-logo" }, h(LogoMark, { size: 40 })),
              h(
                "div",
                { className: "smx-brand-text" },
                h("div", { className: "smx-eyebrow" }, t("deck.eyebrow")),
                h(
                  "h1",
                  null,
                  t("panel.title"),
                  h("span", { className: "smx-title-sub" }, `/ ${servers.length} ${t("deck.nodes")}`),
                  snap?.version
                    ? h("span", { className: "smx-version", title: t("settings.version") }, `v${snap.version}`)
                    : null,
                ),
                h("p", null, t("deck.desc")),
              ),
            ),
            h(
              "div",
              { className: "smx-top-right" },
              h(
                "div",
                { className: "smx-clock" },
                h(LiveChip, { live: auto > 0 }),
                h("span", null, clockText(clock)),
              ),
              h(
                "div",
                { className: "smx-top-actions" },
                h(Button, { variant: "accent", onClick: () => setEditor({ mode: "add", server: null }) }, h(IconPlus, { size: 15 }), t("action.add")),
                h(Button, { onClick: () => probeAll(false), disabled: probing }, h(IconRefresh, { size: 15 }), probing ? t("action.refreshing") : t("action.refresh")),
                h(Button, { className: "smx-icon-btn", onClick: () => setSettingsOpen(true), "aria-label": t("action.settings") }, h(IconGear, { size: 17 })),
              ),
            ),
          ),
          error
            ? h(
                "div",
                { className: "smx-banner" },
                h("div", null, h("b", null, t("toast.loadFailed")), h("span", { className: "smx-mono" }, ` ${error}`)),
                h(Button, { onClick: () => reload().then(() => setError("")).catch((cause) => setError(cause.message)) }, t("action.retry")),
              )
            : null,
          loading
            ? h("div", { className: "smx-loading" }, t("action.refreshing"))
            : h(
                "div",
                { className: "smx-layout" },
                h(
                  "aside",
                  { className: "smx-rail" },
                  h(
                    "div",
                    { className: "smx-rail-head" },
                    h("span", null, t("rail.title")),
                    h("b", null, agg.total),
                  ),
                  servers.length === 0
                    ? h(
                        "div",
                        { className: "smx-rail-empty" },
                        h("p", null, t("rail.empty")),
                        h(Button, { variant: "accent", onClick: () => setEditor({ mode: "add", server: null }) }, t("rail.add")),
                      )
                    : groups.map(([group, list]) =>
                        h(
                          "div",
                          { className: "smx-rail-group", key: group || "default" },
                          h("div", { className: "smx-rail-label" }, (group || t("rail.default")).toUpperCase(), h("span", null, list.length)),
                          list.map((server) =>
                            h(
                              "div",
                              {
                                key: server.id,
                                className: `smx-node ${selected === server.id ? "is-active" : ""}`,
                                role: "button",
                                tabIndex: 0,
                                onClick: () => setSelected(server.id),
                                onKeyDown: (event) => {
                                  if (event.key === "Enter" || event.key === " ") setSelected(server.id);
                                },
                              },
                              h(StatusDot, { level: levelOf(server) }),
                              h(
                                "div",
                                { className: "smx-node-text" },
                                h("b", null, server.name || server.id),
                                h("span", { className: "smx-mono" }, server.host),
                              ),
                              h(
                                "button",
                                {
                                  type: "button",
                                  className: "smx-node-refresh",
                                  title: t("action.probe"),
                                  onClick: (event) => {
                                    event.stopPropagation();
                                    void probeOne(server);
                                  },
                                },
                                h(IconRefresh, { size: 13 }),
                              ),
                            ),
                          ),
                        ),
                      ),
                  h(
                    "div",
                    { className: "smx-rail-hint" },
                    h(IconShield, { size: 16 }),
                    h("div", null, h("b", null, t("rail.hintTitle")), h("p", null, t("rail.agentHint"))),
                  ),
                ),
                h(
                  "main",
                  { className: "smx-main" },
                  h(
                    "div",
                    { className: "smx-stats" },
                    stats.map((stat) =>
                      h(
                        "div",
                        { className: `smx-stat tone-${stat.tone}`, key: stat.key },
                        h("div", { className: "smx-stat-icon" }, h(stat.icon, { size: 18 })),
                        h("div", null, h("b", null, stat.value), h("span", null, t(`stats.${stat.key}`))),
                      ),
                    ),
                  ),
                  agg.total === 0
                    ? h(
                        "div",
                        { className: "smx-card smx-empty" },
                        h("div", { className: "smx-empty-mark" }, h(IconServer, { size: 34 })),
                        h("h2", null, t("empty.title")),
                        h("p", null, t("empty.desc")),
                        h(Button, { variant: "accent", onClick: () => setEditor({ mode: "add", server: null }) }, t("empty.cta")),
                      )
                    : h(
                        "div",
                        { className: "smx-board" },
                        h(
                          Panel,
                          { index: "01", title: t("pulse.title"), right: h(LiveChip, { live: auto > 0 }), className: "smx-pulse" },
                          h("h3", { className: "smx-big" }, t("pulse.headline", { online: agg.online, total: agg.total })),
                          h("p", { className: "smx-sub" }, t("pulse.sub")),
                          h(
                            "div",
                            { className: "smx-pulse-live" },
                            h("div", { className: "smx-pulse-label" }, h("span", null, t("pulse.liveLabel")), h("em", null, `${agg.online} / ${agg.total}`)),
                            h(LatencyBars, { points: history }),
                          ),
                          h(
                            "div",
                            { className: "smx-pulse-foot" },
                            h("div", null, h("span", null, t("pulse.rate")), h("b", null, fmtPct(agg.total ? (agg.online / agg.total) * 100 : null))),
                            h("div", null, h("span", null, t("pulse.latency")), h("b", null, fmtMs(agg.latency))),
                            h("div", null, h("span", null, t("pulse.samples")), h("b", null, history.length)),
                            h("div", null, h("span", null, t("pulse.last")), h("b", null, lastPoint ? timeAgo(new Date(lastPoint.ts).toISOString()) : t("pulse.never"))),
                          ),
                        ),
                        h(
                          Panel,
                          { index: "02", title: t("health.title"), right: h("span", { className: "smx-tag" }, t("pulse.live")), className: "smx-health" },
                          h("p", { className: "smx-sub" }, t("health.sub")),
                          h(
                            "div",
                            { className: "smx-health-body" },
                            h(Donut, {
                              total: agg.total,
                              segments: [
                                { value: agg.online, color: "#3ddc97" },
                                { value: agg.offline, color: "#ff6b81" },
                                { value: agg.unchecked, color: "#6d7280" },
                              ],
                            }),
                            h(
                              "ul",
                              { className: "smx-legend" },
                              h("li", null, h("i", { className: "is-on" }), t("status.online"), h("b", null, agg.online)),
                              h("li", null, h("i", { className: "is-off" }), t("status.offline"), h("b", null, agg.offline)),
                              h("li", null, h("i", { className: "is-idle" }), t("status.unchecked"), h("b", null, agg.unchecked)),
                              h("li", null, h("i", { className: "is-warn" }), t("status.attention"), h("b", null, agg.attention)),
                            ),
                          ),
                        ),
                        h(
                          Panel,
                          { index: "03", title: t("capacity.title"), right: h("span", { className: "smx-tag" }, t("pulse.live")), className: "smx-capacity" },
                          h("p", { className: "smx-sub" }, t("capacity.sub")),
                          h(TrendChart, { points: history }),
                          h(
                            "div",
                            { className: "smx-legend is-row" },
                            h("span", null, h("i", { className: "is-cpu" }), t("capacity.cpu")),
                            h("span", null, h("i", { className: "is-mem" }), t("capacity.memory")),
                            h("span", null, h("i", { className: "is-disk" }), t("capacity.disk")),
                          ),
                          h("p", { className: "smx-note" }, lastPoint ? t("capacity.note", { sec: autoSeconds, n: MAX_POINTS }) : t("capacity.waiting")),
                        ),
                        h(
                          Panel,
                          { index: "04", title: t("waterline.title"), right: h("span", { className: "smx-tag" }, t("pulse.live")), className: "smx-waterline" },
                          h("p", { className: "smx-sub" }, t("waterline.sub")),
                          h(
                            "div",
                            { className: "smx-gauges" },
                            h(Gauge, { label: t("waterline.cpu"), value: agg.cpu }),
                            h(Gauge, { label: t("waterline.memory"), value: agg.mem }),
                            h(Gauge, { label: t("waterline.disk"), value: agg.disk }),
                          ),
                          h(
                            "div",
                            { className: "smx-waterline-foot" },
                            h("span", null, t("detail.docker"), h("b", null, agg.containers)),
                            h("span", null, t("detail.failedUnits"), h("b", null, agg.failedUnits)),
                          ),
                        ),
                      ),
                  selectedServer
                    ? h(ServerDetail, {
                        key: selectedServer.id,
                        server: selectedServer,
                        busy: busy[selectedServer.id],
                        onProbe: probeOne,
                        onTest: testServer,
                        onForget: forgetKey,
                        onEdit: (server) => setEditor({ mode: "edit", server }),
                        onDelete: (server) => setConfirming(server),
                        notify,
                      })
                    : servers.length > 0
                      ? h("p", { className: "smx-muted" }, t("detail.empty"))
                      : null,
                ),
              ),
        ),
        settingsOpen
          ? h(SettingsModal, {
              snap,
              auto,
              setAuto,
              onClose: () => setSettingsOpen(false),
              onAudit: () => {
                setSettingsOpen(false);
                setAuditOpen(true);
              },
            })
          : null,
        auditOpen ? h(AuditModal, { onClose: () => setAuditOpen(false) }) : null,
        editor
          ? h(
              Modal,
              { title: editor.mode === "edit" ? t("form.editTitle") : t("form.addTitle"), onClose: () => setEditor(null), wide: true },
              h(ServerForm, {
                mode: editor.mode,
                server: editor.server,
                saving,
                onClose: () => setEditor(null),
                onSubmit: saveServer,
              }),
            )
          : null,
        confirming
          ? h(
              Modal,
              { title: t("action.delete"), onClose: () => setConfirming(null) },
              h("p", null, t("confirm.delete", { name: confirming.name || confirming.id })),
              h("p", { className: "smx-muted" }, t("confirm.deleteHint")),
              h(
                "div",
                { className: "smx-form-actions" },
                h(Button, { onClick: () => setConfirming(null) }, t("action.cancel")),
                h(Button, { variant: "danger", onClick: removeServer }, t("action.delete")),
              ),
            )
          : null,
        toast ? h("div", { className: `smx-toast is-${toast.tone}`, key: toast.id }, toast.message) : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
      .smx {
        --gold: #d9b36c;
        --gold-soft: rgba(217, 179, 108, .16);
        --green: #3ddc97;
        --red: #ff6b81;
        --blue: #7aa2ff;
        --text: #e9eaef;
        --dim: #8b90a0;
        --line: rgba(255, 255, 255, .075);
        --panel: rgba(24, 26, 33, .92);
        position: relative;
        min-height: 100%;
        overflow: auto;
        color: var(--text);
        background:
          radial-gradient(1100px 520px at 18% -12%, rgba(217, 179, 108, .085), transparent 62%),
          radial-gradient(900px 480px at 96% -6%, rgba(122, 162, 255, .055), transparent 58%),
          #101116;
        font-family: "Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.5;
      }
      .smx *, .smx *::before, .smx *::after { box-sizing: border-box; }
      .smx::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(255, 255, 255, .028) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, .028) 1px, transparent 1px);
        background-size: 54px 54px;
        mask-image: radial-gradient(ellipse at 50% 0%, #000 20%, transparent 78%);
      }
      .smx-inner { position: relative; z-index: 1; max-width: 1520px; margin: 0 auto; padding: 22px 26px 42px; }
      .smx button { font: inherit; }
      .smx h1, .smx h2, .smx h3, .smx p { margin: 0; }
      .smx-mono { font-family: "SFMono-Regular", "Cascadia Mono", Consolas, "Liberation Mono", monospace; }
      .smx-muted { color: var(--dim); }
      .smx-ok { color: var(--green); }
      .smx-bad { color: var(--red); }

      /* header */
      .smx-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 6px 2px 20px; }
      .smx-brand { display: flex; gap: 16px; min-width: 0; }
      .smx-logo {
        flex: none;
        width: 54px; height: 54px;
        display: grid; place-items: center;
        color: var(--gold);
        border: 1px solid rgba(217, 179, 108, .42);
        border-radius: 14px;
        background: linear-gradient(160deg, rgba(217, 179, 108, .17), rgba(217, 179, 108, .03));
        box-shadow: 0 0 28px rgba(217, 179, 108, .13), inset 0 1px 0 rgba(255, 255, 255, .06);
      }
      .smx-logo-img { display: block; object-fit: contain; border-radius: 9px; }
      .smx-logo .smx-logo-img { width: 100%; height: 100%; }
      .smx-disk-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 2px 0 8px; }
      .smx-disk-chip {
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        padding: 4px 9px; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--line); background: rgba(255, 255, 255, .03);
        color: var(--dim); font-size: 11px;
      }
      .smx-disk-chip:hover { color: var(--text); border-color: rgba(217, 179, 108, .35); }
      .smx-disk-chip.is-active { color: var(--gold); border-color: rgba(217, 179, 108, .55); background: rgba(217, 179, 108, .1); }
      .smx-eyebrow { color: var(--gold); font-size: 10px; letter-spacing: .34em; text-transform: uppercase; margin-bottom: 4px; }
      .smx-brand h1 { font-size: 30px; line-height: 1.05; letter-spacing: .14em; font-weight: 800; }
      .smx-title-sub { margin-left: 12px; font-size: 12px; letter-spacing: .04em; font-weight: 500; color: var(--dim); }
      .smx-version { margin-left: 10px; padding: 2px 8px; border: 1px solid rgba(217, 179, 108, .35); border-radius: 999px; color: var(--gold); background: rgba(217, 179, 108, .07); font-size: 10.5px; letter-spacing: .06em; font-weight: 600; vertical-align: 2px; }
      .smx-brand p { margin-top: 6px; color: var(--dim); font-size: 12.5px; max-width: 620px; }
      .smx-top-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
      .smx-clock { display: flex; align-items: center; gap: 10px; color: var(--dim); font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; }
      .smx-live { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); font-size: 11px; }
      .smx-live i { width: 6px; height: 6px; border-radius: 50%; background: #5b6070; }
      .smx-live.is-on { color: var(--green); border-color: rgba(61, 220, 151, .3); background: rgba(61, 220, 151, .07); }
      .smx-live.is-on i { background: var(--green); box-shadow: 0 0 8px var(--green); animation: smx-blink 2.2s infinite; }
      @keyframes smx-blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
      .smx-top-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .smx-btn {
        display: inline-flex; align-items: center; gap: 7px;
        padding: 8px 13px;
        border-radius: 9px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, .035);
        color: var(--text);
        cursor: pointer;
        transition: border-color .15s, background .15s, transform .15s;
        white-space: nowrap;
        font-size: 12.5px;
      }
      .smx-btn:hover:not(:disabled) { border-color: rgba(255, 255, 255, .2); background: rgba(255, 255, 255, .06); }
      .smx-btn:disabled { opacity: .55; cursor: default; }
      .smx-btn.is-accent { color: #f4dfb4; border-color: rgba(217, 179, 108, .45); background: rgba(217, 179, 108, .12); }
      .smx-btn.is-accent:hover:not(:disabled) { background: rgba(217, 179, 108, .19); }
      .smx-btn.is-danger { color: var(--red); border-color: rgba(255, 107, 129, .15); background: rgba(255, 107, 129, .04); }
      .smx-btn.is-danger:hover:not(:disabled) { background: rgba(255, 107, 129, .1); }
      .smx-icon-btn { padding: 8px 10px; }
      .smx-inline-btn { margin-left: 10px; padding: 3px 9px; font-size: 11px; }

      /* banner / loading */
      .smx-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; margin-bottom: 16px; border: 1px solid rgba(255, 107, 129, .28); background: rgba(255, 107, 129, .07); border-radius: 10px; color: #ffc2ca; }
      .smx-loading { padding: 60px 0; text-align: center; color: var(--dim); letter-spacing: .08em; }

      /* stats */
      .smx-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
      .smx-stat {
        display: flex; align-items: center; gap: 12px;
        padding: 13px 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: linear-gradient(170deg, rgba(32, 34, 42, .85), rgba(21, 22, 28, .92));
      }
      .smx-stat-icon { width: 36px; height: 36px; border-radius: 9px; display: grid; place-items: center; border: 1px solid var(--line); background: rgba(255, 255, 255, .03); }
      .smx-stat b { display: block; font-size: 24px; line-height: 1.1; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-stat span { color: var(--dim); font-size: 11.5px; }
      .smx-stat.tone-blue .smx-stat-icon { color: var(--blue); border-color: rgba(122, 162, 255, .25); background: rgba(122, 162, 255, .08); }
      .smx-stat.tone-green .smx-stat-icon { color: var(--green); border-color: rgba(61, 220, 151, .25); background: rgba(61, 220, 151, .08); }
      .smx-stat.tone-red .smx-stat-icon { color: var(--red); border-color: rgba(255, 107, 129, .25); background: rgba(255, 107, 129, .07); }
      .smx-stat.tone-gold .smx-stat-icon { color: var(--gold); border-color: rgba(217, 179, 108, .25); background: rgba(217, 179, 108, .08); }

      /* layout */
      .smx-layout { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 14px; align-items: start; }
      .smx-main { min-width: 0; }

      /* rail */
      .smx-rail { position: sticky; top: 14px; border: 1px solid var(--line); border-radius: 13px; background: linear-gradient(180deg, rgba(27, 29, 36, .9), rgba(19, 20, 26, .94)); overflow: hidden; }
      .smx-rail-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--line); color: var(--dim); font-size: 11.5px; letter-spacing: .12em; }
      .smx-rail-head b { color: var(--text); font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-rail-group { padding: 10px 8px 4px; }
      .smx-rail-label { display: flex; justify-content: space-between; padding: 0 6px 6px; color: #6f7482; font-size: 10px; letter-spacing: .18em; }
      .smx-node { position: relative; display: flex; align-items: center; gap: 9px; padding: 9px 8px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: background .12s, border-color .12s; }
      .smx-node:hover { background: rgba(255, 255, 255, .04); }
      .smx-node.is-active { background: rgba(217, 179, 108, .09); border-color: rgba(217, 179, 108, .25); }
      .smx-node.is-active::before { content: ""; position: absolute; left: -1px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--gold); }
      .smx-node-text { min-width: 0; flex: 1; }
      .smx-node-text b { display: block; font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-node-text span { display: block; color: var(--dim); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-node-refresh { flex: none; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #6f7482; cursor: pointer; opacity: 0; transition: opacity .12s, color .12s; }
      .smx-node:hover .smx-node-refresh { opacity: 1; }
      .smx-node-refresh:hover { color: var(--text); background: rgba(255, 255, 255, .07); }
      .smx-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #6d7280; }
      .smx-dot.is-ok { background: var(--green); box-shadow: 0 0 7px rgba(61, 220, 151, .6); }
      .smx-dot.is-warn, .smx-dot.is-critical { background: var(--gold); box-shadow: 0 0 7px rgba(217, 179, 108, .6); }
      .smx-dot.is-offline { background: var(--red); box-shadow: 0 0 7px rgba(255, 107, 129, .5); }
      .smx-rail-empty { padding: 22px 16px; text-align: center; color: var(--dim); }
      .smx-rail-empty .smx-btn { margin-top: 12px; }
      .smx-rail-hint { display: flex; gap: 9px; margin-top: 8px; padding: 12px 13px; border-top: 1px solid var(--line); color: var(--gold); background: rgba(217, 179, 108, .04); }
      .smx-rail-hint b { display: block; color: #e8d3a8; font-size: 11.5px; }
      .smx-rail-hint p { color: var(--dim); font-size: 10.5px; margin-top: 3px; }

      /* cards */
      .smx-card { border: 1px solid var(--line); border-radius: 13px; background: linear-gradient(180deg, rgba(30, 32, 40, .92), rgba(20, 21, 27, .95)); padding: 15px 16px; }
      .smx-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .smx-card-title { display: flex; align-items: center; gap: 9px; }
      .smx-card-num { color: var(--gold); font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; opacity: .85; }
      .smx-card-title h2 { font-size: 13px; font-weight: 650; letter-spacing: .06em; }
      .smx-tag { color: var(--dim); font-size: 10px; letter-spacing: .12em; }

      /* board */
      .smx-board { display: grid; grid-template-columns: minmax(0, 1.32fr) minmax(0, 1fr); gap: 14px; }
      .smx-pulse { min-height: 268px; display: flex; flex-direction: column; }
      .smx-health { min-height: 268px; }
      .smx-capacity { min-height: 300px; }
      .smx-waterline { min-height: 300px; }
      .smx-big { font-size: 34px; font-weight: 750; letter-spacing: -.015em; margin: 6px 0 3px; }
      .smx-sub { color: var(--dim); font-size: 11.5px; }
      .smx-pulse-live { margin-top: auto; padding-top: 12px; }
      .smx-pulse-label { display: flex; justify-content: space-between; color: #6f7482; font-size: 10px; letter-spacing: .14em; margin-bottom: 7px; }
      .smx-pulse-label em { font-style: normal; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-latbars { display: flex; align-items: flex-end; gap: 3px; height: 48px; }
      .smx-latbars i { flex: 1; min-width: 2px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #e6c885, #8a6d3a); opacity: .7; }
      .smx-latbars i.is-warm { background: linear-gradient(180deg, #ffb3bd, #a84252); }
      .smx-latbars.is-empty { align-items: center; color: #6f7482; font-size: 10px; }
      .smx-pulse-foot { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 13px; padding-top: 11px; border-top: 1px solid var(--line); }
      .smx-pulse-foot span { display: block; color: #6f7482; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
      .smx-pulse-foot b { font-size: 13px; font-family: "SFMono-Regular", Consolas, monospace; font-weight: 600; }

      /* health */
      .smx-health-body { display: flex; align-items: center; gap: 18px; margin-top: 14px; }
      .smx-donut { position: relative; width: 148px; height: 148px; flex: none; }
      .smx-donut svg { width: 100%; height: 100%; display: block; }
      .smx-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .smx-donut-center b { font-size: 34px; line-height: 1; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-donut-center span { color: var(--dim); font-size: 10px; margin-top: 5px; }
      .smx-legend { list-style: none; margin: 0; padding: 0; flex: 1; display: flex; flex-direction: column; gap: 9px; }
      .smx-legend li { display: flex; align-items: center; gap: 8px; color: var(--dim); font-size: 11.5px; }
      .smx-legend li b { margin-left: auto; color: var(--text); font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-legend i { width: 7px; height: 7px; border-radius: 50%; }
      .smx-legend i.is-on { background: var(--green); }
      .smx-legend i.is-off { background: var(--red); }
      .smx-legend i.is-idle { background: #6d7280; }
      .smx-legend i.is-warn { background: var(--gold); }
      .smx-legend i.is-cpu { background: var(--blue); }
      .smx-legend i.is-mem { background: var(--green); }
      .smx-legend i.is-disk { background: var(--gold); }
      .smx-legend.is-row { flex-direction: row; gap: 16px; margin-top: 8px; }
      .smx-legend.is-row span { display: flex; align-items: center; gap: 6px; color: var(--dim); font-size: 10.5px; }

      /* chart */
      .smx-chart { position: relative; height: 186px; margin-top: 12px; padding-left: 40px; }
      .smx-chart svg { width: 100%; height: 100%; display: block; overflow: visible; }
      .smx-yaxis { position: absolute; left: 0; top: 4px; bottom: 4px; display: flex; flex-direction: column; justify-content: space-between; color: #5f6472; font-size: 9.5px; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-chart-empty { position: absolute; inset: 0 0 0 40px; display: grid; place-items: center; color: #6f7482; font-size: 11px; }
      .smx-note { color: #6f7482; font-size: 10px; margin-top: 6px; }

      /* gauges */
      .smx-gauges { display: flex; justify-content: space-around; gap: 8px; margin-top: 18px; }
      .smx-gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .smx-gauge { width: 94px; height: 94px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--tone) var(--smx-gauge), rgba(255, 255, 255, .06) var(--smx-gauge) 100%); }
      .smx-gauge.tone-green { --tone: var(--green); }
      .smx-gauge.tone-gold { --tone: var(--gold); }
      .smx-gauge.tone-red { --tone: var(--red); }
      .smx-gauge.tone-dim { --tone: #565b69; }
      .smx-gauge-hole { width: 74px; height: 74px; border-radius: 50%; background: #171920; display: grid; place-items: center; border: 1px solid rgba(255, 255, 255, .04); }
      .smx-gauge-hole b { font-size: 16px; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-gauge-label { color: var(--dim); font-size: 10.5px; }
      .smx-waterline-foot { display: flex; justify-content: space-around; margin-top: 16px; padding-top: 11px; border-top: 1px solid var(--line); color: #6f7482; font-size: 10.5px; }
      .smx-waterline-foot b { color: var(--text); font-family: "SFMono-Regular", Consolas, monospace; margin-left: 6px; }

      /* empty */
      .smx-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 42px 20px; gap: 10px; }
      .smx-empty-mark { width: 62px; height: 62px; border-radius: 16px; display: grid; place-items: center; color: var(--gold); border: 1px dashed rgba(217, 179, 108, .35); background: rgba(217, 179, 108, .06); }
      .smx-empty h2 { font-size: 17px; margin-top: 6px; }
      .smx-empty p { color: var(--dim); max-width: 420px; font-size: 12px; }
      .smx-empty .smx-btn { margin-top: 8px; }

      /* detail */
      .smx-detail { margin-top: 14px; }
      .smx-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .smx-detail-id { display: flex; align-items: center; gap: 10px; }
      .smx-detail-id h2 { font-size: 17px; font-weight: 700; }
      .smx-detail-id p { color: var(--dim); font-size: 11px; }
      .smx-detail-actions { display: flex; gap: 7px; flex-wrap: wrap; }
      .smx-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
      .smx-chip { padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); font-size: 10.5px; }
      .smx-chip.is-ok { color: var(--green); border-color: rgba(61, 220, 151, .28); background: rgba(61, 220, 151, .06); }
      .smx-chip.is-warn, .smx-chip.is-critical { color: var(--gold); border-color: rgba(217, 179, 108, .3); background: rgba(217, 179, 108, .06); }
      .smx-chip.is-offline { color: var(--red); border-color: rgba(255, 107, 129, .28); background: rgba(255, 107, 129, .05); }
      .smx-chip.is-mono { font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-detail-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; padding: 10px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .smx-detail-strip span { display: block; color: #6f7482; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
      .smx-detail-strip b { display: block; margin-top: 2px; font-size: 12px; font-family: "SFMono-Regular", Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 13px 0; }
      .smx-block { border: 1px solid var(--line); border-radius: 10px; padding: 11px 12px; background: rgba(255, 255, 255, .018); }
      .smx-block h3 { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #6f7482; margin-bottom: 9px; }
      .smx-fnos-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .smx-fnos-head h3 { margin-bottom: 0; }
      .smx-fnos-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; color: var(--dim); font-size: 11px; margin-bottom: 7px; }
      .smx-fnos-meta b { color: var(--text); font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-fnos-apps { display: flex; flex-direction: column; margin-top: 7px; }
      .smx-fnos-app { display: grid; grid-template-columns: minmax(0, 1fr) 84px 52px; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid rgba(255, 255, 255, .05); font-size: 11px; }
      .smx-fnos-app a { color: var(--gold); text-decoration: none; }
      .smx-fnos-app a:hover { text-decoration: underline; }
      .smx-meter { margin-bottom: 10px; }
      .smx-meter:last-child { margin-bottom: 0; }
      .smx-meter-head { display: flex; justify-content: space-between; gap: 8px; color: var(--dim); font-size: 11px; }
      .smx-meter-head b { font-family: "SFMono-Regular", Consolas, monospace; color: var(--text); }
      .smx-meter-track { height: 5px; margin-top: 5px; border-radius: 4px; background: rgba(255, 255, 255, .07); overflow: hidden; }
      .smx-meter-track i { display: block; height: 100%; border-radius: 4px; background: var(--green); }
      .smx-meter-track i.tone-gold { background: var(--gold); }
      .smx-meter-track i.tone-red { background: var(--red); }
      .smx-meter-track i.tone-dim { background: #565b69; }
      .smx-meter-detail { color: #6f7482; font-size: 10px; margin-top: 3px; }
      .tone-green { color: var(--green); }
      .tone-gold { color: var(--gold); }
      .tone-red { color: var(--red); }
      .tone-dim { color: var(--dim); }
      .smx-list, .smx-warn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .smx-list li { display: flex; align-items: center; gap: 8px; font-size: 11px; min-width: 0; }
      .smx-list-main { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-pill { flex: none; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: #7b8090; font-size: 9px; }
      .smx-pill.is-on { color: var(--green); border-color: rgba(61, 220, 151, .25); }
      .smx-warn-list li { color: var(--gold); font-size: 11px; }
      .smx-warn-line { color: var(--gold); font-size: 11px; margin-top: 7px; }
      .smx-table { display: flex; flex-direction: column; }
      .smx-tr { display: grid; grid-template-columns: 70px 60px 60px minmax(0, 1fr); gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, .04); font-size: 11px; color: #c6c9d2; }
      .smx-tr.is-head { color: #6f7482; font-size: 9.5px; letter-spacing: .12em; border-bottom-color: var(--line); }
      .smx-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-hint-line { margin-top: 12px; color: var(--dim); font-size: 11px; }
      .smx-hint-line code { color: #b9bdc9; font-size: 10.5px; }
      .smx-offline { margin-top: 12px; padding: 16px; border-radius: 10px; border: 1px solid rgba(255, 107, 129, .25); background: rgba(255, 107, 129, .05); }
      .smx-offline b { color: var(--red); }
      .smx-offline p { margin: 6px 0 12px; color: #d7a3aa; font-size: 11px; word-break: break-word; }

      /* docker */
      .smx-docker { margin-top: 14px; padding: 13px 14px 15px; }
      .smx-docker-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .smx-docker-title { display: flex; align-items: center; gap: 8px; }
      .smx-docker-title h3 { display: flex; align-items: center; gap: 7px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #c3a775; }
      .smx-docker-live { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(61, 220, 151, .25); background: rgba(61, 220, 151, .05); color: #7ddcb2; font-size: 9.5px; }
      .smx-docker-live i { width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px rgba(61, 220, 151, .9); animation: smx-pulse 1.8s infinite; }
      .smx-docker-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .smx-chip.is-warn { color: var(--gold); border-color: rgba(217, 179, 108, .3); }
      .smx-onepanel { display: flex; align-items: center; gap: 10px; margin-top: 11px; padding: 9px 11px; border: 1px solid rgba(217, 179, 108, .22); border-radius: 9px; background: linear-gradient(90deg, rgba(217, 179, 108, .09), rgba(217, 179, 108, .02)); }
      .smx-onepanel-logo { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 7px; border: 1px solid rgba(217, 179, 108, .4); color: var(--gold); font-size: 10px; font-weight: 700; letter-spacing: .04em; }
      .smx-onepanel-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .smx-onepanel-text b { font-size: 11.5px; }
      .smx-onepanel-text span { color: #8b8fa0; font-size: 10px; }
      .smx-docker-filters { display: flex; gap: 6px; margin: 12px 0 8px; flex-wrap: wrap; }
      .smx-filter { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--dim); font-size: 10.5px; cursor: pointer; }
      .smx-filter b { color: #8b8fa0; font-family: "SFMono-Regular", Consolas, monospace; font-size: 9.5px; }
      .smx-filter.is-active { border-color: rgba(217, 179, 108, .4); color: #f0d9a7; background: rgba(217, 179, 108, .1); }
      .smx-docker-table { display: flex; flex-direction: column; }
      .smx-docker-row { display: grid; grid-template-columns: 86px minmax(150px, 1.2fr) 100px 84px 150px minmax(90px, 1fr) 148px; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255, 255, 255, .04); font-size: 11px; min-width: 0; }
      .smx-docker-row.is-head { color: #6f7482; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; border-bottom-color: var(--line); }
      .smx-docker-row.is-on { background: linear-gradient(90deg, rgba(61, 220, 151, .025), transparent 40%); }
      .smx-docker-project { display: flex; align-items: center; gap: 5px; color: #9ea3b2; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-mini-tag { flex: none; padding: 0 4px; border-radius: 4px; border: 1px solid rgba(217, 179, 108, .3); color: #c3a775; font-size: 8px; font-style: normal; letter-spacing: .05em; }
      .smx-docker-name { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
      .smx-docker-name b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-docker-name small { color: #6f7482; font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-docker-state { display: inline-flex; align-items: center; gap: 5px; color: #b9bdc9; font-size: 10.5px; }
      .smx-docker-cpu { display: flex; align-items: center; gap: 6px; }
      .smx-docker-cpu i { flex: 1; height: 4px; border-radius: 3px; background: var(--gold); opacity: .75; max-width: 58px; }
      .smx-docker-cpu small { color: #9ea3b2; font-family: "SFMono-Regular", Consolas, monospace; font-size: 9.5px; }
      .smx-docker-mem, .smx-docker-ports { font-size: 10px; color: #9ea3b2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-docker-actions { display: flex; gap: 4px; justify-content: flex-end; }
      .smx-docker-actions button { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--line); background: rgba(255, 255, 255, .02); color: #a9adba; font-size: 11px; line-height: 1; cursor: pointer; }
      .smx-docker-actions button:hover:not(:disabled) { color: var(--text); border-color: rgba(255, 255, 255, .25); }
      .smx-docker-actions button.is-gold { color: var(--gold); border-color: rgba(217, 179, 108, .3); background: rgba(217, 179, 108, .06); }
      .smx-docker-actions button:disabled { opacity: .32; cursor: not-allowed; }
      .smx-docker-actions .smx-docker-open { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(217, 179, 108, .3); background: rgba(217, 179, 108, .08); color: var(--gold); font-size: 13px; line-height: 1; text-decoration: none; }
      .smx-docker-actions a.smx-docker-open:hover { color: #f0d9a7; border-color: rgba(217, 179, 108, .55); background: rgba(217, 179, 108, .16); }
      .smx-docker-actions button.smx-docker-open { opacity: .32; cursor: not-allowed; }
      .smx-docker-logs { margin: 0; max-height: 60vh; overflow: auto; padding: 10px 12px; border-radius: 8px; background: #101116; border: 1px solid var(--line); color: #c9ccd6; font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word; }

      /* proxmox ve */
      .smx-pve { margin-top: 14px; padding: 13px 14px 15px; }
      .smx-pve-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .smx-pve-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .smx-pve-title h3 { display: flex; align-items: center; gap: 7px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #c3a775; }
      .smx-pve-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
      .smx-pve-stats div { padding: 8px 10px; border: 1px solid rgba(255, 255, 255, .06); border-radius: 9px; background: rgba(255, 255, 255, .015); }
      .smx-pve-stats span { display: block; color: #6f7482; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 3px; }
      .smx-pve-stats b { font-size: 13px; font-weight: 600; }
      .smx-pve-table { display: flex; flex-direction: column; }
      .smx-pve-row { display: grid; grid-template-columns: 54px minmax(150px, 1.3fr) 52px 90px 70px 150px 80px 100px; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255, 255, 255, .04); font-size: 11px; }
      .smx-pve-row.is-head { color: #6f7482; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; border-bottom-color: var(--line); }
      .smx-pve-row.is-on { background: linear-gradient(90deg, rgba(61, 220, 151, .025), transparent 40%); }
      .smx-pve-guest { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .smx-pve-guest b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-pve-state { display: inline-flex; align-items: center; gap: 5px; color: #b9bdc9; font-size: 10.5px; }
      .smx-pve-storage { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 11px; }
      .smx-pve-storage-label { color: #6f7482; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
      .smx-pve-store { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--line); background: rgba(255, 255, 255, .02); }
      .smx-pve-store b { font-size: 10.5px; font-weight: 600; }
      .smx-pve-store small { color: #8b8fa0; font-size: 9.5px; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-chip.is-good { color: #7ee2b4; border-color: rgba(61, 220, 151, .3); background: rgba(61, 220, 151, .06); }
      .smx-mini-tag.is-warn { color: #ffc36b; border-color: rgba(255, 172, 76, .35); }
      .smx-pve-updates { margin: 10px 0 13px; padding: 10px 11px 8px; border: 1px solid rgba(255, 255, 255, .06); border-radius: 9px; background: rgba(255, 255, 255, .012); }
      .smx-pve-updates-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
      .smx-pve-updates-head b { color: #c3a775; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
      .smx-pve-updates-head small { font-size: 10px; }
      .smx-pve-update-list { display: flex; flex-direction: column; gap: 3px; }
      .smx-pve-update-row { display: grid; grid-template-columns: minmax(150px, 1.1fr) minmax(180px, 1.4fr) 90px; gap: 10px; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255, 255, 255, .04); font-size: 10.5px; }
      .smx-pve-update-pkg { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .smx-pve-update-pkg b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-pve-update-row .smx-muted { font-size: 10px; text-align: right; }

      /* 1panel app store */
      .smx-apps-card { margin-top: 14px; padding: 13px 14px 15px; }
      .smx-onepanel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .smx-onepanel-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .smx-onepanel-title h3 { display: flex; align-items: center; gap: 7px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #c3a775; }
      .smx-onepanel-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
      .smx-onepanel-stats div { padding: 8px 10px; border: 1px solid rgba(255, 255, 255, .06); border-radius: 9px; background: rgba(255, 255, 255, .015); }
      .smx-onepanel-stats span { display: block; color: #6f7482; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 3px; }
      .smx-onepanel-stats b { font-size: 13px; font-weight: 600; }
      .smx-onepanel-table { display: flex; flex-direction: column; }
      .smx-onepanel-row { display: grid; grid-template-columns: minmax(150px, 1.2fr) 110px 110px 100px minmax(120px, 1fr); gap: 9px; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255, 255, 255, .04); font-size: 11px; }
      .smx-onepanel-row.is-head { color: #6f7482; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; border-bottom-color: var(--line); }
      .smx-onepanel-row.is-update { background: linear-gradient(90deg, rgba(217, 179, 108, .035), transparent 45%); }
      .smx-onepanel-app { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .smx-onepanel-app b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .smx-onepanel-latest { color: #9ea3b2; }
      .smx-onepanel-latest.is-update { color: #f0d9a7; font-weight: 600; }
      .smx-onepanel-row .smx-pve-state { font-size: 10.5px; }
      .smx-muted { color: #6f7482; font-size: 11px; }
      .smx-mono { font-family: "SFMono-Regular", Consolas, monospace; }

      /* console */
      .smx-console { margin-top: 14px; border: 1px solid var(--line); border-radius: 10px; background: #12131a; overflow: hidden; }
      .smx-console-head { display: flex; align-items: center; gap: 7px; padding: 7px 11px; border-bottom: 1px solid var(--line); color: var(--gold); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
      .smx-console textarea { width: 100%; resize: vertical; border: 0; outline: none; background: transparent; color: #e6e8ee; padding: 10px 12px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; min-height: 56px; }
      .smx-console-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); }
      .smx-console-actions small { color: #6f7482; font-size: 10px; }
      .smx-output { border-top: 1px solid var(--line); }
      .smx-output-head { display: flex; gap: 14px; padding: 6px 11px; color: #6f7482; font-size: 10px; font-family: "SFMono-Regular", Consolas, monospace; }
      .smx-output-head .is-warn { color: var(--gold); }
      .smx-output pre { margin: 0; padding: 10px 12px; max-height: 240px; overflow: auto; font-family: "SFMono-Regular", Consolas, monospace; font-size: 11.5px; color: #c9ccd6; white-space: pre-wrap; word-break: break-word; }

      /* form */
      .smx-modal-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(4, 5, 8, .66); backdrop-filter: blur(4px); display: flex; align-items: flex-start; justify-content: center; padding: 6vh 18px 24px; overflow: auto; }
      .smx-modal { width: min(560px, 100%); border: 1px solid rgba(255, 255, 255, .11); border-radius: 14px; background: linear-gradient(180deg, #20222b, #17181f); box-shadow: 0 24px 80px rgba(0, 0, 0, .55); padding: 18px 20px 20px; }
      .smx-modal.is-wide { width: min(820px, 100%); }
      .smx-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .smx-modal-head h2 { font-size: 15px; letter-spacing: .05em; }
      .smx-close { width: 28px; height: 28px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--dim); font-size: 17px; line-height: 1; cursor: pointer; }
      .smx-close:hover { color: var(--text); border-color: rgba(255, 255, 255, .2); }
      .smx-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; margin-bottom: 10px; }
      .smx-form-grid.is-wide { grid-template-columns: 1fr; }
      .smx-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .smx-field > span { color: #8f93a2; font-size: 10.5px; letter-spacing: .06em; }
      .smx-field input, .smx-field select, .smx-field textarea {
        width: 100%; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--line);
        background: rgba(0, 0, 0, .22); color: var(--text); font-size: 12px; outline: none;
        font-family: inherit;
      }
      .smx-field input:focus, .smx-field select:focus, .smx-field textarea:focus { border-color: rgba(217, 179, 108, .55); }
      .smx-field textarea { resize: vertical; font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; }
      .smx-field small { color: #6f7482; font-size: 9.5px; line-height: 1.35; }
      .smx-form-section { margin: 14px 0 8px; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #6f7482; }
      .smx-form-checks { display: flex; gap: 18px; margin-bottom: 10px; }
      .smx-check { display: flex; align-items: center; gap: 7px; color: #c3c7d1; font-size: 11.5px; cursor: pointer; }
      .smx-check input { accent-color: #d9b36c; }
      .smx-form-error { color: var(--red); font-size: 11.5px; margin: 8px 0 0; }
      .smx-form-hint { color: #6f7482; font-size: 10.5px; margin: 8px 0 0; }
      .smx-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

      /* settings / audit */
      .smx-settings h3 { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #6f7482; margin: 16px 0 7px; }
      .smx-segmented { display: inline-flex; padding: 3px; gap: 2px; border: 1px solid var(--line); border-radius: 9px; background: rgba(0, 0, 0, .2); }
      .smx-segmented button { padding: 5px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--dim); font-size: 11.5px; cursor: pointer; }
      .smx-segmented button.is-on { background: rgba(217, 179, 108, .16); color: #f0d9a7; }
      .smx-kv { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 6px 10px; margin: 12px 0 0; font-size: 11.5px; }
      .smx-kv dt { color: #6f7482; }
      .smx-kv dd { margin: 0; word-break: break-all; }
      .smx-errors { margin-top: 12px; padding: 10px; border: 1px solid rgba(255, 107, 129, .25); border-radius: 8px; color: #ffb3bd; font-size: 11px; }
      .smx-audit .smx-tr { grid-template-columns: 170px 130px 150px 60px; }
      .smx-audit .smx-tr.is-head span:last-child { text-align: right; }

      .smx-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 95; max-width: min(560px, 90vw); padding: 9px 16px; border-radius: 9px; border: 1px solid rgba(61, 220, 151, .3); background: rgba(21, 44, 34, .96); color: #b9f3d7; font-size: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, .45); }
      .smx-toast.is-bad { border-color: rgba(255, 107, 129, .35); background: rgba(48, 20, 26, .96); color: #ffc2ca; }

      @media (max-width: 1180px) {
        .smx-detail-grid { grid-template-columns: 1fr; }
        .smx-layout { grid-template-columns: 1fr; }
        .smx-rail { position: static; }
        .smx-rail-group { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px; }
        .smx-rail-label { grid-column: 1 / -1; }
        .smx-rail-hint { display: none; }
        .smx-docker-table { overflow-x: auto; }
        .smx-docker-row { min-width: 810px; }
        .smx-pve-table { overflow-x: auto; }
        .smx-pve-row { min-width: 820px; }
        .smx-pve-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .smx-pve-update-row { grid-template-columns: minmax(140px, 1fr) 170px; }
        .smx-pve-update-row .smx-muted { display: none; }
        .smx-onepanel-table { overflow-x: auto; }
        .smx-onepanel-row { min-width: 720px; }
        .smx-onepanel-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 980px) {
        .smx-inner { padding: 16px 14px 32px; }
        .smx-top { flex-direction: column; gap: 14px; }
        .smx-top-right { align-items: flex-start; }
        .smx-board { grid-template-columns: 1fr; }
        .smx-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .smx-detail-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .smx-form-grid { grid-template-columns: 1fr; }
        .smx-pulse-foot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 620px) {
        .smx-brand h1 { font-size: 22px; }
        .smx-title-sub { display: block; margin: 4px 0 0; }
        .smx-stats { grid-template-columns: 1fr 1fr; }
        .smx-health-body { flex-direction: column; }
        .smx-legend { width: 100%; }
      }
    `;

    let styleInstalled = false;
    function installStyle() {
      if (styleInstalled) return;
      styleInstalled = true;
      const style = document.createElement("style");
      style.id = "dsh-server-manager-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /* ------------------------------------------------------------------ */
    /* plugin                                                             */
    /* ------------------------------------------------------------------ */

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        installStyle();
        ctx.locale.register(NS, { zh, en });
        boundT = ctx.locale.bind(NS);

        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: 6,
              label: () => t("panel.title"),
              locale: NS,
            },
            LogoMark,
          ),
        );

        ctx.slots.inject("main", function* () {
          yield ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS }, Dashboard);
        });
      },
    };
  },
});
