const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const relativePaths = [
  'out/Application Desk V2-win32-x64/ApplicationDesk.exe',
  'out/Application Desk V2-win32-x64/resources/app.asar',
  'out/make/squirrel.windows/x64/ApplicationDeskV2-Setup.exe',
  `out/make/zip/win32/x64/Application Desk V2-win32-x64-${require('../package.json').version}.zip`,
];
const main = asar.extractFile(path.join(root, relativePaths[1]), path.join('.webpack', 'main', 'index.cjs')).toString();
assert.ok(main.includes('ApplicationDeskV2Data'), 'the final bundle must use a data directory separate from Squirrel');
const reports = ['desktop-smoke', 'workflow-smoke', 'lifecycle-smoke', 'ux-smoke'].map(name => {
  const result = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'));
  assert.equal(result.status, 'passed');
  assert.ok(Date.parse(result.startedAt) >= fs.statSync(path.join(root, relativePaths[1])).mtimeMs, `${name} must run against the final packaged application`);
  return { name, status: result.status, completedAt: result.completedAt, assertions: result.assertions.length };
});
const result = {
  version: require('../package.json').version,
  createdAt: new Date().toISOString(),
  platform: 'Windows x64',
  dataDirectory: '%LOCALAPPDATA%\\ApplicationDeskV2Data',
  installerDirectory: '%LOCALAPPDATA%\\ApplicationDeskV2',
  installerExecution: 'pending user acceptance',
  codeSigning: 'unsigned',
  visualAcceptance: 'pending user review; hidden-window captures may contain an earlier compositor frame',
  reports,
  artifacts: relativePaths.map(relativePath => {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    return { path: relativePath, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }),
};
fs.writeFileSync(path.join(root, 'artifacts', 'release-manifest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
