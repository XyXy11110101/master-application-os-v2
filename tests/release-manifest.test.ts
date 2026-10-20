import test from 'node:test';
import assert from 'node:assert/strict';

const { validateReports, REPORT_NAMES } = require('../scripts/release-manifest.cjs');
const { artifactPaths } = require('../scripts/build-release.cjs');

function fixture() {
  const build = {
    version: '0.2.1', buildStartedAt: '2026-10-20T20:00:00Z', buildCompletedAt: '2026-10-20T20:05:00Z',
    artifacts: artifactPaths('0.2.1').map((name: string, i: number) => ({ path: name, bytes: 100, sha256: String(i).repeat(64) })),
  };
  const reports: Record<string, any> = Object.fromEntries(REPORT_NAMES.map((name: string) => [name, {
    status: 'passed', assertions: ['persisted behavior'], errors: [], startedAt: '2026-10-20T20:06:00Z', completedAt: '2026-10-20T20:07:00Z',
    target: { selection: 'override', executablePath: 'C:\\isolated download\\ApplicationDesk.exe', platform: 'win32', arch: 'x64', version: '0.2.1', executableSha256: '0'.repeat(64), appAsarSha256: '1'.repeat(64) },
  }]));
  return { build, reports };
}

test('release reports require the exact final Windows package, even if other reports say passed', () => {
  const { build, reports } = fixture();
  const summary = validateReports(reports, build);
  assert.equal(summary.length, 4);
  assert.ok(!JSON.stringify(summary).includes('isolated download'));
  for (const [field, wrong] of Object.entries({ selection: 'default', platform: 'linux', arch: 'arm64', version: '0.2.0', executableSha256: 'a'.repeat(64), appAsarSha256: 'b'.repeat(64) })) {
    const changed = structuredClone(reports);
    changed['workflow-smoke'].target[field] = wrong;
    assert.throws(() => validateReports(changed, build), /workflow-smoke/);
  }
});

test('release reports reject stale, incomplete and errored verification', () => {
  const { build, reports } = fixture();
  for (const patch of [{ startedAt: '2026-10-20T20:01:00Z' }, { completedAt: '2026-10-20T20:00:00Z' }, { status: 'failed' }, { errors: ['failure'] }, { target: undefined }, { assertions: [] }]) {
    const changed = structuredClone(reports);
    Object.assign(changed['ux-smoke'], patch);
    assert.throws(() => validateReports(changed, build), /ux-smoke/);
  }
  const missing = structuredClone(reports); delete missing['desktop-smoke'];
  assert.throws(() => validateReports(missing, build), /desktop-smoke/);
});
