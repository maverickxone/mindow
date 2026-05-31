# Mindow — AI 项目知识文档

> **最近一次更新时间**: 2026-05-31 19:52
> **当前版本**: v1.2.0 (commit `1b9b2f6`, branch `main`, 工作区 clean — note4ai.md 为新增未提交)
> **本文档目的**: 给接手此项目的 AI 阅读，看完即可理解 ~80% 架构后只需读少量代码即可动手
> **维护约定**: 每次 commit 后更新顶部时间戳 + 版本号，并把本次变更同步到对应章节

---

## 一、项目概述

**Mindow**（Mind + Window）是一个 **Windows 系统资源监控 + AI 分析工具**，灵感来自 Windows 11 任务管理器但增加了 AI 智能分析。项目有两个可交付形态，共享同一套 Rust 核心逻辑：

1. **mindow-cli** — 单 exe 命令行工具（status/watch/search/report/交互式 REPL），最早成熟，v0.9.5 起稳定
2. **mindow-app** — Tauri 2 桌面 GUI（v1.1.0 起开发，当前主力迭代方向）

- **目标用户**: 普通 Windows 用户（非技术人员为主），文案通俗
- **语言**: 中英双语 i18n，默认中文 (`lng: "zh"`)
- **平台**: **仅 Windows**（用到 Win32 API: Shell 图标提取、注册表自启、TerminateProcess、ShellExecute UAC 提权）
- **当前迭代焦点**: GUI 前端美观度，对标 Win11 任务管理器逐像素还原（尤其性能页图表）

---

## 二、技术栈

| 层 | 技术 | 备注 |
|----|------|------|
| GUI 前端 | React 18 + TypeScript 5 + Tailwind CSS 3 | Vite 5 构建 |
| 图表 | uPlot 1.6 | canvas 高性能时序图 |
| 状态管理 | Zustand 4 | 3 个 store |
| 国际化 | i18next 23 + react-i18next 14 | zh/en |
| 图标 | lucide-react (package.json 写 `^1.17.0`) | 统一从 `components/icons.tsx` 导出 |
| Markdown | react-markdown 10 + remark-gfm 4 | AI 回复渲染 |
| 虚拟列表 | @tanstack/react-virtual 3 | 进程表性能 |
| 桌面框架 | Tauri 2 (`tray-icon` feature) | + global-shortcut/notification/shell 插件 |
| 后端核心 | Rust 2021, sysinfo 0.33, battery 0.7 | |
| Win32 | windows crate 0.58 | Threading/Shell/Registry/Gdi/FileSystem |
| AI 客户端 | reqwest 0.12 (stream) + 自写 SSE | OpenAI 兼容 / Claude 原生 |
| 图标编码 | image 0.25 (png feature) + base64 0.22 | |
| 测试 | Vitest 4 + fast-check 3 (前端) / proptest 1 (Rust) | 前端 15 文件 101 测试 |
| 打包 | NSIS + MSI (currentUser 安装) | GitHub Actions 自动 release |

> **注意**: package.json 中 lucide-react 版本写作 `^1.17.0`（实际 lucide-react 官方版本号体系是 0.x，此处可能是 lockfile 解析的具体版本；如需升级注意核对）。

---

## 三、Workspace 结构 (Cargo workspace, 4 个成员)

`Cargo.toml`: `members = ["core", "ai", "mindow-cli", "mindow-app/src-tauri"]`

