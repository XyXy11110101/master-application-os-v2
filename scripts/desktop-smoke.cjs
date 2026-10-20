const { resolveSmokeTarget, inspectSmokeTarget } = require('./smoke-target.cjs');
const capture = require('./capture.cjs');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-v2-smoke-'));
  let selected;
  const launch = () => electron.launch({
    executablePath: selected.executablePath,
    env: { ...process.env, DESK_DATA_HOME: data, DESK_SHOW_WINDOW: process.env.DESK_SHOW_WINDOW || '0' },
    timeout: 30000,
  });
  const evidence = { dataPath: data, target: null, startedAt: new Date().toISOString(), assertions: [], errors: [] };
  let application;
  async function captureNative(filename) { await capture(application, path.join(output, filename)); }

  try {
    selected = resolveSmokeTarget(root);
    application = await launch();
    evidence.target = await inspectSmokeTarget(application, selected);
    let page = await application.firstWindow();
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.waitForFunction(() => !!window.desk);
    let snapshot = await page.evaluate(() => window.desk.getSnapshot());
    assert.equal(snapshot.workspace, null);
    evidence.assertions.push('fresh isolated workspace starts without personal data');
    await page.getByRole('heading', { name: '建一个自己的工作区' }).waitFor();
    await capture(application, path.join(output, 'onboarding.png'));
    await page.evaluate(() => window.desk.setup({ cycle: '2027–2028', timezone: 'Europe/London', demo: true }));
    await expect.poll(() => page.evaluate(async () => (await window.desk.getSnapshot()).workspace?.demo)).toBe(true);
    await page.getByRole('button', { name: /^我的学校/ }).click();
    const columns = () => page.locator('.school-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    await expect.poll(columns).toBe(4);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 900));
    await expect.poll(columns).toBe(2);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800));
    await expect.poll(columns).toBe(1);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    await expect.poll(columns).toBe(4);
    evidence.assertions.push('actual desktop window sizes produce four, two and one school-card columns');
    await capture(application, path.join(output, 'schools.png'));
    snapshot = await page.evaluate(() => window.desk.getSnapshot());
    assert.equal(snapshot.workspace.demo, true);
    assert.ok(snapshot.projects.length >= 4);
    assert.ok(snapshot.actions.length > 0);
    evidence.assertions.push('isolated fictional demo has schools, requirements and derived actions');
    const requirement = snapshot.requirements.find(r => r.kind === 'document');
    assert.ok(requirement);
    const initial = snapshot.progress.find(p => p.requirementId === requirement.id);
    await page.evaluate(input => window.desk.saveProgress(input), {
      requirementId: requirement.id, expectedRevision: initial.revision, status: 'doing',
      note: '桌面验收：保存与重启', revisitOn: '', selectedVersionId: null,
    });
    let rejected = false;
    try {
      await page.evaluate(input => window.desk.saveProgress(input), {
        requirementId: requirement.id, expectedRevision: initial.revision, status: 'ready',
        note: 'stale', revisitOn: '', selectedVersionId: null,
      });
    } catch { rejected = true; }
    assert.equal(rejected, true);
    evidence.assertions.push('IPC rejects stale revision instead of overwriting progress');
    await page.getByRole('button', { name: '现在', exact: true }).click();
    await capture(application, path.join(output, 'today.png'));
    await page.getByRole('button', { name: '我的材料', exact: true }).click();
    await capture(application, path.join(output, 'library.png'));
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await capture(application, path.join(output, 'settings.png'));
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1440, 960);
      win.webContents.setZoomFactor(2);
    });
    await page.waitForFunction(() => window.innerWidth < 800);
    await page.waitForTimeout(350);
    await captureNative('zoom-200.png');
    evidence.zoomLayout = await page.evaluate(() => ({
      width: window.innerWidth, height: window.innerHeight,
      sidebar: document.querySelector('.sidebar')?.getBoundingClientRect().toJSON(),
      canvas: document.querySelector('.main-canvas')?.getBoundingClientRect().toJSON(),
    }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert.equal(overflow, false);
    evidence.assertions.push('actual Electron webContents zoom factor 2 has no page horizontal overflow');
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setZoomFactor(1);
      win.setSize(640, 800);
    });
    await page.waitForTimeout(350);
    await captureNative('narrow.png');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2), false);
    evidence.assertions.push('640px native window has no page horizontal overflow');
    await application.close();
    application = await launch();
    await inspectSmokeTarget(application, selected, evidence.target);
    page = await application.firstWindow();
    await page.waitForFunction(() => !!window.desk);
    const after = await page.evaluate(() => window.desk.getSnapshot());
    const saved = after.progress.find(p => p.requirementId === requirement.id);
    assert.equal(saved.status, 'doing');
    assert.equal(saved.note, '桌面验收：保存与重启');
    assert.equal(after.workspace.demo, true);
    evidence.assertions.push('workspace selection and progress survive full Electron process restart');
    assert.deepEqual(evidence.errors, []);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = error.stack;
    throw error;
  } finally {
    if (application) { await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await application.close().catch(() => {}); }
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'desktop-smoke.json'), JSON.stringify(evidence, null, 2));
  }
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
