import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { DeskStore } from '../src/main/store';
import type { Requirement, ResearchRun, SaveRequirementInput } from '../src/shared/types';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'application-desk-domain-'));
  const store = new DeskStore(path.join(directory, 'workspace'));
  store.setup({ cycle: '2027–2028', timezone: 'Europe/London', demo: false });
  const cleanup = () => {
    try { store.close(); } catch { /* Already closed in restart tests. */ }
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return { directory, store, cleanup };
}
function addProject(store: DeskStore, name = 'Learning Sciences') {
  store.saveProject({ institution: 'Fictional University', name, degree: 'MSc', officialUrl: 'https://example.edu/program', cycle: '2027–2028', color: '#576D61' });
  return store.snapshot().projects.find(project => project.name === name)!;
}
function inputRequirement(projectId: string, title = 'CV', overrides: Partial<SaveRequirementInput> = {}): SaveRequirementInput {
  return {
    projectId, title, kind: 'document', summary: 'A fictional test requirement.',
    necessity: 'required', support: 'supported', applicability: 'applies',
    condition: '', limits: [{ unit: 'pages', value: 2, nature: 'maximum' }],
    deadline: '', deadlineTimezone: '', evidence: [{
      id: crypto.randomUUID(), url: 'https://example.edu/fictional-policy', title: 'Synthetic test source',
      quote: `This is a synthetic fixture. ${title} is required for the fictional program.`,
      fetchedAt: new Date().toISOString(), scope: '2027–2028 fictional MSc program',
      locator: 'Fictional requirements', sourceHash: 'synthetic-source',
    }], dependencies: [], ...overrides,
  };
}
function addRequirement(store: DeskStore, projectId: string, title = 'CV', overrides: Partial<SaveRequirementInput> = {}) {
  store.saveRequirement(inputRequirement(projectId, title, overrides));
  return store.snapshot().requirements.find(requirement => requirement.projectId === projectId && requirement.title === title)!;
}
function research(projectId: string, requirements: Array<Partial<Requirement> & Pick<Requirement, 'title'>>) {
  const run: ResearchRun = {
    id: crypto.randomUUID(), projectId, status: 'running', startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), message: 'Testing partial results.', candidates: [],
    sources: [], gaps: [], pages: 1, calls: 0, inputTokens: 0, outputTokens: 0,
    usageUnknown: false, queue: [], visited: [], elapsedMs: 0, revision: 1,
  };
  run.candidates = requirements.map((requirement, index) => ({
    key: `key-${index}`,
    requirement: {
      ...inputRequirement(projectId, requirement.title), origin: 'research',
      evidence: [{
        id: `source-${index}`, url: 'https://example.edu/requirements', title: 'Synthetic requirement',
        quote: `Fictional source: ${requirement.title} is required.`, fetchedAt: new Date().toISOString(),
        scope: '2027–2028 MSc fictional program', locator: 'Requirements', sourceHash: `hash-${index}`,
      }],
      ...requirement,
    },
  }));
  return run;
}

