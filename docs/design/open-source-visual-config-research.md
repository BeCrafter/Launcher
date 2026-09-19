# 可视化 launchd 配置编辑调研

> 目的：为 BeCrafter Launcher 的“命令/ plist 操作 → 页面操作”设计提供一手来源依据。
> 结论只引用项目源码或 Apple 文档；访问日期：2026-09-18。

## 1. Sean10000/LaunchManager（Swift 开源 GUI）

来源：

- [PlistService.swift](https://github.com/Sean10000/LaunchManager/blob/main/LaunchManager/Services/PlistService.swift)
- [EditAgentSheet.swift](https://github.com/Sean10000/LaunchManager/blob/main/LaunchManager/Views/EditAgentSheet.swift)
- [AgentStore.swift](https://github.com/Sean10000/LaunchManager/blob/main/LaunchManager/Store/AgentStore.swift)
- [LaunchctlService.swift](https://github.com/Sean10000/LaunchManager/blob/main/LaunchManager/Services/LaunchctlService.swift)
- [LaunchManagerTests.swift](https://github.com/Sean10000/LaunchManager/blob/main/LaunchManagerTests/LaunchManagerTests.swift)

观察：

1. `PlistService.formIncompatibilityReason` 在发现表单无法表达的键时禁用普通表单保存；`save` 通过 `PropertyListSerialization` 重建字典。它证明“无法无损表达就切 XML/原文”是成熟 GUI 的必要边界，但也说明仅从字典重建 XML 不是原始文本保真方案。
2. `EditAgentSheet` 把 `ProgramArguments` 规范化为“可执行文件 + 参数”，并把 `Program` 与 `ProgramArguments` 的组合判为不兼容；这与本项目的 `sourceShape` 设计方向一致。
3. `AgentStore` 将 bootstrap、bootout、start、stop、enable、delete 分开；`LaunchctlService` 用 argv 调用非特权命令，只有特权路径才进入授权执行器。页面应表达用户意图，而不是让用户直接拼 launchctl 命令。
4. 上游删除实现曾把 `bootout` 与 `rm` 拼在同一条授权 shell 命令中，且用户域曾对 bootout 失败使用 `try?` 后继续删文件。该源码可作为反例：删除必须有分阶段结果与失败恢复，不能用绿色成功 toast 掩盖“文件删了但任务仍载入”的状态。
5. 上游 UI 将 `isDisabledByOverride` 单独作为 launchctl 状态展示，而不是把 plist 的 `Disabled` 当作唯一真相。本项目保留 `Disabled`、以 override 反映运行状态是正确方向，但应继续明确“文件值”和“运行时覆盖位”是两个来源。

## 2. Apple launchd / launchctl 一手资料

来源：

- [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [apple-oss-distributions/launchd](https://github.com/apple-oss-distributions/launchd)

观察：

1. `KeepAlive` 可以是布尔值或条件字典；字典条件按 OR 评估。`SuccessfulExit=false` 和 `Crashed=false` 不是“未设置”，所以 UI 必须有 null/未设置态。
2. `RunAtLoad`、`KeepAlive`、`StartInterval`、`StartCalendarInterval`、`WatchPaths` 是不同触发/保持机制；它们可以共存，不应被一概标成非法，但页面必须解释“任务已经运行时不会创建第二个实例”的效果。
3. `WatchPaths` 官方标注为不推荐使用，存在竞态/写入中间态风险；应保留能力并显示风险，而不是偷偷替换为别的触发器。
4. `UserName` 是特权 daemon 场景的字段，不能在普通 LaunchAgent 页面伪装成有效配置；非适用作用域需要显示“存在但不生效/只保留”，而不是静默隐藏。
5. launchctl 的 `enable/disable` 是运行时域的 override；它与 plist 内容不是同一状态。启停、开机自启、保存文件、重新 bootstrap 应在页面和后端操作模型中分开。

## 3. 对 BeCrafter Launcher 的直接设计结论

- 继续保留 A（表单可编辑）、B（可见但 XML-only）、C（原始 XML 修复）三层；B 层不能只显示键名，还应给出路径、类型、值摘要和“值级保留/原文保留”的保证等级。
- 对已有文件优先做 AST/节点级补丁；字典重建只能作为新建或 XML 显式格式化后的路径。否则注释、键顺序、integer/real、data/date 等表示会被改变。
- 所有写操作需要文件 revision；保存/应用/启停/删除还需要共享的同任务操作锁和运行时快照，避免“保存并应用”在用户刚点停止后又偷偷 bootstrap。
- 新建流程应从合法字段集合生成，而不是把可编辑控件默认打开：`StartInterval` 缺失不能显示成“已启用 + 0 秒”；可选键都要表达 `missing/present`。

## 4. 需要避免的错误推论

- “上游支持的字段就能安全照搬”：上游同样把复杂 KeepAlive、额外顶层键、Program/ProgramArguments 组合挡到 XML。
- “写回同一组 JS 值就是原样保留”：这只能保证部分语义值，不能保证 XML 表示。页面文案应明确保证等级。
- “start 前自动 enable 只是实现细节”：它改变了用户的持久化开机自启意图，应改为显式确认或提供一次性启动方案。

## 5. 当前编辑器的落地策略（2026-09-18）

- 页面按语义拆为“启动时机 / 进程生命周期”。`RunAtLoad` 展示为“载入后立即运行”，与运行时 `launchctl enable/disable` 的“允许登录时加载”保持区分；两者不合并为一个 plist 开关。
- `StartInterval` 与 `StartCalendarInterval` 都保留，归入“按时间运行”区域。两者是 launchd 独立评估的调度机制，不能因为开源表单只展示其中一种就删除另一种。
- `WatchPaths` 继续使用多路径列表。Apple 的 `launchd.plist(5)` 定义为 `array of strings`，任一路径变化均可触发；开源 UI 的单行限制不代表底层命令只有单路径。
- `KeepAlive` 默认使用“始终保持 / 崩溃后重启 / 正常退出后重启 / 失败退出后重启”等语义预设；组合条件进入“自定义条件（高级）”，底层仍保留布尔值、三态条件和 OR 语义。
- `ProcessType` 不在普通页面展示，直接使用 launchd 默认资源策略；底层模型和读写逻辑仍保留，已有 plist 的值不会因普通表单保存而丢失，需要高级资源调优时仍可通过 XML 编辑。
- `Nice` 与 `ThrottleInterval` 同样不在普通页面展示：前者是进程优先级调节，后者是异常/高频重启节流；普通任务使用系统默认值即可，已有值继续由底层保留并可通过 XML 调整。