```
mindows/                          ← workspace root
├── Cargo.toml / Cargo.lock       ← workspace 定义
├── README.md                     ← 面向用户的 CLI 使用文档(详尽)
├── CHANGELOG.md                  ← 版本变更记录 (止于 v0.9.5)
├── LICENSE                       ← MIT
├── note4ai.md                    ← 【本文档】
├── .github/workflows/
│   ├── release.yml               ← CLI release (push tag 自动构建 mindow.exe)
│   └── release-gui.yml           ← GUI release (push tag → cargo tauri build → MSI+NSIS)
├── core/                         ← mindow-core (纯逻辑库, version 0.9.5, 无 Win 依赖)
│   ├── src/{types,config,collector,filter,rule_engine,trend_store}.rs + lib.rs
│   └── tests/properties/         ← proptest 属性测试 (alert/config/filter/rule_*/trend)
├── ai/                           ← mindow-ai (AI 集成库, version 0.9.5)
│   └── src/{client,config,baseline,knowledge,prompt,sse,report,websearch}.rs + lib.rs
├── mindow-cli/                   ← mindow-cli (CLI 二进制, bin name = "mindow", version 0.9.5)
│   ├── src/{main,interactive,renderer}.rs
│   └── tests/
├── mindow-app/                   ← Tauri 2 GUI (version 0.1.0, 独立版本号!)
│   ├── src/                      ← React 前端 (详见 §4)
│   ├── src-tauri/                ← Rust 后端 (详见 §5)
│   ├── package.json / tailwind.config.js / postcss.config.js
│   ├── tsconfig.json / vite.config.ts / index.html
│   ├── tr.json                   ← (临时/遗留翻译文件, 非主流程)
│   ├── dist/ (构建产物) / node_modules/
├── md/
│   ├── version/                  ← v0.9.0 ~ v1.1.5 版本说明 (每版一文件)
│   ├── plan/                     ← 开发计划 (plan-github, plan-v09, v1.1.x)
│   ├── conversation/             ← 历史对话记录
│   ├── problem.md                ← 前端问题清单 (v1.1.4 基准, 70+ 项, 多数已在 v1.1.5 修复)
│   └── usage.md                  ← 使用说明
├── screenshots/status.png        ← CLI status 截图
└── target/                       ← Cargo 构建输出 (workspace 共享)
```

> **版本号要点**: core/ai/cli 都是 0.9.5；**mindow-app/src-tauri 是独立的 0.1.0**（tauri.conf.json 也是 0.1.0）。git tag (v1.2.0 等) 是整个仓库的发布版本，与 crate 内部版本号不一致。

---

## 四、前端架构 (mindow-app/src/)

### 4.1 完整文件清单

