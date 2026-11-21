# 安装、环境诊断与安全自升级指南

> [English](INSTALLATION.md) · **简体中文** · [返回首页](../README.zh-CN.md) · [完整使用与技术指南](GUIDE.zh-CN.md)

本文档详细介绍如何在 **macOS**、**Linux** 与 **Windows** 上安装、诊断、升级及排查 **AGY-HUD** 插件。

---

## 环境要求

| 依赖项 | 版本 / 说明 |
| :--- | :--- |
| **Node.js** | **22.18+**（`>=22.18.0`，用于内置 `node:sqlite` 与原生 TypeScript 类型剥离执行） |
| **Google Antigravity** | **Antigravity 2.0**（桌面客户端、CLI `agy`、ACP 或 IDE） |
| **macOS / Linux 基础工具** | `curl` 或 `wget`，以及 `tar`（仅单行脚本安装需要） |
| **Windows 终端** | 系统自带 PowerShell 5.1+ 或 PowerShell 7+（`pwsh`） |

检查当前 Node.js 版本：

```bash
node -v
# 预期输出：v22.18.0 或更高版本（如 v22.21.x、v24.x）
```

---

## 1. 跨平台单行一键安装

单行安装脚本会自动检测 Node.js `>= 22.18`，对照严格白名单校验 GitHub 下载地址，防范压缩包路径穿越（zip-slip），执行原子安装，并在最后自动运行 `--doctor` 完成健康校验。

### macOS / Linux

```sh
curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh
```

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex
```

### 可选环境变量

`scripts/install.sh` 与 `scripts/install.ps1` 均支持以下 4 个环境变量：

| 环境变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `AGY_HUD_VERSION` | 安装指定发布标签（如 `1.2.0` 或 `v1.2.0`） | 最新 GitHub Release（无发布时回退至 `main`） |
| `AGY_HUD_REF` | 安装指定 Git 分支或引用（如 `main`） | *（未设置）* |
| `AGY_HUD_TARGET` | 自定义插件安装目录 | `~/.gemini/config/plugins/agy-hud` |
| `AGY_HUD_REPO` | 自定义 GitHub `owner/repo` 仓库 | `skywalker512/agy-hud` |

**示例：**

```sh
# macOS / Linux —— 安装指定版本到自定义目录
AGY_HUD_VERSION=v1.2.0 AGY_HUD_TARGET=/custom/path/agy-hud \
  curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh
