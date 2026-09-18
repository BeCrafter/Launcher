# Agent 编辑器整改规范

> 状态：**已实施并验收（2026-09-18）** —— P0-1…P1-4 全部落地且有自动化覆盖；其后四轮独立复审发现的问题亦已逐条关闭（逐轮记录见 `demo-react-migration-map.md` 第 41 条）。
> **唯一遗留**：§7 要求的「system / daemon 域**真实特权写入**」回归需交互式系统授权，未纳入自动化 —— 读路径、兼容守卫/横幅、提权取消路径已在真机验证（零写入、无残留）；特权步骤顺序与失败语义（`chown/chmod` 临时文件 → `mv`、条件化 `bootout`/`rm`、清理暂存目录）由单测覆盖。
>
> 适用范围：`src/main/domains/agent-form.ts`、`src/main/services/{agent-service,plist-service,launchctl-service,elevation}.ts`、Agent IPC/预加载、`drawer-store`、Edit/XML tab。
>
> 背景与已落地差异：`demo-react-migration-map.md` 第 39/40 条。
> 本文优先级高于第 39/40 条中「顶层键原样保留」「保存并重载」等未完成或表述过强的描述；实现完成并验收后再回写迁移映射。

## 1. 目标与不可违反的原则

Agent 编辑器的目标不是把 `launchctl` 或 plist 机械地映射成开关，而是让用户可以：

1. **查看既有配置而不改变其原意**；页面不能表达的内容必须可见、可解释，并留在 XML 通道；
2. **编辑可表达的配置而不静默丢失其他配置**；
3. **新建任务时拒绝无效输入，提示（而非伪造）运行效果与风险**；
4. **把文件持久化、launchd 应用、运行控制表达为不同的页面动作**；
5. **在并发修改、改名、特权写入失败时不覆盖、不谎报成功、不制造孤儿任务**。

### 1.1 三条保真等级

| 等级 | 定义 | 页面/保存行为 |
|---|---|---|
| A：结构可编辑 | 所有受管字段的类型、形状、范围及原始表示均可表达 | 允许表单保存；只改用户触碰的字段 |
| B：可见但不可表单编辑 | launchd/plist 合法，但当前表单无对应模型或无法无损表达 | 高级配置区显示键名、类型、值摘要与原因；表单保存锁定，转 XML |
| C：原始 XML 修复 | plist 不可解析、业务身份不合法，或用户显式进入 XML | XML 是唯一编辑通道；身份变更按专门事务处理 |

不得把 B 类“为了提高可编辑率”降格为 A 类。不得把 C 类保存成功后仍保留旧表单快照。

### 1.2 既有配置与新建配置必须分流

- **既有配置**：保真优先。合法但复杂的配置不可自动修正、不可自动删除，也不能因为新建向导不支持就重置。
- **新建/改名**：约束优先。必须验证 label、字段类型、数值范围、路径及身份冲突；不能从 HTML `min/max` 推断后端已经安全。
- **风险组合**：导入时保留并说明；新建时要求显式确认。除非 launchd 或业务机制确实不允许，否则不得把“可能冗余”当作“非法”。

## 2. P0：必须先修复的阻断项

### P0-1：Label、路径与提权命令安全

**现状问题**：`agent-service.save()` 将 `patch.label` 交给 `plist-service.pathFor()`；`writeAt()`、`remove()`、`removeWithBootout()`把路径直接拼进提权 shell 字符串。`ElevationExecutor` 只拒绝双引号、反斜杠与换行，不能证明分号、空白、通配符、命令替换等 shell 元字符安全。非特权 `launchctl-service` 还通过 `sh.split(' ')` 拆参数，路径包含空白即可失真。

**要求**：

1. 新建、表单改名、XML 改名都调用同一个纯函数 `validateAgentLabel(label)`；建议只接受 `[A-Za-z0-9._-]+`，且非空、无路径分隔符、无控制字符、不以 `.` 或 `..` 表示路径段。现有磁盘上的不规范 label 可以展示，但不能进入普通改名/特权操作流程。
2. `pathFor()` 后必须以 `relative(scopeDir, target)` 验证目标仍在对应管理目录内；不得仅依赖 `join()`。
3. 非特权命令统一走 `runner.run(command, argv)`，不再由字符串拆参。
4. 提权层不得接收混入用户数据的 shell 字符串。应将受控操作建模为 command + argv，采用可靠的 AppleScript/shell 参数编码；若短期无法完成，必须拒绝 system/daemon 的新建、改名和删除，而不是继续拼 shell。
5. 授权说明应展示**实际完整动作**与实际目标路径；显示文案不是安全边界。

