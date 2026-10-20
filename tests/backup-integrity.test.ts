import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import AdmZip from 'adm-zip';
import { DeskStore } from '../src/main/store';

type Manifest = { format: string; version: number; files: { path: string; sha256: string; size: number }[] };
const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'application-desk-backup-'));
  const store = new DeskStore(path.join(directory, 'original'));
  store.setup({ cycle: '2027–2028', timezone: 'Europe/London', demo: false });
  store.saveProject({
    institution: 'Fictional Backup College', name: 'Archive Studies', degree: 'MSc',
    officialUrl: 'https://example.edu/archive', cycle: '2027–2028', color: '#465D79',
  });
  const source = path.join(directory, 'original-material.txt');
  fs.writeFileSync(source, 'A fictional material that must survive failed restores.');
  const version = store.importFile(source, { title: 'Preserved original' });
  const sentinelPath = path.join(store.root, 'preserve-me.txt');
  fs.writeFileSync(sentinelPath, 'Existing user data must not change.');
  const archive = store.backupTo(path.join(directory, 'valid.zip'));
  const restores = path.join(directory, 'restores');
  fs.mkdirSync(restores);
  fs.writeFileSync(path.join(restores, 'parent-sentinel.txt'), 'Keep this unrelated file.');
  const originalSnapshot = JSON.stringify(store.snapshot());
  const originalBytes = fs.readFileSync(store.materialPath(version.id));
  const unchanged = () => {
    assert.equal(JSON.stringify(store.snapshot()), originalSnapshot);
    assert.deepEqual(fs.readFileSync(store.materialPath(version.id)), originalBytes);
    assert.deepEqual(fs.readFileSync(source), originalBytes);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'Existing user data must not change.');
    assert.deepEqual(fs.readdirSync(restores), ['parent-sentinel.txt'], 'failed restore leaves no partially enabled workspace');
  };
  const cleanup = () => {
    store.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('application-desk-backup-'));
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return { directory, store, version, archive, restores, unchanged, cleanup };
}
function readManifest(zip: AdmZip): Manifest {
  return JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8')) as Manifest;
}
function rewriteEntry(zip: AdmZip, name: string, bytes: Buffer, updateManifest: boolean) {
  zip.updateFile(name, bytes);
  if (!updateManifest) return;
  const manifest = readManifest(zip);
  const entry = manifest.files.find(item => item.path === name)!;
  entry.sha256 = digest(bytes); entry.size = bytes.length;
  zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
}
function writeMutation(original: string, destination: string, mutate: (zip: AdmZip) => void) {
  const zip = new AdmZip(original);
  mutate(zip);
  zip.writeZip(destination);
  return destination;
}

test('altered managed copy refuses backup and preserves an existing backup at the target', () => {
  const f = fixture();
  try {
    const validBytes = fs.readFileSync(f.archive);
    const managed = path.join(f.store.root, f.version.relativePath);
    const original = fs.readFileSync(managed);
    fs.writeFileSync(managed, 'Externally changed bytes.');
    assert.throws(() => f.store.backupTo(f.archive), /材料副本发生变化/);
    assert.deepEqual(fs.readFileSync(f.archive), validBytes, 'failed backup must not replace a prior recoverable archive');
    fs.writeFileSync(managed, original);
    f.unchanged();
  } finally { f.cleanup(); }
});