```

```powershell
# Windows PowerShell —— 安装指定版本
$env:AGY_HUD_VERSION = "v1.2.0"
irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex
```

---

## 2. 源码安装、开发软链接与 CLI 命令参考

如果你在本地克隆了仓库，可以直接使用零依赖脚本 `plugin/install.mjs` 完成安装、软链接开发、更新、诊断和卸载：

```bash
git clone https://github.com/skywalker512/agy-hud.git
cd agy-hud
```

### 子命令

| 命令 | 说明 |
| :--- | :--- |
| `node plugin/install.mjs` *（或 `--install`）* | 以临时目录暂存并原子替换方式复制到 `~/.gemini/config/plugins/agy-hud`（若缺少预构建 UI 产物会自动构建 `web/`）。 |
| `node plugin/install.mjs --link` | 将 `plugin/` 目录直接链接到 Antigravity 插件目录，支持开发热重载（macOS/Linux 创建目录符号链接，Windows 创建目录联接 `junction`，无需管理员权限）。 |
| `node plugin/install.mjs --doctor` | 运行 6 项环境与插件健康诊断（见第 3 节）。 |
| `node plugin/install.mjs --check-update` | 检查 GitHub（`skywalker512/agy-hud`）是否有更高 SemVer 版本，不修改磁盘文件。 |
| `node plugin/install.mjs --update` | 下载、校验、安全解压并原子升级已安装插件，失败时自动回滚至原版本。 |
| `node plugin/install.mjs --uninstall` | 干净移除已安装的插件目录或开发软链接。 |

### 参数选项

| 参数 | 适用命令 | 说明 |
| :--- | :--- | :--- |
| `--target <dir>` | 全部命令 | 指定自定义插件安装目录（默认 `~/.gemini/config/plugins/agy-hud`），适合测试或企业环境。 |
| `--source <dir>` | `--install` / `--link` / `--version` | 指定源插件目录路径。 |
| `--force` | `--update` | 允许覆盖 `--link` 开发软链接，或强制重新安装同一版本。 |
| `--ref <tag>` / `--tag <tag>` | `--update` | 升级至指定 GitHub Release 标签（例如 `--ref v1.3.0`）。 |
| `--no-build` | `--install` | 缺少预构建 UI 时直接报错，不自动执行 `npm --prefix web run build`。 |
| `--json` | `--doctor` / `--check-update` / `--update` | 向标准输出打印结构化 JSON，便于脚本或 CI 集成。 |
| `-v` / `--version` | 独立使用 | 输出本地 `plugin/plugin.json` 版本号。 |
| `-h` / `--help` | 独立使用 | 显示完整命令行帮助信息。 |

> **安装完成后**：若侧边栏未立即出现 AGY-HUD 图标，请重启 Antigravity 或重新加载插件。

---

## 3. 环境健康诊断（`--doctor`）

运行 `node plugin/install.mjs --doctor`（或 `--doctor --json`）即可一键排查环境状态：

```bash
node plugin/install.mjs --doctor
```

诊断涵盖 6 个检查项：

1. **`platform`**：输出操作系统、CPU 架构及内核版本。
2. **`node`**：校验 Node.js `>= 22.18`，并实际 `import('node:sqlite')` 验证 `DatabaseSync` 可用。
3. **`antigravity_data`**：探测 `ANTIGRAVITY_APP_DATA_DIR` 及 `~/.gemini/{antigravity,antigravity-cli,antigravity-acp,antigravity-ide}` 下的 `conversations/` 目录（若尚未运行过 Antigravity 则提示 `WARN`）。
4. **`agy_cli`**：检查 `PATH` 中是否包含 `agy` 命令行工具及版本（仅作 `WARN` 提示，桌面端用户可选）。
5. **`plugin_install`**：校验插件目录、合法的 `plugin.json` 清单、`--link` 链接目标以及后端文件（`server.ts`、`sidecar.json`）。
6. **`ui_bundle`**：校验预构建前端产物（`index.html`、`app.js`、`styles.css`）存在且非空，并报告各文件体积。

---

## 4. 应用内一键自升级与安全架构

AGY-HUD 内置零外部依赖的自升级引擎（`plugin/sidecars/hud_panel/lib/updater.ts`），通过 `GET /api/update-status` 与 `POST /api/update-apply` 向前端提供服务。

### 应用内升级流程

- **无打扰检测**：面板加载时调用 `GET /api/update-status`（具备 **6 小时**内存 + 磁盘缓存 `update-cache.json`）。优先查询 GitHub Releases，若尚无 Release 则依次回退至 SemVer 标签和 `main/plugin/plugin.json`。
- **最新状态零干扰**：仅当检测到新版本且当前**不是** `--link` 开发链接模式时，顶部栏才会出现紧凑的 `↑ vX.Y.Z` 徽章。
- **一键升级（账户页签 → 插件与更新）**：
  - 展示当前版本、安装模式（`已安装` / `开发软链接`）、上次检查时间、`[检查更新]` 按钮、更新说明链接与 `[立即更新]` 按钮。
  - **智能重载判断**：升级前对后端文件计算 SHA-256 哈希对比：
    - *仅界面更新*（`uiReloadOnly: true`）：前端静态资源自动热加载。
    - *包含后端更新*（`restartRequired: true`）：配合 `server.ts` 的 `startSelfWatch()` 并在 `750 ms` 后优雅退出，由 Antigravity 自动拉起新版 sidecar，同时界面提示 `[立即重载]`。
  - **开发链接保护**：处于 `--link` 模式（或位于 git 仓库中）时，应用内自升级自动禁用（`reason: "dev_symlink"`），避免误覆盖本地开发代码；请直接使用 `git pull`（或通过 CLI `node plugin/install.mjs --update --force` 转为发行版安装）。

### 多重安全防线

无论通过界面还是 `node plugin/install.mjs --update` 升级，均强制执行以下安全策略：

| 防护层 | 安全保障 |
| :--- | :--- |
| **严格 HTTPS GitHub 白名单** | 仅允许 443 端口、无凭据、无路径穿越的 `https://` 地址，严格限定在 `github.com/skywalker512/agy-hud/`、`codeload.github.com/skywalker512/agy-hud/` 与 `api.github.com/repos/skywalker512/agy-hud/`（以及清单回退用的 `raw.githubusercontent.com/skywalker512/agy-hud/`）。 |
| **手动重定向校验** | 启用 `redirect: 'manual'`，最多允许 **5 跳**重定向，且跳转目标仅限 GitHub 官方发布 CDN（`objects.githubusercontent.com`、`release-assets.githubusercontent.com`、`github-releases.githubusercontent.com`）。 |
| **纯 Node 安全解压** | 自研 `.tar.gz` 与 `.zip` 解压器，严格拦截 **zip-slip**（`..`）、绝对路径、Windows 盘符前缀、空字节、符号链接、硬链接及设备特殊文件。 |
| **资源上限防护** | 压缩包上限 **50 MB**、解压总量上限 **64 MB**、文件数上限 **2,000**、元数据超时 **10 秒**、下载超时 **45 秒**。 |
| **安装包完整性校验** | 替换前校验 `plugin.json`（插件名 + 合法 SemVer）、`sidecar.json`、`server.ts` 及非空 `ui/{index.html,app.js,styles.css}`。 |
| **原子替换与自动回滚** | 先解压暂存到同级临时目录，再备份旧目录并原子 `renameSync` 切换（支持 `EXDEV` 跨分区回退与 Windows `EPERM`/`EBUSY`/`EACCES` 退避重试）；任何环节失败均自动恢复旧版本。 |
| **并发互斥锁** | 进程内并发锁阻止重复触发升级（`reason: "in_progress"`）。 |