test('workspace is empty until setup and demo is fictional, isolated, and persistent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'application-desk-demo-'));
  const personal = new DeskStore(path.join(directory, 'personal'));
  const demo = new DeskStore(path.join(directory, 'demo'), true);
  try {
    assert.equal(personal.snapshot().workspace, null);
    assert.equal(personal.snapshot().projects.length, 0);
    assert.equal(demo.snapshot().projects.length, 5);
    assert.equal(new Set(demo.snapshot().projects.map(project => project.institution)).size, 4);
    assert.equal(demo.snapshot().workspace?.demo, true);
    assert.ok(demo.snapshot().requirements.every(requirement => requirement.evidence.every(evidence => evidence.quote.includes('虚构'))));
    assert.equal(demo.snapshot().versions.length, 1);
    assert.ok(fs.existsSync(demo.materialPath(demo.snapshot().versions[0].id)));
  } finally {
    personal.close(); demo.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('supported requirements and explicitly not-required policies require complete evidence', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    assert.throws(() => addRequirement(store, project.id, 'Unsupported claim', { evidence: [] }), /有依据需要/);
    const source = inputRequirement(project.id).evidence[0];
    assert.throws(() => addRequirement(store, project.id, 'Missing scope', { evidence: [{ ...source, scope: '' }] }), /有依据需要/);
    assert.throws(() => addRequirement(store, project.id, 'Missing date', { evidence: [{ ...source, fetchedAt: '' }] }), /有依据需要/);
    assert.throws(() => addRequirement(store, project.id, 'Unjustified exemption', { necessity: 'not_required', support: 'unknown', evidence: [] }), /明确不要求/);
    const personal = addRequirement(store, project.id, 'My personal task', { kind: 'task', support: 'unknown', necessity: 'unknown', evidence: [] });
    assert.equal(personal.support, 'unknown');
    assert.ok(store.snapshot().actions.some(action => action.requirementId === personal.id));
    assert.equal(store.snapshot().requirements.length, 1);
  } finally { cleanup(); }
});

test('project identity survives restart, duplicate create is harmless, old revisions fail', () => {
  const { store, directory, cleanup } = fixture();
  try {
    const project = addProject(store);
    addProject(store);
    assert.equal(store.snapshot().projects.length, 1);
    store.saveProject({ ...project, expectedRevision: project.revision, name: 'Learning and Design' });
    assert.throws(() => store.saveProject({ ...project, expectedRevision: project.revision, name: 'Stale change' }), /已发生变化/);
    assert.equal(store.snapshot().projects[0].name, 'Learning and Design');
    store.close();
    const reopened = new DeskStore(path.join(directory, 'workspace'));
    assert.equal(reopened.snapshot().projects[0].name, 'Learning and Design');
    assert.equal(reopened.snapshot().projects[0].revision, 2);
    reopened.close();
  } finally { cleanup(); }
});

test('unknown, optional, and explicitly not required remain different, no official time invented', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const unknown = addRequirement(store, project.id, 'Language certificate', { necessity: 'unknown', support: 'unknown', applicability: 'unknown', limits: [] });
    const no = addRequirement(store, project.id, 'GRE', { necessity: 'not_required', limits: [] });
    const optional = addRequirement(store, project.id, 'Writing sample', { necessity: 'optional', deadline: '2027-01-15', limits: [] });
    const snapshot = store.snapshot();
    assert.ok(snapshot.actions.some(action => action.requirementId === unknown.id));
    assert.ok(!snapshot.actions.some(action => action.requirementId === no.id));
    assert.ok(snapshot.actions.some(action => action.requirementId === optional.id));
    assert.equal(snapshot.requirements.find(requirement => requirement.id === optional.id)?.deadline, '2027-01-15');
    assert.equal(snapshot.requirements.find(requirement => requirement.id === optional.id)?.deadlineTimezone, '');
  } finally { cleanup(); }
});

test('dependency graph prevents cycles, and waiting never blocks independent materials', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const transcript = addRequirement(store, project.id, 'Transcript');
    const evaluation = addRequirement(store, project.id, 'Evaluation', { kind: 'assessment', dependencies: [transcript.id] });
    const cv = addRequirement(store, project.id, 'CV');
    store.saveProgress({ requirementId: transcript.id, expectedRevision: 0, status: 'waiting', note: 'Registrar is preparing it', revisitOn: '2099-01-01', selectedVersionId: null });
    assert.throws(() => store.saveRequirement({ ...transcript, expectedRevision: transcript.revision, dependencies: [evaluation.id] }), /循环/);
    const snapshot = store.snapshot();
    assert.equal(snapshot.actions.find(action => action.requirementId === evaluation.id)?.waiting, true);
    assert.equal(snapshot.actions.find(action => action.requirementId === transcript.id)?.waiting, true);
    assert.equal(snapshot.actions.find(action => action.requirementId === cv.id)?.waiting, false);
    store.saveProgress({ ...snapshot.progress.find(progress => progress.requirementId === transcript.id)!, expectedRevision: 1, revisitOn: '2000-01-01' });
    assert.equal(store.snapshot().actions.find(action => action.requirementId === transcript.id)?.waiting, false);
  } finally { cleanup(); }
});

