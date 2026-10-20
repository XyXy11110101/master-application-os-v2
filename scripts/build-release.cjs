const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function readSourceState(root) {
  if (path.resolve(git(root, ['rev-parse', '--show-toplevel'])).toLowerCase() !== path.resolve(root).toLowerCase()) {
    throw new Error('Release builds must run at the repository root.');
  }
  if (git(root, ['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('Commit all source changes before creating a release build.');
  }
  return { sourceCommit: git(root, ['rev-parse', 'HEAD']), sourceCommittedAt: git(root, ['show', '-s', '--format=%cI', 'HEAD']) };
}

function artifactPaths(version) {
  return [
    'out/Application Desk V2-win32-x64/ApplicationDesk.exe',
    'out/Application Desk V2-win32-x64/resources/app.asar',
    'out/make/squirrel.windows/x64/ApplicationDeskV2-Setup.exe',
    `out/make/zip/win32/x64/Application Desk V2-win32-x64-${version}.zip`,
  ];
}

function artifactDigest(root, relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function writeProvenance(filename, value) {
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filename);
}

function runForge(root) {
  const metadata = require.resolve('@electron-forge/cli/package.json', { paths: [root] });
  const cli = path.join(path.dirname(metadata), 'dist', 'electron-forge.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'make', '--platform=win32', '--arch=x64'], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron Forge failed (${signal || `exit ${code}`}).`));
    });
  });
}

async function buildRelease({ root = path.resolve(__dirname, '..'), runForge: make = runForge, platform = process.platform, arch = process.arch, args = [] } = {}) {
  const output = path.join(root, 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  const filename = path.join(output, 'build-provenance.json');
  const record = { schemaVersion: 1, status: 'building', platform, arch, buildStartedAt: new Date().toISOString() };
  // Even a failed preflight must invalidate an older successful build record.
  writeProvenance(filename, record);
  try {
    if (args.length) throw new Error('Release builds do not accept Forge overrides. Use npm run package for development packaging.');
    if (platform !== 'win32' || arch !== 'x64') throw new Error('Release builds require Windows x64.');
    Object.assign(record, readSourceState(root));
    record.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    writeProvenance(filename, record);
    await make(root);
    const finalSource = readSourceState(root);
    if (finalSource.sourceCommit !== record.sourceCommit) throw new Error('Source commit changed during the build.');
    record.artifacts = artifactPaths(record.version).map(relativePath => artifactDigest(root, relativePath));
    record.buildCompletedAt = new Date().toISOString();
    record.status = 'completed';
    writeProvenance(filename, record);
    return record;
  } catch (error) {
    record.status = 'failed';
    record.failedAt = new Date().toISOString();
    record.error = error instanceof Error ? error.message : String(error);
    delete record.artifacts;
    delete record.buildCompletedAt;
    writeProvenance(filename, record);
    throw error;
  }
}

if (require.main === module) {
  buildRelease({ args: process.argv.slice(2) }).then(record => console.log(`Release build recorded for ${record.sourceCommit}.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { readSourceState, artifactPaths, artifactDigest, buildRelease };
