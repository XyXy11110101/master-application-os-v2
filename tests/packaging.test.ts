import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';

const { normalizeZip, normalizeWindowsResults, WINDOWS_FOLDER } = require('../scripts/normalize-zip.cjs');
const { buildRelease, artifactPaths } = require('../scripts/build-release.cjs');
const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-v2-packaging-'));
  return {
    root,
    cleanup() {
      assert.equal(path.dirname(root), os.tmpdir());
      assert.ok(path.basename(root).startsWith('desk-v2-packaging-'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function rawArchive(filename: string, files: Array<[string, Buffer]>) {
  const zip = new AdmZip();
  files.forEach(([name, bytes], index) => {
    const placeholder = `placeholder-${index}`;
    zip.addFile(placeholder, bytes);
    zip.getEntry(placeholder)!.entryName = name;
  });
  zip.writeZip(filename);
}

test('Windows ZIP uses portable raw names and one root without changing file contents', () => {
  const f = fixture();
  try {
    const filename = path.join(f.root, 'application.zip');
    const files: Array<[string, Buffer]> = [
      ['ApplicationDesk.exe', crypto.randomBytes(1000)],
      ['resources\\app.asar', crypto.randomBytes(4096)],
      ['resources\\语言\\说明.txt', Buffer.from('Unicode file content')],
      ['empty.txt', Buffer.alloc(0)],
    ];
    rawArchive(filename, files);
    assert.ok(new AdmZip(filename).getEntries().some(entry => entry.rawEntryName.includes(0x5c)), 'fixture must contain literal backslashes in ZIP headers');
    normalizeZip(filename);
    for (let pass = 0; pass < 2; pass++) {
      const zip = new AdmZip(filename);
      const entries = zip.getEntries();
      assert.ok(entries.every(entry => !entry.rawEntryName.includes(0x5c)));
      assert.ok(entries.every(entry => entry.entryName.startsWith(`${WINDOWS_FOLDER}/`)));
      for (const [name, bytes] of files) {
        const entry = zip.getEntry(`${WINDOWS_FOLDER}/${name.replaceAll('\\', '/')}`);
        assert.ok(entry, name);
        assert.equal(digest(entry.getData()), digest(bytes));
      }
      assert.equal(entries.filter(entry => !entry.isDirectory).length, files.length);
      normalizeZip(filename);
    }
  } finally { f.cleanup(); }
});

test('unsafe or colliding ZIP destinations leave the original archive untouched', () => {
  const f = fixture();
  try {
    const filename = path.join(f.root, 'unsafe.zip');
    const cases = [
      ['../escape.txt'], ['/absolute.txt'], ['C:\\escape.txt'], ['folder\\..\\escape.txt'],
      ['folder\\same.txt', 'folder/same.txt'], ['same.txt', 'SAME.txt'],
      ['folder', 'folder/child.txt'], [`${WINDOWS_FOLDER}/already-rooted.txt`, 'outside.txt'],
    ];
    for (const names of cases) {
      rawArchive(filename, names.map(name => [name, Buffer.from(name)]));
      const before = fs.readFileSync(filename);
      assert.throws(() => normalizeZip(filename));
      assert.deepEqual(fs.readFileSync(filename), before, names.join(', '));
      assert.deepEqual(fs.readdirSync(f.root), ['unsafe.zip'], 'failure must not leave a replacement ZIP');
    }
  } finally { f.cleanup(); }
});

test('Forge postMake changes only Windows x64 ZIP artifacts', () => {
  const f = fixture();
  try {
    const windows = path.join(f.root, 'windows.zip'), linux = path.join(f.root, 'linux.zip');
    const setup = path.join(f.root, 'setup.exe');
    rawArchive(windows, [['ApplicationDesk.exe', Buffer.from('windows')]]);
    rawArchive(linux, [['ApplicationDesk', Buffer.from('linux')]]);
    fs.writeFileSync(setup, 'installer');
    const linuxBefore = fs.readFileSync(linux);
    const results = [{ platform: 'win32', arch: 'x64', artifacts: [windows, setup] }, { platform: 'linux', arch: 'x64', artifacts: [linux] }];
    assert.equal(normalizeWindowsResults(results), results);
    assert.ok(new AdmZip(windows).getEntry(`${WINDOWS_FOLDER}/ApplicationDesk.exe`));
    assert.deepEqual(fs.readFileSync(linux), linuxBefore);
    assert.equal(fs.readFileSync(setup, 'utf8'), 'installer');
  } finally { f.cleanup(); }
});

function repository(root: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  fs.writeFileSync(path.join(root, '.gitignore'), 'artifacts/\nout/\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.1' }));
  git('init'); git('add', '--all');
  git('-c', 'user.name=Packaging Test', '-c', 'user.email=packaging@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Synthetic packaging fixture');
  return git;
}

function fakeBuild(root: string) {
  for (const relativePath of artifactPaths('0.2.1')) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `Fixture bytes for ${relativePath}`);
  }
}