test('import copies originals, versions are selected independently, duplicate bytes do not duplicate versions', () => {
  const { store, directory, cleanup } = fixture();
  try {
    const firstProject = addProject(store);
    const secondProject = addProject(store, 'Digital Education');
    const firstRequirement = addRequirement(store, firstProject.id);
    const secondRequirement = addRequirement(store, secondProject.id);
    const original = path.join(directory, 'draft.txt');
    fs.writeFileSync(original, 'First version.');
    const first = store.importFile(original, { title: 'My CV' });
    assert.equal(store.importFile(original, { materialId: first.materialId }).id, first.id);
    for (const requirement of [firstRequirement, secondRequirement]) {
      store.saveProgress({ requirementId: requirement.id, expectedRevision: 0, status: 'doing', note: '', revisitOn: '', selectedVersionId: first.id });
    }
    fs.writeFileSync(original, 'Second version.');
    const second = store.importFile(original, { materialId: first.materialId });
    assert.notEqual(second.id, first.id);
    assert.equal(fs.readFileSync(store.materialPath(first.id), 'utf8'), 'First version.');
    assert.equal(fs.readFileSync(original, 'utf8'), 'Second version.');
    store.saveProgress({ ...store.snapshot().progress.find(progress => progress.requirementId === firstRequirement.id)!, expectedRevision: 1, selectedVersionId: second.id });
    assert.equal(store.snapshot().progress.find(progress => progress.requirementId === secondRequirement.id)?.selectedVersionId, first.id);
    assert.equal(store.snapshot().versions.length, 2);
  } finally { cleanup(); }
});

test('stale checks cannot be saved after requirement or selected version changes', () => {
  const { store, directory, cleanup } = fixture();
  try {
    const project = addProject(store);
    const requirement = addRequirement(store, project.id);
    const original = path.join(directory, 'draft.txt');
    fs.writeFileSync(original, 'A short document.');
    const version = store.importFile(original, {});
    store.saveProgress({ requirementId: requirement.id, expectedRevision: 0, status: 'doing', note: '', revisitOn: '', selectedVersionId: version.id });
    const result = { id: 'check-one', requirementId: requirement.id, requirementRevision: requirement.revision, versionId: version.id, checkedAt: new Date().toISOString(), words: 3, characters: 17, pages: null, issues: [], notes: [], status: 'within_known_limits' as const };
    store.recordCheck(result);
    store.saveRequirement({ ...requirement, expectedRevision: 1, limits: [{ unit: 'words', value: 2, nature: 'maximum' }] });
    assert.throws(() => store.recordCheck({ ...result, id: 'check-two' }), /已发生变化/);
    assert.equal(store.snapshot().checks.length, 1);
    assert.notEqual(store.snapshot().checks[0].requirementRevision, store.snapshot().requirements[0].revision);
    fs.writeFileSync(path.join(store.root, version.relativePath), 'Changed outside the app');
    assert.throws(() => store.materialPath(version.id), /发生变化/);
    assert.throws(() => store.backupTo(path.join(directory, 'corrupt.zip')), /发生变化/);
  } finally { cleanup(); }
});