test('archive corruption fails file hashing before creating a restored workspace', () => {
  const f = fixture();
  try {
    const bad = writeMutation(f.archive, path.join(f.directory, 'corrupt-file.zip'), zip => {
      const content = zip.getEntry(f.version.relativePath)!.getData();
      content[0] ^= 0xff; // Same length: exercise SHA256 rather than just the size check.
      rewriteEntry(zip, f.version.relativePath, content, false);
    });
    assert.throws(() => DeskStore.restoreFrom(bad, f.restores), /备份校验失败/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test('forging the material manifest hash still fails the immutable SQLite version reference', () => {
  const f = fixture();
  try {
    const bad = writeMutation(f.archive, path.join(f.directory, 'forged-manifest.zip'), zip => {
      rewriteEntry(zip, f.version.relativePath, Buffer.from('A forged material with a matching forged manifest.'), true);
    });
    assert.throws(() => DeskStore.restoreFrom(bad, f.restores), /恢复材料与版本记录不一致/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test('missing files and duplicate manifest references are rejected without touching the original', () => {
  const f = fixture();
  try {
    const missing = writeMutation(f.archive, path.join(f.directory, 'missing-file.zip'), zip => {
      zip.deleteFile(f.version.relativePath);
    });
    assert.throws(() => DeskStore.restoreFrom(missing, f.restores), /备份清单与文件不一致/);
    const duplicate = writeMutation(f.archive, path.join(f.directory, 'duplicate-manifest.zip'), zip => {
      const manifest = readManifest(zip);
      manifest.files[1] = { ...manifest.files[0] };
      zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    });
    assert.throws(() => DeskStore.restoreFrom(duplicate, f.restores), /备份清单含无效文件/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test('raw traversal and Windows alternate-stream zip entry names are rejected before extraction', () => {
  const f = fixture();
  try {
    for (const [index, name] of ['../outside.txt', 'materials/../../outside.txt', 'materials/file.txt:secret'].entries()) {
      const bad = writeMutation(f.archive, path.join(f.directory, `unsafe-${index}.zip`), zip => {
        zip.addFile('unsafe-placeholder.txt', Buffer.from('Never extract this.'));
        // addFile sanitizes traversal. Setting the entry name creates a real adversarial ZIP name.
        zip.getEntry('unsafe-placeholder.txt')!.entryName = name;
      });
      assert.ok(new AdmZip(bad).getEntries().some(entry => entry.entryName === name));
      assert.throws(() => DeskStore.restoreFrom(bad, f.restores), /不安全或重复路径/);
      assert.equal(fs.existsSync(path.join(f.directory, 'outside.txt')), false);
      f.unchanged();
    }
  } finally { f.cleanup(); }
});

test('an intact but unsupported database schema is rejected and staged restore files are cleaned', () => {
  const f = fixture();
  try {
    const alteredDb = path.join(f.directory, 'future-schema.sqlite');
    fs.writeFileSync(alteredDb, new AdmZip(f.archive).getEntry('workspace.sqlite')!.getData());
    const db = new DatabaseSync(alteredDb);
    db.exec('PRAGMA user_version=999');
    db.close();
    const bad = writeMutation(f.archive, path.join(f.directory, 'future-schema.zip'), zip => {
      rewriteEntry(zip, 'workspace.sqlite', fs.readFileSync(alteredDb), true);
    });
    assert.throws(() => DeskStore.restoreFrom(bad, f.restores), /备份数据库版本不受支持/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test('an authenticated manifest cannot make a non-SQLite payload a valid workspace', () => {
  const f = fixture();
  try {
    const bad = writeMutation(f.archive, path.join(f.directory, 'not-sqlite.zip'), zip => {
      rewriteEntry(zip, 'workspace.sqlite', Buffer.from('This has a matching manifest hash but is not SQLite.'), true);
    });
    assert.throws(() => DeskStore.restoreFrom(bad, f.restores), /database|SQLite|数据库/i);
    f.unchanged();
  } finally { f.cleanup(); }
});

test('backup allowlist excludes credentials and arbitrary workspace files while preserving public evidence', () => {
  const f = fixture();
  try {
    const secret = 'SECRET_SENTINEL_NEVER_TO_ARCHIVE_2301';
    fs.writeFileSync(path.join(f.store.root, 'credentials.bin'), secret);
    fs.writeFileSync(path.join(f.store.root, '.env'), `API_KEY=${secret}`);
    fs.mkdirSync(path.join(f.directory, 'credential-vault'));
    fs.writeFileSync(path.join(f.directory, 'credential-vault', 'workspace.bin'), secret);
    fs.mkdirSync(path.join(f.store.root, 'research-cache', 'snapshots'), { recursive: true });
    fs.writeFileSync(path.join(f.store.root, 'research-cache', 'snapshots', 'source.json'), '{"text":"Public source evidence"}');
    f.store.saveApiSettings({ baseUrl: 'https://example.edu/v1', model: 'test-model', hasKey: true, expectedRevision: 0 });
    const archive = f.store.backupTo(path.join(f.directory, 'allowlist.zip'));
    const entries = new AdmZip(archive).getEntries();
    assert.ok(entries.some(entry => entry.entryName === 'research-cache/snapshots/source.json'));
    assert.ok(entries.every(entry => entry.entryName === 'manifest.json' || entry.entryName === 'workspace.sqlite' ||
      entry.entryName.startsWith('materials/') || entry.entryName.startsWith('research-cache/')));
    for (const entry of entries) assert.equal(entry.getData().includes(Buffer.from(secret)), false, `${entry.entryName} must not contain a secret`);
    assert.ok(!entries.some(entry => /credential|\.env|preserve-me/.test(entry.entryName)));
    const restored = DeskStore.restoreFrom(archive, f.restores);
    const restoredStore = new DeskStore(restored);
    try {
      assert.equal(restoredStore.snapshot().apiSettings.model, 'test-model', 'public provider configuration may be backed up');
      assert.equal(fs.existsSync(path.join(restored, 'credentials.bin')), false);
      assert.equal(fs.existsSync(path.join(restored, '.env')), false);
      assert.equal(fs.readFileSync(restoredStore.materialPath(f.version.id), 'utf8'), 'A fictional material that must survive failed restores.');
    } finally { restoredStore.close(); }
    assert.equal(fs.readFileSync(path.join(f.store.root, 'credentials.bin'), 'utf8'), secret);
  } finally { f.cleanup(); }
});