test('release provenance binds completed build timestamps and hashes to a clean source commit', async () => {
  const f = fixture();
  try {
    const git = repository(f.root);
    const result = await buildRelease({ root: f.root, platform: 'win32', arch: 'x64', runForge: async () => fakeBuild(f.root) });
    assert.equal(result.status, 'completed');
    assert.equal(result.sourceCommit, git('rev-parse', 'HEAD'));
    assert.equal(result.sourceCommittedAt, git('show', '-s', '--format=%cI', 'HEAD'));
    assert.ok(Date.parse(result.buildCompletedAt) >= Date.parse(result.buildStartedAt));
    assert.equal(result.artifacts.length, 4);
    for (const artifact of result.artifacts) {
      const bytes = fs.readFileSync(path.join(f.root, artifact.path));
      assert.equal(artifact.bytes, bytes.length);
      assert.equal(artifact.sha256, digest(bytes));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'artifacts/build-provenance.json'), 'utf8')), result);
  } finally { f.cleanup(); }
});

test('dirty source preflight invalidates old provenance and never invokes the build', async () => {
  const f = fixture();
  try {
    repository(f.root);
    await buildRelease({ root: f.root, platform: 'win32', arch: 'x64', runForge: async () => fakeBuild(f.root) });
    fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ version: '0.2.2' }));
    let calls = 0;
    await assert.rejects(buildRelease({ root: f.root, platform: 'win32', arch: 'x64', runForge: async () => { calls++; } }), /Commit all source changes/);
    assert.equal(calls, 0);
    const report = JSON.parse(fs.readFileSync(path.join(f.root, 'artifacts/build-provenance.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.artifacts, undefined);
    assert.equal(report.buildCompletedAt, undefined);
  } finally { f.cleanup(); }
});

test('build failures and mid-build source edits cannot produce completed provenance', async () => {
  for (const mode of ['exit', 'source-edit', 'missing-artifacts']) {
    const f = fixture();
    try {
      repository(f.root);
      await assert.rejects(buildRelease({ root: f.root, platform: 'win32', arch: 'x64', runForge: async () => {
        if (mode === 'exit') throw new Error('Synthetic Forge failure');
        if (mode === 'source-edit') { fakeBuild(f.root); fs.appendFileSync(path.join(f.root, 'package.json'), '\n'); }
      } }));
      const report = JSON.parse(fs.readFileSync(path.join(f.root, 'artifacts/build-provenance.json'), 'utf8'));
      assert.equal(report.status, 'failed', mode);
      assert.equal(report.artifacts, undefined, mode);
    } finally { f.cleanup(); }
  }
});

test('release wrapper refuses another platform and skip-package overrides', async () => {
  const f = fixture();
  try {
    repository(f.root);
    let calls = 0;
    const runForge = async () => { calls++; };
    await assert.rejects(buildRelease({ root: f.root, platform: 'linux', arch: 'x64', runForge }), /Windows x64/);
    await assert.rejects(buildRelease({ root: f.root, platform: 'win32', arch: 'x64', args: ['--skip-package'], runForge }), /do not accept Forge overrides/);
    assert.equal(calls, 0);
  } finally { f.cleanup(); }
});