---

## 5. 常见问题与排障

### Node.js 版本低于 22.18

请将 Node.js 升级至 **22.18+**（Node 22 LTS 或 Node 24+）：

- **macOS（Homebrew）**：`brew install node@22 && brew link --overwrite node@22`
- **macOS / Linux（`fnm` / `nvm`）**：`fnm install 22 && fnm use 22` 或 `nvm install 22 && nvm use 22`
- **Windows（`winget` / `scoop`）**：`winget install OpenJS.NodeJS.LTS` 或 `scoop install nodejs-lts`

升级后重新执行 `node -v` 与 `node plugin/install.mjs --doctor` 确认。

### Antigravity 侧边栏未显示 AGY-HUD 图标

1. 执行 `node plugin/install.mjs --doctor`，确认 `plugin_install` 与 `ui_bundle` 均为 `[PASS]`。
2. 确认安装路径为 `~/.gemini/config/plugins/agy-hud`（或你自定义的 Antigravity 插件目录）。
3. 完全退出并重启 Antigravity，或在插件管理器中重新加载插件。

### 面板提示“未找到对话数据库”

- 请先在 Antigravity 中发起至少一次对话，生成 `~/.gemini/antigravity/conversations/<uuid>.db`。
- 若你使用了自定义数据目录，请在启动 Antigravity 前设置环境变量 `ANTIGRAVITY_APP_DATA_DIR=/你的路径`。

### 应用内更新遇到 GitHub 限流或离线环境

- 未认证的 GitHub API 按 IP 每小时限制 60 次请求。稍后点击 `[检查更新]` 重试，或执行更新卡片底部提供的 CLI 命令：
  ```bash
  node plugin/install.mjs --update
  ```
- 若处于内网或代理受限环境，可手动下载源码/发行包后在本地执行 `node plugin/install.mjs --install`。

### Windows 升级时出现文件占用（`EPERM` / `EBUSY`）

- 安装器内置了针对 Windows 文件锁的退避重试机制。若仍被 Antigravity 进程占用，请先关闭侧边栏或退出 Antigravity，执行 `node plugin/install.mjs --update` 后再重新打开。
