import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, CircleAlert, Globe2, Loader2, Pause, Play, Search, Sparkles } from 'lucide-react';
import { Project, Requirement, ResearchCandidate, Snapshot } from '../shared/types';
import { Badge, Button, Disclosure, Empty, Feedback, SourceList, limitsText, necessityText, supportText, unresolvedText, useTask } from './ui';

import { useSessionState } from './session';

function changes(candidate: ResearchCandidate, existing?: Requirement) {
  if (!existing) return ['新增要求'];
  const next = candidate.requirement;
  const fields: Array<[string, unknown, unknown]> = [
    ['名称', existing.title, next.title], ['说明', existing.summary, next.summary],
    ['必交性', existing.necessity, next.necessity], ['条件', existing.condition, next.condition],
    ['限制', existing.limits, next.limits], ['官方截止', existing.deadline, next.deadline],
    ['证据', existing.evidence, next.evidence], ['证据状态', existing.support, next.support],
    ['事项类型', existing.kind, next.kind], ['截止时区', existing.deadlineTimezone, next.deadlineTimezone],
    ['尚待核实的字段', existing.unresolvedFields || [], next.unresolvedFields || []],
    ['个人适用性', existing.applicability, next.applicability]
  ];
  return fields.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([name]) => name);
}
function ChangeComparison({ existing, candidate }: { existing: Requirement; candidate: ResearchCandidate }) {
  const next = candidate.requirement;
  const kind = { document: '文件材料', recommendation: '推荐信', assessment: '学历评估', task: '一般事项' };
  const applicability = { applies: '适用', not_applicable: '不适用', unknown: '待确认' };
  const values: Array<[string, string, string]> = [
    ['名称', existing.title, next.title], ['说明', existing.summary, next.summary],
    ['必交性', necessityText[existing.necessity], necessityText[next.necessity]],
    ['证据状态', supportText[existing.support], supportText[next.support]],
    ['事项类型', kind[existing.kind], kind[next.kind]],
    ['适用条件', existing.condition || '未明确', next.condition || '未明确'],
    ['本人适用性', applicability[existing.applicability], applicability[next.applicability]],
    ['长度限制', limitsText(existing) || '待核实', limitsText(next) || '待核实'],
    ['官方截止', existing.deadline || '待确认', next.deadline || '待确认'],
    ['截止时区', existing.deadlineTimezone || '未明确', next.deadlineTimezone || '未明确'],
    ['待核实字段', unresolvedText(existing.unresolvedFields) || '无', unresolvedText(next.unresolvedFields) || '无'],
    ['来源适用范围', [...new Set(existing.evidence.map(e => e.scope))].join('；') || '未明确', [...new Set(next.evidence.map(e => e.scope))].join('；') || '未明确']
  ];
  const rows = values.filter(([, before, after]) => before !== after);
  return <div className="change-comparison">{rows.map(([label, before, after]) => <div className="change-field" key={label}><strong>{label}</strong><dl className="facts"><dt>已采用</dt><dd>{before || '空'}</dd><dt>本次草稿</dt><dd>{after || '空'}</dd></dl></div>)}<Disclosure title="已采用版本的原文依据"><SourceList evidence={existing.evidence}/></Disclosure></div>;
}
export function ResearchPanel({ project, snapshot: s, onSettings }: { project: Project; snapshot: Snapshot; onSettings: () => void }) {
  const runs = [...s.research].filter(r => r.projectId === project.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const [viewRun, setViewRun] = useSessionState(`research:${project.id}:run`, '');
  const run = runs.find(r => r.id === viewRun) || runs[0];
  const [selected, setSelected] = useSessionState<string[]>(`research:${project.id}:selected`, []);
  const [replacements, setReplacements] = useSessionState<string[]>(`research:${project.id}:replacements`, []);
  const task = useTask(), adopting = useTask();
  const running = run?.status === 'running';
  const supported = run?.candidates.filter(c => c.requirement.support === 'supported') || [];
  const candidateFingerprint = JSON.stringify(run?.candidates.map(c => [c.key, c.requirement, c.adoptedRequirementId]) || []);
  const [lastFingerprint, setLastFingerprint] = useSessionState(`research:${project.id}:fingerprint`, `${run?.id}:${candidateFingerprint}`);
  useEffect(() => { const current = `${run?.id}:${candidateFingerprint}`; if (lastFingerprint !== current) { setSelected([]); setReplacements([]); setLastFingerprint(current); } }, [run?.id, candidateFingerprint]);
  const toggle = (key: string, checked: boolean) => setSelected(prev => checked ? [...new Set([...prev, key])] : prev.filter(k => k !== key));
  const start = () => void task.run(async () => { setViewRun(''); setSelected([]); setReplacements([]); await window.desk.startResearch({ projectId: project.id }); }, '研究已开始，结果会逐步显示');
  const adopt = () => void adopting.run(async () => {
    if (!run) return;
    await window.desk.adoptResearch({
      runId: run.id, expectedRevision: run.revision,
      selections: selected.map(key => {
        const c = run.candidates.find(c => c.key === key);
        const existing = s.requirements.find(r => r.id === c?.adoptedRequirementId || (r.projectId === project.id && r.researchKey === key));
        return { key, expectedRequirementRevision: existing?.revision, replaceUserEdit: replacements.includes(key) };
      })
    });
    setSelected([]);
  }, '所选要求已接入准备清单，个人进度保持不变');
  return <div className="research-page">
    <section className="research-intro">
      <div className="research-icon"><Globe2 size={26}/></div>
      <div className="grow"><h2>从官方资料，理清要准备什么</h2><p>沿着项目、学院和中央招生政策查找。结果逐步呈现，由你选择采用。</p><div className="row wrap gap-sm"><Badge>{project.cycle}</Badge><span className="small muted">{project.officialUrl ? project.officialUrl.replace(/^https?:\/\//, '').split('/')[0] : '尚未填写官网'}</span></div></div>
      {!running && <Button className="primary" disabled={!project.officialUrl || !s.apiSettings.hasKey} busy={task.busy} onClick={start}><Search size={16}/>{run ? '重新研究' : '开始研究'}</Button>}
      {running && <Button className="secondary" busy={task.busy} onClick={() => void task.run(() => window.desk.cancelResearch({ runId: run.id }), '已请求停止，保留已取得的结果')}><Pause size={15}/>停止研究</Button>}
    </section>
    {!s.apiSettings.hasKey && <div className="info-banner"><Sparkles size={19}/><div><strong>先连接你选择的模型服务</strong><p>官网研究仅发送必要的公开资料。个人文件和背景不会自动上传。</p></div><Button className="secondary" onClick={onSettings}>设置 API <ArrowRight size={14}/></Button></div>}
    {!project.officialUrl && <p className="inline-warning"><CircleAlert size={16}/>请先在“编辑项目”中补充官网链接。</p>}
    <Feedback task={task}/>
    {run ? <>
      <div className="research-status">
        <div className="row wrap between"><div className="row"><span className={`run-indicator ${running ? 'active' : ''}`}>{running ? <Loader2 size={16} className="spin"/> : <BookOpen size={16}/>}</span><div><strong>{({ running: '正在查找与整理', paused: '研究已暂停', completed: '本轮研究已结束', failed: '研究遇到问题', cancelled: '研究已停止' })[run.status]}</strong><p>{run.message || '已取得的内容会保留在这里。'}</p></div></div>
          {runs.length > 1 && <select className="compact-select" aria-label="研究历史" value={run.id} onChange={e => { setViewRun(e.target.value); setSelected([]); }}>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString('zh-CN')}</option>)}</select>}
        </div>
        <div className="run-metrics"><span><strong>{run.pages}</strong> / 30 页资料</span><span><strong>{run.calls}</strong> / 12 次模型调用</span><span><strong>{Math.round((run.inputTokens + run.outputTokens) / 1000 * 10) / 10}k</strong> tokens{run.usageUnknown ? '（部分用量未知）' : ''}</span><span>{Math.round(run.elapsedMs / 1000)} 秒 / 15 分钟</span></div>
        {(run.status === 'paused' || run.status === 'cancelled' || run.status === 'failed') && <Button className="text-button" busy={task.busy} onClick={() => void task.run(() => window.desk.resumeResearch({ runId: run.id }), '已继续研究')}><Play size={14}/>继续查找（可能产生 API 费用）</Button>}
      </div>
      {run.gaps.length > 0 && <Disclosure title={`还需要核实的地方（${run.gaps.length}）`} open><ul className="gap-list">{run.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></Disclosure>}
      <div className="section-heading"><div><h3>研究草稿 <span className="count">{run.candidates.length}</span></h3><p className="muted small">采用只更新项目要求，不会替你确认资格、豁免或材料完成。</p></div><Button className="text-button" disabled={!supported.length} onClick={() => setSelected(supported.filter(c => { const r = s.requirements.find(r => r.id === c.adoptedRequirementId || (r.projectId === project.id && r.researchKey === c.key)); return !r?.userEdited; }).map(c => c.key))}>选择有依据的要求</Button></div>
      {run.candidates.length === 0 ? <Empty icon={running ? <Loader2 size={28} className="spin"/> : <BookOpen size={28}/>} title={running ? '正在读取官方页面' : '暂时没有可采用的要求'} body={running ? '第一批结果会出现在这里，你可以继续浏览其他页面。' : '已保存的来源和缺口仍可查看；也可以手动添加已确认的要求。'}/> :
      <div className="candidate-list">{run.candidates.map(candidate => {
        const r = candidate.requirement;
        const existing = s.requirements.find(q => q.id === candidate.adoptedRequirementId || (q.projectId === project.id && q.researchKey === candidate.key));
        const changed = changes(candidate, existing);
        return <article className={`candidate ${selected.includes(candidate.key) ? 'selected' : ''}`} key={candidate.key}>
          <div className="candidate-header"><input aria-label={`采用 ${r.title}`} type="checkbox" checked={selected.includes(candidate.key)} disabled={r.support !== 'supported' || (!!existing?.userEdited && !replacements.includes(candidate.key))} onChange={e => toggle(candidate.key, e.target.checked)}/><div className="grow"><div className="row wrap between"><h4>{r.title}</h4><div className="row wrap gap-sm"><Badge tone={r.necessity === 'required' ? 'blue' : ''}>{necessityText[r.necessity]}</Badge><Badge tone={r.support === 'supported' ? 'green' : 'amber'}>{supportText[r.support]}</Badge></div></div><p>{r.summary || '暂无摘要，请展开查看来源。'}</p>{limitsText(r) && <p className="limit-summary">{limitsText(r)}</p>}{r.condition && <p className="small"><strong>条件：</strong>{r.condition}</p>}{r.deadline && <p className="small">官方截止：{r.deadline}{r.deadlineTimezone && ` · ${r.deadlineTimezone}`}</p>}</div></div>
          <div className="candidate-body">
            {!!r.unresolvedFields?.length && <p className="inline-warning">仍需核对：{unresolvedText(r.unresolvedFields)}。这些字段不会用于已确认的检查或截止判断。</p>}
            {existing && <div className="change-summary"><strong>{changed.length ? `与已采用内容相比：${changed.join('、')}有变化` : '与已采用要求一致'}</strong>{changed.length > 0 && <ChangeComparison existing={existing} candidate={candidate}/>}</div>}
            {existing?.userEdited && <label className="check-label override-check"><input type="checkbox" checked={replacements.includes(candidate.key)} onChange={e => { setReplacements(v => e.target.checked ? [...v, candidate.key] : v.filter(k => k !== candidate.key)); if (!e.target.checked) toggle(candidate.key, false); }}/>这项要求包含我的编辑；我已比较差异，允许此次替换。</label>}
            <Disclosure title={`查看原文与适用范围（${r.evidence.length}）`}><SourceList evidence={r.evidence}/></Disclosure>
          </div>
        </article>;
      })}</div>}
      <div className="adopt-bar"><div><strong>{selected.length ? `已选择 ${selected.length} 项要求` : '选择你要采用的要求'}</strong><p>未选择的草稿继续保留。后续结果需要再次确认。</p></div><Button className="primary" disabled={!selected.length} busy={adopting.busy} onClick={adopt}><Check size={16}/>采用到准备清单</Button></div>
      <Feedback task={adopting}/>
      <Disclosure title={`本轮已保存来源（${run.sources.length}）`}><SourceList evidence={run.sources}/></Disclosure>
    </> : <div className="research-explainer"><div><span>01</span><h3>找到官方依据</h3><p>项目页、学院和中央政策，保留适用范围。</p></div><div><span>02</span><h3>逐条看清要求</h3><p>已知、未知和冲突分别呈现，不替你猜测。</p></div><div><span>03</span><h3>接入准备流程</h3><p>采用明确的要求，转成可以行动的清单。</p></div></div>}
    <p className="research-footnote">每轮最多读取 30 页、调用模型 12 次、运行 15 分钟。重启应用不会自动继续付费查询；没有服务单价时不估算金额。</p>
  </div>;
}
