const capture = require('./capture.cjs');
// Packaged-app integration test. Set DESK_NATIVE_PICKER=1 to drive the real
// Windows file dialog manually; otherwise the Electron dialog return is stubbed.
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-v2-workflow-'));
  const file = path.join(data, 'sample-statement.txt');
  fs.writeFileSync(file, 'A thoughtful statement about learning design and education.\n');
  const evidence = { startedAt: new Date().toISOString(), data, file, nativePicker: process.env.DESK_NATIVE_PICKER === '1', assertions: [], errors: [] };
  let application;
  try {
    application = await electron.launch({
      executablePath: path.join(root, 'out', 'Application Desk V2-win32-x64', 'ApplicationDesk.exe'),
      env: { ...process.env, DESK_DATA_HOME: data, DESK_SHOW_WINDOW: process.env.DESK_SHOW_WINDOW || '0' },
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.getByLabel('目标入学年份', { exact: true }).selectOption('2027');
    await page.getByLabel('个人时区').selectOption('Europe/London');
    await page.getByRole('button', { name: /建立个人工作区/ }).click();
    await page.getByRole('button', { name: '添加目标项目', exact: true }).click();
    let modal = page.getByRole('dialog', { name: '添加一个目标项目', exact: true });
    await modal.getByLabel('学校名称').fill('QA Example University');
    await modal.getByLabel('项目名称').fill('Learning Design MSc');
    await modal.getByLabel('项目官网').fill('https://example.edu/learning-design');
    await modal.getByRole('button', { name: '保存项目', exact: true }).click();
    await page.getByRole('button', { name: '我的学校', exact: true }).click();
    await page.getByRole('button', { name: /^Learning Design MSc/ }).click();
    await page.getByRole('button', { name: '添加事项', exact: true }).click();
    modal = page.getByRole('dialog', { name: '添加准备事项', exact: true });
    await modal.getByLabel('事项名称').fill('Test statement');
    await modal.getByLabel('具体要做什么').fill('An isolated QA fixture, not a university requirement.');
    await modal.locator('summary', { hasText: '学校要求、个人适用性与条件' }).click();
    await modal.getByLabel('学校是否要求').selectOption('required');
    await modal.getByLabel('依据是否明确').selectOption('supported');
    await modal.getByLabel('是否适用于本人').selectOption('applies');
    await modal.getByRole('button', { name: '保存要求', exact: true }).click();
    await modal.locator('.feedback .error').waitFor();
    assert.equal(await modal.getByLabel('事项名称').inputValue(), 'Test statement');
    evidence.assertions.push('source validation failure retains open editor and typed inputs');
    await modal.locator('summary', { hasText: '来源依据' }).click();
    await modal.getByRole('button', { name: '添加来源', exact: true }).click();
    await modal.getByLabel('官网链接').fill('https://example.edu/learning-design');
    await modal.getByLabel('原文摘录').fill('A statement is required. This is a synthetic test fixture.');
    await modal.getByLabel('适用范围', { exact: true }).fill('Learning Design MSc 2027–2028 synthetic QA');
    await modal.getByRole('button', { name: '保存要求', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    evidence.assertions.push('onboarding, project and supported requirement created through UI');
    for (const summary of ['Second edit retained', 'Third edit retained']) {
      await page.getByRole('button', { name: '编辑要求', exact: true }).click();
      modal = page.getByRole('dialog', { name: '编辑这项要求', exact: true });
      await modal.getByLabel('具体要做什么').fill(summary);
      await modal.getByRole('button', { name: '保存要求', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
    }
    let snapshot = await page.evaluate(() => window.desk.getSnapshot());
    assert.equal(snapshot.requirements[0].summary, 'Third edit retained');
    assert.equal(snapshot.requirements.length, 1);
    evidence.assertions.push('reopening and saving the same requirement twice uses current revision without duplicates');
    await page.getByRole('button', { name: '正在准备', exact: true }).click();
    await page.getByLabel('给自己留个备注').fill('Keep the original selection and input after save.');
    await page.getByRole('button', { name: '保存进度', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    await page.getByLabel('给自己留个备注').fill('A second ordinary save.');
    await page.getByRole('button', { name: '保存进度', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.desk.getSnapshot()).progress[0].note)).toBe('A second ordinary save.');
    evidence.assertions.push('two ordinary progress saves retain selected detail and editable input');
    if (!evidence.nativePicker) {
      await application.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, file);
    }
    await page.getByRole('button', { name: '从电脑导入', exact: true }).click();
    console.log(JSON.stringify({ phase: 'file-picker', path: file, native: evidence.nativePicker }));
    await expect.poll(() => page.evaluate(async () => (await window.desk.getSnapshot()).versions.length), { timeout: 300000 }).toBe(1);
    await page.getByRole('button', { name: '导入新版本', exact: true }).waitFor();
    await page.getByRole('button', { name: '保存进度', exact: true }).click();
    await page.getByRole('button', { name: '检查当前文件', exact: true }).click();
    await page.getByText('本地检查完成', { exact: true }).waitFor({ timeout: 90000 });
    snapshot = await page.evaluate(() => window.desk.getSnapshot());
    assert.equal(snapshot.checks.length, 1);
    assert.ok(snapshot.checks[0].words > 0);
    assert.equal(snapshot.checks[0].pages, null);
    assert.equal(fs.readFileSync(file, 'utf8'), 'A thoughtful statement about learning design and education.\n');
    evidence.assertions.push(`${evidence.nativePicker ? 'real Windows dialog' : 'stubbed dialog'} imports a copy, keeps source, associates and checks in packaged utility process`);
    await capture(application, path.join(output, 'material-detail.png'));
    await page.getByRole('button', { name: '准备好了', exact: true }).click();
    await page.getByRole('button', { name: '保存进度', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.desk.getSnapshot()).progress[0].status)).toBe('ready');
    await page.getByRole('button', { name: /提交与收件/ }).click();
    await page.getByLabel('本人准备完成').fill('2026-10-20');
    await page.getByLabel('实际提交', { exact: false }).fill('2026-10-20');
    await page.getByLabel('我已核对本次记录').check();
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.desk.getSnapshot()).submissions[0].submittedAt)).toBe('2026-10-20');
    snapshot = await page.evaluate(() => window.desk.getSnapshot());
    assert.equal(snapshot.submissions[0].confirmedAt, '');
    assert.equal(snapshot.submissions[0].receivedAt, '');
    evidence.assertions.push('UI records preparation and actual submission independently of formal confirmation and receipt');
    await page.getByRole('button', { name: /准备清单/ }).click();
    await page.getByRole('button', { name: '关联推荐人', exact: true }).click();
    await page.getByRole('button', { name: '添加联系人', exact: true }).click();
    modal = page.getByRole('dialog', { name: '添加推荐人联系人', exact: true });
    await modal.getByLabel('姓名', { exact: true }).fill('QA Fictional Referee');
    await modal.getByLabel('邮箱', { exact: true }).fill('referee@example.test');
    await modal.getByRole('button', { name: '保存联系人', exact: true }).click();
    modal = page.getByRole('dialog', { name: '记录推荐信进度', exact: true });
    await modal.locator('select').first().selectOption({ label: 'QA Fictional Referee · referee@example.test' });
    await modal.getByLabel('这个项目的进度').selectOption('invited');
    await modal.getByLabel('回访日期').fill('2026-11-01');
    await modal.getByRole('button', { name: '保存进度', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    snapshot = await page.evaluate(() => window.desk.getSnapshot());
    assert.equal(snapshot.recommendations[0].stage, 'invited');
    assert.equal(snapshot.recommendations[0].revisitOn, '2026-11-01');
    evidence.assertions.push('nested contact dialog and project-specific invitation/follow-up save through UI');
    await page.getByRole('button', { name: '编辑要求', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: '编辑这项要求', exact: true }).isVisible(), false);
    evidence.assertions.push('keyboard Escape closes editor');
    await page.getByRole('button', { name: '我的材料', exact: true }).click();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800));
    await page.waitForFunction(() => window.innerWidth < 760);
    await expect(page.locator('.library-list')).toBeVisible();
    await expect(page.locator('.library-detail')).toBeHidden();
    await page.locator('.library-item').first().click();
    await expect(page.locator('.library-list')).toBeHidden();
    await expect(page.locator('.library-detail')).toBeVisible();
    await page.getByRole('button', { name: '返回材料列表', exact: true }).click();
    await expect(page.locator('.library-list')).toBeVisible();
    await expect(page.locator('.library-detail')).toBeHidden();
    evidence.assertions.push('640px materials library switches between list and detail with a working back button');
    assert.deepEqual(evidence.errors, []);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.failure = error.stack;
    if (application) {
      const page = await application.firstWindow().catch(() => null);
      if (page) {
        evidence.visibleText = await page.locator('body').innerText().catch(() => '');
        await capture(application, path.join(output, 'workflow-failure.png')).catch(() => {});
      }
    }
    throw error;
  } finally {
    if (application) { await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await application.close().catch(() => {}); }
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'workflow-smoke.json'), JSON.stringify(evidence, null, 2));
  }
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
