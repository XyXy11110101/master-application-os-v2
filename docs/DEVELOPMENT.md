# 开发指南

## 环境与运行

发行目标为 Windows x64，构建需要 Node.js 24、npm 和可下载依赖的网络。Electron 自带应用运行时，使用内置 `node:sqlite`。源码不包含个人工作区、密钥和构建产物。

```powershell
npm ci
npm run typecheck
npm test
npm start
```

测试使用临时工作区和模拟网络，不调用付费模型。开发约束见仓库根目录的 `AGENTS.md`。

## 构建与打包回归

先提交要发布的源码，保持 Git 工作区干净，再执行：

```powershell
npm run make
npm run test:desktop
npm run test:workflow
npm run test:lifecycle
npm run test:ux
```

`make` 记录源码提交、构建时间和产物哈希；完成时规范 ZIP 路径。普通开发可用 `npm run package` 打包，不会生成可发布的构建来源记录。

四组回归默认使用 `out/Application Desk V2-win32-x64/ApplicationDesk.exe`。验证下载包时，完整解压 ZIP，并显式指定目标：

```powershell
$env:DESK_EXE = (Resolve-Path 'C:\test\Application Desk V2-win32-x64\ApplicationDesk.exe').Path
npm run test:desktop
npm run test:workflow
npm run test:lifecycle
npm run test:ux
Remove-Item Env:DESK_EXE
```

将示例路径替换为实际解压位置。无效的覆盖路径会直接报错，不回退到本地构建。报告记录实际程序路径、平台、版本及 EXE 和 `app.asar` 哈希；重启仍须使用同一程序。脚本默认隐藏窗口，系统文件与关闭对话框使用替身。完整本机报告写入忽略跟踪的 `artifacts/`。

`DESK_DATA_HOME` 可将开发数据放入独立目录；自动检查不得使用个人工作区。其他平台的构建或脚本执行不能作为 Windows 安装器、原生对话框或系统缩放的验证证据。

## 模型服务

通用服务填写兼容 Chat Completions 的地址、模型和密钥。官方 DeepSeek 可使用 `https://api.deepseek.com`、`deepseek-flash`，并选择服务默认、关闭或开启思考；该参数仅发送给官方 DeepSeek HTTPS 接口。连接测试和研究使用已保存的同一配置。

连接测试会产生一次短请求，必须收到非空且未截断的正文。研究缓存包含实际请求参数。公开资料获取失败、响应不兼容和预算耗尽都应保留原状态并报告，不自动重试付费请求。

## 发布检查

1. 在固定的干净源码提交上运行 `npm run make`。
2. 解压最终 ZIP，设置 `DESK_EXE`，运行四组回归；检查 ZIP 使用 `/` 且只有 `Application Desk V2-win32-x64/` 顶层目录。
3. 运行 `node scripts/release-manifest.cjs`。它核对构建来源、最终产物和每组报告中的程序身份，生成本机发行清单。
4. 发布安装器、完整 ZIP、SHA-256 清单和精简发行清单。详细运行日志保留在本机。标签指向实际构建提交；修改源码后必须重新构建和检查。
5. 发行说明客观列出完成的检查、已知问题及待验证项。通过下载文件的 SHA-256 核对发行清单；不同构建环境或时间戳可能导致重建文件哈希不同。

原生文件选择器、键盘焦点、Windows 实际 200% 缩放、干净系统安装升级卸载和真实模型结果应分别验证。人工核对研究时，逐条对照当前官网的来源、层次、入学批次、条件和单位；合成离线样例不代表当前官网要求。

## 反馈问题

提供版本、操作系统、复现步骤、预期与实际结果，以及必要日志。报告中区分已复现问题、代码审查发现和未执行的检查。分享前移除密钥、个人材料和无关本机路径。
