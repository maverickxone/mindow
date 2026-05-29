# Mindow

> Mind + Window — 开源 AI 系统资源分析工具

Windows 系统资源监控 + AI 分析。纯 Rust 实现，单个 exe，零依赖运行。

## 功能

- 进程资源监控（内存、CPU），同名进程自动合并
- 规则引擎检测：内存泄漏、持续高 CPU、内存压力、低电量告警、可疑路径
- AI 分析报告：接入 OpenAI / Claude API，自然语言解释系统状态
- 流式输出：AI 回答实时逐字显示
- 报告存档：自动保存到 `~/.mindow/reports/`

## 安装

### 下载可执行文件
从 [Releases](../../releases) 页面下载 `mindow.exe`。

### 从源码安装
```bash
cargo install --git https://github.com/YOUR_USERNAME/mindow.git --bin mindow
```

## 快速开始

```powershell
# 1. 配置 AI
mindow config init

# 2. 系统快照
mindow status

# 3. AI 分析报告
mindow report

# 4. 持续监控
mindow watch
```

## 命令

| 命令 | 说明 |
|------|------|
| `mindow status` | 系统快照 |
| `mindow watch` | 持续监控 (Ctrl+C 退出) |
| `mindow report` | AI 分析报告 |
| `mindow config init` | 交互式配置 |
| `mindow config show` | 显示配置 |
| `mindow config set <key> <value>` | 设置配置项 |
| `mindow update` | 更新到最新版本 |

## 参数

```
--top N              显示前 N 组进程（默认 25）
--sort mem|cpu|name  排序方式（默认 mem）
--interval N         watch 刷新间隔秒数（默认 10）
--lang cn|en         AI 报告语言（默认 cn）
--all                显示全部进程
--no-color           禁用颜色
```

## 配置

配置文件位置：`~/.mindow/config.toml`

```toml
provider = "openai"       # openai | claude
model = "gpt-4o-mini"     # 模型名称
api_key = "sk-..."        # API 密钥
base_url = "https://api.openai.com"  # API 地址
language = "cn"           # cn | en
```

## 架构

```
core/        系统数据采集、过滤、规则引擎（纯 Rust 库）
mindow-cli/  CLI + AI 集成（二进制）
```

## License

MIT
