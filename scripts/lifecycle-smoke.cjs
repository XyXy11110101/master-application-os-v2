// Packaged Electron integration test, isolated from all personal workspaces.
// File/save dialog return values are STUBBED. This script does not validate the
// native Windows picker or install/uninstall the app. No model service is called.
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function makePdf(text) {
  assert.match(text, /^[a-zA-Z .]+$/);
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function assertContained(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'test path must stay inside its temporary root');
}

function inspectArchive(filename, fakeKey, version) {
  const archive = new AdmZip(filename);
  const entries = archive.getEntries();
  const manifest = JSON.parse(archive.readAsText('manifest.json'));
  assert.equal(manifest.format, 'application-desk-v2');
  assert.equal(manifest.version, 1);
  assert.equal(entries.length, manifest.files.length + 1);
  assert.ok(manifest.files.some(file => file.path === 'workspace.sqlite'));
  for (const entry of entries) {
    assert.ok(!/credentials|vault|\.bin$/i.test(entry.entryName), 'backup must exclude the credential vault');
    assert.ok(!entry.getData().includes(Buffer.from(fakeKey)), 'backup must exclude the fake key plaintext');
  }
  for (const file of manifest.files) {
    const bytes = archive.getEntry(file.path).getData();
    assert.equal(bytes.length, file.size);
    assert.equal(digest(bytes), file.sha256);
  }
  const material = archive.getEntry(version.relativePath.replaceAll('\\', '/'));
  assert.ok(material, 'backup must contain the managed PDF copy');
  assert.equal(digest(material.getData()), version.sha256);
  return { path: filename, sha256: digest(fs.readFileSync(filename)), entries: entries.map(entry => entry.entryName) };
}

