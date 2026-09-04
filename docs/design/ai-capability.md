# Launcher AI 能力接入方案

> 状态：已批准（2026-09-04）｜范围：AI 配置生成（launchd plist）、服务异常排查、MCP 暴露、内置专家提示词
> 关联：docs/demo AI 助手模块（sk-plist / sk-diag / sk-refactor / sk-import 四个内置技能）

## 背景与现状

BeCrafter Launcher 是 macOS 服务管理器（launchd / Homebrew services / crontab），当前仓库只有 UI 原型（docs/demo）。AI 助手模块已规划 4 个内置技能：

- **生成 LaunchAgent（sk-plist）**：根据运行参数生成符合 launchd schema 的 plist 草稿
- **诊断任务（sk-diag）**：分析 launchd/cron 任务，定位未运行或异常的根因
- **批量重构建议（sk-refactor）**：扫描重复的 plist 配置，给出抽象原语与合并建议
- **导入现网配置（sk-import）**：读取 brew services 与现有 launchctl 列表，一键生成受管任务

**需求（本次扩展）**：

1. AI 生成配置（launchd plist）与 AI 排查服务异常（对应 sk-plist / sk-diag）
2. 将 Launcher 服务管理能力**暴露为 MCP 服务**，供 AI 自动配置与问题排查定位
3. **内置服务管理专家提示词**，约束 AI 聊天在预期范围内回答

## 已确认约束

- 技术栈 **TS + Electron**；分发给**终端用户**；交互为**应用内聊天/进度流**（非弹终端）
- AI 库采用 **earendil-works/pi**（MIT / TS / 101k+ star / v0.84.4，活跃发布）：
  - `@earendil-works/pi-ai`：统一多厂商 LLM API（OpenAI/Anthropic/Google 等），原生 streaming + tool calling
  - `@earendil-works/pi-agent-core`：agent 运行时（tool calling、状态管理），轻量无重框架
  - `@earendil-works/pi-web-ui`：基于 pi-ai 的现成聊天 UI 组件（内置聊天界面直接复用）
- **MCP 两者都要**：内置聊天进程内直调工具注册表；MCP stdio 服务随应用提供，供外部 AI（Claude Code / Claude Desktop 等）挂载
- **权限模型**：外部 MCP 默认只读，写操作需在应用设置显式开启；内置聊天写操作弹应用内确认框

**关键调研事实**：pi 生态**无 MCP 客户端**（`@agentproto/adapter-pi` 明确标注 "pi has no MCP support"）→ MCP 服务端用官方 `@modelcontextprotocol/sdk`（TS）实现，仅在服务端使用 MCP。

## 方案对比：调本地 AI CLI vs pi 自封装

| 维度 | A：调本地 AI CLI（claude -p / codex exec） | B：pi-ai + pi-agent-core 自封装 |
|---|---|---|
| 集成成本 | 低（子进程 + 参数透传），但每个 CLI 要写适配器 | 中；pi-web-ui 免去聊天 UI 工作量，服务层约 200-400 行 |
| 终端用户可用性 | **硬伤**：要求用户已装 CLI 且已登录鉴权，分发即失效 | 仅需设置页填 provider + API Key（safeStorage 加密），开箱可用 |
| agent 能力（排查场景） | 强：bash/文件/MCP 全有，但不受控 | 自建受控工具集（launchctl/plist/日志/服务状态），只暴露领域操作 |
| 结构化输出 | 弱：只能解析自由文本 | 强：生成 → `plutil -lint` 校验 → 错误回灌重试的确定性闭环 |
| 流式 UI | 弱：解析 stream-json 对抗 CLI | 强：pi 原生流式 + pi-web-ui 现成组件 |
| 模型选择 / 成本 | 由 CLI 订阅决定 | pi-ai 统一层 → 用户可选 OpenAI/Anthropic/Gemini/OpenRouter 等，BYO Key 成本自担 |
| 维护风险 | CLI flag / 协议版本漂移 | pi 处于 0.x，需锁精确版本（save-exact）+ 升级回归 |
| 许可证 | 部分 CLI 禁止再分发，只能调用不可捆绑 | MIT，可随闭源 Electron 分发 |