```
src/
├── App.tsx              ← 根: h-screen flex-col → TitleBar + (Sidebar + main 页面) + Toast + ResizeHandles
│                          监听 snapshot-updated → 派发到 processStore + performanceStore
├── main.tsx             ← ReactDOM.createRoot + 启动占位 (#startup-placeholder) 淡出
├── vite-env.d.ts
├── components/
│   ├── icons.tsx              ← 【唯一图标出口】从 lucide-react re-export 命名图标
│   ├── TitleBar.tsx          ← h-9 标题栏: MindowLogo(自定义SVG窗口+脉冲) + 居中搜索框 + 电池指示 + 最小化/最大化/关闭
│   │                            拖拽=appWindow.startDragging(), 双击=最大化, 关闭=hide到托盘(首次showToast提示)
│   ├── Sidebar.tsx           ← 折叠48px/展开160px, 顶部 3 项(进程/性能/AI)+弹性间隔+底部设置
│   │                            选中态用 .nav-pill-active (左侧3px竖条), 折叠态hover tooltip(delay-300)
│   ├── ProcessTable.tsx      ← 核心组件: @tanstack/react-virtual 虚拟列表
│   │                            mergeProcesses() 按名分组 → sortGroupsGlobal() 全局排序 → 分 User/Unknown/System 段
│   │                            行内热力底色(getResourceHeatBg) + 进度条; 多选(Ctrl/Shift); 展开子行动画
│   ├── ProcessIcon.tsx       ← <img> 显示后端base64图标; 无则 DefaultIcon(进程名首字母+确定性色相)
│   ├── PerformanceChart.tsx  ← uPlot 封装 (详见 4.4)
│   ├── SidePanel.tsx         ← fixed 右侧抽屉(overlay), 宽度可拖拽(localStorage "sidePanelWidth", 360-720)
│   │                            信息卡 + CPU/内存趋势图(get_process_trend + 实时append) + 内嵌 AIChat
│   ├── AIChat.tsx            ← 面板内"AI分析"按钮+结果框, 调 ai_analyze_process, 监听 ai-delta/done
│   ├── ContextMenu.tsx       ← 右键菜单, useLayoutEffect 视口钳制, 结束任务(红)/打开位置/复制名/复制PID
│   ├── Toast.tsx             ← 全局 pub/sub (showToast 导出 + listeners[]), 最多3可见+队列10, slide-in/fade-out
│   ├── BaselineTag.tsx       ← deviation>=1.5 黄 / >=3.0 红, 显示 "↑ N.Nx"
│   ├── MarkdownRenderer.tsx  ← react-markdown + remark-gfm, 全部元素用 design token 样式, select-text
│   ├── ResizeHandles.tsx     ← 8个 fixed 隐形 div (4边4角, 6px), appWindow.startResizeDragging(dir)
│   └── ErrorBoundary.tsx     ← React 错误边界
├── pages/
│   ├── ProcessesPage.tsx     ← 工具栏(标题+结束任务按钮) + 系统汇总行(CPU/内存/磁盘) + ProcessTable + SidePanel + ContextMenu
│   ├── PerformancePage.tsx   ← 左栏指标卡(220px白底, sparkline缩略图) + 右栏详情(CpuDetail/MemoryDetail/DiskDetail/BatteryDetail)
│   │                            子组件: PageHeader/ChartSubtitle/ChartBox/BottomLabel/StatsGrid/MiniSparkline
│   ├── AIPage.tsx            ← 系统上下文折叠区 + 聊天气泡列表 + 自增高输入框(computeRows) + 发送/停止
│   │                            消息含时间戳/复制按钮, ai助手label去重(shouldShowLabel)
│   └── SettingsPage.tsx      ← SettingCard 卡片: 主题/语言(PillButton) + 自启/通知(SwitchToggle) + 快捷键 + AI配置(provider/model/baseURL/apiKey显隐+保存+测试连接)
├── stores/                   ← Zustand (详见 4.5)
│   ├── processStore.ts       ← + 导出 filterProcesses() / sortProcesses() 纯函数
│   ├── performanceStore.ts   ← 60点环形历史, 含 batteryHistory + coresHistory
│   └── settingsStore.ts      ← 所有字段持久化到后端 save_settings
├── hooks/
│   ├── useTauriEvent.ts      ← listen() 封装, 用 ref 持有最新 handler 避免闭包陈旧
│   └── useProcessIcon.ts     ← 全局 iconCache Map + pendingRequests Set; 等待中用 setInterval(100ms)轮询(待优化)
├── lib/
│   ├── format.ts             ← formatBytes(B/KB/MB/GB分级) / formatPercent(<0.05→"0%") / formatRate / formatDiskRate(0→"—")
│   ├── heat.ts               ← getHeatColor(绿→黄→红 hue插值) / getResourceHeatBg(资源色+opacity) / getHeatHue
│   ├── constants.ts          ← SAMPLING_INTERVAL_SECS = 2 (必须与后端 sampling.rs 同步)
│   ├── format.test.ts / heat.test.ts
├── styles/globals.css        ← 设计令牌(CSS变量) + 动画 + 工具类 + .nav-pill-active/.chart-frame/.metric-card-selected
├── i18n/{index.ts, zh.json, en.json}
├── types/index.ts            ← ProcessInfo/SystemInfo/AlertInfo/PerformanceHistory/SnapshotData/ProcessTrend
└── __tests__/
    ├── {BaselineTag,ProcessTable,SettingsPage,Toast}.test.tsx + setup.ts
    └── properties/           ← 8个 fast-check 属性测试 (design-tokens/focus-visible/format/heat/markdown/process-search/textarea-autogrow/toast)
```

### 4.2 数据流（核心）

```
后端 sampling 线程 (每 2 秒)
  └─ emit("snapshot-updated", SnapshotData{processes, system, alerts})
       └─ App.tsx handleSnapshotUpdate (useTauriEvent)
            ├─ processStore.updateSnapshot()  → 进程页/侧栏/标题栏电池 响应
            └─ performanceStore.appendDataPoint(cpu, memPct, diskRead/2, diskWrite/2, battery, perCoreCpu)
                 注: disk 在前端 /SAMPLING_INTERVAL_SECS 转成每秒速率; 历史保留60点
       性能页 mount 时额外调 get_performance_history 预加载历史(但该命令不返回battery/cores)

AI 流 (按钮触发)
  invoke("ai_chat"/"ai_analyze_process", {requestId, ...})
  └─ 后端 ai_bridge 流式 → emit("ai-delta", {request_id, delta}) 多次 → emit("ai-done", {request_id, success, error})
       └─ 前端用 requestIdRef 过滤陈旧流; 停止=置空 requestId 使后续 delta 被忽略
```

