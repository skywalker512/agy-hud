<div align="center">

<img src="docs/assets/banner.svg" alt="AGY-HUD 横幅" width="100%" />

<p>
  <strong>适用于 Google Antigravity 应用的实时生成速度、TTFT、实际路由模型标识与上下文用量监控插件</strong>
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/Node.js-22.5%2B%20node%3Asqlite-06b6d4?style=flat-square" alt="Node.js 22.5+ node:sqlite" />
  <img src="https://img.shields.io/badge/Runtime%20Deps-Zero-10b981?style=flat-square" alt="零运行时依赖" />
  <img src="https://img.shields.io/badge/UI-EN%20%2F%20%E4%B8%AD%E6%96%87-6366f1?style=flat-square" alt="EN / 中文" />
</p>

<p>
  <a href="README.md">English</a> ·
  <strong>简体中文</strong>
</p>

<p>
  <a href="#overview">功能介绍</a> ·
  <a href="#quick-start">快速开始</a> ·
  <a href="#protobuf-map">数据字段说明</a> ·
  <a href="#development">开发</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

</div>

---

<div align="center">
  <img src="docs/assets/hud-showcase.svg" alt="AGY-HUD 侧边栏预览" width="60%" />
</div>

---

## <a id="overview"></a>功能介绍

**AGY-HUD** 是一款面向 Google Antigravity 2.0 应用的侧边栏插件。它以只读模式解析本地 SQLite 对话数据库（`~/.gemini/antigravity/conversations/<uuid>.db` 及其 `-wal` 日志），并按需读取本机回环 Language Server 状态，用于展示流式正文与 5h/7d 配额窗口。无需代理外部 API 请求，即可实时监控生成速度、`TTFT`、**实际路由到的后端模型标识**、上下文窗口构成、分阶段耗时、子智能体 / Side Question 拓扑关系以及 API 等价成本。

### 主要特性

- **优先读取实际路由模型标识**：优先展示 `gen_metadata` 中实际路由到的后端模型标识 `f19`（例如 `gemini-4-carbon`、`gemini-3.8-flash-k`），并自动归一化 LS 模型别名（如 `-high` 后缀与 `MODEL_PLACEHOLDER_*`）；同时读取真实上下文窗口上限 `f9.f10.f4`（如 `256,000`）。
- **生成速度、端到端速度与阶段诊断**：同时展示首字后流式速率（`GEN TPS`）与含 `TTFT` 的端到端速率（`E2E TPS`）。单包缓冲响应标记为 `BUF`，并从 `PEAK TPS` 与加权 `AVG GEN` 中剔除，避免出现均值高于峰值的失真；针对短输出但流式工具参数等待较慢的请求，自动拆分 `思考 (THK)` 与 `工具生成 (TOOL GEN / 工具等待)` 阶段，并将工具耗时起点钳制在模型流式完成之后。
- **三页签侧边栏面板（`实时` / `调用` / `账户`）**：
  - **实时 (Live)**：实时生成与端到端速度卡片、上下文五维构成拆解（系统提示、工具定义、工具返回、模型回复、用户/检查点及单工具占用排行）、支持流式自动跟随到底部的 `思考摘要` / `模型回复` 实时预览，以及主子会话 / `Side Q` 一键跳转。
  - **调用 (Calls)**：五维指标趋势柱状图（速度 / 首字 / 输出 / 缓存率 / 上下文）、轮次折叠、上下文压缩卡片以及按需展开的完整调用正文（上限 `60k` 字符）。
  - **账户 (Account)**：`5h` / `7d` 双窗口模型池配额与重置倒计时、本地 API 等价账单（当前会话 / 今日 / 本月 / 全部历史）、缓存节省金额及大规模历史库后台异步索引。
- **零运行时依赖**：侧边栏插件直接运行在 Antigravity 自带的 `sidecar_sdk` 与 Node.js 22.5+ 内置 `node:sqlite` 上；界面为预构建产物，支持随时切换 `EN` / `中文`。

---

## <a id="quick-start"></a>快速开始

一键安装到 `~/.gemini/config/plugins/agy-hud`（若侧边栏图标未立即出现，重新加载或重启 Antigravity 即可）：

```bash
# 复制安装（先写入临时目录再原子替换；需要 Node.js >= 22.5）
node plugin/install.mjs

# 或使用软链接开发模式（修改仓库代码实时热重载）
node plugin/install.mjs --link
```

卸载插件：

```bash
node plugin/install.mjs --uninstall
```

---

## <a id="protobuf-map"></a>数据字段说明

AGY-HUD 从 `~/.gemini/antigravity/conversations/<uuid>.db` 的 `gen_metadata` 与 `steps` 表中读取以下字段：

| 字段路径 | 对应数据 | 备选回退 |
| :--- | :--- | :--- |
| `gen_metadata.f1.f19` | **实际路由到的后端模型标识**（如 `gemini-3.8-flash-k`） | 仅作兜底的前端展示名称（`f1.f21`） |
| `gen_metadata.f1.f4` | 缓存（`f5`）、新输入（`f2`）、输出（`f3` 或 `f1`）、思考（`f9`）、可见正文（`f10`） | 旧版统计字段（`f1.f17.f2`） |
| `gen_metadata.f1.f9.f10` | 当前上下文用量（`f1`）与窗口上限（`f4`，如 `256,000`） | `缓存 + 新输入`；内置模型上限表 |
| `gen_metadata.f1.f11` / `f1.f12` | 首字延迟（`TTFT`，`f11`）与流式生成时长（`f12`） | `0.0s` |
| `steps`（`status != 3`） | 进行中生成步骤（`step_type = 15`）已运行时间、非生成步骤的 `TOOL` 状态，并通过 `f1.f20` 对齐调用时间戳 | 空闲状态 |

---

## <a id="development"></a>开发

侧边栏后端位于 `plugin/sidecars/hud_panel/`，无需构建。界面源码在 `web/`（Preact + TypeScript + Tailwind），构建产物输出到 `plugin/sidecars/hud_panel/ui/`：

```bash
cd web
npm install
npm run build      # 类型检查并构建到插件的 ui/ 目录
npm run dev        # 监听改动自动重建（配合 `node plugin/install.mjs --link` 使用）
```

运行测试：

```bash
node --test plugin/sidecars/hud_panel/test/server.test.mjs
```

---

## 项目目录结构

```text
agy-hud/
├── plugin/                      # Antigravity 2.0 侧边栏插件（实际安装的内容）
│   ├── plugin.json              # 插件清单文件
│   ├── install.mjs              # 安装 / 卸载脚本
│   ├── assets/logo.svg          # 插件图标
│   └── sidecars/hud_panel/      # node:sqlite 后端（lib/、pricing.json）与构建后的界面（ui/）
├── web/                         # 界面源码（Preact + TypeScript + Tailwind）
├── tools/                       # 调用轨迹录制 / 回放工具，用于生成回归测试样本
├── docs/
│   └── assets/                  # SVG 横幅与界面预览图
├── CHANGELOG.md
└── LICENSE
```

---

## 开源协议

基于 [MIT License](LICENSE) 开源。