test('adopting a partial research result does not confirm applicability, progress, or submission', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const run = research(project.id, [
      { title: 'English test', necessity: 'conditional', applicability: 'applies', condition: 'If no eligible previous degree.' },
      { title: 'GRE', necessity: 'not_required', limits: [] },
      { title: 'An unresolved detail', support: 'unknown' },
    ]);
    store.saveResearch(run);
    store.adoptResearch({ runId: run.id, expectedRevision: store.getResearch(run.id)!.revision, selections: [{ key: 'key-0' }, { key: 'key-1' }] });
    const snapshot = store.snapshot();
    assert.equal(snapshot.requirements.length, 2);
    assert.equal(snapshot.requirements.find(requirement => requirement.title === 'English test')?.applicability, 'unknown');
    assert.ok(snapshot.progress.every(progress => progress.status === 'todo'));
    assert.ok(snapshot.submissions.every(submission => !submission.preparedAt && !submission.submittedAt && !submission.receivedAt));
    assert.throws(() => store.adoptResearch({ runId: run.id, expectedRevision: store.getResearch(run.id)!.revision, selections: [{ key: 'key-2' }] }), /尚未具备/);
    assert.equal(store.snapshot().requirements.length, 2);
  } finally { cleanup(); }
});

test('background research preserves adoption markers and requires deliberate overwrite of personal edits', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const run = research(project.id, [{ title: 'CV' }]);
    store.saveResearch(run);
    store.adoptResearch({ runId: run.id, expectedRevision: 1, selections: [{ key: 'key-0' }] });
    const adopted = store.snapshot().requirements[0];
    store.saveRequirement({ ...adopted, expectedRevision: 1, summary: 'My personal preparation note.' });
    run.candidates[0].requirement.summary = 'A new official requirement.';
    store.saveResearch(run);
    assert.equal(store.getResearch(run.id)?.candidates[0].adoptedRequirementId, adopted.id);
    assert.equal(store.snapshot().requirements[0].summary, 'My personal preparation note.');
    assert.throws(() => store.adoptResearch({ runId: run.id, expectedRevision: store.getResearch(run.id)!.revision, selections: [{ key: 'key-0', expectedRequirementRevision: 2 }] }), /有你的修改/);
    store.adoptResearch({ runId: run.id, expectedRevision: store.getResearch(run.id)!.revision, selections: [{ key: 'key-0', expectedRequirementRevision: 2, replaceUserEdit: true }] });
    assert.equal(store.snapshot().requirements[0].summary, 'A new official requirement.');
    assert.equal(store.snapshot().requirements.length, 1);
  } finally { cleanup(); }
});

test('a failed multi-item adoption is atomic and condition changes invalidate old applicability', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const run = research(project.id, [
      { title: 'Transcript' }, { title: 'Unknown', support: 'unknown' },
    ]);
    store.saveResearch(run);
    assert.throws(() => store.adoptResearch({ runId: run.id, expectedRevision: 1, selections: [{ key: 'key-0' }, { key: 'key-1' }] }), /尚未具备/);
    assert.equal(store.snapshot().requirements.length, 0);
    assert.equal(store.getResearch(run.id)!.revision, 1);
    run.candidates = research(project.id, [{ title: 'Language', necessity: 'conditional', condition: 'Condition A.' }]).candidates;
    store.saveResearch(run);
    store.adoptResearch({ runId: run.id, expectedRevision: 2, selections: [{ key: 'key-0' }] });
    const requirement = store.snapshot().requirements[0];
    store.saveRequirement({ ...requirement, expectedRevision: 1, applicability: 'not_applicable' });
    run.candidates[0].requirement.condition = 'Condition B.';
    store.saveResearch(run);
    store.adoptResearch({ runId: run.id, expectedRevision: store.getResearch(run.id)!.revision, selections: [{ key: 'key-0', expectedRequirementRevision: 2, replaceUserEdit: true }] });
    assert.equal(store.snapshot().requirements[0].applicability, 'unknown');
  } finally { cleanup(); }
});

test('restart pauses running research and preserves partial results without starting paid work', () => {
  const { store, directory, cleanup } = fixture();
  try {
    const project = addProject(store);
    const run = research(project.id, [{ title: 'CV' }]);
    store.saveResearch(run);
    store.close();
    const reopened = new DeskStore(path.join(directory, 'workspace'));
    try {
      assert.equal(reopened.getResearch(run.id)?.status, 'paused');
      assert.equal(reopened.getResearch(run.id)?.candidates.length, 1);
      assert.equal(reopened.getResearch(run.id)?.calls, 0);
    } finally { reopened.close(); }
  } finally { cleanup(); }
});

