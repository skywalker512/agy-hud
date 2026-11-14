<div align="center">

<img src="docs/assets/banner.svg" alt="AGY-HUD 横幅" width="100%" />

<p>
  <strong>适用于 Google Antigravity 的实时生成速度、TTFT、实际路由模型标识与上下文用量监控工具</strong>
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/Python-3.9%2B%20Stdlib-3b82f6?style=flat-square" alt="Python 3.9+ 标准库" />
  <img src="https://img.shields.io/badge/Node.js-22.5%2B%20node%3Asqlite-06b6d4?style=flat-square" alt="Node.js 22.5+ node:sqlite" />
  <img src="https://img.shields.io/badge/Dependencies-Zero%20External-10b981?style=flat-square" alt="零外部依赖" />
  <img src="https://img.shields.io/badge/UI-EN%20%2F%20%E4%B8%AD%E6%96%87-6366f1?style=flat-square" alt="EN / 中文" />
  <img src="https://img.shields.io/badge/Docs-8%20Languages-ec4899?style=flat-square" alt="8 种语言文档" />
</p>

<p>
  <a href="README.md">English</a> ·
  <strong>简体中文</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p>
  <a href="#overview">功能介绍</a> ·
  <a href="#quick-start">快速开始</a> ·
  <a href="#protobuf-map">数据字段说明</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

</div>

---

<div align="center">
  <img src="docs/assets/hud-showcase.svg" alt="AGY-HUD 桌面悬浮窗与侧边栏插件预览" width="100%" />
</div>

---

## <a id="overview"></a>功能介绍

**AGY-HUD** 是一款面向 Google Antigravity 的侧边栏插件、桌面悬浮监控窗与命令行工具。它以只读模式直接解析本地 SQLite 对话数据库（`~/.gemini/antigravity/conversations/<uuid>.db` 及其 `-wal` 日志；侧边栏插件在 IDE 内还会按需读取本机回环 Language Server 状态以展示流式正文与 5h/7d 配额窗口），无需代理外部 API 请求，即可实时监控生成速度、`TTFT`、**实际路由到的后端模型标识**、上下文窗口精细构成、分阶段耗时、子智能体 / Side Question 拓扑关系以及 API 等价成本。

### 主要特性

- **优先读取实际路由模型标识**：优先展示 `gen_metadata` 中实际路由到的后端模型标识 `f19`（例如 `gemini-4-carbon`、`gemini-3.8-flash-k`），并自动归一化 LS 模型别名（如 `-high` 后缀与 `MODEL_PLACEHOLDER_*`）；同时读取真实上下文窗口上限 `f9.f10.f4`（如 `256,000`）。
- **生成速度、端到端速度与阶段诊断**：同时展示首字后流式速率（`GEN TPS`）与含 `TTFT` 的端到端速率（`E2E TPS`）。单包缓冲响应标记为 `BUF`，同时从 `PEAK TPS` 与加权 `AVG GEN` 中剔除，避免出现均值高于峰值的失真；针对短输出但流式工具参数等待较慢的请求自动拆分 `思考 (THK)` 与 `工具生成 (TOOL GEN / 工具等待)` 阶段，并将工具耗时起点钳制在模型流式完成之后。
- **三页签侧边栏面板（`实时` / `调用` / `账户`）**：
  - **实时 (Live)**：实时生成与端到端速度卡片、上下文五维构成拆解（系统提示、工具定义、工具返回、模型回复、用户/检查点及单工具占用排行）、支持流式自动跟随到底部的 `思考摘要` / `模型回复` 实时预览，以及主子会话 / `Side Q` 一键跳转。
  - **调用 (Calls)**：五维指标趋势柱状图（速度 / 首字 / 输出 / 缓存率 / 上下文）、轮次折叠、上下文压缩卡片以及按需展开的完整调用正文（上限提升至 `60k` 字符）。
  - **账户 (Account)**：`5h` / `7d` 双窗口模型池配额与重置倒计时、本地 API 等价账单（当前会话 / 今日 / 本月 / 全部历史）、缓存节省金额及大规模历史库后台异步索引。
- **零外部第三方依赖**：命令行模式（`--cli`、`--watch`、`--data-dir`）仅依赖 Python 3.9+ 标准库且不依赖 `tkinter`（仅启动桌面悬浮窗时按需加载 `tkinter`）；侧边栏插件直接运行在 Antigravity 自带的 `sidecar_sdk` 与 Node.js 22.5+ 内置 `node:sqlite` 上，支持随时切换 `EN` / `中文`。

