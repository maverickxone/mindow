# Mindow

> Mind + Window — Windows 系统资源监控 + AI 分析工具

实时查看进程资源占用，AI 帮你分析哪些进程异常、该不该关。提供 GUI 桌面应用和 CLI 命令行两种使用方式。

## 下载安装

### GUI 桌面应用（推荐）

从 [Releases](../../releases) 页面下载最新的 `Mindow_x.x.x_x64-setup.exe`，双击安装即可使用。

- 支持 Windows 10/11 64 位
- 安装后从开始菜单或桌面快捷方式启动
- 首次安装可能弹出 Windows SmartScreen 提示，点击"仍要运行"即可（开源软件未购买代码签名证书）

> 💡 AI 功能需要配置 API 密钥：打开应用 → 设置页 → AI 配置区域填写 provider、model、base_url、api_key → 点击保存

### CLI 命令行工具

从 [Releases](../../releases) 页面下载 `mindow.exe`，放到任意目录即可运行。

> 可选：加入系统 PATH 环境变量后，在任意位置打开终端都能直接输入 `mindow`。

## 架构与技术栈

```
mindow
├── core/              纯 Rust 库：数据采集、过滤、规则引擎
├── ai/               AI 集成：LLM 客户端、知识库、基线学习
├── mindow-cli/       CLI 命令行工具
├── mindow-app/       GUI 桌面应用（Tauri 2 + React）
└── .github/workflows/ CI：push tag 自动构建 Release
```

- **GUI**: Tauri 2 + React 18 + TypeScript + Tailwind CSS + uPlot
- **后端**: Rust + sysinfo + Win32 API
- **AI**: 支持 OpenAI 兼容 API 和 Claude API，流式输出
- **平台**: 仅 Windows 10/11

## 配置 AI（首次使用必读）

Mindow 的核心功能（`report`、`search`、交互问答）依赖 AI API。你需要有一个 API key。

### 支持的 AI 服务

| Provider | 说明 | 推荐模型 |
|----------|------|----------|
| OpenAI 兼容 | OpenAI、DeepSeek、硅基流动等任何兼容接口 | gpt-4o-mini / deepseek-chat |
| Claude | Anthropic Claude API | claude-sonnet-4-20250514 |

### 配置步骤

```powershell
# 交互式配置（推荐，一步步引导你填写）
mindow config init

# 或者手动设置各字段
mindow config set provider openai
mindow config set api_key sk-你的密钥
mindow config set model deepseek-chat
mindow config set base_url https://api.deepseek.com
mindow config set language cn
```

### 配置文件位置

`~/.mindow/config.toml`（Windows 下通常是 `C:\Users\你的用户名\.mindow\config.toml`）

```toml
provider = "openai"                    # openai | claude
model = "deepseek-chat"                # 模型名称
api_key = "sk-..."                     # 你的 API 密钥
base_url = "https://api.deepseek.com"  # API 地址
language = "cn"                        # cn | en（AI 回复语言）
```

### 常见 API 配置示例

**DeepSeek（推荐，便宜好用）**
```powershell
mindow config set provider openai
mindow config set base_url https://api.deepseek.com
mindow config set model deepseek-chat
mindow config set api_key sk-你的deepseek密钥
```

**OpenAI**
```powershell
mindow config set provider openai
mindow config set base_url https://api.openai.com
mindow config set model gpt-4o-mini
mindow config set api_key sk-你的openai密钥
```

**Claude**
```powershell
mindow config set provider claude
mindow config set base_url https://api.anthropic.com
mindow config set model claude-sonnet-4-20250514
mindow config set api_key sk-ant-你的claude密钥
```

> 💡 不配置 AI 也能用 `mindow status` 和 `mindow watch`，只是没有 AI 分析功能。

## 使用方式

配置完成后，推荐直接运行 `mindow` 进入交互模式，输入 `/help` 查看所有可用命令：

```powershell
mindow
```

也可以直接执行单次命令而不进入交互模式：

```powershell
mindow status          # 一次性系统快照
mindow watch           # 持续监控
mindow search kiro     # AI 分析某个进程
mindow report          # AI 生成完整报告
```

### 全局参数

所有命令都支持以下参数：

```
--top N              显示前 N 组进程（默认 25）
--sort mem|cpu|name  排序方式（默认 mem）
--interval N         watch 模式刷新间隔秒数（默认 10）
--no-color           禁用彩色输出
--all                显示全部进程（不限制 top-N）
```

## 功能说明

### `mindow status` — 系统快照

一次性采集当前系统状态，展示进程列表、内存/CPU 使用率、电池信息。

```powershell
mindow status              # 默认按内存排序，显示前 25 组
mindow status --sort cpu   # 按 CPU 排序
mindow status --top 10     # 只显示前 10 组
mindow status --all        # 显示全部进程
```

