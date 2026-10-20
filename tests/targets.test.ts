import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DeskStore } from '../src/main/store';
import { createResearchRun } from '../src/research/engine';
import { dateInZone, explicitLevel, validateEntry } from '../src/shared/target';
import type { SaveProjectInput, SaveRequirementInput } from '../src/shared/types';

const project: SaveProjectInput = { institution: 'Example', name: 'Learning Design', degree: 'MPhil', degreeName: 'MPhil', degreeLevel: 'master', entryYear: 2027, entryMonth: 1, officialUrl: 'https://example.edu/apply', cycle: '2027 年入学', color: '#445566' };
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-target-'));
  const store = new DeskStore(path.join(directory, 'workspace'));
  store.setup({ cycle: '2027 年入学', entryYear: 2027, timezone: 'Europe/London', demo: false });
  return { directory, store, close: () => { try { store.close(); } catch {} fs.rmSync(directory, { recursive: true, force: true }); } };
}
function requirement(projectId: string): SaveRequirementInput {
  return { projectId, title: 'Statement', kind: 'document', summary: 'Synthetic source.', necessity: 'unknown', support: 'unknown', applicability: 'unknown', condition: '', limits: [], deadline: '', deadlineTimezone: '', evidence: [], dependencies: [] };
}
test('levels, names and intakes have separate identity; duplicating a target copies no progress', () => {
  const f = fixture();
  try {
    f.store.saveProject(project); f.store.saveProject(project);
    const first = f.store.snapshot().projects[0];
    f.store.saveRequirement(requirement(first.id));
    f.store.saveProject({ ...project, entryMonth: 9 });
    f.store.saveProject({ ...project, degreeLevel: 'doctorate' });
    assert.equal(f.store.snapshot().projects.length, 3);
    assert.equal(f.store.snapshot().requirements.length, 1);
    assert.throws(() => f.store.saveProject({ ...first, id: first.id, expectedRevision: first.revision, entryYear: 2028 }), /复制为新目标/);
    assert.equal(f.store.snapshot().projects[0].entryYear, 2027);
    assert.equal(explicitLevel('MPhil'), 'unknown');
    assert.equal(explicitLevel('MA'), 'unknown');
    assert.equal(explicitLevel('硕士'), 'master');
    assert.throws(() => validateEntry({ entryYear: null, entryMonth: 9 }), /月份/);
    assert.throws(() => validateEntry({ entryYear: 2027, entryMonth: 13 }), /月份/);
  } finally { f.close(); }
});
test('schema 1 migrates with a restorable backup, retaining ambiguous legacy values and old research scope', () => {
  const f = fixture(); let upgraded: DeskStore | undefined, restored: DeskStore | undefined;
  try {
    f.store.saveProject({ ...project, cycle: '2026–2027', entryYear: undefined, entryMonth: undefined, degreeLevel: undefined });
    const old = f.store.snapshot().projects[0];
    f.store.saveRequirement(requirement(old.id));
    const req = f.store.snapshot().requirements[0];
    f.store.saveProgress({ requirementId: req.id, expectedRevision: 0, status: 'doing', note: 'Keep my work', revisitOn: '', selectedVersionId: null });
    const run = createResearchRun(old); f.store.saveResearch(run);
    const dbPath = f.store.databasePath; f.store.close();
    const db = new DatabaseSync(dbPath);
    for (const row of db.prepare("SELECT kind,id,data FROM entities WHERE kind IN ('project','workspace')").all() as Array<{ kind: string; id: string; data: string }>) {
      const value = JSON.parse(row.data);
      for (const key of ['degreeLevel', 'degreeName', 'entryYear', 'entryMonth', 'scopeConfirmed']) delete value[key];
      db.prepare('UPDATE entities SET data=? WHERE kind=? AND id=?').run(JSON.stringify(value), row.kind, row.id);
    }
    db.exec('PRAGMA user_version=1'); db.close();
    upgraded = new DeskStore(path.dirname(dbPath));
    const migrated = upgraded.snapshot().projects[0];
    assert.equal(migrated.legacyCycle, '2026–2027');
    assert.equal(migrated.degreeName, 'MPhil');
    assert.equal(migrated.degreeLevel, 'unknown');
    assert.equal(migrated.entryYear, null);
    const archive = fs.readdirSync(path.join(upgraded.root, 'migration-backups'))[0];
    assert.ok(archive.endsWith('.zip'));
    const restoredRoot = DeskStore.restoreFrom(path.join(upgraded.root, 'migration-backups', archive), path.join(f.directory, 'restored'));
    restored = new DeskStore(restoredRoot);
    assert.equal(restored.snapshot().projects[0].legacyCycle, '2026–2027');
    upgraded.saveProject({ ...migrated, expectedRevision: migrated.revision, degreeLevel: 'master', entryYear: 2027, entryMonth: null });
    const after = upgraded.snapshot();
    assert.equal(after.requirements[0].revision, req.revision + 1);
    assert.ok(after.requirements[0].unresolvedFields?.includes('scope'));
    assert.equal(after.progress[0].note, 'Keep my work');
    assert.equal(after.progress[0].status, 'doing');
    assert.throws(() => upgraded!.assertResearchContext(run.id), /重新研究/);
  } finally { upgraded?.close(); restored?.close(); f.close(); }
});
test('filling an unspecified degree name or month preserves the project and requests scope review', () => {
  const f = fixture();
  try {
    f.store.saveProject({ ...project, degreeName: '', entryMonth: null });
    const original = f.store.snapshot().projects[0];
    f.store.saveRequirement(requirement(original.id));
    f.store.saveProject({ ...original, expectedRevision: original.revision, degreeName: 'MPhil', entryMonth: 9 });
    assert.equal(f.store.snapshot().projects.length, 1);
    const updated = f.store.snapshot().projects[0];
    assert.equal(updated.entryMonth, 9);
    assert.ok(f.store.snapshot().requirements[0].unresolvedFields?.includes('scope'));
    assert.throws(() => f.store.saveProject({ ...updated, expectedRevision: updated.revision, entryMonth: 1 }), /复制为新目标/);
    const workspace = f.store.snapshot().workspace!;
    f.store.saveWorkspace({ cycle: '2030 年入学', entryYear: 2030, timezone: workspace.timezone, expectedRevision: workspace.revision });
    assert.equal(f.store.snapshot().projects[0].entryYear, 2027);
  } finally { f.close(); }
});
test('actions locate the exact recommendation and submission record, with stable local calendar dates', () => {
  const f = fixture();
  try {
    f.store.saveProject(project);
    const p = f.store.snapshot().projects[0];
    assert.equal(f.store.snapshot().actions[0].destination?.section, 'research');
    f.store.saveContact({ name: 'Referee', email: 'person@example.test', note: '' });
    const contact = f.store.snapshot().contacts[0];
    f.store.saveRecommendation({ projectId: p.id, contactId: contact.id, stage: 'planned', revisitOn: '', note: '' });
    const r = f.store.snapshot().recommendations[0];
    assert.deepEqual(f.store.snapshot().actions.find(a => a.id === `recommendation:${r.id}`)?.destination, { section: 'recommendation', recordId: r.id });
    f.store.saveSubmission({ projectId: p.id, expectedRevision: 0, preparedAt: '', submittedAt: '2026-10-20', confirmedAt: '', receivedAt: '', receipt: '', note: '' });
    assert.equal(f.store.snapshot().actions.find(a => a.id === `submission:${p.id}`)?.destination?.section, 'submission');
    const today = dateInZone('Europe/London');
    assert.equal((Date.parse(dateInZone('Europe/London', 7)) - Date.parse(today)) / 86400000, 7);
  } finally { f.close(); }
});
