import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  Action, AdoptInput, ApiSettings, Applicability, CheckResult, Contact, Evidence, ThinkingMode,
  LegacyPreview, Material, MaterialVersion, Necessity, Progress, ProgressInput,
  Project, Recommendation, Requirement, ResearchRun, SaveContactInput,
  SaveProjectInput, SaveRecommendationInput, SaveRequirementInput,
  SaveSubmissionInput, Snapshot, Submission, Support, Workspace, WorkspaceInput,
} from '../shared/types';
import { previewLegacy } from './legacy';
import { restoreBackup, sha256, writeBackup } from './backup';
import { explicitLevel, projectScope, targetKey, validateEntry } from '../shared/target';

const id = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const clean = (value: unknown, name: string, max = 10000): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name}格式无效。`);
  return value.trim();
};
const requiredText = (value: unknown, name: string, max = 500): string => {
  const text = clean(value, name, max);
  if (!text) throw new Error(`请填写${name}。`);
  return text;
};
const oneOf = <T extends string>(value: unknown, choices: readonly T[], name: string): T => {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`${name}无效。`);
  return value as T;
};
function revision(actual: number, expected: unknown) {
  if (!Number.isInteger(expected) || actual !== expected) {
    throw new Error('这条记录已发生变化。请保留输入并重新载入最新记录后再保存。');
  }
}
function validDate(value: string, name: string): string {
  const result = clean(value, name, 80);
  if (!result) return '';
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(result) ||
      Number.isNaN(Date.parse(result))) throw new Error(`${name}需要有效日期。`);
  const day = result.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error(`${name}需要有效日期。`);
  return result;
}
function timezone(value: string, allowEmpty = false): string {
  const result = clean(value, '时区', 100);
  if (allowEmpty && !result) return '';
  try { new Intl.DateTimeFormat('en', { timeZone: result }).format(); }
  catch { throw new Error('请选择有效的 IANA 时区，例如 Europe/London。'); }
  return result;
}
function url(value: string, allowEmpty = true): string {
  const text = clean(value, '网址', 3000);
  if (!text && allowEmpty) return '';
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.toString();
  } catch { throw new Error('网址需要使用 http 或 https，且不能包含账号密码。'); }
}
function todayIn(zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const get = (name: string) => parts.find(part => part.type === name)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const defaultProgress = (requirementId: string): Progress => ({
  requirementId, status: 'todo', note: '', revisitOn: '', selectedVersionId: null, revision: 0,
});
const defaultSubmission = (projectId: string): Submission => ({
  projectId, preparedAt: '', submittedAt: '', confirmedAt: '', receivedAt: '', receipt: '', note: '', revision: 0,
});
const defaultApi = (): ApiSettings => ({ baseUrl: '', model: '', hasKey: false, revision: 0, thinkingMode: 'provider_default' });

export class DeskStore {
  readonly root: string;
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(root: string, demo = false) {
    this.root = path.resolve(root);
    this.databasePath = path.join(this.root, 'workspace.sqlite');
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(path.join(this.root, 'materials'), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const versionRow = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (versionRow.user_version > 2) { this.db.close(); throw new Error('工作区由更新版本创建，请升级应用后再打开。'); }
    if (versionRow.user_version === 0) {
      // A pre-existing nonempty schema is not silently transformed.
      const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (rows.length) { this.db.close(); throw new Error('数据库格式无法识别，未修改原数据库。'); }
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE entities (
          kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
          data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(kind,id)
        );
        CREATE TABLE history (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
          entity_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, recorded_at TEXT NOT NULL
        );
        CREATE INDEX history_entity ON history(kind,entity_id,sequence);
        PRAGMA user_version=2;
        COMMIT;
      `);
    }
    if (versionRow.user_version === 1) {
      try {
        const backupDir = path.join(this.root, 'migration-backups');
        fs.mkdirSync(backupDir, { recursive: true });
        this.backupTo(path.join(backupDir, `before-schema-2-${Date.now()}.zip`));
        this.atomic(() => {
          const workspace = this.get<Workspace>('workspace', 'current');
          if (workspace) this.put('workspace', 'current', { ...workspace, entryYear: null, entryMonth: null, revision: workspace.revision + 1 });
          for (const project of this.all<Project>('project')) {
            this.put('project', project.id, { ...project, legacyDegree: project.degree, legacyCycle: project.cycle,
              degreeLevel: explicitLevel(project.degree), degreeName: explicitLevel(project.degree) === 'unknown' ? project.degree : '',
              entryYear: null, entryMonth: null, scopeConfirmed: false, revision: project.revision + 1 });
          }
          this.db.exec('PRAGMA user_version=2');
        });
      } catch (error) { this.db.close(); throw error; }
    }
    this.atomic(() => {
      for (const run of this.all<ResearchRun>('research')) {
        if (run.status !== 'running') continue;
        this.put('research', run.id, {
          ...run, status: 'paused', message: '上次查询已中断，阶段结果已保留。点击继续才会再次调用服务。',
          updatedAt: timestamp(), revision: run.revision + 1,
        });
      }
    });
    if (demo && !this.get<Workspace>('workspace', 'current')) {
      this.setup({ cycle: '2027 年入学', entryYear: 2027, entryMonth: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', demo: true });
    }
  }

  close() { this.db.close(); }
  private atomic<T>(callback: () => T): T {
    if (this.transactionDepth) return callback();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally { this.transactionDepth--; }
  }
  private get<T>(kind: string, entityId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get(kind, entityId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  private all<T>(kind: string): T[] {
    return (this.db.prepare('SELECT data FROM entities WHERE kind=? ORDER BY created_at,id').all(kind) as { data: string }[])
      .map(row => JSON.parse(row.data) as T);
  }
  private put(kind: string, entityId: string, value: unknown) {
    const current = this.db.prepare('SELECT revision,data FROM entities WHERE kind=? AND id=?').get(kind, entityId) as { revision: number; data: string } | undefined;
    if (current) {
      this.db.prepare('INSERT INTO history(kind,entity_id,revision,data,recorded_at) VALUES(?,?,?,?,?)')
        .run(kind, entityId, current.revision, current.data, timestamp());
    }
    const next = value as { revision?: number };
    this.db.prepare(`INSERT INTO entities(kind,id,revision,data,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at`)
      .run(kind, entityId, next.revision ?? 1, JSON.stringify(value), timestamp(), timestamp());
  }
  private requireProject(projectId: string): Project {
    const project = this.get<Project>('project', projectId);
    if (!project) throw new Error('项目不存在，请重新载入。');
    return project;
  }
  private requireRequirement(requirementId: string): Requirement {
    const requirement = this.get<Requirement>('requirement', requirementId);
    if (!requirement) throw new Error('准备事项不存在，请重新载入。');
    return requirement;
  }
  private requireWorkspace(): Workspace {
    const workspace = this.get<Workspace>('workspace', 'current');
    if (!workspace) throw new Error('请先建立工作区。');
    return workspace;
  }
  private invalidatePrepared(projectId: string) {
    const submission = this.get<Submission>('submission', projectId);
    if (submission?.preparedAt) this.put('submission', projectId, { ...submission, preparedAt: '', revision: submission.revision + 1 });
  }
  snapshot(): Snapshot {
    const workspace = this.get<Workspace>('workspace', 'current') ?? null;
    const projects = this.all<Project>('project');
    const requirements = this.all<Requirement>('requirement');
    const progress = requirements.map(requirement => this.get<Progress>('progress', requirement.id) ?? defaultProgress(requirement.id));
    const submissions = projects.map(project => this.get<Submission>('submission', project.id) ?? defaultSubmission(project.id));
    const snapshot: Snapshot = {
      workspace, projects, requirements, progress, submissions,
      materials: this.all('material'), versions: this.all('version'), checks: this.all('check'),
      contacts: this.all('contact'), recommendations: this.all('recommendation'),
      research: this.all<ResearchRun>('research').reverse(),
      apiSettings: { ...defaultApi(), ...this.get<ApiSettings>('settings', 'api') },
      actions: [], dataPath: this.root,
    };
    snapshot.actions = this.actions(snapshot);
    return snapshot;
  }
  setup(input: WorkspaceInput & { demo: boolean }): void {
    this.atomic(() => {
      if (this.get<Workspace>('workspace', 'current')) return;
      const workspace: Workspace = {
        id: id(), name: input.demo ? '体验工作区' : '我的申请工作区',
        cycle: requiredText(input.cycle, '申请季', 80), timezone: timezone(input.timezone),
        ...validateEntry(input), demo: Boolean(input.demo), revision: 1,
      };
      this.put('workspace', 'current', workspace);
      if (input.demo) this.seedDemo(workspace);
    });
  }
  saveWorkspace(input: WorkspaceInput & { expectedRevision: number }): void {
    this.atomic(() => {
      const current = this.requireWorkspace();
      revision(current.revision, input.expectedRevision);
      this.put('workspace', 'current', { ...current, ...validateEntry({ ...current, ...input }), cycle: requiredText(input.cycle, '入学时间', 80), timezone: timezone(input.timezone), revision: current.revision + 1 });
    });
  }
  saveProject(input: SaveProjectInput): void {
    this.atomic(() => {
      this.requireWorkspace();
      const existing = input.id ? this.requireProject(input.id) : undefined;
      if (existing) revision(existing.revision, input.expectedRevision);
      const institution = requiredText(input.institution, '学校名称');
      const name = requiredText(input.name, '项目名称');
      const cycle = requiredText(input.cycle, '申请季', 80);
      const degree = clean(input.degree, '学位', 100);
      const target = { ...validateEntry({ ...existing, ...input }), degreeLevel: oneOf(input.degreeLevel ?? existing?.degreeLevel ?? explicitLevel(degree), ['undergraduate', 'master', 'doctorate', 'unknown'] as const, '学位层次'), degreeName: clean(input.degreeName ?? existing?.degreeName ?? (explicitLevel(degree) === 'unknown' ? degree : ''), '学位名称', 100) };
      const changedTarget = existing && targetKey(existing) !== targetKey(target);
      const officialUrl = url(input.officialUrl);
      if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('学校颜色格式无效。');
      const duplicate = this.all<Project>('project').find(project =>
        project.id !== existing?.id && project.institution.toLocaleLowerCase() === institution.toLocaleLowerCase() &&
        project.name.toLocaleLowerCase() === name.toLocaleLowerCase() && targetKey(project) === targetKey(target) &&
        (target.entryYear !== null || project.cycle === cycle),
      );
      if (duplicate) {
        if (!existing && duplicate.officialUrl === officialUrl) return;
        throw new Error('这个申请季已存在同一项目，请直接编辑现有项目。');
      }
      const changedIntakeOrLevel = existing && (existing.degreeLevel !== target.degreeLevel || existing.entryYear !== target.entryYear || (existing.entryMonth != null && existing.entryMonth !== target.entryMonth));
      if (existing?.scopeConfirmed && changedIntakeOrLevel) throw new Error('此项目已有明确目标。请使用“复制为新目标”，分别管理不同层次或入学批次。');
      if (existing && (existing.cycle !== cycle || existing.institution !== institution || existing.name !== name || existing.degree !== degree) &&
          this.all<Requirement>('requirement').some(requirement => requirement.projectId === existing.id)) {
        throw new Error('已有要求的项目不能直接更改申请季、学校、项目名称或学位。请另建项目，避免把旧要求用于不同项目。');
      }
      const project: Project = {
        ...existing, ...target, scopeConfirmed: target.degreeLevel !== 'unknown' && !!target.entryYear,
        id: existing?.id ?? id(), institution, name, cycle, degree, officialUrl,
        color: input.color, archived: existing?.archived ?? false,
        revision: (existing?.revision ?? 0) + 1, ...(existing?.legacyKey ? { legacyKey: existing.legacyKey } : {}),
      };
      this.put('project', project.id, project);
      if (changedTarget) {
        for (const requirement of this.all<Requirement>('requirement').filter(r => r.projectId === project.id)) {
          this.put('requirement', requirement.id, { ...requirement, unresolvedFields: [...new Set([...(requirement.unresolvedFields || []), 'scope', 'application_cycle'])], revision: requirement.revision + 1 });
        }
        this.invalidatePrepared(project.id);
      }
    });
  }
  archiveProject(input: { id: string; archived: boolean; expectedRevision: number }): void {
    this.atomic(() => {
      const current = this.requireProject(input.id);
      revision(current.revision, input.expectedRevision);
      if (typeof input.archived !== 'boolean') throw new Error('项目状态无效。');
      this.put('project', current.id, { ...current, archived: input.archived, revision: current.revision + 1 });
    });
  }
  previewLegacy(source?: string): LegacyPreview { return previewLegacy(source); }
  importLegacy(input: { source: string; keys: string[] }): void {
    const preview = previewLegacy(input.source);
    if (!Array.isArray(input.keys) || input.keys.some(key => !preview.entries.some(entry => entry.key === key))) {
      throw new Error('导入选择已变化，请重新预览旧工作区。');
    }
    this.atomic(() => {
      const workspace = this.requireWorkspace();
      const existing = this.all<Project>('project');
      for (const entry of preview.entries.filter(item => input.keys.includes(item.key))) {
        if (existing.some(project => project.legacyKey === entry.key)) continue;
        const project: Project = {
          id: id(), institution: entry.institution, name: entry.name, degree: entry.degree,
          officialUrl: entry.officialUrl, cycle: entry.cycle || '旧名单未提供申请季', legacyCycle: entry.cycle, legacyDegree: entry.degree,
          degreeLevel: explicitLevel(entry.degree), degreeName: explicitLevel(entry.degree) === 'unknown' ? entry.degree : '', entryYear: null, entryMonth: null, scopeConfirmed: false,
          color: '#687F73', archived: entry.archived, revision: 1, legacyKey: entry.key,
        };
        this.put('project', project.id, project);
        existing.push(project);
      }
    });
  }
  private normalizedRequirement(input: SaveRequirementInput, existing?: Requirement): Requirement {
    this.requireProject(input.projectId);
    if (existing && input.projectId !== existing.projectId) throw new Error('不能把现有要求移动到另一个项目。');
    const necessity = oneOf<Necessity>(input.necessity, ['required', 'conditional', 'optional', 'not_required', 'unknown'], '必交性');
    const support = oneOf<Support>(input.support, ['supported', 'unknown', 'conflict'], '依据状态');
    const applicability = oneOf<Applicability>(input.applicability, ['unknown', 'applies', 'not_applicable'], '适用状态');
    const kind = oneOf(input.kind, ['document', 'recommendation', 'assessment', 'task'] as const, '材料类别');
    if (!Array.isArray(input.limits) || input.limits.length > 100) throw new Error('长度限制格式无效。');
    const limits = input.limits.map(limit => {
      if (!Number.isFinite(limit.value) || limit.value <= 0 || limit.value > 10000000) throw new Error('限制数量需要大于零。');
      return {
        unit: oneOf(limit.unit, ['words', 'characters', 'pages', 'files', 'seconds'] as const, '限制单位'),
        nature: oneOf(limit.nature, ['maximum', 'minimum', 'recommended'] as const, '限制性质'),
        value: limit.value, ...(limit.evidenceId ? { evidenceId: clean(limit.evidenceId, '依据编号', 200) } : {}),
      };
    });
    if (!Array.isArray(input.evidence) || input.evidence.length > 100) throw new Error('依据格式无效。');
    const evidence: Evidence[] = input.evidence.map(item => ({
      id: requiredText(item.id, '依据编号', 200), url: url(item.url, false),
      title: clean(item.title, '来源标题', 1000), quote: requiredText(item.quote, '来源原文', 100000),
      fetchedAt: validDate(item.fetchedAt, '获取时间'), scope: clean(item.scope, '适用范围', 3000),
      locator: clean(item.locator, '原文位置', 1000), sourceHash: clean(item.sourceHash, '来源指纹', 200),
    }));
    if (support === 'supported' && (!evidence.length || evidence.some(item => !item.quote || !item.scope || !item.fetchedAt))) {
      throw new Error('标记为有依据需要填写来源网址、原文、适用范围和获取时间。还没有来源时，请保留“待核实”。');
    }
    if (necessity === 'not_required' && support !== 'supported') {
      throw new Error('“明确不要求”需要官方依据；尚未查明时，请将必交性保留为未知。');
    }
    if (!Array.isArray(input.dependencies) || input.dependencies.length > 100 || input.dependencies.some(value => typeof value !== 'string')) {
      throw new Error('前置事项格式无效。');
    }
    const dependencies = [...new Set(input.dependencies)];
    const unresolved = input.unresolvedFields ?? existing?.unresolvedFields ?? [];
    if (!Array.isArray(unresolved) || unresolved.length > 100 || unresolved.some(value => typeof value !== 'string' || value.length > 300)) {
      throw new Error('待核实字段格式无效。');
    }
    for (const dependency of dependencies) {
      const target = this.requireRequirement(dependency);
      if (target.projectId !== input.projectId || dependency === existing?.id) throw new Error('前置事项必须属于本项目，且不能是事项自身。');
    }
    return {
      id: existing?.id ?? input.id ?? id(), projectId: input.projectId, title: requiredText(input.title, '材料名称'),
      kind, necessity, support, applicability,
      summary: clean(input.summary, '要求摘要', 20000), condition: clean(input.condition, '适用条件', 20000),
      limits, evidence, deadline: validDate(input.deadline, '官方截止日期'),
      deadlineTimezone: timezone(input.deadlineTimezone, true), dependencies,
      revision: (existing?.revision ?? 0) + 1,
      origin: existing?.origin ?? 'manual', userEdited: true,
      unresolvedFields: [...new Set(unresolved.map(value => value.trim()).filter(Boolean))],
      ...(existing?.researchKey ? { researchKey: existing.researchKey } : {}),
    };
  }
  private validateDependencyGraph(candidate: Requirement) {
    const all = this.all<Requirement>('requirement').filter(requirement => requirement.id !== candidate.id);
    all.push(candidate);
    const map = new Map(all.map(requirement => [requirement.id, requirement]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string) => {
      if (visiting.has(key)) throw new Error('前置事项构成循环，请修改依赖关系。');
      if (visited.has(key)) return;
      visiting.add(key);
      for (const child of map.get(key)?.dependencies ?? []) visit(child);
      visiting.delete(key); visited.add(key);
    };
    visit(candidate.id);
  }
  saveRequirement(input: SaveRequirementInput): void {
    this.atomic(() => {
      const existing = input.id ? this.requireRequirement(input.id) : undefined;
      if (existing) revision(existing.revision, input.expectedRevision);
      const next = this.normalizedRequirement(input, existing);
      if (!existing) {
        const duplicate = this.all<Requirement>('requirement').find(requirement =>
          requirement.projectId === next.projectId && requirement.title === next.title);
        if (duplicate) throw new Error('已有同名准备事项，请编辑已有事项。');
      }
      this.validateDependencyGraph(next);
      this.put('requirement', next.id, next);
      this.invalidatePrepared(next.projectId);
    });
  }
  saveProgress(input: ProgressInput): void {
    this.atomic(() => {
      const requirement = this.requireRequirement(input.requirementId);
      const current = this.get<Progress>('progress', requirement.id) ?? defaultProgress(requirement.id);
      revision(current.revision, input.expectedRevision);
      const status = oneOf(input.status, ['todo', 'doing', 'ready', 'waiting', 'deferred'] as const, '准备状态');
      const revisitOn = validDate(input.revisitOn, '回访日期');
      if (status === 'deferred' && !revisitOn) throw new Error('推迟事项需要填写再次提醒日期。');
      if (input.selectedVersionId !== null && !this.get<MaterialVersion>('version', input.selectedVersionId)) throw new Error('所选文件版本不存在。');
      if (input.selectedVersionId && requirement.kind !== 'document' && requirement.kind !== 'assessment') {
        throw new Error('该事项不能关联个人文件。');
      }
      this.put('progress', requirement.id, {
        requirementId: requirement.id, status, note: clean(input.note, '进度备注', 10000),
        revisitOn, selectedVersionId: input.selectedVersionId, revision: current.revision + 1,
      } satisfies Progress);
      if (status !== 'ready' || current.selectedVersionId !== input.selectedVersionId) this.invalidatePrepared(requirement.projectId);
    });
  }
  importFile(source: string, input: { materialId?: string; title?: string }): MaterialVersion {
    this.requireWorkspace();
    const absolute = path.resolve(source);
    if (!fs.statSync(absolute).isFile()) throw new Error('请选择文件。');
    const extension = path.extname(absolute).toLowerCase();
    if (!['.txt', '.md', '.docx', '.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('目前支持 TXT、Markdown、DOCX、PDF 和图片文件。');
    const stat = fs.statSync(absolute);
    if (stat.size > 100 * 1024 * 1024) throw new Error('单个文件最多 100 MB。');
    const bytes = fs.readFileSync(absolute);
    const fingerprint = sha256(bytes);
    const material = input.materialId ? this.get<Material>('material', input.materialId) : undefined;
    if (input.materialId && !material) throw new Error('材料不存在，请重新载入。');
    if (material) {
      const same = this.all<MaterialVersion>('version').find(version => version.materialId === material.id && version.sha256 === fingerprint);
      if (same) return same;
    } else {
      const title = input.title?.trim() || path.basename(absolute, extension);
      const sameMaterial = this.all<Material>('material').find(item => item.title === title);
      const sameVersion = sameMaterial && this.all<MaterialVersion>('version').find(version => version.materialId === sameMaterial.id && version.sha256 === fingerprint);
      if (sameVersion) return sameVersion;
    }
    const versionId = id();
    const relativePath = `materials/${versionId}${extension}`;
    const destination = path.join(this.root, relativePath);
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    try {
      return this.atomic(() => {
        const targetMaterial: Material = material ?? { id: id(), title: requiredText(input.title?.trim() || path.basename(absolute, extension), '材料名称'), revision: 1 };
        if (!material) this.put('material', targetMaterial.id, targetMaterial);
        else this.put('material', material.id, { ...material, revision: material.revision + 1 });
        const version: MaterialVersion = {
          id: versionId, materialId: targetMaterial.id, filename: path.basename(absolute),
          extension, sha256: fingerprint, size: bytes.length, importedAt: timestamp(), relativePath,
        };
        this.put('version', version.id, version);
        return version;
      });
    } catch (error) {
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      throw error;
    }
  }
  materialPath(versionId: string): string {
    const version = this.get<MaterialVersion>('version', versionId);
    if (!version) throw new Error('文件版本不存在。');
    const absolute = path.resolve(this.root, version.relativePath);
    if (!absolute.startsWith(this.root + path.sep) || !version.relativePath.replaceAll('\\', '/').startsWith('materials/')) {
      throw new Error('材料路径不安全。');
    }
    if (!fs.existsSync(absolute)) throw new Error('材料副本已丢失，请从原件重新导入。');
    if (fs.lstatSync(absolute).isSymbolicLink() || sha256(fs.readFileSync(absolute)) !== version.sha256) {
      throw new Error('材料副本发生变化，请重新导入为新版本。');
    }
    return absolute;
  }
  recordCheck(result: CheckResult): void {
    this.atomic(() => {
      const requirement = this.requireRequirement(result.requirementId);
      revision(requirement.revision, result.requirementRevision);
      const progress = this.get<Progress>('progress', requirement.id) ?? defaultProgress(requirement.id);
      if (progress.selectedVersionId !== result.versionId) throw new Error('检查期间已更换文件，请检查当前版本。');
      this.materialPath(result.versionId);
      this.put('check', requiredText(result.id, '检查编号', 200), result);
    });
  }
  saveContact(input: SaveContactInput): void {
    this.atomic(() => {
      this.requireWorkspace();
      const current = input.id ? this.get<Contact>('contact', input.id) : undefined;
      if (input.id && !current) throw new Error('联系人不存在。');
      if (current) revision(current.revision, input.expectedRevision);
      const name = requiredText(input.name, '姓名');
      const email = clean(input.email, '邮箱', 320);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式无效。');
      if (!current && this.all<Contact>('contact').some(contact => contact.name === name && contact.email.toLowerCase() === email.toLowerCase())) return;
      const contact: Contact = { id: current?.id ?? id(), name, email, note: clean(input.note, '联系人备注'), revision: (current?.revision ?? 0) + 1 };
      this.put('contact', contact.id, contact);
    });
  }
  saveRecommendation(input: SaveRecommendationInput): void {
    this.atomic(() => {
      this.requireProject(input.projectId);
      if (!this.get<Contact>('contact', input.contactId)) throw new Error('联系人不存在。');
      const current = input.id ? this.get<Recommendation>('recommendation', input.id) : undefined;
      if (input.id && !current) throw new Error('推荐信记录不存在。');
      if (current) {
        revision(current.revision, input.expectedRevision);
        if (current.projectId !== input.projectId) throw new Error('不能移动逐项目推荐信记录。');
      }
      const duplicate = this.all<Recommendation>('recommendation').find(item =>
        item.projectId === input.projectId && item.contactId === input.contactId && item.id !== current?.id);
      if (duplicate) {
        if (!current && duplicate.stage === input.stage) return;
        throw new Error('该推荐人在此项目已有记录，请编辑现有记录。');
      }
      const recommendation: Recommendation = {
        id: current?.id ?? id(), projectId: input.projectId, contactId: input.contactId,
        stage: oneOf(input.stage, ['planned', 'contacted', 'agreed', 'invited', 'received'] as const, '推荐信阶段'),
        revisitOn: validDate(input.revisitOn, '回访日期'), note: clean(input.note, '推荐信备注'),
        revision: (current?.revision ?? 0) + 1,
      };
      this.put('recommendation', recommendation.id, recommendation);
      this.invalidatePrepared(recommendation.projectId);
    });
  }
  saveSubmission(input: SaveSubmissionInput): void {
    this.atomic(() => {
      this.requireProject(input.projectId);
      const current = this.get<Submission>('submission', input.projectId) ?? defaultSubmission(input.projectId);
      revision(current.revision, input.expectedRevision);
      const preparedAt = validDate(input.preparedAt, '准备核对日期');
      const submittedAt = validDate(input.submittedAt, '实际提交日期');
      const confirmedAt = validDate(input.confirmedAt, '正式确认日期');
      const receivedAt = validDate(input.receivedAt, '学校收齐日期');
      const receipt = clean(input.receipt, '回执记录', 10000);
      if (confirmedAt && (!submittedAt || !receipt)) throw new Error('正式确认需要实际提交日期和回执记录。');
      if (current.confirmedAt && (submittedAt !== current.submittedAt || confirmedAt !== current.confirmedAt || receipt !== current.receipt)) {
        throw new Error('已正式确认的提交事实不能覆盖，请在备注中补充更正说明。');
      }
      if (preparedAt && preparedAt !== current.preparedAt) {
        const requirements = this.all<Requirement>('requirement').filter(item => item.projectId === input.projectId);
        if (!requirements.length) throw new Error('尚无项目要求，不能记录为准备已核对。');
        const pending = requirements.filter(requirement => {
          if (requirement.necessity === 'not_required' || requirement.necessity === 'optional' || requirement.applicability === 'not_applicable') return false;
          return requirement.support !== 'supported' || requirement.necessity === 'unknown' ||
            Boolean(requirement.unresolvedFields?.length) ||
            (requirement.necessity === 'conditional' && requirement.applicability === 'unknown') ||
            (this.get<Progress>('progress', requirement.id) ?? defaultProgress(requirement.id)).status !== 'ready';
        });
        if (pending.length) throw new Error(`还有未核对或未准备的事项：${pending.slice(0, 3).map(item => item.title).join('、')}。实际提交事实仍可单独记录。`);
      }
      this.put('submission', input.projectId, {
        projectId: input.projectId, preparedAt, submittedAt, confirmedAt, receivedAt, receipt,
        note: clean(input.note, '提交备注', 10000), revision: current.revision + 1,
      } satisfies Submission);
    });
  }
  saveApiSettings(input: { baseUrl: string; model: string; hasKey?: boolean; thinkingMode?: ThinkingMode; expectedRevision: number }): void {
    this.atomic(() => {
      const current = this.get<ApiSettings>('settings', 'api') ?? defaultApi();
      revision(current.revision, input.expectedRevision);
      this.put('settings', 'api', {
        baseUrl: input.baseUrl ? url(input.baseUrl) : '', model: clean(input.model, '模型', 300),
        hasKey: input.hasKey ?? current.hasKey, revision: current.revision + 1,
        thinkingMode: oneOf(input.thinkingMode ?? current.thinkingMode ?? 'provider_default', ['provider_default', 'disabled', 'enabled'] as const, '思考模式'),
      } satisfies ApiSettings);
    });
  }
  getResearch(runId: string): ResearchRun | undefined { return this.get<ResearchRun>('research', runId); }
  assertResearchContext(runId: string): void {
    const run = this.getResearch(runId);
    const context = this.get<{ scope: string }>('research-context', runId);
    if (!run || !context || context.scope !== projectScope(this.requireProject(run.projectId))) {
      throw new Error('项目范围已变化，请按当前项目重新研究，核对层次和入学时间；旧任务不能继续或采用。');
    }
  }
  saveResearch(run: ResearchRun): void {
    this.atomic(() => {
      const project = this.requireProject(run.projectId);
      const current = this.getResearch(run.id);
      if (current && current.projectId !== run.projectId) throw new Error('查询不能移到另一项目。');
      if (!current) this.put('research-context', run.id, { scope: projectScope(project), revision: 1 });
      const candidates = run.candidates.map(candidate => {
        const adopted = current?.candidates.find(item => item.key === candidate.key);
        return {
          ...candidate,
          ...(adopted?.adoptedRequirementId ? { adoptedRequirementId: adopted.adoptedRequirementId, adoptedHash: adopted.adoptedHash } : {}),
        };
      });
      // Persist the run, including its partial results, but never write requirements here.
      this.put('research', run.id, { ...run, candidates, revision: (current?.revision ?? 0) + 1, updatedAt: timestamp() });
    });
  }
  adoptResearch(input: AdoptInput): void {
    this.atomic(() => {
      const run = this.getResearch(input.runId);
      if (!run) throw new Error('研究结果不存在。');
      revision(run.revision, input.expectedRevision);
      this.assertResearchContext(run.id);
      if (!Array.isArray(input.selections) || !input.selections.length) throw new Error('请至少选择一项要求。');
      if (new Set(input.selections.map(item => item.key)).size !== input.selections.length) throw new Error('选择中含重复要求。');
      const allRequirements = this.all<Requirement>('requirement');
      for (const selection of input.selections) {
        const candidate = run.candidates.find(item => item.key === selection.key);
        if (!candidate || candidate.requirement.projectId !== run.projectId) throw new Error('研究条目已变化，请重新核对。');
        const raw = candidate.requirement;
        if (raw.support !== 'supported' || !raw.evidence.length || raw.evidence.some(item => !item.quote || !item.scope || !item.fetchedAt)) {
          throw new Error(`“${raw.title}”尚未具备完整依据，不能作为有效要求采用。`);
        }
        const current = allRequirements.find(item => item.projectId === run.projectId && item.researchKey === candidate.key);
        if (current) {
          revision(current.revision, selection.expectedRequirementRevision);
          if (current.userEdited && !selection.replaceUserEdit) throw new Error(`“${current.title}”有你的修改，请先核对差异并明确选择是否替换。`);
        }
        const fingerprint = sha256(Buffer.from(JSON.stringify(raw)));
        if (current && candidate.adoptedHash === fingerprint && candidate.adoptedRequirementId === current.id && !current.userEdited) continue;
        const next = this.normalizedRequirement({
          ...raw, id: current?.id, projectId: run.projectId, expectedRevision: current?.revision,
          // Research never decides an individual applicant's exemption.
          applicability: raw.necessity === 'conditional'
            ? (current?.condition === raw.condition && current.necessity === raw.necessity ? current.applicability : 'unknown')
            : (current?.applicability ?? raw.applicability),
        }, current);
        next.origin = 'research'; next.userEdited = false; next.researchKey = candidate.key;
        this.validateDependencyGraph(next);
        this.put('requirement', next.id, next);
        this.invalidatePrepared(next.projectId);
        candidate.adoptedRequirementId = next.id; candidate.adoptedHash = fingerprint;
        const index = allRequirements.findIndex(item => item.id === next.id);
        if (index === -1) allRequirements.push(next); else allRequirements[index] = next;
      }
      this.put('research', run.id, { ...run, revision: run.revision + 1 });
    });
  }
  backupTo(destination: string): string {
    const temporary = path.join(this.root, `.backup-${id()}.sqlite`);
    try {
      this.db.prepare('VACUUM INTO ?').run(temporary);
      const versions = this.all<MaterialVersion>('version');
      return writeBackup(destination, temporary, this.root, versions.map(version => version.relativePath),
        Object.fromEntries(versions.map(version => [version.relativePath, version.sha256])));
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  static restoreFrom(archive: string, parentRoot: string): string { return restoreBackup(archive, parentRoot); }

  private actions(snapshot: Snapshot): Action[] {
    if (!snapshot.workspace) return [];
    const today = todayIn(snapshot.workspace.timezone);
    const active = snapshot.projects.filter(project => !project.archived);
    const projectMap = new Map(active.map(project => [project.id, project]));
    const progressMap = new Map(snapshot.progress.map(item => [item.requirementId, item]));
    const requirementMap = new Map(snapshot.requirements.map(item => [item.id, item]));
    const result: Action[] = [];
    for (const project of active) {
      if (!project.entryYear || !project.degreeLevel || project.degreeLevel === 'unknown') {
        result.push({ id: `target:${project.id}`, projectId: project.id, title: `确认 ${project.name} 的入学目标`, reason: '旧申请季和学位名称不能自动转换成确定的目标范围。', instruction: '选择学位层次与入学年份；月份可以暂不确定。', priority: 85, waiting: false, revisitOn: '', destination: { section: 'project' }, buttonLabel: '确认入学目标' });
      } else if (!snapshot.requirements.some(requirement => requirement.projectId === project.id)) {
        result.push({
          id: `requirements:${project.id}`, projectId: project.id, title: `查明 ${project.name} 的申请要求`,
          reason: '项目已加入，尚未采用本轮要求。', instruction: project.officialUrl ? '从项目官网开始研究，或手动记录有依据的要求。' : '补充项目官网，再开始查明本轮要求。',
          priority: 65, waiting: false, revisitOn: '',
        });
      }
    }
    for (const requirement of snapshot.requirements) {
      const project = projectMap.get(requirement.projectId);
      if (!project || requirement.necessity === 'not_required' || requirement.applicability === 'not_applicable') continue;
      const submission = snapshot.submissions.find(item => item.projectId === project.id);
      if (submission?.receivedAt || submission?.submittedAt) continue;
      const progress = progressMap.get(requirement.id) ?? defaultProgress(requirement.id);
      const scopePending = requirement.unresolvedFields?.some(field => ['scope', 'application_cycle', 'entry_month'].includes(field));
      if (progress.status === 'ready' && !scopePending) continue;
      const blockers = requirement.dependencies.map(key => requirementMap.get(key)).filter((item): item is Requirement =>
        Boolean(item && item.necessity !== 'not_required' && item.applicability !== 'not_applicable' && progressMap.get(item.id)?.status !== 'ready'));
      const beforeReturn = Boolean(progress.revisitOn && progress.revisitOn.slice(0, 10) > today);
      const waiting = blockers.length > 0 || ((progress.status === 'waiting' || progress.status === 'deferred') && (beforeReturn || !progress.revisitOn));
      const revisit = (progress.status === 'waiting' || progress.status === 'deferred') && progress.revisitOn && !beforeReturn;
      let title = `准备${requirement.title}`;
      let reason = requirement.necessity === 'optional' ? '这是选交材料，由你决定是否准备。' : '根据当前要求推进这项准备。';
      let instruction = requirement.summary || '查看要求，开始准备；完成后更新这项进度。';
      if (requirement.support !== 'supported' || requirement.necessity === 'unknown' || scopePending) {
        title = `核对${requirement.title}的要求`;
        reason = scopePending ? '入学目标或项目适用范围仍待核对，个人准备进度已保留。' : requirement.support === 'conflict' ? '来源存在差异，需要确认适用规则。' : '已发现这项材料，但仍有要求待核实。';
        instruction = '展开来源，核对已知要求与缺口；已有依据的部分可以先准备。';
      } else if (requirement.necessity === 'conditional' && requirement.applicability === 'unknown') {
        title = `确认${requirement.title}是否适用`;
        reason = requirement.condition || '这项材料取决于你的个人情况。';
        instruction = '对照适用条件，在要求中记录你的判断；不会自动替你确认豁免。';
      } else if (revisit) {
        title = `跟进${requirement.title}`;
        reason = '已到你安排的回访日期。'; instruction = progress.note || '查看对方回复或办理进度，再更新状态和下次回访时间。';
      } else if (waiting) {
        title = `${requirement.title}：目前无需操作`;
        reason = blockers.length ? `先完成：${blockers.map(item => item.title).join('、')}` : progress.note || '正在等待回复或计划日期。';
        instruction = progress.revisitOn ? `在 ${progress.revisitOn.slice(0, 10)} 回访。` : '收到回复后继续，也可以设置回访日期。';
      }
      const reliableDeadline = requirement.support === 'supported' && requirement.deadline &&
        !requirement.unresolvedFields?.some(field => ['deadline', 'application_cycle', 'entry_month', 'scope'].includes(field));
      const remaining = reliableDeadline ? Math.ceil((Date.parse(requirement.deadline.slice(0, 10)) - Date.parse(today)) / 86400000) : null;
      const urgency = remaining === null ? 0 : remaining <= 7 ? 35 : remaining <= 30 ? 15 : 0;
      result.push({
        id: `requirement:${requirement.id}`, projectId: project.id, requirementId: requirement.id,
        title, reason, instruction, waiting, revisitOn: progress.revisitOn,
        priority: (waiting ? -100 : 50) + urgency + (revisit ? 25 : 0) + (progress.status === 'doing' ? 10 : 0) - (requirement.necessity === 'optional' ? 35 : 0),
      });
    }
    for (const record of snapshot.recommendations) {
      const project = projectMap.get(record.projectId);
      const contact = snapshot.contacts.find(item => item.id === record.contactId);
      if (!project || !contact || record.stage === 'received') continue;
      const waiting = ['contacted', 'invited'].includes(record.stage) && (!record.revisitOn || record.revisitOn.slice(0, 10) > today);
      const title = record.stage === 'planned' ? `联系 ${contact.name} 担任推荐人` :
        record.stage === 'agreed' ? `向 ${contact.name} 发送 ${project.name} 的推荐邀请` :
        waiting ? `${contact.name} 的推荐信：目前无需操作` : `跟进 ${contact.name} 的推荐信`;
      result.push({
        id: `recommendation:${record.id}`, projectId: project.id,
        requirementId: snapshot.requirements.find(item => item.projectId === project.id && item.kind === 'recommendation')?.id,
        title, reason: '每个项目分别记录邀请与收件进度。',
        instruction: record.note || (record.stage === 'planned' ? '说明申请项目和时间安排，询问对方是否愿意推荐。' : record.stage === 'agreed' ? '在该项目网申中填写联系人并发送邀请，然后记录邀请已发出。' : '查看回复或在网申中核对收件情况，按项目更新。'),
        priority: waiting ? -95 : 80, waiting, revisitOn: record.revisitOn,
      });
    }
    for (const project of active) {
      const submission = snapshot.submissions.find(s => s.projectId === project.id)!;
      const required = snapshot.requirements.filter(r => r.projectId === project.id && r.necessity !== 'not_required' && r.applicability !== 'not_applicable');
      if (submission.receivedAt || (!submission.submittedAt && !required.length)) continue;
      if (submission.submittedAt || (required.every(r => progressMap.get(r.id)?.status === 'ready') && required.length)) {
        result.push({ id: `submission:${project.id}`, projectId: project.id, title: submission.submittedAt ? '核对正式确认与学校收件' : '核对准备情况并记录提交', reason: '准备、实际提交、正式确认和收齐分别记录。', instruction: '以网申或学校通知为依据，记录实际发生的步骤。', priority: submission.submittedAt ? -90 : 55, waiting: !!submission.submittedAt, revisitOn: '', destination: { section: 'submission' }, buttonLabel: submission.submittedAt ? '查看提交与收件' : '记录提交' });
      }
    }
    for (const action of result) {
      if (action.destination) continue;
      if (action.id.startsWith('recommendation:')) { action.destination = { section: 'recommendation', recordId: action.id.slice(15) }; action.buttonLabel = '记录联系结果'; }
      else if (action.requirementId) { action.destination = { section: 'requirement', recordId: action.requirementId }; action.buttonLabel = '查看这项准备'; }
      else { action.destination = { section: projectMap.get(action.projectId)?.officialUrl ? 'research' : 'project' }; action.buttonLabel = action.destination.section === 'research' ? '查看待核实要求' : '补充项目信息'; }
    }
    return result.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  private seedDemo(workspace: Workspace) {
    const schools = [
      ['Northbridge University', '学习科学与设计', 'MSc', '#8C4B46'],
      ['Northbridge University', '数字社会研究', 'MSc', '#8C4B46'],
      ['Westhaven College', '教育与公共政策', 'MA', '#5E796E'],
      ['Aster University', '人机交互', 'MSc', '#7D7194'],
      ['Lakeside Institute', '发展与学习', 'MPhil', '#477484'],
    ];
    const projectIds: string[] = [];
    schools.forEach(([institution, name, degree, color]) => {
      const project: Project = { id: id(), institution, name, degree, degreeName: degree, degreeLevel: 'master', entryYear: workspace.entryYear ?? 2027, entryMonth: workspace.entryMonth ?? null, scopeConfirmed: true, color, officialUrl: 'https://example.edu/fictional-program', cycle: workspace.cycle, archived: false, revision: 1 };
      projectIds.push(project.id); this.put('project', project.id, project);
    });
    const make = (projectId: string, title: string, summary: string, kind: Requirement['kind'] = 'document', necessity: Necessity = 'required', limits: Requirement['limits'] = []): Requirement => {
      const evidenceId = id();
      const requirement: Requirement = {
        id: id(), projectId, title, summary, kind, necessity, support: 'supported',
        applicability: necessity === 'conditional' ? 'unknown' : 'applies',
        condition: necessity === 'conditional' ? '示例条件：先核对是否需要提交语言成绩。' : '',
        limits, deadline: '', deadlineTimezone: '', dependencies: [],
        revision: 1, origin: 'manual', userEdited: false,
        evidence: [{
          id: evidenceId, url: 'https://example.edu/fictional-policy', title: '虚构演示要求',
          quote: `这是虚构演示资料，不代表任何真实学校政策。${summary}`,
          fetchedAt: timestamp(), scope: `${workspace.cycle} · 虚构演示项目`, locator: '演示说明', sourceHash: 'fictional-demo',
        }],
      };
      this.put('requirement', requirement.id, requirement);
      return requirement;
    };
    const cv = make(projectIds[0], '个人简历', '整理教育经历、研究与实践。先完成一份可复用的简历，再针对项目调整。', 'document', 'required', [{ unit: 'pages', value: 2, nature: 'maximum' }]);
    this.put('progress', cv.id, { ...defaultProgress(cv.id), status: 'doing', note: '已整理教育经历，接下来补充研究项目。', revision: 1 });
    const statement = make(projectIds[0], '目的陈述', '围绕你的学习经历、研究兴趣和项目匹配展开，使用具体经历支持观点。', 'document', 'required', [{ unit: 'words', value: 1000, nature: 'maximum' }]);
    make(projectIds[0], '推荐信', '与两位熟悉你的推荐人联系。邀请与收件需逐项目记录。', 'recommendation', 'required', [{ unit: 'files', value: 2, nature: 'minimum' }]);
    const transcript = make(projectIds[0], '成绩单', '向学校申请正式成绩单，并核对姓名、课程与成绩。');
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    this.put('progress', transcript.id, { ...defaultProgress(transcript.id), status: 'waiting', note: '已向教务处申请，等待电子版。', revisitOn: future, revision: 1 });
    make(projectIds[0], '语言成绩', '根据授课语言和教育经历核对适用条件。', 'document', 'conditional');
    make(projectIds[1], '个人简历', '在同一材料库选择适合本项目的简历版本。', 'document', 'required', [{ unit: 'pages', value: 2, nature: 'recommended' }]);
    make(projectIds[2], '个人陈述', '说明你希望研究的教育议题，以及已有的实践经历。', 'document', 'required', [{ unit: 'words', value: 800, nature: 'maximum' }]);
    make(projectIds[3], '作品说明', '选择一项项目，简要说明问题、过程与你的贡献。', 'document', 'optional');
    const contact: Contact = { id: id(), name: '陈老师', email: 'chen@example.com', note: '虚构演示联系人', revision: 1 };
    this.put('contact', contact.id, contact);
    const recommendation: Recommendation = { id: id(), projectId: projectIds[0], contactId: contact.id, stage: 'agreed', revisitOn: '', note: '已同意推荐。准备好项目清单后发送网申邀请。', revision: 1 };
    this.put('recommendation', recommendation.id, recommendation);
    const demoText = Buffer.from('FICTIONAL DEMO — Curriculum Vitae\n\nAlex Lin\nEducation: Example University\nResearch: Designed a small learning experience and evaluated the prototype.\n\nThis fictional document is for product demonstration only.\n');
    const material: Material = { id: id(), title: '个人简历 · 初稿', revision: 1 };
    const version: MaterialVersion = {
      id: id(), materialId: material.id, filename: 'fictional-cv.txt', extension: '.txt',
      sha256: sha256(demoText), size: demoText.length, importedAt: timestamp(), relativePath: '',
    };
    version.relativePath = `materials/${version.id}.txt`;
    fs.writeFileSync(path.join(this.root, version.relativePath), demoText, { flag: 'wx' });
    this.put('material', material.id, material); this.put('version', version.id, version);
    this.put('progress', cv.id, { ...this.get<Progress>('progress', cv.id)!, selectedVersionId: version.id });
    this.put('progress', statement.id, { ...defaultProgress(statement.id), revision: 1 });
  }
}