test('recommendations share contacts while keeping every project stage separate', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const other = addProject(store, 'Design Research');
    const requirement = addRequirement(store, project.id, 'Recommendation letters', { kind: 'recommendation' });
    store.saveContact({ name: 'Fictional tutor', email: 'tutor@example.com', note: '' });
    store.saveContact({ name: 'Fictional tutor', email: 'tutor@example.com', note: '' });
    const contactId = store.snapshot().contacts[0].id;
    store.saveRecommendation({ projectId: project.id, contactId, stage: 'received', revisitOn: '', note: '' });
    store.saveRecommendation({ projectId: other.id, contactId, stage: 'planned', revisitOn: '', note: '' });
    assert.equal(store.snapshot().contacts.length, 1);
    assert.equal(store.snapshot().recommendations.find(item => item.projectId === other.id)?.stage, 'planned');
    assert.equal(store.snapshot().progress.find(item => item.requirementId === requirement.id)?.status, 'todo');
    assert.ok(store.snapshot().submissions.every(submission => !submission.receivedAt));
  } finally { cleanup(); }
});

test('preparation, actual submission, formal confirmation and receipt remain separate facts', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const requirement = addRequirement(store, project.id);
    addRequirement(store, project.id, 'Optional sample', { necessity: 'optional' });
    const empty = store.snapshot().submissions[0];
    assert.throws(() => store.saveSubmission({ ...empty, expectedRevision: 0, preparedAt: '2027-01-01' }), /未核对或未准备/);
    store.saveSubmission({ ...empty, expectedRevision: 0, submittedAt: '2027-01-01', receipt: 'I actually submitted.' });
    assert.equal(store.snapshot().submissions[0].preparedAt, '');
    assert.equal(store.snapshot().submissions[0].confirmedAt, '');
    store.saveProgress({ requirementId: requirement.id, expectedRevision: 0, status: 'ready', note: '', revisitOn: '', selectedVersionId: null });
    store.saveSubmission({ ...store.snapshot().submissions[0], expectedRevision: 1, preparedAt: '2027-01-02', confirmedAt: '2027-01-02' });
    assert.equal(store.snapshot().submissions[0].receivedAt, '');
    const confirmed = store.snapshot().submissions[0];
    assert.throws(() => store.saveSubmission({ ...confirmed, expectedRevision: confirmed.revision, submittedAt: '2027-02-01' }), /不能覆盖/);
    store.saveRequirement({ ...requirement, expectedRevision: requirement.revision, limits: [{ unit: 'pages', value: 1, nature: 'maximum' }] });
    assert.equal(store.snapshot().submissions[0].preparedAt, '');
    assert.equal(store.snapshot().submissions[0].submittedAt, '2027-01-01');
    assert.equal(store.snapshot().submissions[0].confirmedAt, '2027-01-02');
  } finally { cleanup(); }
});