**结论**：方案 B 为主力引擎。方案 A 降级为可选的「交给已装 Agent」高级通道保留（demo 扫描模块已有此基础，与原始 mockup 交互文案一致），两者不互斥。

**选 pi 的三个注意点**：

1. 锁版本：v0.84 仍是 0.x，API 可能破坏性变更 → `save-exact` 锁精确版本，升级时跑生成/诊断端到端回归
2. 防腐层：应用侧只依赖自定的 `LlmClient`（send / stream / toolCall），pi-ai 只在这一层出现，换库只改一个文件
3. 安全：诊断工具只读；写操作仅通过应用自有 API，不暴露任意 shell

## 推荐架构

```
Electron 主进程
├── domains/                    # 领域层（真实实现；现只有 mock 原型，需新建）
│   ├── launchd.ts              # launchctl 读写、plist 解析/校验、状态查询
│   ├── brew.ts                 # brew services list/start/stop
│   └── cron.ts                 # crontab 列出/增删
├── ai/
│   ├── registry.ts             # ToolRegistry：工具唯一来源（名称/描述/zod schema/实现）
│   ├── llm.ts                  # LlmClient 防腐层（唯一依赖 pi-ai 的文件）
│   ├── agent.ts                # pi-agent-core 运行时：注入 registry 子集（工具白名单）
│   ├── prompts/expert.md       # 专家提示词（单源，见下节）
│   └── skills/{plist,diag,...}.ts  # 技能 = 任务提示词 + 工具白名单 + 上下文装载器
├── mcp/
│   ├── server.ts               # @modelcontextprotocol/sdk：registry → MCP tools + prompts
│   └── transports.ts           # stdio（默认，供外部 agent 挂载）；Streamable HTTP 可选（127.0.0.1 + 会话 token）
├── settings (AI)               # provider/model/apiKey(safeStorage)、MCP 开关、权限模式 readOnly/full
渲染进程
├── 聊天 UI：复用 @earendil-works/pi-web-ui（基于 pi-ai 的现成聊天组件）
├── 技能卡片区（沿用 demo 的 AI 模块） + 结果回填表单/plist 预览
└── MCP 配置区：展示挂载命令/配置 JSON（给 Claude Code `claude mcp add` 用）+ 「允许外部 Agent 修改」开关
```

## MCP 服务设计

- **单一工具源**：MCP 工具与内置聊天工具**同一份 ToolRegistry**（zod schema → MCP tool schema），MCP server 只做「注册 + 传输适配」，逻辑零重复。内置聊天走进程内注册表（无网络开销），外部 Agent 走 stdio。
- **发布形态**：MCP server 随应用发布（同仓库，可独立以 `launcher-mcp` 模式启动）；外部通过 Claude Code `claude mcp add` / Claude Desktop `mcpServers` 配置挂载，启动命令与 JSON 在应用内一键复制。
- **工具集**：
  - 只读（默认可用）：`list_services`（launchd+brew+cron 汇总带状态）、`get_service_status`（pid/uptime/exitCode/重启次数）、`read_plist`（plutil 解析为 JSON）、`search_services`、`tail_log`（unified logging `log show` 或 stdout/stderr 文件尾部）、`check_port`（lsof）、`collect_diagnostic_context`（一步打包排查上下文，供外部 agent 少走弯路）、`validate_plist`（plutil -lint）、`generate_plist`（确定性草稿，无副作用）
  - 写操作（需开启 full 模式，MCP annotations 标记 `destructiveHint`/`readOnlyHint`）：`write_plist`、`load_plist`/`unload_plist`（bootstrap/bootout）、`add_cron`/`remove_cron`