输出内容：
- **SYSTEM 区域**: CPU 平均使用率、内存使用率（带进度条）、电池状态
- **PROCESSES 区域**: 进程名（同名自动合并）、CPU%、内存、状态标记
  - `[S]` 蓝色 = System 系统进程
  - `[U]` 白色 = User 用户安装的应用
  - `[?]` 黄色 = Unknown 无法读取路径
- **ALERTS 区域**: 如果有内存压力等异常会显示告警（status 单次运行只检测瞬时告警）

![status 命令效果](screenshots/status.png)

### `mindow watch` — 持续监控

像任务管理器一样持续刷新，每隔 N 秒重新采集一次。规则引擎在此模式下累积数据，可以检测内存泄漏和持续高 CPU。

```powershell
mindow watch               # 默认 10 秒刷新一次
mindow watch --interval 3  # 3 秒刷新
mindow watch --sort cpu    # 按 CPU 排序
```

按 `Ctrl+C` 退出。watch 模式下规则引擎会逐步积累数据：
- 运行 5 个周期后（默认 50 秒），内存泄漏和高 CPU 检测开始生效
- 如果检测到异常，ALERTS 区域会实时显示告警

### `mindow search <进程名>` — AI 分析单个进程

查询某个进程是什么、是否安全、是否占用异常。

```powershell
mindow search kiro          # 按名字搜索（模糊匹配）
mindow search 4160          # 按 PID 搜索
mindow search kiro --refresh  # 跳过缓存，强制重新询问 AI
```

工作流程：
1. 在当前运行的进程中查找匹配项
2. 联网搜索（DuckDuckGo）获取该进程的公开信息
3. 将进程数据 + 搜索结果 + 历史基线一起发给 AI
4. AI 返回：软件描述、类别、典型内存范围、风险等级（safe/caution）、建议
5. 结果自动缓存到 knowledge.json，下次查询同一进程秒出结果

### `mindow report` — AI 系统分析报告

让 AI 综合分析整个系统状态，生成一份完整的健康报告。

```powershell
mindow report              # 中文报告（默认）
mindow report --lang en    # 英文报告
```

报告内容（AI 流式输出，逐字显示）：
1. 系统概要 — 整体健康状况评估
2. 异常分析 — 解释检测到的问题
3. 具体建议 — 可操作的优化建议

报告自动保存到 `~/.mindow/reports/` 目录，带时间戳文件名。

### `mindow`（交互模式）— REPL 界面

不带任何子命令直接运行 `mindow`，进入交互式界面。

```powershell
mindow
```

交互模式支持两种输入方式：

**斜杠命令**（等同于上面的单次命令）：
```
> /status              等同于 mindow status
> /search kiro         等同于 mindow search kiro
> /report              等同于 mindow report
> /config              查看 AI 配置
> /config set key val  修改配置
> /baseline            查看进程基线数据
> /knowledge           查看 AI 知识缓存
> /clear               清屏
> /help                显示帮助（选择命令后显示详细用法）
> /quit                退出（或按两次 Ctrl+C）
```

**自由提问**（直接打字，AI 自动结合当前系统数据回答）：
```
> 为什么我的内存占用这么高？
> chrome 是不是有问题？
> 哪些进程可以关掉来省电？
> 我的系统现在健康吗？
```

每次提问时，程序会自动采集一次系统快照作为上下文发送给 AI，所以 AI 的回答是基于你当前实时的系统状态。

### `mindow config` — 配置管理

```powershell
mindow config init              # 交互式引导，一步步填写所有配置
mindow config show              # 显示当前配置（API key 会脱敏显示）
mindow config set <key> <value> # 修改单个字段
```

可设置的字段：`provider`、`model`、`api_key`、`base_url`、`language`

### `mindow baseline` — 基线数据管理

程序每次运行 status/watch 时会自动学习每个进程的"正常"资源占用水平。

```powershell
mindow baseline show    # 查看所有进程的历史统计（平均内存、最大内存、平均 CPU）
mindow baseline reset   # 清空所有基线数据，从头学习
```

基线数据用于 AI 分析时判断某个进程是否"异常偏高"。

### `mindow knowledge` — AI 知识缓存管理

AI 分析过的进程信息会缓存起来，避免重复查询浪费 API 额度。

```powershell
mindow knowledge show   # 查看所有缓存的进程知识
mindow knowledge clear  # 清空缓存（下次 search 会重新查询 AI）
```

### 数据存储

所有数据存储在 `~/.mindow/` 目录下：

```
~/.mindow/
├── config.toml        AI 配置
├── baselines.json     进程历史基线数据
├── knowledge.json     AI 进程知识缓存
├── reports/           AI 分析报告存档
└── history.txt        交互模式命令历史
```

## 资源占用

| 资源 | 消耗 |
|------|------|
| 内存 | ~20 MB（常驻） |
| CPU | ~0%（10 秒一次采集，每次几十毫秒） |
| 磁盘 | 每次采集写几 KB |
| 网络 | 仅在 AI 分析时调用 API |

## License

MIT
