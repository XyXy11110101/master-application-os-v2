import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Plus, Trash2, UserRound, X } from 'lucide-react';
import { DegreeLevel, Contact, Evidence, Limit, Project, Recommendation, Requirement, SaveProjectInput, SaveRecommendationInput, SaveRequirementInput, SaveSubmissionInput, Snapshot } from '../shared/types';
import { Badge, Button, Disclosure, Empty, Feedback, Field, Form, Modal, necessityText, supportText, unitText, unresolvedText, useTask } from './ui';

import { degreeLabels, entryLabel } from '../shared/target';
import { EntryFields, PersonalDate } from './choices';
import { useDraft, useSessionState } from './session';
import { schoolSuggestions, canonicalSchool } from './branding';

const colors = ['#386d65', '#3d65a8', '#956b42', '#765ba4', '#a74f5e', '#4f7e97', '#7b864e'];
export function ProjectEditor({ open, onClose, project, cycle, snapshot: s, copyFrom }: { open: boolean; onClose: () => void; project?: Project; cycle: string; snapshot: Snapshot; copyFrom?: Project }) {
  const source = project || copyFrom;
  const initial = (): SaveProjectInput => ({ id: project?.id, expectedRevision: project?.revision, institution: source?.institution || '', name: source?.name || '', degree: source?.degree || '', degreeLevel: source?.degreeLevel || 'master', degreeName: source?.degreeName ?? source?.degree ?? '', officialUrl: source?.officialUrl || '', cycle: project?.cycle || cycle, entryYear: project ? project.entryYear ?? null : source?.entryYear ?? s?.workspace?.entryYear ?? new Date().getFullYear() + 1, entryMonth: source ? source.entryMonth ?? null : s?.workspace?.entryMonth ?? null, color: source?.color || colors[0] });
  const draftState = useDraft(`project:${project?.id || (copyFrom ? `copy:${copyFrom.id}` : 'new')}`, initial);
  const draft = draftState.value, setDraft = draftState.set;
  const task = useTask();
  const change = (patch: Partial<SaveProjectInput>) => setDraft(d => ({ ...d, ...patch }));
  const schools = [...new Set([...(s?.projects.map(p => p.institution) || []), ...schoolSuggestions])];
  const listId = React.useId();
  return <Modal open={open} onClose={onClose} title={project ? '编辑项目' : copyFrom ? '复制为新目标' : '添加一个目标项目'} subtitle="先记下目标，要求和材料可以随后完善。">
    <Form onSubmit={async () => { if (await task.run(async () => {
      const input = { ...draft, institution: project ? draft.institution : canonicalSchool(draft.institution, s?.projects || []), degree: project ? draft.degree : draft.degreeName || degreeLabels[draft.degreeLevel || 'unknown'], cycle: project ? draft.cycle : entryLabel(draft) };
      await window.desk.saveProject(input);
      const next = project ? (await window.desk.getSnapshot()).projects.find(p => p.id === project.id) : undefined;
      draftState.saved(next ? { ...input, expectedRevision: next.revision } : initial());
    }, '项目已保存')) onClose(); }}>
      <div className="form-grid"><Field label="学校名称"><input list={listId} autoComplete="off" value={draft.institution} onChange={e => change({ institution: e.target.value })} onBlur={() => { if (!project) change({ institution: canonicalSchool(draft.institution, s?.projects || []) }); }} placeholder="搜索学校，也可以手动新增" required/><datalist id={listId}>{schools.map(name => <option key={name} value={name}/>)}</datalist></Field><Field label="项目名称"><input value={draft.name} onChange={e => change({ name: e.target.value })} placeholder="例如：Learning Design" required/></Field></div>
      <div className="form-grid"><Field label="学位层次"><select value={draft.degreeLevel} onChange={e => change({ degreeLevel: e.target.value as DegreeLevel })}>{Object.entries(degreeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="具体学位名称（可选）"><input list={`${listId}-degrees`} value={draft.degreeName || ''} onChange={e => change({ degreeName: e.target.value })} placeholder="选择或填写官方名称"/><datalist id={`${listId}-degrees`}>{['BA', 'BSc', 'BEng', 'MA', 'MSc', 'MRes', 'MPhil', 'MEng', 'MBA', 'MEd', 'PhD', 'DPhil', 'EdD'].map(name => <option key={name} value={name}/>)}</datalist></Field></div>
      <EntryFields value={draft} onChange={change} required={!project || !!project.entryYear}/>
      {project && !project.scopeConfirmed && <p className="inline-warning">旧记录：{project.legacyDegree || project.degree} · {project.legacyCycle || project.cycle}。请确认目标范围；已有要求会保留并重新核对。</p>}
      {project?.scopeConfirmed && <p className="muted small">更换层次或入学批次请使用项目页的“复制为新目标”。</p>}
      <Field label="项目官网" hint="暂时没有也可以先保存。"><input type="url" value={draft.officialUrl} onChange={e => change({ officialUrl: e.target.value })} placeholder="https://…"/></Field>
      <div className="field"><span className="field-label">项目识别色</span><div className="swatches">{colors.map(color => <button type="button" key={color} aria-label={`选择颜色 ${color}`} aria-pressed={draft.color === color} style={{ backgroundColor: color }} onClick={() => change({ color })}>{draft.color === color && <Check size={15}/>}</button>)}</div></div>
      <footer className="modal-footer"><Feedback task={task}/>{draftState.dirty && <Button onClick={() => { draftState.discard(); task.clear(); }}>放弃修改</Button>}<Button onClick={onClose}>稍后继续</Button><Button type="submit" className="primary" busy={task.busy}>保存项目</Button></footer>
    </Form>
  </Modal>;
}

function newSource(): Evidence { return { id: crypto.randomUUID(), url: '', title: '', quote: '', fetchedAt: new Date().toISOString(), scope: '', locator: '', sourceHash: '' }; }
export function RequirementEditor({ open, onClose, project, requirement, all }: { open: boolean; onClose: () => void; project: Project; requirement?: Requirement; all: Requirement[] }) {
  const initial = (): SaveRequirementInput => ({
    id: requirement?.id, expectedRevision: requirement?.revision, projectId: project.id, title: requirement?.title || '', kind: requirement?.kind || 'document', summary: requirement?.summary || '', necessity: requirement?.necessity || 'unknown', support: requirement?.support || 'unknown', applicability: requirement?.applicability || 'unknown', condition: requirement?.condition || '', limits: requirement?.limits || [], deadline: requirement?.deadline || '', deadlineTimezone: requirement?.deadlineTimezone || '', evidence: requirement?.evidence || [], dependencies: requirement?.dependencies || [], unresolvedFields: requirement?.unresolvedFields || []
  });
  const draftState = useDraft(`requirement:${project.id}:${requirement?.id || 'new'}`, initial), task = useTask();
  const draft = draftState.value, setDraft = draftState.set;
  const change = (patch: Partial<SaveRequirementInput>) => setDraft(d => ({ ...d, ...patch }));
  const setSource = (index: number, patch: Partial<Evidence>) => change({ evidence: draft.evidence.map((e, i) => i === index ? { ...e, ...patch } : e) });
  const setLimit = (index: number, patch: Partial<Limit>) => change({ limits: draft.limits.map((l, i) => i === index ? { ...l, ...patch } : l) });
  return <Modal open={open} onClose={onClose} title={requirement ? '编辑这项要求' : '添加准备事项'} subtitle={`${project.institution} · ${project.name} · ${project.cycle}`} wide>
    <Form onSubmit={async () => { if (await task.run(async () => { await window.desk.saveRequirement(draft); if (requirement) { const next = (await window.desk.getSnapshot()).requirements.find(r => r.id === requirement.id); if (next) setDraft(d => ({ ...d, expectedRevision: next.revision })); } }, '要求已保存')) { draftState.saved(requirement ? undefined : initial()); onClose(); } }}>
      <div className="form-grid"><Field label="事项名称"><input value={draft.title} onChange={e => change({ title: e.target.value })} placeholder="例如：个人陈述" required/></Field><Field label="类型"><select value={draft.kind} onChange={e => change({ kind: e.target.value as Requirement['kind'] })}><option value="document">文件材料</option><option value="recommendation">推荐信</option><option value="assessment">学历评估</option><option value="task">一般事项</option></select></Field></div>
      <Field label="具体要做什么"><textarea rows={3} value={draft.summary} onChange={e => change({ summary: e.target.value })} placeholder="写下题目、交付方式或下一步做法…"/></Field>
      <Disclosure title="学校要求、个人适用性与条件">
      <div className="form-grid"><Field label="学校是否要求"><select value={draft.necessity} onChange={e => change({ necessity: e.target.value as Requirement['necessity'] })}>{Object.entries(necessityText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="依据是否明确"><select value={draft.support} onChange={e => change({ support: e.target.value as Requirement['support'] })}>{Object.entries(supportText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
      <div className="form-grid"><Field label="是否适用于本人"><select value={draft.applicability} onChange={e => change({ applicability: e.target.value as Requirement['applicability'] })}><option value="unknown">尚未确认</option><option value="applies">适用</option><option value="not_applicable">不适用</option></select></Field><Field label="适用条件"><input value={draft.condition} onChange={e => change({ condition: e.target.value })} placeholder="保留完整条件、例外和适用人群"/></Field></div>
      {!!requirement?.unresolvedFields?.length && <div className="editor-section"><p className="small">需要核对的差异：{unresolvedText(requirement.unresolvedFields)}</p><label className="check-label"><input type="checkbox" checked={!draft.unresolvedFields?.length} onChange={e => change({ unresolvedFields: e.target.checked ? [] : requirement.unresolvedFields })}/>我已对照来源解决这些差异，并更新了相关字段和依据。</label></div>}
      </Disclosure>
      <Disclosure title="长度与数量限制"><section className="editor-section"><div className="section-heading"><h3>长度与数量</h3><Button className="text-button" onClick={() => change({ limits: [...draft.limits, { value: null as unknown as number, unit: 'words', nature: 'maximum' }] })}><Plus size={14}/>添加限制</Button></div>
        {draft.limits.length === 0 && <p className="muted small">没有明确限制时留空，不用猜一个数字。</p>}
        {draft.limits.map((limit, i) => <div className="limit-row" key={i}><select aria-label="限制性质" value={limit.nature} onChange={e => setLimit(i, { nature: e.target.value as Limit['nature'] })}><option value="maximum">最多</option><option value="minimum">至少</option><option value="recommended">建议</option></select><input aria-label="限制数值" type="number" min="1" value={limit.value ?? ''} onChange={e => setLimit(i, { value: e.target.value ? Number(e.target.value) : null as unknown as number })} required/><select aria-label="限制单位" value={limit.unit} onChange={e => setLimit(i, { unit: e.target.value as Limit['unit'] })}>{Object.entries(unitText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button className="icon-button" aria-label="移除限制" onClick={() => change({ limits: draft.limits.filter((_, j) => i !== j) })}><X size={15}/></Button></div>)}
      </section></Disclosure>
      <Disclosure title="官方截止与真实前置关系">
        <div className="form-grid"><Field label="官方截止日期" hint="未知时留空，不自动补齐时间。"><input type="date" value={draft.deadline.slice(0, 10)} onChange={e => change({ deadline: e.target.value })}/></Field><Field label="官方时区" hint="只填写官方明确的时区。"><input value={draft.deadlineTimezone} onChange={e => change({ deadlineTimezone: e.target.value })} placeholder="未公布可留空"/></Field></div>
        <p className="small muted">只选择确实需要先完成的事项。不同材料通常可以同时准备。</p>
        <div className="checkbox-list">{all.filter(r => r.projectId === project.id && r.id !== requirement?.id).map(r => <label className="check-label" key={r.id}><input type="checkbox" checked={draft.dependencies.includes(r.id)} onChange={e => change({ dependencies: e.target.checked ? [...draft.dependencies, r.id] : draft.dependencies.filter(id => id !== r.id) })}/>{r.title}</label>)}</div>
      </Disclosure>
      <Disclosure title={`来源依据（${draft.evidence.length}）`}>
        {draft.evidence.map((source, i) => <div className="source-editor" key={source.id}><div className="row between"><strong>来源 {i + 1}</strong><Button className="text-button" onClick={() => change({ evidence: draft.evidence.filter((_, j) => i !== j) })}>移除</Button></div><Field label="官网链接"><input type="url" value={source.url} onChange={e => setSource(i, { url: e.target.value })}/></Field><Field label="原文摘录"><textarea rows={3} value={source.quote} onChange={e => setSource(i, { quote: e.target.value })}/></Field><div className="form-grid"><Field label="页面标题"><input value={source.title} onChange={e => setSource(i, { title: e.target.value })}/></Field><Field label="适用范围"><input value={source.scope} onChange={e => setSource(i, { scope: e.target.value })} placeholder={`${project.name} · ${project.cycle}`}/></Field></div><Field label="章节或页码"><input value={source.locator} onChange={e => setSource(i, { locator: e.target.value })}/></Field></div>)}
        <Button className="secondary" onClick={() => change({ evidence: [...draft.evidence, newSource()] })}><Plus size={14}/>添加来源</Button>
      </Disclosure>
      <footer className="modal-footer"><Feedback task={task}/>{draftState.dirty && <Button onClick={() => draftState.discard()}>放弃修改</Button>}<Button onClick={onClose}>稍后继续</Button><Button type="submit" className="primary" busy={task.busy}>保存要求</Button></footer>
    </Form>
  </Modal>;
}

const stageLabels: Record<Recommendation['stage'], string> = { planned: '待联系', contacted: '已联系', agreed: '已同意', invited: '邀请已发出', received: '学校已收到' };
export function Recommendations({ project, snapshot: s, focusId, onFocused }: { project: Project; snapshot: Snapshot; focusId?: string; onFocused?: () => void }) {
  const [editing, setEditing] = useState<Recommendation | null>(null), [open, setOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [newContactId, setNewContactId] = useState('');
  const records = s.recommendations.filter(r => r.projectId === project.id);
  useEffect(() => { if (focusId) { const record = records.find(r => r.id === focusId); if (record) { setEditing(record); setOpen(true); onFocused?.(); } } }, [focusId]);
  return <section className="recommendations-section">
    <div className="section-heading"><div><h3>推荐人进度</h3><p className="muted small">联系人可以复用，每个项目分别记录。</p></div><Button className="secondary" onClick={() => { setNewContactId(''); setEditing(null); setOpen(true); }}><Plus size={15}/>关联推荐人</Button></div>
    {records.length === 0 ? <div className="quiet-note"><UserRound size={19}/><p>还没有为这个项目关联推荐人。先联系并取得同意，再发送网申邀请。</p></div> : <div className="referee-list">{records.map(record => { const contact = s.contacts.find(c => c.id === record.contactId); return <button className="referee-row" key={record.id} onClick={() => { setNewContactId(''); setEditing(record); setOpen(true); }}><div className="avatar">{contact?.name.slice(0, 1)}</div><span className="grow"><strong>{contact?.name}</strong><small>{contact?.email}{record.revisitOn && ` · ${record.revisitOn}回访`}</small></span><Badge tone={record.stage === 'received' ? 'green' : ''}>{stageLabels[record.stage]}</Badge></button>; })}</div>}
    <RecommendationEditor key={editing?.id || 'new'} open={open} onClose={() => setOpen(false)} project={project} snapshot={s} record={editing || undefined} newContactId={newContactId} onNewContact={() => { setNewContactId(''); setContactOpen(true); }}/>
    <ContactEditor open={contactOpen} onClose={() => setContactOpen(false)} onSaved={setNewContactId}/>
  </section>;
}
function RecommendationEditor({ open, onClose, project, snapshot: s, record, onNewContact, newContactId }: { open: boolean; onClose: () => void; project: Project; snapshot: Snapshot; record?: Recommendation; onNewContact: () => void; newContactId: string }) {
  const initial = (): SaveRecommendationInput => ({ id: record?.id, expectedRevision: record?.revision, projectId: project.id, contactId: record?.contactId || s.contacts[0]?.id || '', stage: record?.stage || 'planned', revisitOn: record?.revisitOn || '', note: record?.note || '' });
  const draftState = useDraft(`recommendation:${project.id}:${record?.id || 'new'}`, initial);
  const draft = draftState.value, setDraft = draftState.set;
  const task = useTask();
  useEffect(() => { if (newContactId) setDraft(d => ({ ...d, contactId: newContactId })); }, [newContactId]);
  return <Modal open={open} onClose={onClose} title="记录推荐信进度" subtitle={project.institution}>
    <Form onSubmit={async () => { if (await task.run(async () => { await window.desk.saveRecommendation(draft); if (record) { const next = (await window.desk.getSnapshot()).recommendations.find(r => r.id === record.id); if (next) setDraft(d => ({ ...d, expectedRevision: next.revision })); } })) { draftState.saved(record ? undefined : { projectId: project.id, contactId: '', stage: 'planned', revisitOn: '', note: '' }); onClose(); } }}>
      <Field label="推荐人"><select value={draft.contactId} onChange={e => setDraft(d => ({ ...d, contactId: e.target.value }))} required><option value="">选择联系人…</option>{s.contacts.map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select></Field><Button className="text-button" onClick={onNewContact}><Plus size={14}/>添加联系人</Button>
      <Field label="这个项目的进度"><select value={draft.stage} onChange={e => setDraft(d => ({ ...d, stage: e.target.value as Recommendation['stage'] }))}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <PersonalDate label="回访日期" value={draft.revisitOn} onChange={value => setDraft(d => ({ ...d, revisitOn: value }))} timezone={s.workspace!.timezone}/>
      <Field label="备注"><textarea rows={2} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}/></Field>
      <p className="small muted">“学校已收到”请以该校网申或正式通知为依据记录。</p>
      <footer className="modal-footer"><Feedback task={task}/>{draftState.dirty && <Button onClick={draftState.discard}>放弃修改</Button>}<Button onClick={onClose}>稍后继续</Button><Button className="primary" type="submit" busy={task.busy}>保存进度</Button></footer>
    </Form>
  </Modal>;
}
export function ContactEditor({ open, onClose, contact, onSaved }: { open: boolean; onClose: () => void; contact?: Contact; onSaved?: (contactId: string) => void }) {
  const initial = () => ({ id: contact?.id, expectedRevision: contact?.revision, name: contact?.name || '', email: contact?.email || '', note: contact?.note || '' });
  const draftState = useDraft(`contact:${contact?.id || 'new'}`, initial);
  const { name, email, note } = draftState.value;
  const setName = (name: string) => draftState.set(d => ({ ...d, name }));
  const setEmail = (email: string) => draftState.set(d => ({ ...d, email }));
  const setNote = (note: string) => draftState.set(d => ({ ...d, note }));
  const task = useTask();
  return <Modal open={open} onClose={onClose} title={contact ? '编辑联系人' : '添加推荐人联系人'}>
    <Form onSubmit={async () => { if (await task.run(async () => {
      await window.desk.saveContact(draftState.value);
      {
        const latest = (await window.desk.getSnapshot()).contacts;
        const saved = contact ? latest.find(c => c.id === contact.id) : latest.find(c => c.name === name.trim() && c.email.toLowerCase() === email.trim().toLowerCase());
        if (saved) { onSaved?.(saved.id); draftState.saved(contact ? { id: saved.id, expectedRevision: saved.revision, name: saved.name, email: saved.email, note: saved.note } : initial()); }
      }
    })) { onClose(); } }}>
      <Field label="姓名"><input value={name} onChange={e => setName(e.target.value)} required/></Field><Field label="邮箱"><input type="email" value={email} onChange={e => setEmail(e.target.value)}/></Field><Field label="备注"><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="例如：毕业论文导师"/></Field>
      <footer className="modal-footer"><Feedback task={task}/>{draftState.dirty && <Button onClick={draftState.discard}>放弃修改</Button>}<Button onClick={onClose}>稍后继续</Button><Button type="submit" className="primary" busy={task.busy}>保存联系人</Button></footer>
    </Form>
  </Modal>;
}
export function SubmissionPanel({ project, snapshot: s }: { project: Project; snapshot: Snapshot }) {
  const record = s.submissions.find(x => x.projectId === project.id);
  const draftState = useDraft<SaveSubmissionInput>(`submission:${project.id}`, () => ({ projectId: project.id, expectedRevision: record?.revision || 0, preparedAt: record?.preparedAt || '', submittedAt: record?.submittedAt || '', confirmedAt: record?.confirmedAt || '', receivedAt: record?.receivedAt || '', receipt: record?.receipt || '', note: record?.note || '' }));
  const draft = draftState.value;
  const setDraft: typeof draftState.set = value => { setConfirmed(false); draftState.set(value); };
  const [confirmed, setConfirmed] = useState(false);
  const task = useTask();
  const rows = [
    ['preparedAt', '本人准备完成', '材料已准备并自行检查'],
    ['submittedAt', '实际提交', '已在学校网申中完成提交'],
    ['confirmedAt', '正式确认', '已取得提交回执或官方确认'],
    ['receivedAt', '学校收齐', '学校已确认所需材料收齐']
  ] as const;
  return <div className="submission-layout">
    <section className="submission-intro"><span className="eyebrow">每一步，各自有据</span><h2>准备好了之后，<br/>再记录真正发生的事。</h2><p>准备进度、实际提交和学校收件分别保存。这里的记录来自你在网申或官方通知中的核对。</p><div className="submission-track">{rows.map(([key, title], i) => <div className={`track-item ${draft[key] ? 'done' : ''}`} key={key}><span>{draft[key] ? <Check size={14}/> : i + 1}</span><div><strong>{title}</strong><small>{draft[key] || '尚未记录'}</small></div></div>)}</div></section>
    <Form className="submission-form" onSubmit={async () => { await task.run(async () => { await window.desk.saveSubmission(draft); const next = (await window.desk.getSnapshot()).submissions.find(x => x.projectId === project.id); if (next) { const { revision, ...fields } = next; draftState.saved({ ...fields, expectedRevision: revision }); } setConfirmed(false); }); }}>
      {rows.map(([key, title, hint]) => <div key={key}><PersonalDate label={title} value={draft[key].slice(0, 10)} onChange={value => setDraft(d => ({ ...d, [key]: value }))} timezone={s.workspace!.timezone} today/><p className="muted small">{hint}</p></div>)}
      <Field label="回执编号或说明"><input value={draft.receipt} onChange={e => setDraft(d => ({ ...d, receipt: e.target.value }))} placeholder="记录你能再次核对的回执信息"/></Field>
      <Field label="备注"><textarea rows={2} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}/></Field>
      <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对本次记录，与实际申请情况一致</label>
      <div className="save-bar"><Button type="submit" className="primary" disabled={!confirmed} busy={task.busy}>保存记录</Button><Feedback task={task}/>{draftState.dirty && <Button onClick={() => { draftState.discard(); setConfirmed(false); }}>放弃修改</Button>}</div>
    </Form>
  </div>;
}