test('legacy imports identities only, tolerates malformed URLs, and never revives removed programs', () => {
  const { store, directory, cleanup } = fixture();
  try {
    const source = path.join(directory, 'legacy');
    fs.mkdirSync(path.join(source, 'canonical', 'programs'), { recursive: true });
    fs.writeFileSync(path.join(source, 'canonical', 'programs', 'one.yaml'), 'id: old-name\ninstitution: Fictional University\nprogram_name: Current program name\ndegree: MSc\nofficial_url: not a URL\napplication_cycle: 2027–2028\npool_status: core\npersonal_secret: NEVER_IMPORT_THIS\nsubmitted: true\n');
    fs.writeFileSync(path.join(source, 'canonical', 'programs', 'two.yaml'), 'id: removed\ninstitution: Fictional University\nprogram_name: Removed program\nofficial_url: UNKNOWN\napplication_cycle: 2027–2028\npool_status: removed_from_core_pool\n');
    const preview = store.previewLegacy(source);
    assert.equal(preview.entries.length, 2);
    assert.equal(preview.entries[0].officialUrl, '');
    assert.match(preview.entries[0].warning, /官网待补充/);
    store.importLegacy({ source, keys: preview.entries.map(entry => entry.key) });
    store.importLegacy({ source, keys: preview.entries.map(entry => entry.key) });
    const snapshot = store.snapshot();
    assert.equal(snapshot.projects.length, 2);
    assert.equal(snapshot.projects.find(project => project.name === 'Removed program')?.archived, true);
    assert.equal(snapshot.projects.find(project => project.name === 'Current program name')?.archived, false);
    assert.equal(snapshot.requirements.length, 0);
    assert.equal(snapshot.materials.length, 0);
    assert.equal(snapshot.progress.length, 0);
    assert.ok(snapshot.submissions.every(submission => !submission.submittedAt));
    assert.ok(!JSON.stringify(snapshot).includes('NEVER_IMPORT_THIS'));
  } finally { cleanup(); }
});

test('backup restores to an isolated verified workspace with evidence caches and without secrets', () => {
  const { store, directory, cleanup } = fixture();
  try {
    const project = addProject(store);
    const requirement = addRequirement(store, project.id);
    const original = path.join(directory, 'file.txt');
    fs.writeFileSync(original, 'Backup material.');
    const version = store.importFile(original, {});
    store.saveProgress({ requirementId: requirement.id, expectedRevision: 0, status: 'doing', note: 'Keep this progress.', revisitOn: '', selectedVersionId: version.id });
    fs.mkdirSync(path.join(store.root, 'research-cache', 'snapshots'), { recursive: true });
    fs.writeFileSync(path.join(store.root, 'research-cache', 'snapshots', 'hash.json'), '{"public":"saved evidence"}');
    fs.writeFileSync(path.join(store.root, 'credentials.json'), '{"key":"NEVER_BACK_UP_THIS"}');
    store.saveApiSettings({ baseUrl: 'https://example.com/v1', model: 'example-model', hasKey: true, expectedRevision: 0 });
    const archivePath = store.backupTo(path.join(directory, 'backup.zip'));
    const zip = new AdmZip(archivePath);
    assert.ok(!zip.getEntries().some(entry => entry.entryName.includes('credentials')));
    const restoredPath = DeskStore.restoreFrom(archivePath, path.join(directory, 'restored'));
    assert.notEqual(restoredPath, store.root);
    const restored = new DeskStore(restoredPath);
    try {
      assert.equal(restored.snapshot().projects[0].name, project.name);
      assert.equal(restored.snapshot().progress[0].note, 'Keep this progress.');
      assert.equal(fs.readFileSync(restored.materialPath(version.id), 'utf8'), 'Backup material.');
      assert.equal(fs.readFileSync(path.join(restored.root, 'research-cache', 'snapshots', 'hash.json'), 'utf8'), '{"public":"saved evidence"}');
      assert.equal(restored.snapshot().versions[0].sha256, version.sha256);
    } finally { restored.close(); }
    zip.updateFile(version.relativePath, Buffer.from('Tampered material.'));
    const tampered = path.join(directory, 'tampered.zip'); zip.writeZip(tampered);
    assert.throws(() => DeskStore.restoreFrom(tampered, path.join(directory, 'restored')), /不符|校验失败/);
    assert.equal(fs.readFileSync(store.materialPath(version.id), 'utf8'), 'Backup material.');
  } finally { cleanup(); }
});

test('malformed dates and changing cycle on an adopted project are rejected without mutation', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    assert.throws(() => addRequirement(store, project.id, 'Bad deadline', { deadline: '2027-02-30' }), /有效日期/);
    assert.equal(store.snapshot().requirements.length, 0);
    addRequirement(store, project.id);
    assert.throws(() => store.saveProject({ ...project, expectedRevision: 1, cycle: '2028–2029' }), /不能直接更改申请季/);
    assert.equal(store.snapshot().projects[0].cycle, '2027–2028');
    assert.throws(() => store.saveWorkspace({ cycle: '2027–2028', timezone: 'Not/A/Timezone', expectedRevision: 1 }), /有效的 IANA 时区/);
    assert.equal(store.snapshot().workspace?.timezone, 'Europe/London');
  } finally { cleanup(); }
});

