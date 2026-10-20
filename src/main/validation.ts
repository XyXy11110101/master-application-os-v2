import { z } from 'zod';

const text = z.string().max(100000);
const id = z.string().min(1).max(500);
const revision = z.number().int().nonnegative();
const entry = { entryYear: z.number().int().min(1900).max(9999).nullable().optional(), entryMonth: z.number().int().min(1).max(12).nullable().optional() };
const evidence = z.object({
  id, url: text, title: text, quote: text, fetchedAt: text, scope: text, locator: text, sourceHash: text,
});
const limit = z.object({
  unit: z.enum(['words', 'characters', 'pages', 'files', 'seconds']),
  value: z.number().finite().nonnegative(), nature: z.enum(['maximum', 'minimum', 'recommended']),
  evidenceId: id.optional(),
});
export const schemas = {
  setUnsaved: z.object({ dirty: z.boolean() }).strict(),
  setup: z.object({ ...entry, cycle: z.string().min(1).max(100), timezone: id, demo: z.boolean() }).strict(),
  switchWorkspace: z.object({ demo: z.boolean() }).strict(),
  saveWorkspace: z.object({ ...entry, cycle: z.string().min(1).max(100), timezone: id, expectedRevision: revision }).strict(),
  saveProject: z.object({
    ...entry, degreeLevel: z.enum(['undergraduate', 'master', 'doctorate', 'unknown']).optional(), degreeName: z.string().max(100).optional(),
    id: id.optional(), expectedRevision: revision.optional(), institution: z.string().min(1).max(500),
    name: z.string().min(1).max(500), degree: text, officialUrl: text, cycle: z.string().min(1).max(100), color: z.string().max(100),
  }).strict(),
  archiveProject: z.object({ id, archived: z.boolean(), expectedRevision: revision }).strict(),
  previewLegacy: z.object({ path: text.optional() }).strict().optional(),
  importLegacy: z.object({ source: text, keys: z.array(id).max(1000) }).strict(),
  saveRequirement: z.object({
    id: id.optional(), expectedRevision: revision.optional(), projectId: id, title: z.string().min(1).max(500),
    kind: z.enum(['document', 'recommendation', 'assessment', 'task']), summary: text,
    necessity: z.enum(['required', 'conditional', 'optional', 'not_required', 'unknown']),
    support: z.enum(['supported', 'unknown', 'conflict']), applicability: z.enum(['unknown', 'applies', 'not_applicable']),
    condition: text, limits: z.array(limit).max(100), deadline: text, deadlineTimezone: text,
    evidence: z.array(evidence).max(100), dependencies: z.array(id).max(100),
    unresolvedFields: z.array(z.string().max(200)).max(100).optional(),
  }).strict(),
  saveProgress: z.object({
    requirementId: id, expectedRevision: revision,
    status: z.enum(['todo', 'doing', 'ready', 'waiting', 'deferred']),
    note: text, revisitOn: text, selectedVersionId: id.nullable(),
  }).strict(),
  importMaterial: z.object({ materialId: id.optional(), title: z.string().max(500).optional() }).strict(),
  openMaterial: z.object({ versionId: id }).strict(),
  checkMaterial: z.object({ requirementId: id }).strict(),
  saveContact: z.object({ id: id.optional(), expectedRevision: revision.optional(), name: z.string().min(1).max(500), email: text, note: text }).strict(),
  saveRecommendation: z.object({
    id: id.optional(), expectedRevision: revision.optional(), projectId: id, contactId: id,
    stage: z.enum(['planned', 'contacted', 'agreed', 'invited', 'received']), revisitOn: text, note: text,
  }).strict(),
  saveSubmission: z.object({
    projectId: id, expectedRevision: revision, preparedAt: text, submittedAt: text,
    confirmedAt: text, receivedAt: text, receipt: text, note: text,
  }).strict(),
  saveApiSettings: z.object({
    baseUrl: text, model: z.string().max(500), key: z.string().max(20000).optional(), expectedRevision: revision,
  }).strict(),
  startResearch: z.object({ projectId: id }).strict(),
  cancelResearch: z.object({ runId: id }).strict(),
  resumeResearch: z.object({ runId: id }).strict(),
  adoptResearch: z.object({
    runId: id, expectedRevision: revision,
    selections: z.array(z.object({ key: id, expectedRequirementRevision: revision.optional(), replaceUserEdit: z.boolean().optional() }).strict()).max(200),
  }).strict(),
  openExternal: z.object({ url: text }).strict(),
};