**验收**：非法 label、含空白/路径分隔符/控制字符的 label 在 main 侧零写盘、零提权；合法 label 的 user/system/daemon 写入、删除、改名均在固定目录内；特权实现的单测断言执行器收到的是安全参数而非含用户拼接的 shell。

### P0-2：保存与“应用/重载”必须分开

**现状问题**：表单 `save()` 与 XML `saveXml()`只写 plist；Edit tab 和 toast 却使用“保存并重载”的语义。现有任务改名时只卸载旧任务并删除旧文件，也没有加载新任务。

**要求**：引入不写入 plist 的操作意图 `applyMode`：

- `save`：只写文件，成功文案只能是“已保存到文件”；不改变当前 launchd 运行态；
- `saveAndApply`：仅用户明确选择时执行。记录保存前 loaded/enabled 状态；原子写入后，对原先已载入的任务执行 `bootout → bootstrap`；是否 `kickstart` 必须按独立用户意图决定，不得因为保存就偷偷运行任务；
- 重命名：由专门迁移事务处理（见 P0-4），不是普通 save 的副作用；
- XML tab 同样提供“保存”与必要时“保存并应用”，不得让 XML 的行为与表单不同。

失败时要返回分阶段结果（文件已写/已回滚、旧任务是否仍载入、新任务是否已加载），不能仅 toast 成功或失败。

**验收**：对已载入任务，单测验证 `save` 零 launchctl 调用；`saveAndApply` 的顺序为备份/写入/bootout/bootstrap/状态刷新；bootstrap 失败可回滚文件并把实际运行态上报。UI 文案与调用的 `applyMode` 一一对应。

### P0-3：XML 保存后必须使表单重新取源

**现状问题**：XML 保存后仅更新 XML 文本、`unsupportedKeys`、`preservedKeys`；`form` 与 undo 栈仍是保存前的快照。随后表单保存会覆盖 XML 中刚改过的受管字段。

**要求**：XML 保存成功后，由 main 返回完整的最新 `AgentDocument`，renderer 必须整体替换：`form`、`sourceXml`、兼容报告、revision、Agent 身份、状态；`formHistory` 清空。若读取失败或身份已变化，关闭抽屉并刷新列表，不得继续使用旧 id/旧 form。

**验收**：XML 修改 `ProgramArguments`、KeepAlive、环境变量后保存，再不修改表单直接保存，磁盘值保持 XML 修改结果；XML 保存后 Undo 不得回到保存前内容。

### P0-4：Label 是任务身份，必须有显式生命周期事务

**现状问题**：XML 使用旧 path 写入；普通任务 XML 改 Label 会被覆盖守卫拒绝，非任务文件则可写出“文件名旧、Label 新”的任务，旧 `agentId` 随即失效。表单改名也可能卸载并删除旧文件但不加载新任务。

**要求**：

- 已有任务的 XML 默认禁止修改/删除 `Label`，报错必须说明“请使用重命名任务”；
- 单独提供 `renameAgent({ id, revision, newLabel, applyMode })`：校验 label 与目标冲突 → 写目标文件 → 如原任务已载入则按用户选择迁移运行态 → 删除旧文件 → 返回新 id/revision；
- 非任务文件“补 Label”允许保留原文件名，这是第 37 条既有决策，但保存后必须返回新的任务 id；
- 任何 XML 保存后 `readXml(oldId)` 失败均不是可吞掉的非关键错误，必须刷新/关闭 UI。

**验收**：普通任务 XML 改 Label 被拒绝且文件不变；重命名成功后旧文件不存在、新文件和 Agent id 一致；迁移失败不会删除唯一可用的旧文件；非任务原地转正后 UI 使用新 id。

## 3. P1：保真与冲突控制

### P1-1：引入 revision，拒绝静默并发覆盖

每次读取 Agent 文档时返回 `revision`（内容 hash 优先；或 inode + mtimeMs + size 的组合）。所有 `saveForm`、`saveXml`、`rename`、`remove` 都携带 `expectedRevision`，main 在实际写入前重新读取并 compare-and-swap。