test('research cannot be adopted after project identity or cycle changes while it runs', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const run = research(project.id, [{ title: 'CV' }]);
    store.saveResearch(run);
    store.saveProject({ ...project, expectedRevision: project.revision, cycle: '2028–2029' });
    store.saveResearch({ ...run, status: 'completed' });
    assert.throws(() => store.adoptResearch({ runId: run.id, expectedRevision: store.getResearch(run.id)!.revision, selections: [{ key: 'key-0' }] }), /当前项目重新研究/);
    assert.equal(store.snapshot().requirements.length, 0);
  } finally { cleanup(); }
});

test('unresolved field conflicts preserve supported facts but block personal preparation attestation', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const run = research(project.id, [{ title: 'Statement', limits: [], unresolvedFields: ['limits.words.maximum'] }]);
    store.saveResearch(run);
    store.adoptResearch({ runId: run.id, expectedRevision: 1, selections: [{ key: 'key-0' }] });
    const requirement = store.snapshot().requirements[0];
    assert.equal(requirement.support, 'supported');
    assert.deepEqual(requirement.unresolvedFields, ['limits.words.maximum']);
    store.saveProgress({ requirementId: requirement.id, expectedRevision: 0, status: 'ready', note: 'A draft exists.', revisitOn: '', selectedVersionId: null });
    assert.throws(() => store.saveSubmission({ ...store.snapshot().submissions[0], expectedRevision: 0, preparedAt: '2027-01-01' }), /未核对或未准备/);
    const { unresolvedFields: omitted, ...edit } = requirement;
    store.saveRequirement({ ...edit, expectedRevision: 1, summary: 'Changed only summary.' });
    assert.deepEqual(store.snapshot().requirements[0].unresolvedFields, ['limits.words.maximum']);
    store.saveRequirement({ ...store.snapshot().requirements[0], expectedRevision: 2, unresolvedFields: [], limits: [{ value: 1000, unit: 'words', nature: 'maximum' }] });
    store.saveSubmission({ ...store.snapshot().submissions[0], expectedRevision: 0, preparedAt: '2027-01-01' });
    assert.equal(store.snapshot().submissions[0].preparedAt, '2027-01-01');
    assert.equal(store.snapshot().checks.length, 0, 'manual preparation attestation is not an automated document check');
  } finally { cleanup(); }
});

test('unverified or out-of-scope deadlines do not gain confirmed deadline urgency', () => {
  const { store, cleanup } = fixture();
  try {
    const project = addProject(store);
    const known = addRequirement(store, project.id, 'Known deadline', { deadline: '2000-01-01' });
    const unknown = addRequirement(store, project.id, 'Unverified deadline', { support: 'unknown', deadline: '2000-01-01' });
    const scope = addRequirement(store, project.id, 'Scope pending', { deadline: '2000-01-01', unresolvedFields: ['scope'] });
    const cycle = addRequirement(store, project.id, 'Cycle pending', { deadline: '2000-01-01', unresolvedFields: ['application_cycle'] });
    const conflict = addRequirement(store, project.id, 'Deadline conflict', { deadline: '2000-01-01', unresolvedFields: ['deadline'] });
    const snapshot = store.snapshot();
    const priority = (requirement: Requirement) => snapshot.actions.find(action => action.requirementId === requirement.id)!.priority;
    assert.equal(priority(known), 85);
    for (const unverified of [unknown, scope, cycle, conflict]) assert.equal(priority(unverified), 50);
    assert.equal(snapshot.requirements.find(item => item.id === unknown.id)?.deadline, '2000-01-01', 'pending source value remains visible for user review');
  } finally { cleanup(); }
});
