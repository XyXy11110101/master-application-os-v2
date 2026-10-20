# V2 0.2.0 独立验证指南

本仓库是独立 Windows 桌面应用，使用 Electron、React、TypeScript 和 SQLite。验证目标是发现真实缺陷，并区分实际执行结果与代码推断。已有测试通过不代表界面、研究质量和安装流程已经验收。

## 下载和复现

- [v0.2.0 待验收版](https://github.com/XyXy11110101/master-application-os-v2/releases/tag/v0.2.0) 提供安装器、完整 Windows x64 ZIP、SHA-256 清单、发行清单和自动验证摘要。
- 直接试用时完整解压 ZIP，再运行其中的 `ApplicationDesk.exe`；不能只复制 EXE。安装器为 `ApplicationDeskV2-Setup.exe`，当前未签名。
- 源码归档不包含 `node_modules`、打包产物、密钥或个人工作区。Windows x64 构建需要 Node.js 24、npm 和可下载依赖的网络。
- `release-manifest.json` 记录源码提交、产物哈希和已有检查摘要；`validation-evidence.json` 保留原检查时间及断言，并移除了本机绝对路径。它们属于作者侧检查证据，请独立复现。

在 PowerShell 中从固定版本构建：

```powershell
git clone --branch v0.2.0 https://github.com/XyXy11110101/master-application-os-v2.git
cd master-application-os-v2
npm ci
npm run typecheck
npm test
npm run make
npm run test:desktop
npm run test:workflow
npm run test:lifecycle
npm run test:ux
```

逐条执行并记录退出码；构建失败时不要把后续脚本记为通过。四组打包回归默认查找 `out/Application Desk V2-win32-x64/ApplicationDesk.exe`。如果要验证下载的 ZIP，在完整解压后，把 `DESK_EXE` 设为其中 EXE 的绝对路径，再运行这四组脚本：

```powershell
$env:DESK_EXE = (Resolve-Path 'C:\test\Application Desk V2-win32-x64\ApplicationDesk.exe').Path
npm run test:desktop
npm run test:workflow
npm run test:lifecycle
npm run test:ux
Remove-Item Env:DESK_EXE
```

请把示例路径替换为实际解压位置。脚本使用隔离的临时工作区，默认隐藏窗口、模拟系统对话框，不调用真实模型；输出写入本机 `artifacts`。非 Windows 环境可以审阅源码和尝试运行兼容的检查，但不得把未运行的 Windows 验收项目报告为通过。

下载后可用 `Get-FileHash -Algorithm SHA256 <文件路径>` 与发行附件 `SHA256SUMS.txt` 对照。重建产物可能因时间戳和打包环境而具有不同哈希；该清单用于核对下载文件。

## 优先检查的行为

1. 年份表示目标入学年份，月份可未知；项目层次与具体学位名称独立。自定义年份、学校别名和时区选择可保存。不要把旧“2026–2027 申请季”直接解释为某个入学年。
2. 填写中切换页面或项目后保留草稿；放弃修改、保存失败重试、重复保存、正常关闭取消退出均符合预期。恢复备份后的工作区不应继承原工作区的未保存草稿。
3. 首页行动进入对应推荐人、研究区或提交记录。等待回访、材料独立并行、真实前置关系以及分开的提交阶段正确影响行动。
4. 同一材料的新版本不会替换其他项目选定的旧版本；检查只在相关要求或版本变化后过期。备份恢复保留记录、文件及历史，密钥不进入备份。
5. 本科、硕士、博士研究互不套用专属政策；截止年份不冒充入学年份，季节不推断月份。继续研究、采用及模型缓存均绑定目标范围，取消和重启不自动继续收费调用。
6. 证据、未知、明确不要求、条件、个人适用性与个人完成进度保持独立。部分采用及后续差异确认不覆盖用户修改。

源码入口：`src/main/store.ts`（数据与动作）、`src/main/validation.ts`（IPC 校验）、`src/research/engine.ts`（研究）、`src/shared/target.ts`（目标范围）、`src/renderer/session.tsx`（会话草稿）。架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 必须单独记录的人工验收

详细步骤见 [MANUAL_ACCEPTANCE.md](MANUAL_ACCEPTANCE.md)。以下结果不能由自动测试或静态代码审查代替：

- 原生 Windows 文件选择器、键盘与焦点、窄窗、Windows 系统真实 200% 缩放。
- 陌生用户能否独立开始、五秒找到主要行动、布局与操作感是否获认可。
- 干净 Windows 的安装、启动、两个实际发行版本间升级、备份恢复、卸载后数据保留。
- 用自行配置的模型研究真实本科、硕士、博士项目，并逐条与当前官网核对准确性、完整性、适用范围及费用。真实 API 需要验证者主动配置并决定调用，默认不执行。

Stanford、Harvard、UCL 的离线测试是合成回归样例，不是当前官网要求的人工金标准。隐藏窗口截图也不作为视觉验收证据。已有结果与限制见 [VALIDATION.md](VALIDATION.md)。

## 验证报告格式

记录版本标签、提交 SHA、操作系统、Node.js 版本、执行命令和退出码。每个问题写明：严重程度、复现步骤、预期与实际结果、相关代码位置或日志证据；区分“已复现缺陷”“静态审查风险”和“未执行/待验证”。不要把缺少环境或权限导致的未执行记成通过。

可交给 Grok 的任务说明：

> 请下载并独立验证本仓库 v0.2.0，先阅读 AGENTS.md 和 docs/EXTERNAL_VALIDATION.md。优先复现表单、草稿、逐项目材料版本、迁移恢复、三类学位研究范围和取消/重启行为。具备 Windows 环境时执行构建与四组打包回归，否则明确说明未执行的范围。输出可复现的问题及证据，区分实测、推断和待验收；不要因已有测试通过就判定产品全部完成。
