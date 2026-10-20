import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, Clock3, File, FileCheck2, FilePlus2, FileText, FolderOpen, History, Link2, Plus, Search, Upload } from 'lucide-react';
import { ProgressInput, Requirement, Snapshot } from '../shared/types';
import { Badge, Button, Disclosure, Empty, Feedback, Field, Form, SourceList, limitsText, necessityText, shortDate, statusText, supportText, unresolvedText, useTask } from './ui';

import { PersonalDate } from './choices';
import { useDraft, useSessionState } from './session';
import { entryLabel } from '../shared/target';

export function RequirementDetail({ requirement: r, snapshot: s, onEdit, onBack }: { requirement: Requirement; snapshot: Snapshot; onEdit: () => void; onBack?: () => void }) {
  const progress = s.progress.find(p => p.requirementId === r.id);
  const initial = (): ProgressInput => ({
    requirementId: r.id, expectedRevision: progress?.revision || 0, status: progress?.status || 'todo',
    note: progress?.note || '', revisitOn: progress?.revisitOn || '', selectedVersionId: progress?.selectedVersionId || null
  });
  const draftState = useDraft(`progress:${r.id}`, initial);
  const draft = draftState.value, setDraft = draftState.set, dirty = draftState.dirty;
  const save = useTask(), file = useTask(), checking = useTask();
  const change = (patch: Partial<ProgressInput>) => { setDraft(d => ({ ...d, ...patch })); save.clear(); };
  const doSave = async () => {
    if (file.busy) return false;
    const ok = await save.run(async () => {
      await window.desk.saveProgress(draft);
      const latest = await window.desk.getSnapshot();
      const next = latest.progress.find(p => p.requirementId === r.id);
      if (next) { const { revision, ...fields } = next; draftState.saved({ ...fields, expectedRevision: revision }); }
    });
    return ok;
  };
  const version = s.versions.find(v => v.id === draft.selectedVersionId);
  const currentVersion = s.versions.find(v => v.id === progress?.selectedVersionId);
  const latestCheck = [...s.checks].filter(c => c.requirementId === r.id).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  const stale = latestCheck && (latestCheck.requirementRevision !== r.revision || latestCheck.versionId !== progress?.selectedVersionId);
  const project = s.projects.find(p => p.id === r.projectId);
  const blocked = r.dependencies.map(id => s.requirements.find(q => q.id === id)).filter(q => q && !s.progress.some(p => p.requirementId === q.id && p.status === 'ready')) as Requirement[];
  const action = s.actions.find(a => a.requirementId === r.id);
  const importFile = () => void file.run(async () => {
    const result = await window.desk.importMaterial({ title: r.title, materialId: version?.materialId });
    if (!result) return false;
    change({ selectedVersionId: result.id });
  }, '文件副本已导入，请保存这次关联。');
  return <section className="detail-pane">
    <header className="detail-head">
      <div className="row between">
        {onBack && <Button className="text-button mobile-back" onClick={onBack}><ArrowLeft size={15}/>返回清单</Button>}
        <span className="eyebrow">{project?.institution} · {project && entryLabel(project)}</span>
        <Button className="text-button" onClick={onEdit}>编辑要求</Button>
      </div>
      <h2>{r.title}</h2>
      <div className="row wrap gap-sm"><Badge tone={r.necessity === 'required' ? 'blue' : ''}>{necessityText[r.necessity]}</Badge>
        {r.support !== 'supported' && <Badge tone="amber">{supportText[r.support]}</Badge>}
        {r.applicability === 'not_applicable' && <Badge>本人不适用</Badge>}
        {r.applicability === 'unknown' && r.necessity === 'conditional' && <Badge tone="amber">本人适用性待核对</Badge>}
      </div>
    </header>
    <div className="detail-content">
      {!!r.unresolvedFields?.length && <p className="inline-warning">待核对：{unresolvedText(r.unresolvedFields)}。已保存的个人进度保持不变。</p>}
      <section className="next-step">
        <span className="section-kicker">当前这一步</span>
        <h3>{draft.status === 'ready' ? '已记录为准备好了' : draft.status === 'waiting' ? '等到回访时再检查进度' : action?.title || `准备${r.title}`}</h3>
        <p>{draft.status === 'ready' ? '准备状态由你记录，实际提交与学校收件会分别保留。' : action?.instruction || r.summary || '先查看这项材料的要求，再关联文件或记录准备进度。'}</p>
        {blocked.length > 0 && <p className="small">前置事项：{blocked.map(q => q.title).join('、')}</p>}
        {r.condition && <p className="small"><strong>适用条件：</strong>{r.condition}</p>}
      </section>
      {!!r.unresolvedFields?.length && <p className="inline-warning">仍需核对：{unresolvedText(r.unresolvedFields)}。已有依据的其他要求可以继续使用。</p>}
      <Form onSubmit={doSave}>
        <div className="section-heading"><h3>准备进度</h3>{dirty && <span className="muted small">尚未保存</span>}</div>
        <div className="status-options" role="group" aria-label="准备进度">
          {(['todo', 'doing', 'ready', 'waiting', 'deferred'] as const).map(status => <button type="button" key={status} className={`status-option ${draft.status === status ? 'selected' : ''}`} onClick={() => change({ status })}>
            {status === 'ready' ? <CheckCircle2 size={15}/> : status === 'waiting' || status === 'deferred' ? <Clock3 size={15}/> : <span className={`status-dot ${status}`}/>}
            {statusText[status]}
          </button>)}
        </div>
        {(draft.status === 'waiting' || draft.status === 'deferred') && <PersonalDate label={draft.status === 'waiting' ? '哪天回访' : '哪天继续'} value={draft.revisitOn} onChange={value => change({ revisitOn: value })} timezone={s.workspace!.timezone} required/>}
        <Field label="给自己留个备注"><textarea rows={2} placeholder={draft.status === 'waiting' ? '在等谁、什么回复？' : '记下下一次可以接着做的地方…'} value={draft.note} onChange={e => change({ note: e.target.value })}/></Field>
        {(r.kind === 'document' || r.kind === 'assessment') && <section className="file-section">
          <div className="section-heading"><h3>这份申请使用的文件</h3><span className="muted small">各项目单独选择版本</span></div>
          {version ? <div className="file-tile"><div className="file-icon"><FileText size={22}/></div><div className="grow"><strong>{version.filename}</strong><p>{Math.max(1, Math.round(version.size / 1024))} KB · {shortDate(version.importedAt)}导入的副本</p></div><Button className="icon-button" aria-label="打开文件" onClick={() => void file.run(() => window.desk.openMaterial({ versionId: version.id }), '已交给系统打开')}><ArrowUpRight size={18}/></Button></div> : <div className="file-empty"><FilePlus2 size={22}/><p>还没有关联文件</p></div>}
          <div className="row wrap"><Button className="secondary" busy={file.busy} onClick={importFile}><Upload size={15}/>{version ? '导入新版本' : '从电脑导入'}</Button>
            {draft.selectedVersionId && <Button className="text-button" onClick={() => change({ selectedVersionId: null })}>解除关联</Button>}
          </div>
          {s.versions.length > 0 && <MaterialPicker snapshot={s} requirementId={r.id} value={draft.selectedVersionId} savedValue={progress?.selectedVersionId || null} onChange={value => change({ selectedVersionId: value })}/>}

          <Feedback task={file}/>
        </section>}
        <div className="save-bar"><Button type="submit" className="primary" busy={save.busy} disabled={file.busy}><Check size={16}/>保存进度</Button><Feedback task={save}/>{dirty && <Button disabled={file.busy} onClick={draftState.discard}>放弃修改</Button>}</div>
      </Form>
      {(r.kind === 'document' || r.kind === 'assessment') && <section className="detail-section">
        <div className="section-heading"><h3>检查文件</h3><Badge>在本机完成</Badge></div>
        <p className="muted small">{limitsText(r) || '尚无已记录的长度限制；可先查看文件的字数和页数。'}</p>
        <Button className="secondary" busy={checking.busy} disabled={!currentVersion || dirty} onClick={() => void checking.run(() => window.desk.checkMaterial({ requirementId: r.id }), '本地检查完成')}><FileCheck2 size={16}/>{checking.busy ? '正在检查' : '检查当前文件'}</Button>
        {dirty && <p className="muted small">先保存关联和进度，再检查当前文件。</p>}
        <Feedback task={checking}/>
        {latestCheck && <div className={`check-result ${latestCheck.issues.length || stale ? 'has-issues' : ''}`}>
          <strong>{stale ? '原检查已过期' : latestCheck.status === 'unreadable' ? '暂时无法可靠读取' : latestCheck.issues.length ? '这些地方需要再看一下' : '未发现超出已知长度限制'}</strong>
          {stale ? <p>文件或项目要求已变化，请重新检查。</p> : <>
            {latestCheck.issues.length > 0 && <ul>{latestCheck.issues.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            <div className="check-stats">{[['词', latestCheck.words], ['字符', latestCheck.characters], ['页', latestCheck.pages]].map(([label, value]) => <span key={label}><strong>{value ?? '—'}</strong>{label}</span>)}</div>
            {latestCheck.notes.map((t, i) => <p className="small muted" key={i}>{t}</p>)}
          </>}
          <p className="muted small">检查不代表材料内容合格，也不会自动完成申请。</p>
        </div>}
      </section>}
      <Disclosure title="要求、截止与官方依据">
        <p>{r.summary || '尚未填写摘要。'}</p>
        <dl className="facts"><dt>必交性</dt><dd>{necessityText[r.necessity]}</dd><dt>证据状态</dt><dd>{supportText[r.support]}</dd><dt>长度限制</dt><dd>{limitsText(r) || '待核实'}</dd><dt>官方截止</dt><dd>{r.deadline || '待确认'}{r.deadlineTimezone && ` · ${r.deadlineTimezone}`}</dd></dl>
        <SourceList evidence={r.evidence}/>
      </Disclosure>
      <Disclosure title="版本与检查记录">
        <p className="muted small">要求版本 {r.revision} · {r.origin === 'manual' ? '手动整理' : '来自已采用的研究'}{r.userEdited ? ' · 含个人编辑' : ''}</p>
        {s.checks.filter(c => c.requirementId === r.id).map(c => <p className="history-row" key={c.id}><History size={13}/>{c.checkedAt.replace('T', ' ').slice(0, 16)} · 要求版本 {c.requirementRevision}</p>)}
      </Disclosure>
    </div>
  </section>;
}

export function MaterialsPage({ snapshot: s, onRequirement }: { snapshot: Snapshot; onRequirement: (id: string) => void }) {
  const [query, setQuery] = useSessionState('materials:query', '');
  const [selected, setSelected] = useSessionState('materials:selected', '');
  const [mobileDetail, setMobileDetail] = useSessionState('materials:detail', false);
  const task = useTask();
  const list = s.materials.filter(m => m.title.toLowerCase().includes(query.toLowerCase()));
  const material = list.find(m => m.id === selected) || list[0];
  const versions = s.versions.filter(v => v.materialId === material?.id).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const versionIds = new Set(versions.map(v => v.id));
  const linked = s.progress.filter(p => p.selectedVersionId && versionIds.has(p.selectedVersionId));
  const importNew = (newVersion = false) => void task.run(async () => {
    const result = await window.desk.importMaterial(newVersion && material ? { materialId: material.id } : {});
    if (!result) return false;
    setSelected(result.materialId); setMobileDetail(true);
  }, '文件副本已保存到材料库');
  return <div className="page materials-page">
    <header className="page-heading"><div><span className="eyebrow">你的文件，各校复用</span><h1>我的材料</h1><p>保存每次修改，为每份申请选择合适的版本。</p></div><Button className="primary" busy={task.busy} onClick={() => importNew()}><Plus size={16}/>导入材料</Button></header>
    <Feedback task={task}/>
    {s.materials.length === 0 ? <Empty icon={<FolderOpen size={32}/>} title="从第一份材料开始" body="导入简历、文书或成绩单的副本。原始文件会保留在原处。" action={<Button className="primary" onClick={() => importNew()}><Upload size={16}/>从电脑导入</Button>}/> :
    <div className={`library-split ${mobileDetail ? 'show-detail' : ''}`}>
      <aside className="library-list"><div className="search-box"><Search size={16}/><input aria-label="搜索材料" placeholder="搜索材料" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="list-label">{list.length} 份材料</div>
        {list.map(m => { const count = s.versions.filter(v => v.materialId === m.id).length; return <button className={`library-item ${material?.id === m.id ? 'selected' : ''}`} onClick={() => { setSelected(m.id); setMobileDetail(true); }} key={m.id}><FileText size={22}/><span className="grow"><strong>{m.title}</strong><small>{count} 个版本</small></span><span className="selection-mark"/></button>; })}
      </aside>
      <section className="library-detail"><Button className="text-button mobile-back library-back" onClick={() => setMobileDetail(false)}><ArrowLeft size={15}/>返回材料列表</Button>{material ? <>
        <div className="library-title"><div className="file-icon large"><FileText size={30}/></div><div><span className="eyebrow">材料库</span><h2>{material.title}</h2><p className="muted">原件不变，修改后的文件作为新版本保存。</p></div></div>
        <div className="section-heading"><h3>文件版本</h3><Button className="secondary" onClick={() => importNew(true)} busy={task.busy}><Upload size={15}/>导入新版本</Button></div>
        <div className="version-list">{versions.map((v, index) => <div className="version-row" key={v.id}><div className="version-number">V{versions.length - index}</div><div className="grow"><strong>{v.filename}</strong><p>{new Date(v.importedAt).toLocaleString('zh-CN')} · {Math.max(1, Math.round(v.size / 1024))} KB</p></div>{index === 0 && <Badge tone="green">最新导入</Badge>}<Button className="icon-button" aria-label={`打开 ${v.filename}`} onClick={() => void task.run(() => window.desk.openMaterial({ versionId: v.id }), '已交给系统打开')}><ArrowUpRight size={17}/></Button></div>)}</div>
        <div className="section-heading space-top"><h3>用于这些项目</h3><span className="muted small">{linked.length} 处关联</span></div>
        {linked.length ? linked.map(p => { const r = s.requirements.find(r => r.id === p.requirementId), project = s.projects.find(j => j.id === r?.projectId); return r && <button className="linked-row" key={p.requirementId} onClick={() => onRequirement(r.id)}><Link2 size={17}/><span className="grow"><strong>{project?.institution} · {r.title}</strong><small>{project?.name} · {statusText[p.status]}</small></span><ArrowUpRight size={15}/></button>; }) : <p className="muted">还未关联项目。打开项目的准备清单，即可选择材料库中的版本。</p>}
        <div className="quiet-note"><FileCheck2 size={18}/><p>长度要求随项目变化。请到对应项目中检查所选文件，结果会与要求版本一同保存。</p></div>
      </> : <Empty title="没有找到材料" body="试试其他名称，或导入一份新文件。"/>}</section>
    </div>}
  </div>;
}

function MaterialPicker({ snapshot: s, requirementId, value, savedValue, onChange }: { snapshot: Snapshot; requirementId: string; value: string | null; savedValue: string | null; onChange: (id: string) => void }) {
  const [query, setQuery] = useSessionState(`picker:${requirementId}:query`, '');
  const [selected, setSelected] = useSessionState(`picker:${requirementId}:material`, s.versions.find(v => v.id === value)?.materialId || '');
  const materials = s.materials.filter(m => m.title.toLowerCase().includes(query.toLowerCase()) || s.versions.some(v => v.materialId === m.id && v.filename.toLowerCase().includes(query.toLowerCase())));
  const versions = s.versions.filter(v => v.materialId === selected).sort((a, b) => a.importedAt.localeCompare(b.importedAt));
  return <Disclosure title="从材料库选择版本"><Field label="搜索已有材料"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="材料名称或文件名"/></Field><Field label="选择材料"><select value={materials.some(m => m.id === selected) ? selected : ''} onChange={e => setSelected(e.target.value)}><option value="">选择一份材料…</option>{materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></Field>
    {!materials.length && <p className="muted small">没有找到匹配材料。</p>}
    {materials.some(m => m.id === selected) && <div className="version-picker" role="group" aria-label="选择文件版本">{[...versions].reverse().map((v, i) => <button type="button" key={v.id} aria-pressed={v.id === value} onClick={() => onChange(v.id)} className={v.id === value ? 'selected' : ''}><strong>V{versions.length - i} · {v.filename}</strong><small>{new Date(v.importedAt).toLocaleString('zh-CN')} · {v.id === savedValue ? '本项目当前使用' : v.id === value ? '已选择，待保存' : '点击选择此版本'}</small></button>)}</div>}
  </Disclosure>;
}
