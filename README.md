# pi-config

我现在的 [pi](https://github.com/badlogic/pi-mono) 配置快照：**packages / extensions / skills / agents / 设置模板**，给朋友照着装一份一样的。

> 灵感来自 [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config)。
> **不要**直接把整个仓库 clone 覆盖到 `~/.pi/agent`——用下面的安装脚本，或者只挑你要的部分拷。
>
> 🔒 真实密钥不进仓库：`settings.json` / `models.json` / `web-search.json` / `auth.json`
> 只在本机 `~/.pi/agent/` 里，仓库里只放 `*.example` 模板（占位值）。
> 仓库已开启 secret scanning + push protection。

---

## 快速安装

```bash
git clone https://github.com/Gyarados4157/pi-config.git
cd pi-config
./install.sh --dry-run     # 先看会改什么
./install.sh               # 真正安装
```

`install.sh` 做四件事：

1. 把 `agents/` `extensions/` `skills/` `packages/pi-interactive-subagents/` 同步进 `~/.pi/agent/`
2. 给需要依赖的扩展跑 `npm install`（目前只有 `extensions/bash-guard`）
3. **只在目标不存在时**用 `*.example` 生成 `settings.json` / `models.json` / `~/.pi/web-search.json` / `mcp.json`
4. 按 `settings.json` 里的清单逐个 `pi install npm:<包>`

参数：

| 参数 | 作用 |
|---|---|
| `--dry-run` | 只打印，不写盘 |
| `--no-packages` | 跳过 `pi install`（自己手动装 npm 包） |
| `--prune` | 额外删除 `agents/ extensions/ skills/` 里不在本仓库的文件（默认关闭，避免误删你自己的东西） |

装完手动补两处密钥，然后重启 pi：

```bash
$EDITOR ~/.pi/agent/models.json        # 每个 provider 的 apiKey
$EDITOR ~/.pi/web-search.json          # tavilyApiKey（或只用 exa）
```

`pi list` 确认包都加载了，或进 pi 后 `/reload`。

### 前置依赖

| 需要 | 用途 | 备注 |
|---|---|---|
| `pi` ≥ 0.87 | 本体 | 快照基于 **0.87.1** |
| `node` + `npm` | 扩展依赖、npm 包 | 本机 v26.8.1 |
| `herdr` ≥ 0.9 | 分屏 subagent、`herdr_*` 工具 | 本机 herdr 0.9.0 |
| `python3` | `analyze-sessions` / `huashu-flash` / `pdf-reader` 脚本 | 系统 3.9.6 即可；`pdf-reader` 另需 `pip install -r skills/pdf-reader/requirements.txt`（PyMuPDF） |
| `yt-dlp` | `youtube-transcript` 技能 | 本机 2026.03.03 |
| `rtk` | `pi-rtk-optimizer` 的命令改写 | 本机 rtk 0.42.4；缺了会自动跳过 |
| Otty / Orca | 对应终端集成扩展 | 没装这些终端的话，那几个扩展是无害的空转 |

---

## 目录结构

```
pi-config/
├── agents/                # 全局 subagent 定义（planner / researcher / scout / worker）
├── extensions/            # 本机扩展（单文件 .ts 或目录）
├── packages/
│   └── pi-interactive-subagents/   # 本地 fork：Herdr 版异步 subagent
├── patches/               # 需要手动维护的补丁脚本
├── skills/                # agent skills（SKILL.md + 脚本）
├── settings.json.example      # 设置模板（无密钥）
├── models.json.example        # 模型/provider 模板（apiKey 占位）
├── web-search.json.example    # 搜索 provider 模板（apiKey 占位）
├── mcp.json.example           # MCP server 开关模板
├── AGENTS.md                  # 全局指令（可选用；含个人工作流约定）
└── install.sh
```

---

## Pi packages（`settings.json` 里的 `packages`）

### 本地 fork

| 包 | 版本 | 说明 |
|---|---|---|
| `packages/pi-interactive-subagents` | `3.7.2-local.1` | ⭐ **Herdr fork**：异步 subagent，跑在 Herdr 分屏里，`subagent()` 立即返回，结束后结果 steer 回主会话。上游 [amosblomqvist/pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) 只支持 tmux，这个 fork 把 tmux 层换成了 Herdr（`herdr.ts` / `layout.ts` / `mux.ts` / `watch.ts` 等）。**npm 上没有**，所以直接放进本仓库，`settings.json` 用相对路径引用。 |

细节见 [`packages/pi-interactive-subagents/README.md`](packages/pi-interactive-subagents/README.md) 和它自己的 `AGENTS.md`（分屏规则）。

### npm 包

| 包 | 当前版本 | 作用 |
|---|---|---|
| `pi-one-ui` | 0.7.1 | 整体 UI：可定制的 Context / Shell 渲染 |
| `@fradser/pi-btw` | 0.2.10 | `/btw` 旁路提问，只读 overlay，不进会话历史（可调 read/grep/find/ls 验证事实） |
| `pi-mcp-adapter` | 3.0.0 | MCP 接入（lazy：只注册一个代理 tool，server 按需启动） |
| `pi-gpt-search` | 1.1.0 | 独立 web search（OpenAI Codex standalone search engine） |
| `context-mode` | 1.0.169 | 上下文压缩 / FTS5 知识库 / 沙箱执行（`ctx_*` 系列工具） |
| `@cortexkit/pi-magic-context` | 0.43.2 | Magic Context：跨会话记忆与后台压缩 |
| `@ogulcancelik/pi-herdr` | 0.4.0 | Herdr 原生工具（`herdr_layout` / `herdr_pane` / `herdr_agent`） |
| `pi-rtk-optimizer` | 0.9.0 | rtk 命令改写 + 工具输出压缩 |
| `@narumitw/pi-goal` | 0.54.5 | `/goal` 单目标自主完成模式（**故意钉在 0.54.5**，上游已到 0.54.8） |

> 除 `pi-goal` 外都不锁版本，`pi update --extensions` 会跟上游走。
> `extensions/pi-rtk-optimizer/config.json` 是给 `pi-rtk-optimizer` 用的本机配置覆盖。

---

## Extensions

放在 `~/.pi/agent/extensions/`，pi 自动发现。🌟 = 自己写的，其余是上游或第三方终端 App 生成/托管的。

| 扩展 | 作用 | 备注 |
|---|---|---|
| `ask-user-question.ts` | `ask_user_question` 工具：单选/多选弹窗，富布局 | 用旧的 `@mariozechner/*` 导入名，pi 仍提供别名 |
| `bash-guard/` 🌟 | 拦截危险 bash（`rm` / `sudo` / `curl \| sh` / `git reset --hard` …），弹 Run/Abort；对 subagent 更严格 | 需要 `npm install`（shell-quote）；自带 `analyze.check.ts` 自测 |
| `command-v-image-paste.ts` 🌟 | macOS/Ghostty `Cmd+V` 贴图：`sips` 压到长边 1600px（~150–250KB），避免大截图卡编辑器 | |
| `context-mode-injection-guard.ts` 🌟 | 剥掉 context-mode 每轮注入的空壳「compaction recovery」文本 | |
| `continue-f5.ts` 🌟 | `F5` 继续当前会话没做完的活 | |
| `custom-header.ts.off` | 自定义 header 实验，**已停用**（`.off` 后缀不会加载） | 仅作参考 |
| `edit-recovery/index.ts` 🌟 | edit 失败时补一条针对性提示（match 失败/重叠/无改动…），避免重放旧 `oldText` | 与 `~/.pi/agent/AGENTS.md` 的 edit 规则配套 |
| `herdr-agent-state.ts` | 在 Herdr 里通过 unix socket 上报 agent 生命周期 | **Herdr 托管**，重装 Herdr 会覆盖 |
| `magic-context-model-sync/index.ts` 🌟 | 把 pi 的模型清单同步进 `~/.config/cortexkit/magic-context.jsonc`（带备份） | |
| `orca-agent-status.ts` | Orca 终端状态回传 | **Orca 托管** |
| `orca-prefill.ts` | Orca 预填 | **Orca 托管** |
| `orca-titlebar-spinner.ts` | Orca 标题栏转圈 | **Orca 托管** |
| `otty-integration.ts` | 向 Otty 上报 processing/idle 与完成通知 | **Otty 托管**；本仓库版本把用户名硬编码改成了 `homedir()` |
| `pi-ops-guard.ts` 🌟 | 两个高频错误的 fail-fast：`ctx_execute_file` 指向 cwd 之外、以及 `web_search`（应改用 `codex-search` / `codex-research`） | 配套 `skills/pi-ops/` |
| `pi-rtk-optimizer/config.json` | `pi-rtk-optimizer` 的本机配置（rewrite 模式、输出压缩、trackSavings…） | 配置，不是扩展代码 |
| `responses-nostream.ts` 🌟 | 给「上游不支持流式」的 provider 提供 OpenAI Responses 非流式实现 | 让 CPA 上的 `mira/*` 模型能在 pi 里用 |

**没包含**：`extensions/mirasim-gateway-*.js` —— 由 mirasim App 生成、文件名带 hash、每次都会重写，属于机器产物。

---

## Skills

`~/.pi/agent/skills/`，可用 `/skill:<name>` 触发。

| 技能 | 作用 |
|---|---|
| `analyze-sessions/` | 查历史 pi 会话：按天/项目/模型统计成本、挖掘提问模式、全文检索、渲染单个会话 |
| `huashu-flash/` | 闪电.skill：给网站/App 提速（定义「打开到能用」→ 测基线 → 棘轮只许变好）。中文技能，含参考资料与 `bench.py` / `ratchet.py` |
| `jev-decisions/` | 可选的 Jev 语义判定（claim-vs-evidence、候选排序、diff 打分）。**默认关闭**，只在明确启用 Jev 时用 |
| `pdf-reader/` | 读 PDF（论文、讲义）：抽文本 + 渲染页面看公式图。需 `pip install -r requirements.txt` |
| `pi-ops/` | pi 工具踩坑手册：edit 失败、ctx_execute_file 越界、交接、bash 超时等 |
| `tdd/` | 测试先行的红绿重构流程 |
| `youtube-transcript/` | 给 YouTube URL，返回标题 + 字幕 JSON（走 `yt-dlp`） |

> 本机 `tdd` 原本是软链到 `~/.local/share/agent-rules/skills/tdd`，仓库里已经 vendored 成真实目录，装完不依赖那个路径。

---

## Agents

`~/.pi/agent/agents/*.md` 是全局 subagent 定义，优先级 **project > global > package-bundled**：

| Agent | 用途 |
|---|---|
| `planner.md` | 只出实现计划，不改代码 |
| `researcher.md` | 外部资料调研，产出结论 + 落盘路径 |
| `scout.md` | 只读代码库侦察：路径、行号、下一步该开哪个符号 |
| `worker.md` | 通用执行者，可以再派 scout/researcher |

`researcher/worker/scout` 和 fork 自带的那份内容一致；`planner` 是本地新增的。

---

## 设置

### `settings.json`（→ `~/.pi/agent/settings.json`）

关键项：

- `theme: dark`、`tuiMode: fullscreen`、`fullscreenScrollbar: auto`
- `defaultProjectTrust: "always"` —— 新项目默认信任（会执行项目里的扩展代码，自己判断要不要保留）
- `packages` —— 见上面的清单，本地 fork 用相对路径 `./packages/pi-interactive-subagents`（相对 settings 所在目录解析）
- `skills: ["!lark-*"]` —— 屏蔽 lark 系列技能
- `compaction` —— 后台压缩：`reserveTokens 16384`、`keepRecentTokens 20000`
- 默认模型：`DDDD/deepseek-v4.1-flash`，`defaultThinkingLevel: high`
- `enabledModels` —— 模型选择器里只露出 5 个（`gpt-6-luna:max`、`grok-4.7:medium`、`deepseek-v4.1-flash:high`、`gpt-6-astra:medium`、`gpt-6-sol:high`）

> ⚠️ 模板里的 `defaultProvider` / `enabledModels` 指向 `DDDD`，那是**我自己的中转**。
> 没有对应 key 的话，删掉 `defaultProvider` / `defaultModel` / `enabledModels`，或改成你自己的 provider。

### `models.json`（→ `~/.pi/agent/models.json`）

三个 OpenAI 兼容 provider，`apiKey` 在模板里是占位符：

| Provider | baseUrl | 模型 |
|---|---|---|
| `DDDD` | `https://cpa.alphafox.app/v1`（`openai-responses`） | `gpt-6-luna`、`gpt-6-astra`、`gpt-6-sol`、`grok-4.7`、`deepseek-v4.1-flash`、`gemini-3.8-flash-high`、`mira/gpt-6-astra`、`mira/claude-opus-5-5`、`space-bunny-free`、`muse-spark`、`cline-pass/deepseek-v4.1-flash` |
| `anyrouter` | `https://anyrouter.top/v1`（`openai-responses`） | `gpt-6-astra` |
| `cline-pass` | `https://api.cline.bot/api/v1`（`openai-completions`） | `cline-pass/deepseek-v4.1-flash`（`max_tokens` 字段，上下文 384k） |

两个坑，都是实测出来的：

- `mira/*`（DDDD 的 Mirasim 渠道）在 CPA 上**流式会 502**，所以用扩展提供的 `"api": "openai-responses-nostream"`（也就是 `extensions/responses-nostream.ts`）。想要真流式就换成 `"api": "openai-completions"`（实测 200 + 增量 chunk + 工具调用正常）。
- `gpt-6-astra` 这类模型名在 CPA 上有别名歧义：`mira/gpt-6-astra` 才是 Mirasim 分组，不带前缀的 `gpt-6-astra` 会落到 Codex 分组。

### `web-search.json`（→ `~/.pi/web-search.json`）

Tavily 为主、Exa 兜底，`fallbackOn: [transient, quota, network, invalid-response]`。模板里 `tavilyApiKey` 是占位符。

### `mcp.json`（→ `~/.pi/agent/mcp.json`）

本机只放「开关」：

```json
{
  "mcpServers": {
    "context-mode": { "disabled": true },
    "jev": { "disabled": true }
  },
  "settings": { "jev": false }
}
```

真正的 server 定义在 pi-mcp-adapter 会一起读的**全局层**（多个 agent 共用，不在本仓库）：

- `~/.config/mcp/mcp.json` —— `cua-driver`（原生桌面操作）、`jev`、`context-mode`
- `~/.pi/agent/mcp.json` —— 上面这份，用来在 pi 里覆盖/关掉个别 server

所以 `context-mode` 在本机是「包提供直连工具（`ctx_*`），MCP server 关掉」；`jev` 整体关闭。

### `AGENTS.md`（→ `~/.pi/agent/AGENTS.md`）

全局指令：持续工作原则、工具地图（哪个活走 bash / ctx_* / codex-search / ego-browser / ocr / mcpScript）、Dispatch 规则（scout / researcher / worker）、Jev 是可选项。**属于个人工作流约定，不想要可以删。**

### `patches/pi-mcp-adapter-jev-origin.sh`

把 `pi-mcp-adapter` 内置的 Jev/TypeSafe 集成从上游 `https://api.typesafe.ai` 改指向自建网关。补丁打在 `node_modules` 里，**每次更新 pi-mcp-adapter 后都要重跑**：

```bash
./patches/pi-mcp-adapter-jev-origin.sh --status    # 看当前状态
./patches/pi-mcp-adapter-jev-origin.sh             # 应用
./patches/pi-mcp-adapter-jev-origin.sh --revert    # 回滚
```

不用 Jev 的话忽略这个脚本。

---

## 密钥策略

- 真实密钥只在 `~/.pi/agent/`（`models.json`、`web-search.json`、`auth.json`），**永不提交**
- 仓库只保留 `*.example`；`install.sh` 也只会**在目标不存在时**生成文件，不覆盖
- `.gitignore` 已排除 `auth.json`、`sessions/`、`mcp-cache.json`、`node_modules/`、`.venv/`、`*.log` 等

---

## 版本快照

| | |
|---|---|
| 快照时间 | 2026-09-27 |
| pi | 0.87.1 |
| herdr | 0.9.0 |
| rtk | 0.42.4 |
| node | v26.8.1 |
| pi-interactive-subagents | 3.7.2-local.1（Herdr fork，上游 3.7.2 = tmux） |

## 参考

- pi 文档：<https://github.com/badlogic/pi-mono>（`docs/packages.md`、`docs/settings.md`、`docs/extensions.md`、`docs/skills.md`）
- 上游配置范例：<https://github.com/amosblomqvist/pi-config>
