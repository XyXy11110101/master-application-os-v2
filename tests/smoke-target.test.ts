import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const { resolveSmokeTarget, inspectSmokeTarget } = require('../scripts/smoke-target.cjs');
const repository = path.resolve(__dirname, '..');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-smoke-target-'));
  const packageAt = (relative: string, content: string) => {
    const executablePath = path.join(directory, relative, 'ApplicationDesk.exe');
    const resourcesPath = path.join(path.dirname(executablePath), 'resources');
    fs.mkdirSync(resourcesPath, { recursive: true });
    fs.writeFileSync(executablePath, `Executable fixture: ${content}`);
    const appPath = path.join(resourcesPath, 'app.asar');
    fs.writeFileSync(appPath, `Application fixture: ${content}`);
    return { executablePath: fs.realpathSync.native(executablePath), resourcesPath, appPath };
  };
  const close = () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('desk-smoke-target-'));
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return { directory, packageAt, close };
}

test('smoke target overrides select the requested file and invalid overrides never fall back', () => {
  const f = fixture();
  try {
    const local = f.packageAt('out/Application Desk V2-win32-x64', 'local');
    const downloaded = f.packageAt('download with spaces', 'downloaded');
    assert.deepEqual(resolveSmokeTarget(f.directory, {}), { selection: 'default', executablePath: local.executablePath });
    assert.deepEqual(resolveSmokeTarget(f.directory, { DESK_EXE: downloaded.executablePath }), { selection: 'override', executablePath: downloaded.executablePath });
    for (const value of ['', '   ', path.join(f.directory, 'missing.exe'), f.directory]) {
      assert.throws(() => resolveSmokeTarget(f.directory, { DESK_EXE: value }), /DESK_EXE/);
    }
  } finally { f.close(); }
});

test('smoke identity comes from the running package and rejects a different executable or app archive', async () => {
  const f = fixture();
  try {
    const downloaded = f.packageAt('download', 'downloaded');
    const other = f.packageAt('other', 'other');
    const selected = resolveSmokeTarget(f.directory, { DESK_EXE: downloaded.executablePath });
    const runtime = { ...downloaded, platform: 'win32', arch: 'x64', version: '0.2.1', isPackaged: true };
    const app = (changes = {}) => ({ evaluate: async () => ({ ...runtime, ...changes }) });
    const identity = await inspectSmokeTarget(app(), selected);
    const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.deepEqual(identity, {
      ...selected, platform: 'win32', arch: 'x64', version: '0.2.1',
      executableSha256: hash(downloaded.executablePath), appAsarSha256: hash(downloaded.appPath),
    });
    await assert.rejects(inspectSmokeTarget(app({ executablePath: other.executablePath }), selected), /running executable differs/);
    await assert.rejects(inspectSmokeTarget(app({ appPath: other.appPath }), selected), /app.asar differs/);
    await assert.rejects(inspectSmokeTarget(app({ resourcesPath: other.resourcesPath }), selected), /resources belong to another/);
    await assert.rejects(inspectSmokeTarget(app({ isPackaged: false }), selected), /packaged application/);
    await assert.rejects(inspectSmokeTarget(app({ version: '' }), selected), /Missing runtime version/);
  } finally { f.close(); }
});

test('smoke identity rejects package changes between restarts even if the executable is unchanged', async () => {
  const f = fixture();
  try {
    const packaged = f.packageAt('download', 'downloaded');
    const selected = resolveSmokeTarget(f.directory, { DESK_EXE: packaged.executablePath });
    const runtime = { ...packaged, platform: 'win32', arch: 'x64', version: '0.2.1', isPackaged: true };
    const app = { evaluate: async () => runtime };
    const identity = await inspectSmokeTarget(app, selected);
    assert.deepEqual(await inspectSmokeTarget(app, selected, identity), identity);
    fs.appendFileSync(packaged.appPath, 'changed application');
    await assert.rejects(inspectSmokeTarget(app, selected, identity), /changed across application restarts/);
  } finally { f.close(); }
});

test('all four smoke entrypoints use DESK_EXE and write failure evidence without launching a fallback', () => {
  const f = fixture();
  try {
    f.packageAt('out/Application Desk V2-win32-x64', 'local');
    const downloaded = f.packageAt('separate download', 'downloaded');
    const scripts = path.join(f.directory, 'scripts');
    fs.mkdirSync(scripts);
    for (const filename of ['smoke-target.cjs', 'capture.cjs', 'desktop-smoke.cjs', 'workflow-smoke.cjs', 'ux-smoke.cjs', 'lifecycle-smoke.cjs']) {
      fs.copyFileSync(path.join(repository, 'scripts', filename), path.join(scripts, filename));
    }
    const launched = path.join(f.directory, 'launch.json');
    const preload = path.join(f.directory, 'observe-launch.cjs');
    fs.writeFileSync(preload, `
const fs = require('node:fs');
require('playwright')._electron.launch = async options => {
  fs.writeFileSync(process.env.TEST_LAUNCH_RECORD, JSON.stringify({ executablePath: options.executablePath }));
  throw new Error('TEST_STOP_AFTER_LAUNCH_TARGET');
};
`);
    for (const name of ['desktop', 'workflow', 'ux', 'lifecycle']) {
      const script = path.join(scripts, `${name}-smoke.cjs`);
      const execute = (override: string) => spawnSync(process.execPath, ['--require', preload, script], {
        cwd: f.directory, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, DESK_EXE: override, TEST_LAUNCH_RECORD: launched, NODE_PATH: path.join(repository, 'node_modules'), TEMP: f.directory, TMP: f.directory, TMPDIR: f.directory },
      });
      const requested = execute(downloaded.executablePath);
      assert.equal(requested.status, 1, `${name}: ${requested.stderr}`);
      assert.equal(JSON.parse(fs.readFileSync(launched, 'utf8')).executablePath, downloaded.executablePath, name);
      fs.unlinkSync(launched);
      const invalid = execute(path.join(f.directory, 'missing.exe'));
      assert.equal(invalid.status, 1, `${name}: ${invalid.stderr}`);
      assert.equal(fs.existsSync(launched), false, `${name} must not launch another build`);
      const report = JSON.parse(fs.readFileSync(path.join(f.directory, 'artifacts', `${name}-smoke.json`), 'utf8'));
      assert.equal(report.status, 'failed', name);
      assert.match(report.failure, /DESK_EXE/, name);
      assert.equal(report.target, null, name);
    }
  } finally { f.close(); }
});