- **安全模型**：外部 stdio 默认 `readOnly`（只暴露只读工具）；设置里显式开启「允许外部 Agent 修改」后才暴露写工具；内置聊天的写操作执行前弹应用内确认框（携带命令详情）。MCP server 不提供任意 shell。
- **MCP Prompts**：`expert` + 4 个技能以 MCP Prompts 暴露，外部 Agent 挂载后可 `mcp/listPrompts` 拉取「专家设定」，保证内置/外部行为一致。

## 专家提示词设计（prompts/expert.md，单源）

分层设计：**expert.md = 常驻角色与边界（base system prompt）**；**技能 = 任务模板**（对话中注入任务段 + 工具白名单 + 上下文装载器，运行时位于 src/ai/prompts/expert.md，由 skill 逻辑引用）。

expert.md 内容结构：

1. **角色**：macOS 服务管理专家（launchd/launchctl、plist schema、KeepAlive/ThrottleInterval 语义、crontab 五段式、brew services、统一日志）
2. **范围约束（核心）**：只回答服务管理/故障排查相关问题；超出范围（代码、闲聊、无关话题）→ 礼貌声明边界并引导；不编造命令/路径/PID/错误信息
3. **工作流**：先收集证据（列状态 → 读 plist → 看日志）再下结论；结论必须引用工具读取的真实数据；修复建议附带具体命令；涉及写操作时提示需应用确认
4. **输出规范**：诊断报告固定结构（症状/证据/根因/修复步骤/验证）；生成配置时输出 plist 并逐项说明含义

用途：① 内置聊天 system prompt（对话开始时注入，按技能追加任务段）② MCP Prompts 暴露；zh 为主、术语保留英文，随应用 i18n 调整。

## 实施步骤

1. **domains 层**：launchd/brew/cron 真实实现（先只读：list/status/read/log；后写操作）——所有 AI 能力的地基
2. **ToolRegistry + 只读工具**：zod schema 定义（唯一来源）
3. **MCP server（stdio）**：官方 SDK 适配只读工具 + expert 提示词；用 Claude Code 挂载实测（`claude mcp add launcher -- <cmd>`）
4. **LlmClient 防腐层 + 专家提示词 + 最小聊天**（无工具流式对话，验证 pi-ai 接入与范围约束效果）
5. **pi-agent-core + skill-plist / skill-diag**：生成闭环（generate → validatePlist → 错误回灌，≤3 次重试 → 预览草稿不落盘）；诊断（上下文装载 → 工具调用 → 归因报告 + 修复动作按钮）
6. **渲染层**：集成 pi-web-ui 聊天界面 + 技能卡片 + MCP 配置区（挂载命令一键复制、权限开关）+ 写操作确认框
7. **设置与安全收尾**：provider/apiKey（safeStorage）、readOnly/full 模式、pi 依赖锁精确版本、升级回归用例

## 验证清单

- **生成闭环**：含糊描述（缺 ProgramArguments）→ 触发校验重试而非产出坏文件；产物过 `plutil -lint`；预览不落盘
- **诊断正确性**：构造 3 个故障案例——① plist 指向不存在二进制 ② KeepAlive crash loop ③ 端口占用；agent 走真实 domains 层读状态
- **MCP 外部挂载**：Claude Code 挂载后仅见只读工具；开启 full 后可见写工具且 annotations 正确；`生成 plist → 校验 → 加载` 全链路走通；写操作在 Claude Desktop 侧触发用户确认
- **专家提示词范围**：聊天问与服务管理无关问题 → 按边界声明拒绝并引导；诊断结论均引用真实数据（无编造）
- **聊天流与降级**：流式逐字展示、可取消；未配置 Key 时入口清晰引导；safeStorage 加密验证
- **升级回归**：pi 版本升级后全量跑上述用例（锁定版本下应全绿）
