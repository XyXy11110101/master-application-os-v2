export type Id = string;
export type DegreeLevel = 'undergraduate' | 'master' | 'doctorate' | 'unknown';
export interface EntryTarget { entryYear?: number | null; entryMonth?: number | null; }
export interface WorkspaceInput extends EntryTarget { cycle: string; timezone: string; }
export type RequirementKind = 'document' | 'recommendation' | 'assessment' | 'task';
export type Necessity = 'required' | 'conditional' | 'optional' | 'not_required' | 'unknown';
export type Support = 'supported' | 'unknown' | 'conflict';
export type Applicability = 'unknown' | 'applies' | 'not_applicable';
export type ProgressStatus = 'todo' | 'doing' | 'ready' | 'waiting' | 'deferred';
export interface Workspace extends EntryTarget {
  id: Id; name: string; cycle: string; timezone: string; demo: boolean; revision: number;
}
export interface Project extends EntryTarget {
  degreeLevel?: DegreeLevel; degreeName?: string; legacyDegree?: string; legacyCycle?: string; scopeConfirmed?: boolean;
  id: Id; institution: string; name: string; degree: string; officialUrl: string;
  cycle: string; color: string; archived: boolean; revision: number; legacyKey?: string;
}
export interface Evidence {
  id: Id; url: string; title: string; quote: string; fetchedAt: string;
  scope: string; locator: string; sourceHash: string;
}
export interface Limit {
  unit: 'words' | 'characters' | 'pages' | 'files' | 'seconds';
  value: number; nature: 'maximum' | 'minimum' | 'recommended'; evidenceId?: Id;
}
export interface Requirement {
  id: Id; projectId: Id; title: string; kind: RequirementKind; summary: string;
  necessity: Necessity; support: Support; applicability: Applicability;
  condition: string; limits: Limit[]; deadline: string; deadlineTimezone: string;
  evidence: Evidence[]; dependencies: Id[]; revision: number;
  origin: 'manual' | 'research'; researchKey?: string; userEdited: boolean;
  unresolvedFields?: string[];
}
export interface Progress {
  requirementId: Id; status: ProgressStatus; note: string; revisitOn: string;
  selectedVersionId: Id | null; revision: number;
}
export interface Material {
  id: Id; title: string; revision: number;
}
export interface MaterialVersion {
  id: Id; materialId: Id; filename: string; extension: string; sha256: string;
  size: number; importedAt: string; relativePath: string;
}
export interface CheckResult {
  id: Id; requirementId: Id; versionId: Id; requirementRevision: number;
  checkedAt: string; words: number | null; characters: number | null; pages: number | null;
  issues: string[]; notes: string[]; status: 'issues' | 'within_known_limits' | 'unreadable';
}
export interface Contact {
  id: Id; name: string; email: string; note: string; revision: number;
}
export interface Recommendation {
  id: Id; projectId: Id; contactId: Id;
  stage: 'planned' | 'contacted' | 'agreed' | 'invited' | 'received';
  revisitOn: string; note: string; revision: number;
}
export interface Submission {
  projectId: Id; preparedAt: string; submittedAt: string; confirmedAt: string;
  receivedAt: string; receipt: string; note: string; revision: number;
}
export interface Action {
  destination?: { section: 'research' | 'requirement' | 'recommendation' | 'submission' | 'project'; recordId?: Id }; buttonLabel?: string;
  id: string; projectId: Id; requirementId?: Id; title: string; reason: string;
  instruction: string; priority: number; waiting: boolean; revisitOn: string;
}
export interface ResearchCandidate {
  key: string; requirement: Omit<Requirement, 'id' | 'revision' | 'userEdited'>;
  adoptedRequirementId?: Id; adoptedHash?: string;
}
export interface ResearchRun {
  scope?: string;
  id: Id; projectId: Id; status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startedAt: string; updatedAt: string; message: string; candidates: ResearchCandidate[];
  sources: Evidence[]; gaps: string[]; pages: number; calls: number;
  inputTokens: number; outputTokens: number; usageUnknown: boolean;
  queue: string[]; visited: string[]; elapsedMs: number; revision: number;
}
export interface ApiSettings {
  baseUrl: string; model: string; hasKey: boolean; revision: number;
}
export interface Snapshot {
  workspace: Workspace | null; projects: Project[]; requirements: Requirement[];
  progress: Progress[]; materials: Material[]; versions: MaterialVersion[];
  checks: CheckResult[]; contacts: Contact[]; recommendations: Recommendation[];
  submissions: Submission[]; research: ResearchRun[]; actions: Action[];
  apiSettings: ApiSettings; dataPath: string;
}
export interface LegacyEntry {
  key: string; institution: string; name: string; degree: string;
  officialUrl: string; cycle: string; archived: boolean; warning: string;
}
export interface LegacyPreview { source: string; entries: LegacyEntry[]; warnings: string[]; }
export interface SaveProjectInput extends EntryTarget {
  degreeLevel?: DegreeLevel; degreeName?: string;
  id?: Id; expectedRevision?: number; institution: string; name: string;
  degree: string; officialUrl: string; cycle: string; color: string;
}
export interface SaveRequirementInput {
  id?: Id; expectedRevision?: number; projectId: Id; title: string;
  kind: RequirementKind; summary: string; necessity: Necessity; support: Support;
  applicability: Applicability; condition: string; limits: Limit[]; deadline: string;
  deadlineTimezone: string; evidence: Evidence[]; dependencies: Id[];
  unresolvedFields?: string[];
}
export interface ProgressInput {
  requirementId: Id; expectedRevision: number; status: ProgressStatus;
  note: string; revisitOn: string; selectedVersionId: Id | null;
}
export interface SaveContactInput { id?: Id; expectedRevision?: number; name: string; email: string; note: string; }
export interface SaveRecommendationInput {
  id?: Id; expectedRevision?: number; projectId: Id; contactId: Id;
  stage: Recommendation['stage']; revisitOn: string; note: string;
}
export interface SaveSubmissionInput extends Omit<Submission, 'revision'> { expectedRevision: number; }
export interface AdoptInput {
  runId: Id; expectedRevision: number;
  selections: Array<{ key: string; expectedRequirementRevision?: number; replaceUserEdit?: boolean }>;
}
export interface ApiSettingsInput { baseUrl: string; model: string; key?: string; expectedRevision: number; }
export interface ParsedDocument {
  text: string; pages: number | null; notes: string[];
}
export interface DesktopApi {
  getSnapshot(): Promise<Snapshot>;
  setup(input: WorkspaceInput & { demo: boolean }): Promise<void>;
  switchWorkspace(input: { demo: boolean }): Promise<void>;
  saveWorkspace(input: WorkspaceInput & { expectedRevision: number }): Promise<void>;
  setUnsaved(input: { dirty: boolean }): Promise<void>;
  saveProject(input: SaveProjectInput): Promise<void>;
  archiveProject(input: { id: Id; archived: boolean; expectedRevision: number }): Promise<void>;
  previewLegacy(input?: { path?: string }): Promise<LegacyPreview>;
  importLegacy(input: { source: string; keys: string[] }): Promise<void>;
  saveRequirement(input: SaveRequirementInput): Promise<void>;
  saveProgress(input: ProgressInput): Promise<void>;
  importMaterial(input: { materialId?: Id; title?: string }): Promise<MaterialVersion | null>;
  openMaterial(input: { versionId: Id }): Promise<void>;
  checkMaterial(input: { requirementId: Id }): Promise<CheckResult>;
  saveContact(input: SaveContactInput): Promise<void>;
  saveRecommendation(input: SaveRecommendationInput): Promise<void>;
  saveSubmission(input: SaveSubmissionInput): Promise<void>;
  saveApiSettings(input: ApiSettingsInput): Promise<void>;
  testApi(): Promise<{ message: string }>;
  startResearch(input: { projectId: Id }): Promise<void>;
  cancelResearch(input: { runId: Id }): Promise<void>;
  resumeResearch(input: { runId: Id }): Promise<void>;
  adoptResearch(input: AdoptInput): Promise<void>;
  createBackup(): Promise<{ path: string } | null>;
  restoreBackup(): Promise<{ path: string } | null>;
  openExternal(input: { url: string }): Promise<void>;
  onChanged(callback: () => void): () => void;
}
declare global { interface Window { desk: DesktopApi; } }
