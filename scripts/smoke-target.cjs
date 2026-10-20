const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function existingFile(filename, label) {
  const resolved = path.resolve(filename);
  assert.ok(fs.existsSync(resolved) && fs.statSync(resolved).isFile(), `${label} is not a file: ${resolved}`);
  return fs.realpathSync.native(resolved);
}

function samePath(actual, expected, label) {
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  assert.equal(normalize(actual), normalize(expected), label);
}

async function sha256(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function resolveSmokeTarget(repository, env = process.env) {
  const overridden = Object.hasOwn(env, 'DESK_EXE');
  if (overridden) {
    assert.ok(typeof env.DESK_EXE === 'string' && env.DESK_EXE.trim(), 'DESK_EXE must name an executable; an empty override does not use the default build.');
  }
  const filename = overridden
    ? env.DESK_EXE
    : path.join(repository, 'out', 'Application Desk V2-win32-x64', 'ApplicationDesk.exe');
  return {
    selection: overridden ? 'override' : 'default',
    executablePath: existingFile(filename, overridden ? 'DESK_EXE' : 'Default smoke executable'),
  };
}

async function inspectSmokeTarget(application, selected, previous) {
  const runtime = await application.evaluate(({ app }) => ({
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }));
  assert.equal(runtime.isPackaged, true, 'Smoke tests must launch a packaged application.');
  const executablePath = existingFile(runtime.executablePath, 'Running executable');
  samePath(executablePath, selected.executablePath, 'The running executable differs from the selected smoke target.');
  const resourcesPath = runtime.platform === 'darwin'
    ? path.resolve(path.dirname(executablePath), '..', 'Resources')
    : path.join(path.dirname(executablePath), 'resources');
  samePath(fs.realpathSync.native(runtime.resourcesPath), fs.realpathSync.native(resourcesPath), 'The running resources belong to another application.');
  const appAsarPath = existingFile(runtime.appPath, 'Running app.asar');
  samePath(appAsarPath, existingFile(path.join(resourcesPath, 'app.asar'), 'Selected app.asar'), 'The running app.asar differs from the selected package.');
  for (const field of ['platform', 'arch', 'version']) {
    assert.ok(typeof runtime[field] === 'string' && runtime[field].trim(), `Missing runtime ${field}.`);
  }
  const target = {
    selection: selected.selection,
    executablePath,
    platform: runtime.platform,
    arch: runtime.arch,
    version: runtime.version,
    executableSha256: await sha256(executablePath),
    appAsarSha256: await sha256(appAsarPath),
  };
  if (previous) assert.deepEqual(target, previous, 'The smoke target changed across application restarts.');
  return target;
}

module.exports = { resolveSmokeTarget, inspectSmokeTarget };