冲突时返回结构化错误：`kind: 'conflict'`、最新 revision、最新 XML/字段摘要；renderer 提供“重新加载”“查看差异”“放弃本地改动”。不能用 1500ms 的扫描缓存代替 revision，也不能通过全量表单 spread 覆盖最新受管字段。

可选优化：renderer 额外上报 `dirtyFields`，服务端仅合并用户触碰字段；但 `revision` 仍是必要安全边界。

### P1-2：兼容性 schema 必须覆盖所有受管键

当前只覆盖部分 KeepAlive、字典型 EnvironmentVariables、SCI。需在 main 建立单一 `validateFormCompatibility(value)`，并由 UI 与保存端共用其输出。

至少覆盖：

| 字段 | 兼容条件 / 新建校验 |
|---|---|
| `Label` | 非空、通过 P0-1 校验；既有异常 label 走 XML/迁移 |
| `Program` | string；与 `ProgramArguments` 同存时不得猜测 argv 语义 |
| `ProgramArguments` | string array；元素非 string 必须 B 类锁定 |
| `RunAtLoad` | boolean；异常类型锁定 |
| `KeepAlive` | boolean，或仅含可表达、boolean 的字典条件；其余锁定 |
| `WatchPaths` | string array；非数组或非 string 元素锁定 |
| `StartInterval` | 正整数；既有非法/异常类型锁定，新建禁止 |
| `StartCalendarInterval` | dict 或 dict array；只含 Minute/Hour/Day/Weekday/Month 整数，并校验范围：0–59/0–23/1–31/0–7/1–12 |
| `EnvironmentVariables` | dictionary of strings；非 dict 同样锁定，不能只检查 dict 内元素 |
| 工作目录、stdio、`UserName`、`ProcessType` | 类型与作用域校验；`UserName` 仅 daemon 可新设，其他 scope 的已有值仅保留 |
| `Nice`、`ThrottleInterval` | number/integer 与业务范围校验；不能依赖 `input min/max` |
| `Disabled`、`EnableTransactions` | 仅往返保留，不能通过隐藏 UI 改写 |

`Program` 与 `ProgramArguments` 同时存在时，必须保留原始 source shape；在未实现“可执行路径 + argv[0] + args”模型之前归入 B 类，禁止表单保存。

### P1-3：顶层未知键不能宣称“XML 原样保留”

当前 `parsePlistXml()` 会丢弃全部 XML 注释，将 `<data>` / `<date>` 降为 string，再由 `toPlistXml()` 输出 `<string>`；数字也可能发生 integer/real 规范化。因此“从解析后的 JS object 回填”仅是**部分语义保留**，不是用户要求的原始配置内容保留。

实施者必须二选一并在 UI/文档诚实表述：

1. **推荐**：维护 XML AST/节点范围，仅替换被表单修改的受管节点；未触碰的键、注释、类型、CDATA、顺序保持原样；
2. 若短期只保证值级保留：将含 data/date/额外注释或无法确认的未知结构归入 B 类锁定，明确提示“此文件需要 XML 编辑以避免格式/类型变化”。

不得继续使用“原样”“逐值保真”描述解析后重建的 XML。

### P1-4：运行效果冲突采用分层提示，不误判合法配置

`KeepAlive` 与 `StartInterval`、`StartCalendarInterval`、`WatchPaths` 组合不是一律非法。手册明确两个 interval 独立评估；但实例已运行时不会产生第二个实例，KeepAlive 也可能使调度效果不符合直觉。

- 既有配置：保留并显示准确说明；
- 新建配置：首次组合时弹确认，说明实际效果；
- 保存：确认信息不写入 plist；
- 文案不得称“其他触发一定轮不到”，应说明“任务已运行时触发不会创建额外实例”。

空的 SCI 规则是全通配风险项：导入时显示其实际意义；新建时不允许通过空白表格隐式生成，必须明确选择“每分钟”或确认。

## 4. 页面与 IPC 目标契约

### 4.1 文档模型