async function main() {
  const repository = path.resolve(__dirname, '..');
  const output = path.join(repository, 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-v2-lifecycle-'));
  const executable = path.resolve(process.env.DESK_EXE || path.join(repository, 'out', 'Application Desk V2-win32-x64', 'ApplicationDesk.exe'));
  const pdfPath = path.join(data, 'synthetic-lifecycle.pdf');
  const archivePath = path.join(data, 'workspace-backup.zip');
  const text = 'Lifecycle PDF check passes.';
  const pdf = makePdf(text);
  const fakeKey = `lifecycle-fake-key-${crypto.randomUUID()}`;
  fs.writeFileSync(pdfPath, pdf);
  const evidence = {
    startedAt: new Date().toISOString(),
    executable,
    data,
    dialogMode: 'stubbed Electron showOpenDialog/showSaveDialog return values',
    windowMode: 'hidden BrowserWindow; no current desktop interaction',
    modelCalls: 0,
    limitations: [
      'This is a packaged-app IPC and lifecycle check, not a native picker usability test.',
      'The PDF is a generated one-page text fixture, not a scanned PDF or a general extraction accuracy benchmark.',
      'A fake key exercises native safeStorage only; no real model credential, endpoint, or paid request is used.',
      'The upgrade trigger is an old installed-version.json marker; this does not install a new release or validate Squirrel upgrade/uninstall.',
      'Temporary test data and reports are retained for inspection.',
    ],
    assertions: [],
    launches: [],
    errors: [],
  };
  let application;
  let page;
  async function launch(phase) {
    assert.equal(application, undefined, 'previous application must be closed before restart');
    application = await electron.launch({
      executablePath: executable,
      env: { ...process.env, DESK_DATA_HOME: data, DESK_SHOW_WINDOW: '0' },
      timeout: 60000,
    });
    page = await application.firstWindow();
    page.on('pageerror', error => evidence.errors.push({ phase, message: error.message }));
    await expect.poll(
      () => page.evaluate(() => typeof window.desk?.getSnapshot),
      { timeout: 30000, message: 'isolated packaged preload becomes available' },
    ).toBe('function');
    const runtime = await application.evaluate(({ app, safeStorage }) => ({
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      userData: app.getPath('userData'),
      pid: process.pid,
      electron: process.versions.electron,
      node: process.versions.node,
    }));
    assert.equal(runtime.isPackaged, true);
    assertContained(data, runtime.userData);
    evidence.launches.push({ phase, ...runtime });
    return runtime;
  }
  async function close() {
    if (!application) return;
    const current = application;
    application = undefined;
    page = undefined;
    await current.close();
  }
  async function snapshot() {
    const value = await page.evaluate(() => window.desk.getSnapshot());
    assert.ok(!JSON.stringify(value).includes(fakeKey), 'renderer snapshot must not expose the fake key');
    assertContained(data, value.dataPath);
    return value;
  }
  async function assertRestored(expected) {
    await expect.poll(async () => (await snapshot()).dataPath, { timeout: 30000 }).toBe(expected.path);
    const state = await snapshot();
    assert.equal(state.workspace.id, expected.workspaceId);
    assert.equal(state.projects.length, 1);
    assert.equal(state.requirements.length, 1);
    assert.deepEqual(state.versions, [expected.version]);
    assert.deepEqual(state.checks, [expected.check]);
    assert.equal(state.progress[0].selectedVersionId, expected.version.id);
    assert.equal(state.progress[0].note, 'Persistent lifecycle test note');
    assert.equal(state.progress[0].status, 'doing');
    assert.equal(state.apiSettings.hasKey, false, 'restored workspace must not inherit the source key flag');
    assert.equal(state.apiSettings.baseUrl, 'https://model.invalid/v1');
    assert.equal(state.apiSettings.model, 'lifecycle-fixture');
    assert.equal(state.research.length, 0);
    assert.equal(digest(fs.readFileSync(path.join(state.dataPath, expected.version.relativePath))), expected.version.sha256);
    assert.equal(digest(fs.readFileSync(pdfPath)), expected.version.sha256);
    return state;
  }

  try {
    evidence.executableSha256 = digest(fs.readFileSync(executable));
    const initialRuntime = await launch('initial');
    assert.equal(initialRuntime.encryptionAvailable, true, 'native safeStorage must be available on this Windows user account');
    let state = await snapshot();
    assert.equal(state.workspace, null);
    await page.evaluate(() => window.desk.setup({ cycle: '2027–2028', timezone: 'Europe/London', demo: false }));
    await page.evaluate(() => window.desk.saveProject({
      institution: 'Lifecycle Fictional University',
      name: 'Synthetic PDF Studies',
      degree: 'MSc',
      officialUrl: 'https://example.edu/synthetic-lifecycle',
      cycle: '2027–2028',
      color: '#356783',
    }));
    state = await snapshot();
    const originalPath = state.dataPath;
    const workspaceId = state.workspace.id;
    const projectId = state.projects[0].id;
    await page.evaluate(projectId => window.desk.saveRequirement({
      projectId, title: 'Synthetic PDF requirement', kind: 'document',
      summary: 'A fictional fixture for lifecycle validation, not university policy.',
      necessity: 'required', support: 'supported', applicability: 'applies', condition: '',
      limits: [
        { unit: 'pages', value: 1, nature: 'maximum', evidenceId: 'synthetic-source' },
        { unit: 'words', value: 20, nature: 'maximum', evidenceId: 'synthetic-source' },
      ],
      deadline: '', deadlineTimezone: '', dependencies: [], unresolvedFields: [],
      evidence: [{
        id: 'synthetic-source', url: 'https://example.edu/synthetic-lifecycle',
        title: 'Synthetic test source',
        quote: 'Synthetic test only: one PDF of at most 1 page and at most 20 words.',
        fetchedAt: new Date().toISOString(), scope: 'Synthetic PDF Studies 2027–2028 fictional fixture',
        locator: 'Locally constructed fixture', sourceHash: 'synthetic-fixture',
      }],
    }), projectId);
    state = await snapshot();
    const requirementId = state.requirements[0].id;
    await application.evaluate(({ dialog, utilityProcess }, paths) => {
      globalThis.__deskLifecycleSmoke = { dialogs: [], utilityStarts: [] };
      dialog.showOpenDialog = async (...args) => {
        const options = args.at(-1);
        globalThis.__deskLifecycleSmoke.dialogs.push({ method: 'showOpenDialog', title: options.title, stubbed: true });
        if (options.title === '导入材料副本') return { canceled: false, filePaths: [paths.pdf] };
        if (options.title === '恢复到独立工作区') return { canceled: false, filePaths: [paths.backup] };
        throw new Error(`Unexpected dialog title: ${options.title}`);
      };
      dialog.showSaveDialog = async (...args) => {
        const options = args.at(-1);
        globalThis.__deskLifecycleSmoke.dialogs.push({ method: 'showSaveDialog', title: options.title, stubbed: true });
        if (options.title !== '保存工作区备份') throw new Error(`Unexpected dialog title: ${options.title}`);
        return { canceled: false, filePath: paths.backup };
      };
      // Observation only: every invocation forwards to the real Electron fork.
      const originalFork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args) => {
        const record = { module: args[0], serviceName: args[2]?.serviceName, forwardedToNativeFork: true, pid: null };
        globalThis.__deskLifecycleSmoke.utilityStarts.push(record);
        const child = originalFork(...args);
        child.once('spawn', () => { record.pid = child.pid; });
        return child;
      };
    }, { pdf: pdfPath, backup: archivePath });

    const version = await page.evaluate(() => window.desk.importMaterial({ title: 'Synthetic lifecycle PDF' }));
    assert.ok(version);
    assert.equal(version.sha256, digest(pdf));
    assert.notEqual(path.resolve(originalPath, version.relativePath), path.resolve(pdfPath));
    assert.equal(digest(fs.readFileSync(pdfPath)), version.sha256);
    await page.evaluate(({ requirementId, versionId }) => window.desk.saveProgress({
      requirementId, expectedRevision: 0, status: 'doing',
      note: 'Persistent lifecycle test note', revisitOn: '', selectedVersionId: versionId,
    }), { requirementId, versionId: version.id });
    const check = await page.evaluate(requirementId => window.desk.checkMaterial({ requirementId }), requirementId);
    await expect.poll(async () => (await snapshot()).checks.length, { timeout: 30000 }).toBe(1);
    assert.equal(check.pages, 1);
    assert.equal(check.words, 4);
    assert.equal(check.characters, text.length);
    assert.equal(check.versionId, version.id);
    assert.equal(check.requirementId, requirementId);
    assert.equal(check.status, 'within_known_limits');
    assert.deepEqual(check.issues, []);
    const workerObservation = await application.evaluate(() => globalThis.__deskLifecycleSmoke.utilityStarts);
    assert.equal(workerObservation.length, 1);
    assert.equal(workerObservation[0].forwardedToNativeFork, true);
    assert.equal(workerObservation[0].serviceName, 'Application Desk background task');
    assert.ok(workerObservation[0].pid > 0, 'real utility process must have spawned');
    evidence.utilityProcesses = workerObservation;
    evidence.pdfResult = { pages: check.pages, words: check.words, characters: check.characters, status: check.status };
    evidence.assertions.push('A generated valid text PDF is imported as an immutable copy through a stubbed dialog and checked by the real packaged utilityProcess/pdfjs runtime.');

    state = await snapshot();
    await page.evaluate(({ key, expectedRevision }) => window.desk.saveApiSettings({
      baseUrl: 'https://model.invalid/v1', model: 'lifecycle-fixture', key, expectedRevision,
    }), { key: fakeKey, expectedRevision: state.apiSettings.revision });
    state = await snapshot();
    assert.equal(state.apiSettings.hasKey, true);
    const credentialRoot = path.join(data, 'credentials');
    const credentialFiles = fs.readdirSync(credentialRoot).filter(name => name.endsWith('.bin'));
    assert.equal(credentialFiles.length, 1);
    const encrypted = fs.readFileSync(path.join(credentialRoot, credentialFiles[0]));
    assert.ok(!encrypted.includes(Buffer.from(fakeKey)));
    const nativeRoundTrip = await application.evaluate(({ safeStorage }, input) => ({
      available: safeStorage.isEncryptionAvailable(),
      matches: safeStorage.decryptString(Buffer.from(input.ciphertext, 'base64')) === input.expected,
    }), { ciphertext: encrypted.toString('base64'), expected: fakeKey });
    assert.deepEqual(nativeRoundTrip, { available: true, matches: true });
    for (const name of fs.readdirSync(originalPath).filter(name => name.startsWith('workspace.sqlite'))) {
      assert.ok(!fs.readFileSync(path.join(originalPath, name)).includes(Buffer.from(fakeKey)), 'SQLite files must exclude the key');
    }
    evidence.safeStorage = { available: true, nativeDecryptMatches: true, plaintextAbsentFromSnapshotDatabaseAndCiphertext: true, credentialFiles: credentialFiles.length };
    evidence.assertions.push('A fake key round-trips through native safeStorage; renderer snapshots, SQLite files, and ciphertext do not contain plaintext.');

    const backup = await page.evaluate(() => window.desk.createBackup());
    assert.equal(backup.path, archivePath);
    evidence.backup = inspectArchive(backup.path, fakeKey, version);
    const restored = await page.evaluate(() => window.desk.restoreBackup());
    assert.ok(restored && restored.path !== originalPath);
    assertContained(path.join(data, 'workspaces'), restored.path);
    const expected = { path: restored.path, workspaceId, version, check };
    await assertRestored(expected);
    assert.ok(fs.existsSync(path.join(originalPath, 'workspace.sqlite')));
    assert.equal(digest(fs.readFileSync(path.join(originalPath, version.relativePath))), version.sha256);
    assert.equal(fs.readdirSync(credentialRoot).filter(name => name.endsWith('.bin')).length, 1);
    evidence.dialogs = await application.evaluate(() => globalThis.__deskLifecycleSmoke.dialogs);
    assert.deepEqual(evidence.dialogs.map(entry => entry.title), ['导入材料副本', '保存工作区备份', '恢复到独立工作区']);
    evidence.originalWorkspace = originalPath;
    evidence.restoredWorkspace = restored.path;
    evidence.assertions.push('Stubbed backup/restore dialogs exercise the real IPC archive service; restored data lives in a new workspace, original files remain intact, and the restored key flag is false.');

    await close();
    await launch('restart-after-restore');
    await assertRestored(expected);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'active.json'), 'utf8')).path, restored.path);
    evidence.assertions.push('A complete application restart retains the restored active workspace, progress, selected version, PDF check, and false key flag.');
    await close();

    const marker = path.join(data, 'installed-version.json');
    fs.writeFileSync(marker, JSON.stringify({ version: '0.0.0-lifecycle-fixture' }));
    const upgradeRoot = path.join(data, 'upgrade-backups');
    assert.equal(fs.existsSync(upgradeRoot), false);
    const upgradedRuntime = await launch('simulated-version-change');
    await assertRestored(expected);
    assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).version, upgradedRuntime.version);
    const upgradeDirectories = fs.readdirSync(upgradeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
    assert.equal(upgradeDirectories.length, 1);
    const upgradeDirectory = path.join(upgradeRoot, upgradeDirectories[0].name);
    const upgradeArchives = fs.readdirSync(upgradeDirectory).filter(name => name.endsWith('.zip')).sort();
    assert.deepEqual(upgradeArchives, ['personal.zip', `${path.basename(restored.path)}.zip`].sort());
    evidence.upgradeBackups = upgradeArchives.map(name => inspectArchive(path.join(upgradeDirectory, name), fakeKey, version));
    evidence.assertions.push('An old installed-version.json marker causes one automatic backup of each workspace before the new version marker is written; archives include PDF copies and exclude credentials.');
    await close();

    await launch('same-version-restart');
    await assertRestored(expected);
    assert.equal(fs.readdirSync(upgradeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).length, 1);
    evidence.assertions.push('A same-version restart does not produce a duplicate upgrade backup.');
    assert.deepEqual(evidence.errors, []);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    // The only key used is fake, but keep even its value out of the report.
    evidence.failure = String(error.stack || error).replaceAll(fakeKey, '[redacted fake key]');
    throw error;
  } finally {
    try { await close(); }
    catch (error) {
      evidence.status = 'failed';
      evidence.shutdownFailure = String(error.stack || error);
      process.exitCode = 1;
    }
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'lifecycle-smoke.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
