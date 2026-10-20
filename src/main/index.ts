import { app, BrowserWindow, dialog, ipcMain, Menu, shell, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { DeskStore } from './store';
import { Credentials } from './credentials';
import { schemas } from './validation';
import { createResearchRun } from '../research/engine';
import type { ResearchRun, CheckResult } from '../shared/types';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) app.quit();
// Squirrel installs into %LOCALAPPDATA%\ApplicationDeskV2. User data must be a
// different sibling directory so uninstalling cannot remove the workspace.
const baseRoot = process.env.DESK_DATA_HOME || path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'ApplicationDeskV2Data');
fs.mkdirSync(baseRoot, { recursive: true });
app.setPath('userData', path.join(baseRoot, 'desktop'));
const instance = app.requestSingleInstanceLock();
if (!instance) app.quit();
let window: BrowserWindow | null = null;
let store: DeskStore;
let credentials: Credentials;
const jobs = new Map<string, { child: UtilityProcess; store: DeskStore; timeout?: ReturnType<typeof setTimeout> }>();
const workers = new Set<UtilityProcess>();
const checks = new Set<string>();
let apiTestRunning = false;
let switching = false;
let quitting = false;
let unsaved = false;
function allowClose(): boolean {
  if (!unsaved || !window) return true;
  const response = dialog.showMessageBoxSync(window, { type: 'question', title: '还有未保存的修改', message: '当前会话中有尚未保存的内容。', detail: '返回后可以保存或放弃修改；退出会丢弃这些会话草稿。', buttons: ['返回继续填写', '放弃并退出'], defaultId: 0, cancelId: 0, noLink: true });
  if (response !== 1) return false;
  unsaved = false;
  return true;
}
const pointerFile = path.join(baseRoot, 'active.json');
const versionFile = path.join(baseRoot, 'installed-version.json');
const workspaceRoot = path.join(baseRoot, 'workspaces');
const personalRoot = path.join(workspaceRoot, 'personal');
const demoRoot = path.join(workspaceRoot, 'demo');
function inside(parent: string, child: string) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
function currentPath(): string {
  try {
    const selected = JSON.parse(fs.readFileSync(pointerFile, 'utf8')).path;
    if (typeof selected === 'string' && inside(workspaceRoot, selected)) return selected;
  } catch { /* First run. */ }
  return personalRoot;
}
function setCurrent(root: string) {
  fs.writeFileSync(`${pointerFile}.tmp`, JSON.stringify({ path: root }));
  fs.renameSync(`${pointerFile}.tmp`, pointerFile);
}
function backupForUpgrade() {
  const version = app.getVersion();
  let previous = '';
  try { previous = JSON.parse(fs.readFileSync(versionFile, 'utf8')).version || ''; } catch { /* First installation. */ }
  if (previous && previous !== version && fs.existsSync(workspaceRoot)) {
    const destination = path.join(baseRoot, 'upgrade-backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${version}`);
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = path.join(workspaceRoot, entry.name);
      if (!fs.existsSync(path.join(candidate, 'workspace.sqlite'))) continue;
      const previousStore = new DeskStore(candidate);
      try { previousStore.backupTo(path.join(destination, `${entry.name}.zip`)); }
      finally { previousStore.close(); }
    }
  }
  fs.writeFileSync(`${versionFile}.tmp`, JSON.stringify({ version }));
  fs.renameSync(`${versionFile}.tmp`, versionFile);
}
function emit() { if (window && !window.isDestroyed()) window.webContents.send('desk:changed'); }
function ensureIdle() {
  if (jobs.size || checks.size || apiTestRunning) throw new Error('请先停止研究或等待当前检查完成，再切换工作区。');
}
function switchTo(root: string, demo: boolean) {
  ensureIdle();
  const next = new DeskStore(root, demo);
  try { setCurrent(root); } catch (error) { next.close(); throw error; }
  store.close();
  store = next;
  emit();
}
function worker(request: unknown, onUpdate?: (run: ResearchRun) => void, jobId?: string): Promise<unknown> {
  const activeStore = store;
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], {
      stdio: 'ignore', serviceName: 'Application Desk background task',
      env: { ...process.env, DESK_PDFJS_ROOT: app.isPackaged ? path.join(process.resourcesPath, 'runtime/pdfjs-dist') : path.resolve(app.getAppPath(), 'node_modules/pdfjs-dist') },
    });
    workers.add(child);
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('后台任务超时，已保存的研究结果仍可查看。')), jobId ? 16 * 60_000 : 90_000);
    if (jobId) jobs.set(jobId, { child, store: activeStore, timeout });
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (jobId) jobs.delete(jobId);
      workers.delete(child);
      child.kill();
      if (error) reject(error); else resolve(result);
    };
    child.on('spawn', () => child.postMessage(request));
    child.on('message', (message: { type: string; run?: ResearchRun; result?: unknown; error?: string }) => {
      try {
        if (message.type === 'update' && message.run) onUpdate?.(message.run);
        if (message.type === 'result') finish(undefined, message.result);
        if (message.type === 'error') finish(new Error(message.error || '后台任务失败'));
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    child.on('exit', code => { if (!settled) finish(new Error(`后台进程已中断（${code}），请重试。`)); });
  });
}
function apiConfig() {
  const settings = store.snapshot().apiSettings;
  const key = credentials.read(store.root);
  if (!settings.baseUrl || !settings.model || !key) throw new Error('请先在设置中填写服务地址、模型和密钥。');
  return { baseUrl: settings.baseUrl, model: settings.model, key };
}
function begin(run: ResearchRun) {
  if ([...jobs.values()].some(value => value.store === store)) throw new Error('已有研究正在运行，请先等待或停止。');
  const activeStore = store;
  const project = store.snapshot().projects.find(p => p.id === run.projectId && !p.archived);
  if (!project) throw new Error('项目不存在或已移出。');
  if (!project.entryYear || !project.degreeLevel || project.degreeLevel === 'unknown') throw new Error('请先在项目信息中确认学位层次和目标入学年份。');
  if (store.getResearch(run.id)) store.assertResearchContext(run.id);
  if (store.snapshot().workspace?.demo) throw new Error('演示工作区不进行付费查询；请切换个人工作区。');
  const settings = apiConfig();
  run.status = 'running';
  activeStore.saveResearch(run);
  emit();
  void worker({ type: 'research', run, project, settings, cacheDir: path.join(activeStore.root, 'research-cache') },
    update => { activeStore.saveResearch(update); emit(); }, run.id)
    .then(result => { if (!quitting) { activeStore.saveResearch(result as ResearchRun); emit(); } })
    .catch(error => {
      if (quitting) return;
      const latest = activeStore.snapshot().research.find(r => r.id === run.id) || run;
      activeStore.saveResearch({ ...latest, status: 'failed', message: String(error.message), updatedAt: new Date().toISOString() });
      emit();
    });
}
function register(name: string, schema: z.ZodType | null, handler: (input: any) => unknown | Promise<unknown>) {
  ipcMain.handle(`desk:${name}`, async (event, input) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('请求不来自工作台主窗口。');
    }
    if (switching) throw new Error('正在切换工作区，请稍后重试。');
    const parsed = schema ? schema.safeParse(input) : { success: input === undefined, data: undefined };
    if (!parsed.success) throw new Error('输入格式不正确，请检查填写内容。');
    const result = await handler(parsed.data);
    if (!['getSnapshot', 'previewLegacy', 'openExternal', 'openMaterial', 'setUnsaved'].includes(name)) emit();
    return result;
  });
}
function registerHandlers() {
  register('setUnsaved', schemas.setUnsaved, input => { unsaved = input.dirty; });
  register('getSnapshot', null, () => ({
    ...store.snapshot(), apiSettings: { ...store.snapshot().apiSettings, hasKey: credentials.has(store.root) },
  }));
  register('setup', schemas.setup, input => {
    const root = input.demo ? demoRoot : personalRoot;
    if (path.resolve(root) !== path.resolve(store.root)) switchTo(root, false);
    store.setup(input);
  });
  register('switchWorkspace', schemas.switchWorkspace, input => switchTo(input.demo ? demoRoot : personalRoot, input.demo));
  register('saveWorkspace', schemas.saveWorkspace, input => store.saveWorkspace(input));
  register('saveProject', schemas.saveProject, input => {
    if (input.id && [...jobs.keys()].some(id => store.snapshot().research.find(r => r.id === id)?.projectId === input.id)) {
      throw new Error('请先停止这个项目的研究，再修改项目信息。');
    }
    store.saveProject(input);
  });
  register('archiveProject', schemas.archiveProject, input => {
    if ([...jobs.keys()].some(id => store.snapshot().research.find(r => r.id === id)?.projectId === input.id)) throw new Error('请先停止这个项目的研究。');
    store.archiveProject(input);
  });
  register('previewLegacy', schemas.previewLegacy, input => store.previewLegacy(input?.path));
  register('importLegacy', schemas.importLegacy, input => store.importLegacy(input));
  register('saveRequirement', schemas.saveRequirement, input => store.saveRequirement(input));
  register('saveProgress', schemas.saveProgress, input => store.saveProgress(input));
  register('importMaterial', schemas.importMaterial, async input => {
    const activeStore = store;
    const result = await dialog.showOpenDialog(window!, {
      title: '导入材料副本', buttonLabel: '导入副本', properties: ['openFile'],
      filters: [{ name: '申请材料', extensions: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg'] }, { name: '所有文件', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (activeStore !== store) throw new Error('工作区已切换，请重新选择文件。');
    return store.importFile(result.filePaths[0], input);
  });
  register('openMaterial', schemas.openMaterial, async input => {
    const file = store.materialPath(input.versionId);
    if (!/\.(pdf|docx|txt|md|png|jpg|jpeg)$/i.test(file)) throw new Error('此文件类型不支持直接打开，请从备份中导出。');
    const error = await shell.openPath(file);
    if (error) throw new Error(`无法打开文件：${error}`);
  });
  register('checkMaterial', schemas.checkMaterial, async input => {
    const activeStore = store;
    if (checks.has(input.requirementId)) throw new Error('这份材料正在检查。');
    const snapshot = store.snapshot();
    const requirement = snapshot.requirements.find(r => r.id === input.requirementId);
    const progress = snapshot.progress.find(p => p.requirementId === input.requirementId);
    const version = snapshot.versions.find(v => v.id === progress?.selectedVersionId);
    if (!requirement || !version) throw new Error('请先关联一个文件版本。');
    checks.add(input.requirementId);
    try {
      const result = await worker({ type: 'check', file: activeStore.materialPath(version.id), requirement, version }) as CheckResult;
      activeStore.recordCheck(result);
      return result;
    } finally { checks.delete(input.requirementId); }
  });
  register('saveContact', schemas.saveContact, input => store.saveContact(input));
  register('saveRecommendation', schemas.saveRecommendation, input => store.saveRecommendation(input));
  register('saveSubmission', schemas.saveSubmission, input => store.saveSubmission(input));
  register('saveApiSettings', schemas.saveApiSettings, input => {
    if (store.snapshot().apiSettings.revision !== input.expectedRevision) throw new Error('设置已在其他操作中更新，请重新打开设置后保存。');
    const previous = input.key !== undefined ? credentials.read(store.root) : undefined;
    try {
      if (input.key !== undefined) credentials.write(store.root, input.key.trim());
      store.saveApiSettings({ baseUrl: input.baseUrl, model: input.model, hasKey: credentials.has(store.root), expectedRevision: input.expectedRevision });
    } catch (error) {
      if (previous !== undefined) credentials.write(store.root, previous);
      throw error;
    }
  });
  register('testApi', null, async () => {
    if (apiTestRunning) throw new Error('连接测试正在进行。');
    apiTestRunning = true;
    try { return await worker({ type: 'test', settings: apiConfig() }); }
    finally { apiTestRunning = false; }
  });
  register('startResearch', schemas.startResearch, input => {
    const project = store.snapshot().projects.find(p => p.id === input.projectId);
    if (!project) throw new Error('没有找到项目。');
    begin(createResearchRun(project));
  });
  register('resumeResearch', schemas.resumeResearch, input => {
    const run = store.snapshot().research.find(r => r.id === input.runId);
    if (!run) throw new Error('没有找到研究记录。');
    if (run.status === 'completed') throw new Error('该次研究已结束，请发起新研究。');
    begin(run);
  });
  register('cancelResearch', schemas.cancelResearch, input => {
    const job = jobs.get(input.runId);
    if (!job) return;
    job.child.postMessage({ type: 'cancel' });
  });
  register('adoptResearch', schemas.adoptResearch, input => store.adoptResearch(input));
  register('createBackup', null, async () => {
    const activeStore = store;
    const result = await dialog.showSaveDialog(window!, {
      title: '保存工作区备份', defaultPath: `ApplicationDesk-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: '工作区备份', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    if (activeStore !== store) throw new Error('工作区已切换，请为当前工作区重新创建备份。');
    return { path: activeStore.backupTo(result.filePath) };
  });
  register('restoreBackup', null, async () => {
    ensureIdle();
    const result = await dialog.showOpenDialog(window!, { title: '恢复到独立工作区', properties: ['openFile'], filters: [{ name: '工作区备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    ensureIdle();
    switching = true;
    try {
      const restored = DeskStore.restoreFrom(result.filePaths[0], workspaceRoot);
      switchTo(restored, false);
      return { path: restored };
    } finally { switching = false; }
  });
  register('openExternal', schemas.openExternal, input => {
    const url = new URL(input.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持打开公开网页链接。');
    return shell.openExternal(url.toString());
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 600, minHeight: 540,
    title: '申请工作台 V2', backgroundColor: '#f7f8fa',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'assets/icon.png'),
    show: process.env.DESK_SHOW_WINDOW !== '0',
    webPreferences: { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== MAIN_WINDOW_WEBPACK_ENTRY) event.preventDefault();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: '工作台', submenu: [
      { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' },
      { type: 'separator' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }, { type: 'separator' }, { label: '退出', role: 'quit' },
    ],
  }]));
  window.setMenuBarVisibility(false);
  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  window.on('closed', () => { window = null; });
  window.on('close', event => { if (!allowClose()) event.preventDefault(); });
}
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.whenReady().then(() => {
  if (!instance) return;
  credentials = new Credentials(path.join(baseRoot, 'credentials'));
  backupForUpgrade();
  const root = currentPath();
  store = new DeskStore(root, root === demoRoot);
  registerHandlers();
  createWindow();
}).catch(error => {
  dialog.showErrorBox('工作台无法启动', error instanceof Error ? error.message : String(error));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!allowClose()) { event.preventDefault(); return; }
  quitting = true;
  for (const [id, job] of jobs) {
    const run = job.store.snapshot().research.find(r => r.id === id);
    if (run) job.store.saveResearch({ ...run, status: 'paused', message: '应用已关闭，研究已暂停。继续需要手动操作。', updatedAt: new Date().toISOString() });
    job.child.kill();
  }
  jobs.clear();
  for (const child of workers) child.kill();
  workers.clear();
});
app.on('will-quit', () => store?.close());