```ts
type AgentDocument = {
  id: string
  scope: AgentScope
  path: string
  revision: string
  sourceXml: string
  form: AgentForm | null
  compatibility: {
    unsupportedPaths: string[] // B/C 类：表单拥有但无法无损表达
    preservedTopLevelKeys: string[]
    warnings: string[]
  }
  sourceShape: {
    program: 'program' | 'arguments' | 'both' | 'none'
  }
}
```

`revision`、`sourceShape`、`dirtyFields`、`applyMode` 都是内部 IPC 元数据，**绝不能写入 plist**。

### 4.2 写入接口

```ts
saveForm(input: {
  id: string
  expectedRevision: string
  dirtyFields: string[]
  patch: Partial<AgentForm>
  applyMode: 'save' | 'saveAndApply'
}): Promise<AgentDocument>

saveXml(input: {
  id: string
  expectedRevision: string
  xml: string
  applyMode: 'save' | 'saveAndApply'
}): Promise<AgentDocument>
```

若 XML 改变 Label，`saveXml` 返回明确的 rename-required 错误；不能暗中创建新身份。

## 5. 字段政策

| 字段/能力 | 当前/目标政策 | 原因 |
|---|---|---|
| `UserName` | 仅 daemon 表单可编辑；其他 scope 现有值只保留 | launchd 对 agent 域忽略它 |
| `GroupName`、`InitGroups` | 暂不新增 UI | 依赖 UserName，需用户/组解析与特权域模型 |
| `Disabled` | 页面反映 launchctl override；plist 值仅保留 | override 是外部持久状态，不能用文件 toggle 伪造状态 |
| `EnableTransactions` | 仅保留，暂不设 UI | 暂无完整的用户操作模型与实证覆盖 |
| `Debug` | 删除无绑定的假 toggle；已有 plist `Debug` 作为未知键保留/提示 | `Debug` 是 launchd plist 的 boolean 键，不是“不存在的键”；文档不得写成无对应 plist 键 |
| `KeepAlive.PathState`、`OtherJobEnabled`、`NetworkState` 等 | XML-only | 字段结构与语义各异，不能塞进两个三态按钮 |
| `Sockets`、`MachServices`、资源限制 | XML-only 或未来独立建模 | 属于服务激活/IPC/资源策略，不是普通表单开关 |

## 6. 实施顺序与验收清单

1. **P0-1**：先封堵 label/path/提权命令安全；未完成前禁止 system/daemon 新建或改名发布。
2. **P0-2**：分离保存与应用，删除“保存并重载”假反馈。
3. **P0-3 / P0-4**：以 `AgentDocument` 回源，完成 XML 同步与身份事务。
4. **P1-1**：revision/CAS；所有写路径统一接入。
5. **P1-2 / P1-3**：完整 schema 和 XML 保真策略。
6. **P1-4**：新建向导中的风险确认与准确文案。

必须新增并通过以下测试：

- 非法 label、目录逃逸、包含空白的 path、特权参数编码；
- `save` 零 launchctl 调用；`saveAndApply` 成功、失败、回滚及状态刷新；
- XML 修改受管字段后再表单保存不回滚；
- XML 改 Label 被拒绝；显式 rename 成功/冲突/回滚；
- revision 冲突零写盘；
- 各托管键错误类型、错误数组元素、SCI 越界、`Program + ProgramArguments` 同存；
- 未知键含 `<data>`、`<date>`、多处注释时的保真或表单锁定；
- 已有 KeepAlive + 多触发组合不被自动修改；新建组合要求确认。

当前 `agent-service.test.ts` 中为验证写入而使用 `.catch(() => {})` 的用例必须改为显式断言成功或断言预期错误，不能吞掉最终 `currentAgent()` 失败。

## 7. 完成定义

只有同时满足下列条件，才能把 migration-map 第 39/40 条的“已完成”表述恢复为正式结论：

- P0 全部有实现与自动化覆盖；
- 所有写路径都具有 revision 校验；
- UI 的“保存”“应用”“重命名”分别对应真实后端行为；
- 既有不支持配置不会被表单写坏，未知 XML 类型/注释的保真边界有实现或明确锁定；
- `npm test`、`npm run typecheck`、`node docs/demo/check.mjs` 通过；
- 至少完成一轮本机真实 plist 的手工回归：用户域、系统域、daemon 域、含未知顶层键、含 KeepAlive 复杂条件、XML 编辑、改名冲突与外部修改冲突。