---

## <a id="quick-start"></a>快速开始

### 1. Antigravity 2.0 侧边栏插件

一键安装到 `~/.gemini/config/plugins/agy-hud`（若侧边栏图标未立即出现，重新加载或重启 Antigravity 即可）：

```bash
# 复制安装（先写入临时目录再原子替换；需要 Node.js >= 22.5）
python plugin/install_plugin.py

# 或使用软链接开发模式（修改仓库代码实时热重载）
python plugin/install_plugin.py --link
```

卸载插件：

```bash
python plugin/install_plugin.py --uninstall
```

### 2. 独立桌面悬浮窗与命令行工具

完全独立运行，不会修改 Antigravity 的任何现有插件配置：

- **Windows 桌面直接启动（不弹出控制台窗口）**：双击运行 `desktop/launch.bat` 或 `desktop/launch.pyw`
- **Python 图形界面 / 命令行**：

```bash
# 启动桌面悬浮窗（默认英文界面，500ms 刷新，透明度 92%）
python -m desktop.cli

# 可选参数：--lang en|zh，--refresh-ms 500，--alpha 0.92
python -m desktop.cli --lang zh --refresh-ms 1000

# 在终端输出一次当前状态后退出（无 tkinter 的无头 Python 环境亦可直接运行）
python -m desktop.cli --cli

# 在终端中监听变化，每当完成新的一轮调用时输出一行摘要（支持 --data-dir 指定目录）
python -m desktop.cli --watch --interval 1.0
```

> [!TIP]
> 左键按住悬浮窗顶部可拖动位置（锁定后固定），点击 `▾` 或双击标题文字可展开/收起详情卡片；在窗口任意位置**点击鼠标右键**，即可切换**语言（`EN` / `中文`）**、**始终置顶**、**锁定位置**、**透明度（`100%`–`50%`）**与**刷新频率（`0.5s`–`5s`）**。

---

## <a id="protobuf-map"></a>数据字段说明

AGY-HUD 从 `~/.gemini/antigravity/conversations/<uuid>.db` 的 `gen_metadata` 与 `steps` 表中读取以下字段：

| 字段路径 | 对应数据 | 备选回退 |
| :--- | :--- | :--- |
| `gen_metadata.f1.f19` | **实际路由到的后端模型标识**（如 `gemini-3.8-flash-k`） | 仅作兜底的前端展示名称（`f1.f21`） |
| `gen_metadata.f1.f4` | 缓存（`f5`）、新输入（`f2`）、输出（`f3` 或 `f1`）、思考（`f9`）、可见正文（`f10`） | 旧版统计字段（`f1.f17.f2`） |
| `gen_metadata.f1.f9.f10` | 当前上下文用量（`f1`）与窗口上限（`f4`，如 `256,000`） | `缓存 + 新输入`；内置模型上限表 |
| `gen_metadata.f1.f11` / `f1.f12` | 首字延迟（`TTFT`，`f11`）与流式生成时长（`f12`） | `0.0s` |
| `steps`（`status != 3`） | 进行中生成步骤（`step_type = 15`）已运行时间；侧边栏插件同时显示非生成步骤的 `TOOL` 状态并通过 `f1.f20` 对齐调用时间戳 | 空闲状态 |

---

## 项目目录结构

```text
agy-hud/
├── desktop/                     # Python 3.9+ 标准库桌面悬浮窗与 CLI
│   ├── telemetry.py             # 只读 SQLite (?mode=ro) + WAL 与 protobuf 解析模块
│   ├── hud_pill.py              # Tkinter 无边框悬浮胶囊、详情卡片与 EN/中文界面
│   ├── cli.py                   # 图形界面 / --cli / --watch 统一入口
│   ├── launch.pyw               # Windows 静默后台启动脚本
│   └── launch.bat               # Windows 双击启动脚本
├── plugin/                      # Antigravity 2.0 侧边栏插件
│   ├── plugin.json              # 插件清单文件
│   ├── install_plugin.py        # 安装 / 卸载脚本
│   ├── assets/logo.svg          # 插件图标
│   └── sidecars/hud_panel/      # node:sqlite 后端（450ms 轮询、ETag）与网页界面
├── docs/
│   └── assets/                  # SVG 横幅与界面预览图
├── pyproject.toml
├── CHANGELOG.md
└── LICENSE
```

---

## 开源协议

基于 [MIT License](LICENSE) 开源。