### 4.3 设计令牌系统 (globals.css)

- **Surface 5 级**: 浅色 `#fff→#d8d9dd`，深色 `#1a1a1e→#3d3d43`
- **文字 3 级**: text-primary / text-secondary / text-muted
- **资源分色 (浅色)**: `--color-cpu:#4ba0a0`(teal) / `--color-memory:#5b9bd5`(Win11蓝) / `--color-disk:#c4903d`(amber) / `--color-disk-write:#b87333` / `--color-battery:#5da55d`(green)；深色版更亮
- **accent**: 浅 `hsl(210,85%,45%)` / 深 `hsl(210,85%,65%)`
- **heat 色阶**: safe(绿142°)→moderate(黄60°)→high(橙30°)→extreme(红0°)
- **间距** 4px 基准 / **圆角** 0/4/8/12 / **过渡** 100/200/300ms / **字阶** 11/12/13/14/16/20px
- **双主题**: `:root`(浅) vs `html[data-theme="dark"]`(深)；切换时临时加 `[data-theme-transition]` 触发 200ms 过渡
- **Tailwind 桥接**: tailwind.config.js 把所有 token 映射成工具类(含 legacy 别名 primary/secondary/tertiary/accent-info 等)

### 4.4 图表组件 (PerformanceChart.tsx) — 重点

- 基于 uPlot；**Y 轴范围必须用 `scales.y.range` 控制**（曾误用 `axes[].range` 导致 0-200% bug，已修）
- CPU/内存/电池图传 `yRange={[0,100]}`；磁盘图不传(auto-scale)
- **面积填充**: `makeSolidFill()` 返回单一 35% 不透明度纯色（**无渐变**，用户明确要求）
- **网格**: X轴无垂直线 `grid:{show:false}`；Y轴水平线 `rgba(0,0,0,0.04)` 极淡；无 ticks
- **外框**: `ChartBox` 组件包裹，`rgba(0,0,0,0.08)` 1px + radius 2px(几乎直角)
- **曲线**: 线宽默认 1.5px；smooth=true 用 `uPlot.paths.spline`；磁盘图 smooth=false 保留尖峰
- **Tooltip**: 自定义 HTML overlay div，显示时刻 + 各序列色块值
- **resize**: ResizeObserver 监听容器宽度变化 setSize
- props: `{data, series, height?, yRange?, yFormat?, smooth?, gradientFill?, showLegend?, syncKey?, spanLabel?, maxLabel?}`

### 4.5 Zustand Stores 细节

- **processStore**: processes/system/alerts/selectedPid/selectedPids(Set)/sortColumn/sortDirection/searchQuery
  - `filterProcesses(list, query)`: 纯数字 query 同时匹配 name 子串 + PID 精确
  - `sortProcesses(list, col, dir)`: name/pid/cpu/memory/diskRead/diskWrite
