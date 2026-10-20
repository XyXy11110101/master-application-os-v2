const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const { readSourceState, artifactPaths, artifactDigest } = require('./build-release.cjs');

const REPORT_NAMES = ['desktop-smoke', 'workflow-smoke', 'lifecycle-smoke', 'ux-smoke'];

function checkedTime(value, label) {
  assert.equal(typeof value, 'string', `${label} is missing`);
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time), `${label} is invalid`);
  return time;
}

function validateReports(reports, build) {
  const start = checkedTime(build.buildStartedAt, 'Build start');
  const end = checkedTime(build.buildCompletedAt, 'Build completion');
  assert.ok(start <= end, 'Build completion predates its start');
  const files = artifactPaths(build.version);
  const executable = build.artifacts.find(item => item.path === files[0]);
  const archive = build.artifacts.find(item => item.path === files[1]);
  assert.ok(executable && archive, 'Build identity is missing');
  return REPORT_NAMES.map(name => {
    const report = reports[name];
    assert.ok(report, `${name}: report is missing`);
    assert.equal(report.status, 'passed', `${name}: did not pass`);
    assert.ok(Array.isArray(report.assertions) && report.assertions.length, `${name}: no assertions`);
    assert.ok(Array.isArray(report.errors) && report.errors.length === 0, `${name}: errors remain`);
    const started = checkedTime(report.startedAt, `${name} start`);
    const completed = checkedTime(report.completedAt, `${name} completion`);
    assert.ok(started >= end && completed >= started, `${name}: report predates the final build`);
    const target = report.target;
    assert.ok(target, `${name}: runtime target is missing`);
    assert.equal(target.selection, 'override', `${name}: explicitly select the extracted release ZIP with DESK_EXE`);
    assert.equal(target.platform, 'win32', `${name}: not a Windows runtime`);
    assert.equal(target.arch, 'x64', `${name}: not an x64 runtime`);
    assert.equal(target.version, build.version, `${name}: wrong application version`);
    assert.equal(target.executableSha256, executable.sha256, `${name}: wrong executable hash`);
    assert.equal(target.appAsarSha256, archive.sha256, `${name}: wrong application archive hash`);
    return { name, status: 'passed', completedAt: report.completedAt, assertions: report.assertions.length };
  });
}

function createManifest(root = path.resolve(__dirname, '..')) {
  const source = readSourceState(root);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const build = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'build-provenance.json'), 'utf8'));
  assert.equal(build.schemaVersion, 1);
  assert.equal(build.status, 'completed', 'A completed release build is required');
  assert.equal(build.sourceCommit, source.sourceCommit, 'The source commit changed after the build');
  assert.equal(build.sourceCommittedAt, source.sourceCommittedAt);
  assert.equal(build.version, version);
  assert.equal(build.platform, 'win32');
  assert.equal(build.arch, 'x64');
  assert.ok(checkedTime(build.sourceCommittedAt, 'Source commit') <= checkedTime(build.buildStartedAt, 'Build start'), 'Build predates the source commit');
  const paths = artifactPaths(version);
  const artifacts = paths.map(filename => artifactDigest(root, filename));
  assert.deepEqual(artifacts, build.artifacts, 'Final artifacts differ from the recorded build');
  const archive = path.join(root, paths[1]);
  const bundledPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(bundledPackage.version, version, 'Packaged version does not match the source');
  const main = asar.extractFile(archive, path.join('.webpack', 'main', 'index.cjs')).toString();
  assert.ok(main.includes('ApplicationDeskV2Data'), 'Data must remain separate from the installer');
  const reports = Object.fromEntries(REPORT_NAMES.map(name => [name,
    JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8')),
  ]));
  const checks = validateReports(reports, build);
  return {
    schemaVersion: 2, version, sourceCommit: build.sourceCommit, sourceCommittedAt: build.sourceCommittedAt,
    buildStartedAt: build.buildStartedAt, buildCompletedAt: build.buildCompletedAt,
    manifestCreatedAt: new Date().toISOString(), platform: 'Windows x64', codeSigning: 'unsigned',
    validation: { checks, nativeDialogs: 'pending', systemScaling: 'pending', installationLifecycle: 'pending', realModelResearch: 'pending' },
    artifacts,
  };
}

if (require.main === module) {
  const filename = path.resolve(__dirname, '..', 'artifacts', 'release-manifest.json');
  try {
    const manifest = createManifest();
    fs.writeFileSync(`${filename}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(`${filename}.tmp`, filename);
    console.log(`Verified ${manifest.version}: ${manifest.sourceCommit}; ${manifest.validation.checks.length} Windows release checks.`);
  } catch (error) {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { REPORT_NAMES, validateReports, createManifest };
