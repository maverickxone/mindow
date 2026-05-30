# Changelog

## v0.9.5 (2026-05-31)

大规模修复和重构，当前最稳定版本。

### 修复
- **版本号统一** — 两个 Cargo.toml 都使用 0.9.5，代码中用 `env!("CARGO_PKG_VERSION")` 消除硬编码
- **PathStatus 重构** — 去掉 Suspicious，改为 System/User/Unknown 三分类，消除大量误报
- **错误处理改进** — baseline.rs 和 knowledge.rs 引入 `writable` 标志，防止损坏文件被静默覆盖
- **WebSearch 修复** — 切换到 DuckDuckGo Lite（POST），解析更稳定，有重试逻辑
- **规则引擎精简** — 删除 SuspiciousPath 规则（不属于资源监控工具的职责）

### 改进
- 电池告警和内存压力规则适配新 PathStatus（System 进程不参与告警）
- 渲染器更新：System=[S] cyan，User=[U] white，Unknown=[?] yellow
- 进程分组合并时 PathStatus 按 User > Unknown > System 优先级

---

## v0.9.2 (2026-05-30)

新增交互模式。

### 新增
- `mindow`（无子命令）进入交互式 REPL
- 斜杠命令：/status, /search, /report, /config, /baseline, /knowledge, /clear, /help, /quit
- 自由文本直接问 AI（自动附带系统快照做上下文）
- `rustyline` 行编辑 + 命令历史持久化（~/.mindow/history.txt）
- `dialoguer` 帮助命令选择器
- 双击 Ctrl+C 退出

### 删除
- 移除 `mindow update` 命令（Windows 无法自我替换运行中的 exe）

---

## v0.9.1 (2026-05-30)

Search 改进 + 联网搜索。

### 修复
- search 命令使用合并后的进程数据（之前只匹配单个子进程 33MB，现在展示合计 2.5GB）
- 基线数据按合并总量记录

### 新增
- DuckDuckGo 联网搜索（websearch.rs），为 AI 提供额外上下文
- search 输出增加丰富颜色（边框 cyan，标签 bold，风险着色）
- `--refresh` 参数跳过缓存重新查询 AI

---

## v0.8.0 (2026-05-30)

AI 集成。

### 新增
- `mindow report` — 调 AI 生成系统分析报告，流式输出 + 保存 Markdown
- `mindow config init/show/set` — 配置管理（provider/model/api_key/base_url/language）
- `mindow search <name|PID>` — AI 进程分析
- 知识库缓存（~/.mindow/knowledge.json）
- 基线学习（~/.mindow/baselines.json）
- 支持 OpenAI 和 Claude 两种 API 协议
- SSE 流式解析器
- 报告保存到 ~/.mindow/reports/
- `indicatif` 加载动画
- GitHub Actions release workflow
- MIT LICENSE

---

## v0.5.0 (2026-05-29)

首个可用版本 — 规则引擎 + CLI。

### 新增
- Cargo workspace：core/（库）+ mindow-cli/（二进制）
- 数据采集：sysinfo + battery crate
- 预过滤：Top-N by memory/CPU，路径分类，去重合并
- 规则引擎：内存泄漏、持续高 CPU、内存压力（滞回防抖）、电量告警
- CLI：`mindow status`（快照）+ `mindow watch`（持续监控）
- 彩色终端输出（进度条、着色）
- 同名进程合并显示
- 属性测试（proptest）
- `--sort`、`--top`、`--all`、`--no-color` 参数