- **performanceStore**: cpuHistory/memoryHistory/diskReadHistory/diskWriteHistory/**batteryHistory**/timestamps/**coresHistory**(每核心) — 全部 MAX_DATA_POINTS=60
  - `setHistory()` 用 get_performance_history 全量替换(不含 battery/cores)；`appendDataPoint()` 增量追加
- **settingsStore**: theme/language/autostart/shortcut/aiEndpoint/aiApiKey/sidebarExpanded/notificationsEnabled + 扩展 aiProvider/aiModel/aiBaseUrl
  - **代码异味**: 每个 setter 手动重建完整 AppSettings 再 invoke("save_settings") — 重复约100行，加字段易漏
  - 初始默认 theme="light", sidebarExpanded=true
  - AI 配置走独立命令 save_ai_config → 写 config.toml（GUI设置写 gui_settings.json，两文件分离）

---

## 五、Tauri 后端 (mindow-app/src-tauri/src/)

```
main.rs              ← 入口: manage(AppState) + 3插件 + invoke_handler(15命令) + setup(托盘/快捷键/通知初始化/窗口恢复/启动采样) + on_window_event(关闭拦截/移动resize保存)
                        采样 Config 用 interval_secs:1 构造(仅影响告警时长文案计算), 实际采样节奏由 sampling.rs 常量决定
state.rs             ← AppState: snapshot/rule_engine/performance_history/baselines(+writable)/knowledge(+writable)/notification_cooldowns/notifications_enabled(AtomicBool)
                        + 所有前端序列化结构 (SnapshotData/SystemInfo/ProcessInfo/AlertInfo + 枚举) + AlertInfo::from_alert(中文消息)
sampling.rs          ← start_sampling_loop: 独立线程, catch_unwind 防 panic; MAX_HISTORY_POINTS=60; SAMPLING_INTERVAL_SECS=2
commands.rs          ← 15 IPC 命令 + build_process_tree(按 parent_pid) + AppSettings 结构 + settings_file_path(~/.mindow/gui_settings.json)
ai_bridge.rs         ← stream_analyze_process / stream_chat; build_system_context(快照→markdown给AI); TauriStreamCallback emit事件
                        【注意】GUI 的 ai_bridge 不调 websearch(那是CLI专属)
icons.rs             ← SHGetFileInfoW(SHGFI_LARGEICON 32x32) → GetDIBits → BGRA转RGBA保留alpha → image crate编码PNG → base64; 全局 OnceLock<Mutex<HashMap>> 缓存
system_ops.rs        ← kill_process(OpenProcess+TerminateProcess, ACCESS_DENIED时runas提权taskkill) / open_file_location(explorer /select) / set_autostart+get_autostart(注册表 HKCU Run)
global_shortcut.rs   ← DEFAULT_SHORTCUT="ctrl+shift+m" 切换窗口显隐; 注册失败仅警告
notifications.rs     ← check_and_send_alerts: 启动30s静默 + 开关检查 + 冷却去重(Critical 5min/Warning 15min) + 每周期最多2条; cooldown_key="类型:进程名"
window_state.rs      ← 窗口位置/大小持久化【到 Tauri AppConfigDir(不是~/.mindow!)】; is_within_screens 多屏边界检测, 越界则居中
```

### 5.1 IPC 命令清单 (15)

| 命令 | 签名要点 | 用途 |
|------|---------|------|
| `get_snapshot` | → SnapshotData | 当前快照(进程/系统/告警) |
| `get_performance_history` | → {cpu/memory/disk_read/disk_write_history, timestamps} | 60点历史(无battery/cores) |
| `get_process_trend` | pid → {memory_trend, cpu_trend} | 单进程趋势(来自 TrendStore) |
| `get_process_tree` | → Vec<ProcessTreeNode> | 按 parent_pid 构建的进程树(含聚合) |
| `kill_process` | pid → Result<String> | 结束进程, 拒绝则 UAC 提权 |
| `open_file_location` | path → Result | Explorer /select 定位 |
| `toggle_autostart` | enable: bool → Result | 写/删 注册表 Run 键 |
| `get_autostart_status` | → bool | 读注册表 |
| `ai_analyze_process` | requestId, processName, pid? | 分析单进程(流式) |
| `ai_chat` | requestId, userMessage | 自由对话(附系统上下文, 流式) |
| `get_settings` | → AppSettings | 读 gui_settings.json |
| `save_settings` | settings | 写 gui_settings.json + 同步 notifications_enabled 到运行态 |
| `save_ai_config` | config{provider,model,base_url,api_key} | 写 config.toml(AI后端真正读的文件) |
| `test_ai_connection` | config | 发一次最小请求测连通 |
| `get_process_icon` | exePath → Option<String base64> | 提取exe图标 |

### 5.2 前后端类型对应 (序列化字段名一致)

```
Rust ProcessInfo  ←→  TS ProcessInfo   (snake_case 字段直接对应)
Rust SystemInfo   ←→  TS SystemInfo    (battery_charging: "Charging"|"Discharging"|"Full"|null)
Rust AlertInfo    ←→  TS AlertInfo     (alert_type 枚举序列化为字符串)
Rust SnapshotData ←→  TS SnapshotData
```

---

## 六、Core Crate (mindow-core) — 纯逻辑, 平台无关, 重测试

### 6.1 types.rs

- `ProcessSample`: name, pid, cpu_percent, memory_bytes, disk_read/write_bytes(**每采样间隔增量, 非累计**), exe_path, start_time, parent_pid
- `SystemSample`: total_memory, used_memory, per_core_cpu(Vec), battery(BatteryStatus)
- `BatteryStatus`: Available{level, charging:ChargingState} | Unavailable
- `Alert`: MemoryLeak | HighCpu | BatteryWarning | MemoryPressure；`.severity()` → Critical(内存压力/高CPU) / Warning(泄漏/电池)
- `PathStatus`: System | User | Unknown
- `FilteredSnapshot{processes: Vec<FilteredProcess{sample, path_status}>}`

### 6.2 collector.rs

- `Collect` trait + `SysinfoCollector`(包 sysinfo::System)
- `collect_processes()`: refresh_processes_specifics(All, remove_dead=true, everything())
- `collect_system()`: refresh_memory + refresh_cpu_usage + 电池(battery crate, 取第一块)
- CPU 需两次刷新才准确 → 创建时 new_all+refresh_all, 采样前 sleep 500ms

### 6.3 filter.rs

- `classify_path()`: None→Unknown；以 `c:\windows\` 或 `c:\program files\windowsapps\` 开头(小写)→System；否则→User
- `filter_snapshot()`: 取 top-N by memory + top-N by cpu，按 PID 去重合并，分类路径

### 6.4 rule_engine.rs (RuleEngine, 跨周期有状态)

- evaluate() 流程: 收集活跃PID → trend_store.remove_stale → push_sample → 4条规则
- **内存压力**: used/total>85%激活, <80%清除(迟滞), 候选=非系统进程按内存降序
- **电池警告**: <20% + Discharging + 有非系统进程 cpu>5%; offender = cpu>5% 或 mem>200MB
- **内存泄漏**: 连续 mem_samples 个样本单调递增 且 (增长>50MB 或 >20%)
- **高CPU**: 连续 cpu_samples 个样本全部 > cpu_threshold

### 6.5 config.rs

`Config{ top_n:25, interval_secs:10, cpu_threshold:80.0, mem_samples:15, cpu_samples:10 }`(默认值)；`validate_config(RawConfig)` 越界值回退默认并收集 warnings。
**注意**: GUI 后端 main.rs 实际用 `interval_secs:1` + 其余默认；CLI 默认 interval 10。

### 6.6 trend_store.rs

`TrendStore`: 两个 `HashMap<pid, VecDeque>`(memory u64 / cpu f32)，环形缓冲容量 = `max(mem_samples, cpu_samples)`；remove_stale 清理已退出 PID。

---

## 七、AI Crate (mindow-ai)

### 7.1 client.rs

- `Provider`: OpenAI | Claude
- `OpenAiClient`: POST `{base_url}/v1/chat/completions`, Bearer 认证, stream:true
- `ClaudeClient`: POST `{base_url}/v1/messages`, x-api-key + anthropic-version, max_tokens:4096
- `StreamCallback` trait: on_delta/on_complete/on_error
- `AiError`: NoApiKey/NetworkError/Timeout/HttpError/ParseError/StreamInterrupted
- HTTP 错误码映射中文友好消息(401密钥无效/429频繁/500不可用)

### 7.2 sse.rs

`parse_sse_line(line, provider) → SseEvent(Delta|Done|Skip)`
- OpenAI: `data: {...}` 取 choices[0].delta.content；`data: [DONE]`→Done
- Claude: `event: message_stop`→Done；`data:{type:content_block_delta}` 取 delta.text

### 7.3 config.rs (AI 配置, 与 GUI 设置分离!)

- `AiConfig{provider, model, api_key, base_url, language}` ←→ `~/.mindow/config.toml`
- `default_base_url()="https://api.openai.com"`(注意无 /v1, 客户端拼接时加)
- `load_config()` 文件不存在则创建默认；`mask_api_key()` 前4后4其余打码

### 7.4 baseline.rs

- `BaselineStore{entries: HashMap<name, ProcessBaseline>}` ←→ `~/.mindow/baselines.json`
- 增量平均 + max 跟踪 + 近似 p95(`avg + (max-avg)*0.6`)
- `check_memory_anomaly()`: 样本<10返回None；current/p95>1.5 返回 Some(ratio)
- **LoadResult.writable**: 文件损坏时 false, 防止覆盖损坏数据(knowledge.rs 同模式)
- key 规范化: lowercase + 去 `.exe`

### 7.5 knowledge.rs / prompt.rs / report.rs / websearch.rs

- knowledge: `ProcessKnowledge{description,category,typical_memory,risk,advice,updated}` ←→ knowledge.json (AI 分析结果缓存)
- prompt: build_system_prompt(cn/en) / build_user_prompt(系统数据→markdown) / build_search_prompt(进程搜索, 要求JSON输出, 含"不要乱判malware"规则)
- websearch: **仅 CLI 用** — DuckDuckGo Lite (POST, 无需key), 解析 `result-snippet` HTML

---

## 八、CLI (mindow-cli) — 共享 core+ai

子命令(clap): `status`(单次快照) / `watch`(持续监控, 规则引擎累积) / `report`(AI流式报告→保存markdown) / `search <name|pid>`(AI进程分析+联网+缓存) / `config {init|show|set}` / `baseline {show|reset}` / `knowledge {show|clear}`；无子命令→`interactive` REPL(rustyline, 斜杠命令+自由提问)。
全局参数: `--top/--interval/--cpu-threshold/--mem-samples/--cpu-samples/--sort/--no-color/--all`。

---

## 九、配置 & 数据文件位置

| 文件 | 路径 | 写入方 |
|------|------|--------|
| AI 配置 | `~/.mindow/config.toml` | ai/config.rs, GUI save_ai_config, CLI config |
| GUI 设置 | `~/.mindow/gui_settings.json` | GUI save_settings |
| 基线数据 | `~/.mindow/baselines.json` | 采样循环 / CLI |
| 知识缓存 | `~/.mindow/knowledge.json` | CLI search |
| AI 报告 | `~/.mindow/reports/` | CLI report |
| REPL 历史 | `~/.mindow/history.txt` | CLI interactive |
| **窗口状态** | **Tauri AppConfigDir/window_state.json** (非 ~/.mindow!) | GUI window_state.rs |

> **关键陷阱**: GUI 设置(gui_settings.json)和 AI 配置(config.toml)是**两个独立文件**。早期 bug 是 GUI 填的 key 写进 gui_settings 但 AI 后端读 config.toml → 不生效。v1.1.5 起 GUI 用 `save_ai_config` 专门写 config.toml 解决。

---

## 十、构建 & 运行

```bash
# GUI 开发 (Vite 热更新 + Rust 编译; 必须用此方式才有真实数据)
cd mindow-app && cargo tauri dev
#   注: npm run dev 只起前端, 无后端 → 图表空白. 改前端代码热更新, 改 Rust 需重编译.

cd mindow-app && npx tsc --noEmit        # 前端类型检查
cd mindow-app && npx vite build          # 前端生产构建 (输出 dist/, 约 545KB JS)
cd mindow-app && npx vitest run          # 前端测试 (15 files / 101 tests)
cargo test --workspace                   # Rust 全部测试
cd mindow-app && cargo tauri build       # 生产打包 MSI+NSIS

# CLI
cargo install --path mindow-cli          # 安装 mindow 命令
cargo run -p mindow-cli -- status        # 直接运行
```

PowerShell 注意: 不支持 `&&` 连接命令，用 `;` 或分两次执行。

---

## 十一、版本历史

| 版本 | 核心变更 |
|------|----------|
| v0.5.0 | CLI 初版: workspace + 采集 + 规则引擎 + status/watch |
| v0.8.0 | AI 集成: report/config/search + 知识库 + 基线 + SSE |
| v0.9.1/0.9.2 | 联网搜索 + 交互 REPL |
| v0.9.5 | PathStatus 三分类重构(去 Suspicious), writable 防覆盖, 最稳定 CLI |
| v1.1.0 | GUI 初版 (Tauri 2 + React) |
| v1.1.3 | 进程图标提取 + 基线标记 |
| v1.1.5 | UI/UX 大修 (problem.md 70+ 问题, 设计令牌, 图表优化, AI配置打通, Markdown渲染) |
| v1.1.6 | 前端优化 |
| **v1.2.0** | **图表完全重写(Win11风格, scales.y.range修复Y轴, 纯色填充, 电池历史图表, 资源色改hex, Lucide图标统一, 侧栏pill+设置下沉)** |

---

## 十二、当前已知问题 / 待改进 (按优先级)

🔴 **较重要**
1. **SidePanel 无焦点陷阱/role=dialog** — 键盘 Tab 穿透到背景, 无障碍缺失
2. **TitleBar 关闭 Toast 竞态** — showToast 后立即 hide(), 提示可能来不及显示
3. **useProcessIcon 轮询** — 多实例等待用 setInterval(100ms), 进程多时浪费, 应改 Promise

🟠 **中等**
4. **settingsStore 重复代码** — 每 setter 手动重建 AppSettings (~100行), 加字段易漏
5. **index.html anti-FOUC 硬编码深色背景** `#1a1a1e` — 浅色主题用户首开闪深色
6. **Toast warning 白字在黄底** — WCAG AA 对比度不足
7. **磁盘图无 yRange** — auto-scale 正确但数值可能跳动(设计取舍, 速率无固定上限)

🟡 **次要**
8. **tauri.conf.json CSP 为 null** — 生产安全隐患
9. **ProcessTable recentlyExpandedRef setTimeout** — 卸载时不清理(轻微泄漏风险)
10. **PerformancePage syncKey 已移除** — overview 模式不再存在(v1.2.0 改为单指标视图)
11. **api_key 明文存储** — config.toml / gui_settings.json 明文

---

## 十三、关键设计决策 & 陷阱

1. **无边框窗口** (`decorations:false`, **无 transparent**) + 自定义 TitleBar + ResizeHandles(8方向)
   - 历史教训: transparent:true 会破坏 Windows 拖拽/resize hit-test, 已移除
2. **拖拽/resize 用 JS API** (startDragging/startResizeDragging) + capabilities 需 `allow-start-dragging`/`allow-start-resize-dragging`
3. **Sidebar 推挤模式**(flex), **SidePanel 浮层模式**(fixed overlay 不挤压表格)
4. **进程按名分组** — 后端发原始列表, 前端 mergeProcesses 合并同名显示汇总
5. **排序全局化** — sortGroupsGlobal 跨 App/Background/System 段统一排序
6. **图标全局缓存** — Map<exePath, base64>, 空字符串表示"已知无图标"避免重试
7. **AI 流式 request_id 过滤** — 防止旧流的 delta 污染新对话; 停止=置空 requestId
8. **关闭=最小化托盘** — on_window_event 拦截 CloseRequested + prevent_close + hide
9. **图表 Y 轴必须用 scales.y.range** — 不是 axes[].range(那个不控制数据范围!)
10. **disk 字节是每间隔增量** — 前端除以 SAMPLING_INTERVAL_SECS 转每秒速率
11. **采样节奏**: 真实节奏由 sampling.rs `SAMPLING_INTERVAL_SECS=2` 决定; main.rs 的 Config.interval_secs:1 只用于规则引擎告警时长文案

---

## 十四、Tauri 事件

| 事件 | 方向 | Payload | 时机 |
|------|------|---------|------|
| `snapshot-updated` | Rust→JS | SnapshotData | 每2秒采样完成 |
| `ai-delta` | Rust→JS | {request_id, delta} | AI 流式增量 |
| `ai-done` | Rust→JS | {request_id, success, error?} | AI 响应结束/出错 |

capabilities (default.json) 已授权: window 各操作 + start-dragging/start-resize-dragging + shell:allow-open + notification + global-shortcut。

---

## 十五、i18n

- 初始化: `lng:"zh"`, `fallbackLng:"zh"`, `escapeValue:false`
- Key 命名: `tabs.*` / `processes.*.*` / `performance.*` / `ai.*` / `settings.*` / `common.*` / `search.*`
- zh.json 与 en.json **必须保持 key 完全同步**, 约 120+ keys
- 切换语言: settingsStore.setLanguage → i18n.changeLanguage + 持久化

---

## 十六、测试现状

- **前端**: Vitest, 15 文件 / 101 测试通过。含 fast-check 属性测试(heat 单调性/format 精度/搜索过滤/toast 上限/markdown/focus-ring/textarea 行数/design-token)
- **Rust core**: 各模块内联 #[cfg(test)] + tests/properties/ proptest (alert/config/filter/rule_battery/rule_high_cpu/rule_memory_leak/rule_memory_pressure/trend_buffer/path)
- **Rust GUI 后端**: commands.rs/notifications.rs/system_ops.rs/window_state.rs 均有测试(notifications 用 proptest 验证冷却, system_ops 验证 kill 幂等不 panic, window_state 验证序列化+多屏边界)
- 改动后验证三连: `npx tsc --noEmit` → `npx vite build` → `npx vitest run`
