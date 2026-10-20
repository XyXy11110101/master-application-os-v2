import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { DatabaseSync } from 'node:sqlite';

interface BackupManifest {
  format: 'application-desk-v2';
  version: 1;
  createdAt: string;
  files: { path: string; sha256: string; size: number }[];
}

export function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeRelative(name: string): boolean {
  return !name.includes('\\') && !name.includes(':') && !name.startsWith('/') &&
    name.split('/').every(part => part !== '..' && part !== '.' && part !== '');
}

/** Receives a separately created, consistent SQLite snapshot, never a live WAL database. */
export function writeBackup(
  destination: string,
  sqliteSnapshot: string,
  root: string,
  managedPaths: string[],
  expectedHashes: Record<string, string> = {},
): string {
  const archive = new AdmZip();
  const manifest: BackupManifest = { format: 'application-desk-v2', version: 1, createdAt: new Date().toISOString(), files: [] };
  const add = (name: string, bytes: Buffer) => {
    if (!safeRelative(name)) throw new Error('备份中存在不安全的文件路径。');
    archive.addFile(name, bytes);
    manifest.files.push({ path: name, sha256: sha256(bytes), size: bytes.length });
  };
  add('workspace.sqlite', fs.readFileSync(sqliteSnapshot));
  for (const relative of new Set(managedPaths)) {
    const normalized = relative.replaceAll('\\', '/');
    if (!normalized.startsWith('materials/') || !safeRelative(normalized)) throw new Error('材料路径超出工作区。');
    const absolute = path.resolve(root, ...normalized.split('/'));
    const rootPath = path.resolve(root) + path.sep;
    if (!absolute.startsWith(rootPath) || fs.lstatSync(absolute).isSymbolicLink()) throw new Error('材料路径超出工作区。');
    const bytes = fs.readFileSync(absolute);
    if (expectedHashes[relative] && sha256(bytes) !== expectedHashes[relative]) throw new Error('材料副本发生变化，备份已停止，请重新导入该文件。');
    add(normalized, bytes);
  }
  const cacheRoot = path.join(root, 'research-cache');
  const walk = (directory: string) => {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('研究资料中存在不安全链接，备份已停止。');
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('研究资料中存在不安全链接，备份已停止。');
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) {
        // Research snapshots/cache are public material only; vaults live outside this root.
        if (stat.size > 100 * 1024 * 1024) throw new Error('研究资料文件过大，备份已停止。');
        add(path.relative(root, absolute).replaceAll('\\', '/'), fs.readFileSync(absolute));
      }
      if (manifest.files.length > 10000 || manifest.files.reduce((total, file) => total + file.size, 0) > 2 * 1024 * 1024 * 1024) {
        throw new Error('工作区超过当前备份的 2 GB 或 10000 文件上限。');
      }
    }
  };
  if (fs.existsSync(cacheRoot)) walk(cacheRoot);
  if (manifest.files.length > 10000 || manifest.files.reduce((total, file) => total + file.size, 0) > 2 * 1024 * 1024 * 1024) {
    throw new Error('工作区超过当前备份的 2 GB 或 10000 文件上限。');
  }
  archive.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  const finalPath = path.resolve(destination);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const temporary = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    archive.writeZip(temporary);
    fs.renameSync(temporary, finalPath);
    return finalPath;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Restores into a new directory, validates all bytes and references, never overwrites a workspace. */
export function restoreBackup(archivePath: string, parentRoot: string): string {
  const archiveStat = fs.statSync(archivePath);
  if (archiveStat.size > 2 * 1024 * 1024 * 1024) throw new Error('备份文件超过 2 GB，无法安全恢复。');
  const archive = new AdmZip(archivePath);
  const entries = archive.getEntries();
  if (entries.length > 10000) throw new Error('备份文件数量异常。');
  const names = new Set<string>();
  let uncompressed = 0;
  for (const entry of entries) {
    if (entry.isDirectory || !safeRelative(entry.entryName) || names.has(entry.entryName)) throw new Error('备份包含不安全或重复路径。');
    names.add(entry.entryName);
    uncompressed += entry.header.size;
  }
  if (uncompressed > 2 * 1024 * 1024 * 1024) throw new Error('备份展开后超过 2 GB。');
  const manifestEntry = archive.getEntry('manifest.json');
  if (!manifestEntry || manifestEntry.header.size > 5 * 1024 * 1024) throw new Error('备份清单缺失或异常。');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as BackupManifest;
  if (manifest.format !== 'application-desk-v2' || manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('这不是受支持的新版工作区备份。');
  }
  if (manifest.files.length !== entries.length - 1 || !manifest.files.some(file => file.path === 'workspace.sqlite')) {
    throw new Error('备份清单与文件不一致。');
  }
  const buffers = new Map<string, Buffer>();
  for (const file of manifest.files) {
    if (!safeRelative(file.path) || !(file.path === 'workspace.sqlite' || file.path.startsWith('materials/') || file.path.startsWith('research-cache/')) || buffers.has(file.path)) {
      throw new Error('备份清单含无效文件。');
    }
    const entry = archive.getEntry(file.path);
    if (!entry || entry.header.size !== file.size) throw new Error(`备份缺少文件或大小不符：${file.path}`);
    const bytes = entry.getData();
    if (sha256(bytes) !== file.sha256) throw new Error(`备份校验失败：${file.path}`);
    buffers.set(file.path, bytes);
  }
  const parent = path.resolve(parentRoot);
  fs.mkdirSync(parent, { recursive: true });
  const restored = path.join(parent, `restored-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(restored);
  try {
    for (const [name, bytes] of buffers) {
      const target = path.join(restored, ...name.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: 'wx' });
    }
    const db = new DatabaseSync(path.join(restored, 'workspace.sqlite'));
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
      if (integrity.integrity_check !== 'ok') throw new Error('恢复数据库完整性检查失败。');
      const version = db.prepare('PRAGMA user_version').get() as Record<string, number>;
      if (![1, 2].includes(version.user_version)) throw new Error('备份数据库版本不受支持。');
      const versions = db.prepare("SELECT data FROM entities WHERE kind = 'version'").all() as { data: string }[];
      for (const row of versions) {
        const version = JSON.parse(row.data) as { relativePath: string; sha256: string; size: number };
        const bytes = buffers.get(version.relativePath.replaceAll('\\', '/'));
        if (!bytes || sha256(bytes) !== version.sha256 || bytes.length !== version.size) throw new Error('恢复材料与版本记录不一致。');
      }
    } finally { db.close(); }
    return restored;
  } catch (error) {
    // Only remove the exact new directory created above, after verifying containment.
    if (path.dirname(path.resolve(restored)) === parent && path.basename(restored).startsWith('restored-')) {
      fs.rmSync(restored, { recursive: true, force: true });
    }
    throw error;
  }
}
