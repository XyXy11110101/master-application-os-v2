import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronRight, Circle, CircleAlert, Clock3, Compass, Ellipsis, FileText, FolderOpen, GraduationCap, LayoutGrid, ListChecks, Loader2, Menu, Plus, Search, Settings, ShieldCheck, Sparkles, Sun, X } from 'lucide-react';
import { Action, Project, Requirement, Snapshot } from '../shared/types';
import { Badge, Button, Crest, Disclosure, Empty, Feedback, Field, Form, SourceList, errorText, limitsText, necessityText, shortDate, statusText, supportText, unresolvedText, useTask } from './ui';
import { ProjectEditor, Recommendations, RequirementEditor, SubmissionPanel } from './forms';
import { MaterialsPage, RequirementDetail } from './materials';
import { ResearchPanel } from './research';
import { LegacyImport, SettingsPage } from './settings';

import { entryLabel, projectLabel } from '../shared/target';
import { EntryFields, TimezoneField } from './choices';
import { SessionScope, useSessionState } from './session';

type Nav = 'now' | 'schools' | 'materials' | 'settings';
const navigation = [
  { id: 'now' as Nav, label: '现在', icon: Sun },
  { id: 'schools' as Nav, label: '我的学校', icon: GraduationCap },
  { id: 'materials' as Nav, label: '我的材料', icon: FolderOpen },
  { id: 'settings' as Nav, label: '设置', icon: Settings }
];
class RenderBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="fatal-screen"><CircleAlert size={30}/><h2>页面遇到问题</h2><p>已保存的资料仍在本机。</p><pre>{this.state.error}</pre><Button className="primary" onClick={() => location.reload()}>重新打开页面</Button></div> : this.props.children; }
}
export default function App() { return <RenderBoundary><Desk/></RenderBoundary>; }
function Desk() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState('');
  const [nav, setNav] = useState<Nav>('now'), [projectId, setProjectId] = useState(''), [requirementId, setRequirementId] = useState('');
  const [settingsSection, setSettingsSection] = useState('workspace');
  const [projectOpen, setProjectOpen] = useState(false), [legacyOpen, setLegacyOpen] = useState(false), [menuOpen, setMenuOpen] = useState(false);
  const [focusAction, setFocusAction] = useState<Action | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const request = ++seq.current;
    try { const s = await window.desk.getSnapshot(); if (request === seq.current) { setSnapshot(s); setError(''); } }
    catch (e) { if (request === seq.current) setError(errorText(e)); }
  }, []);
  useEffect(() => { void load(); let timer: ReturnType<typeof setTimeout>; const unsubscribe = window.desk.onChanged(() => { clearTimeout(timer); timer = setTimeout(() => void load(), 40); }); return () => { clearTimeout(timer); unsubscribe(); }; }, [load]);
  const go = (target: Nav) => { setNav(target); setMenuOpen(false); if (target === 'settings') setSettingsSection('workspace'); };
  const openProject = (id: string) => { setFocusAction(null); setProjectId(id); setRequirementId(''); setNav('schools'); };
  const openAction = (action: Action) => { setRequirementId(''); setProjectId(action.projectId); setFocusAction({ ...action }); setNav('schools'); };
  const openRequirement = (id: string) => {
    const r = snapshot?.requirements.find(r => r.id === id);
    if (r) { setRequirementId(id); setProjectId(r.projectId); setNav('schools'); }
  };
  if (!snapshot) return <div className="startup-screen"><div className="brand-symbol"><Compass size={26}/></div><h1>申请工作台</h1>{error ? <><p className="error">{error}</p><Button onClick={() => void load()}>重试</Button></> : <p><Loader2 className="spin" size={16}/>正在打开本机工作区…</p>}</div>;
  if (!snapshot.workspace) return <Setup onReady={load}/>;
  const s = snapshot, activeProjects = s.projects.filter(p => !p.archived), currentProject = s.projects.find(p => p.id === projectId && !p.archived);
  return <SessionScope id={`${s.workspace!.id}:${s.dataPath}`}><div className="app-shell" key={s.dataPath}>
    <button className="mobile-menu-button" aria-label={menuOpen ? '关闭导航' : '打开导航'} onClick={() => setMenuOpen(v => !v)}>{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
    {menuOpen && <div className="nav-backdrop" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-symbol"><Compass size={24}/></span><span><strong>申请工作台</strong><small>APPLICATION DESK</small></span></div>
      <div className="workspace-tag"><span className="workspace-dot"/><span>{s.workspace!.demo ? '虚构演示工作区' : '我的入学目标'}</span><span className="workspace-season">{entryLabel(s.workspace!)}</span></div>
      <nav className="primary-nav" aria-label="主导航">{navigation.map(item => <button key={item.id} aria-label={item.label} className={nav === item.id ? 'selected' : ''} aria-current={nav === item.id ? 'page' : undefined} onClick={() => go(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'schools' && activeProjects.length > 0 && <span className="nav-count">{activeProjects.length}</span>}</button>)}</nav>
      {activeProjects.length > 0 && <section className="sidebar-projects"><div className="sidebar-label">目标项目 <button aria-label="添加项目" onClick={() => setProjectOpen(true)}><Plus size={14}/></button></div>{activeProjects.slice(0, 6).map(p => <button key={p.id} className={`sidebar-project ${nav === 'schools' && projectId === p.id ? 'selected' : ''}`} onClick={() => openProject(p.id)}><span style={{ backgroundColor: p.color }} className="project-dot"/><span><strong>{p.institution}</strong><small>{p.name}</small>{activeProjects.some(other => other.id !== p.id && other.institution === p.institution && other.name === p.name) && <small>{entryLabel(p)}</small>}</span></button>)}{activeProjects.length > 6 && <button className="sidebar-more" onClick={() => go('schools')}>查看全部 {activeProjects.length} 个项目</button>}</section>}
      <div className="sidebar-bottom"><ShieldCheck size={16}/><div><strong>资料保存在本机</strong><span>每一步，都由你决定</span></div></div>
    </aside>
    <main className="main-canvas">
      <div className="topbar"><div className="breadcrumb"><span>我的工作台</span><ChevronRight size={12}/><strong>{navigation.find(n => n.id === nav)?.label}</strong>{nav === 'schools' && currentProject && <><ChevronRight size={12}/><span>{currentProject.institution}</span></>}</div><div className="topbar-right">{s.workspace!.demo && <Badge tone="amber">虚构数据演示</Badge>}<span className="local-pill"><span/>本地工作区</span></div></div>
      {error && <div className="app-error" role="alert">{error}<Button className="text-button" onClick={() => void load()}>重新加载</Button></div>}
      {nav === 'now' && <NowPage snapshot={s} onAction={openAction} onSchools={() => go('schools')} onAdd={() => setProjectOpen(true)} onLegacy={() => setLegacyOpen(true)}/>}
      {nav === 'schools' && (currentProject ? <ProjectPage key={currentProject.id} snapshot={s} project={currentProject} focusRequirement={requirementId} focusAction={focusAction} onActionHandled={() => setFocusAction(null)} onBack={() => { setProjectId(''); setRequirementId(''); }} onSettings={() => { setSettingsSection('api'); setNav('settings'); }}/> : <SchoolsPage snapshot={s} onProject={openProject} onAdd={() => setProjectOpen(true)} onLegacy={() => setLegacyOpen(true)}/>)}
      {nav === 'materials' && <MaterialsPage snapshot={s} onRequirement={openRequirement}/>}
      {nav === 'settings' && <SettingsPage key={s.workspace!.id} snapshot={s} initialSection={settingsSection}/>}
    </main>
    <ProjectEditor open={projectOpen} onClose={() => setProjectOpen(false)} cycle={s.workspace!.cycle} snapshot={s}/>
    <LegacyImport open={legacyOpen} onClose={() => setLegacyOpen(false)}/>
  </div></SessionScope>;
}

function Setup({ onReady }: { onReady: () => Promise<unknown> }) {
  const [entry, setEntry] = useState<{ entryYear?: number | null; entryMonth?: number | null }>({ entryYear: new Date().getFullYear() + 1, entryMonth: null });
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const task = useTask();
  const begin = (demo: boolean) => void task.run(async () => { await window.desk.setup({ cycle: entryLabel(entry), ...entry, timezone, demo }); await onReady(); }, '工作区已建立');
  return <div className="welcome">
    <div className="welcome-art"><div className="welcome-brand"><Compass size={27}/><span>APPLICATION DESK</span></div><div className="welcome-copy"><span className="eyebrow">属于你的申请工作台</span><h1>把想去的地方，<br/>变成眼前的下一步。</h1><p>从官方要求开始，整理材料、安排准备，<br/>一步一步完成你的升学申请。</p></div><div className="welcome-paper"><span className="paper-label">MY NEXT CHAPTER</span><div className="paper-rule"/><div className="paper-check"><Check size={15}/><span>找到目标项目</span></div><div className="paper-check"><Check size={15}/><span>看清官方要求</span></div><div className="paper-check current"><span className="paper-circle"/><strong>开始下一步准备</strong></div><div className="paper-short-rule"/></div><div className="welcome-foot"><ShieldCheck size={17}/>本地保存 · 无需账户 · 你掌控资料</div></div>
    <div className="welcome-form"><div className="welcome-form-inner"><span className="step-label">开始之前</span><h2>建一个自己的工作区</h2><p className="muted">选好入学年份和个人时区，就可以开始。</p><Form onSubmit={() => begin(false)}>
      <EntryFields value={entry} onChange={setEntry} required/><TimezoneField value={timezone} onChange={setTimezone}/>
      <Button type="submit" className="primary full-width" busy={task.busy}>建立个人工作区 <ArrowRight size={17}/></Button>
    </Form><Feedback task={task}/><div className="welcome-divider"><span>也可以先看看</span></div><Button className="demo-button" busy={task.busy} onClick={() => begin(true)}><div className="demo-icon"><Sparkles size={20}/></div><span><strong>体验虚构演示</strong><small>用几个示例项目，走一遍准备流程</small></span><ArrowRight size={18}/></Button><p className="welcome-small">演示与个人资料完全隔离，可以随时切换。</p></div></div>
  </div>;
}

function NowPage({ snapshot: s, onAction, onSchools, onAdd, onLegacy }: { snapshot: Snapshot; onAction: (a: Action) => void; onSchools: () => void; onAdd: () => void; onLegacy: () => void }) {
  const projects = s.projects.filter(p => !p.archived);
  const actions = s.actions.filter(a => projects.some(p => p.id === a.projectId));
  const available = actions.filter(a => !a.waiting), waiting = actions.filter(a => a.waiting);
  const hero = available[0], project = s.projects.find(p => p.id === hero?.projectId);
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: s.workspace!.timezone, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const ready = s.progress.filter(p => p.status === 'ready' && s.requirements.some(r => r.id === p.requirementId && projects.some(j => j.id === r.projectId))).length;
  const deadlines = s.requirements.filter(r => r.deadline && r.support === 'supported' && !r.unresolvedFields?.some(field => field.startsWith('deadline') || ['application_cycle', 'entry_month', 'scope'].includes(field)) && projects.some(p => p.id === r.projectId)).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 3);
  return <div className="page now-page">
    <header className="page-heading"><div><span className="eyebrow">{date}</span><h1>现在，做这一件事。</h1><p>{projects.length ? `${projects.length} 个目标项目，按自己的节奏一步步准备。` : '先添加一个目标项目，让准备从清楚的下一步开始。'}</p></div><div className="season-mark"><span>入学目标</span><strong>{entryLabel(s.workspace!)}</strong></div></header>
    {!projects.length ? <div className="first-project"><div className="first-project-icon"><GraduationCap size={36}/></div><h2>你的下一站，从这里开始</h2><p>记下学校和项目官网，整理要求，开始准备第一份材料。</p><div className="row"><Button className="primary" onClick={onAdd}><Plus size={16}/>添加目标项目</Button><Button className="secondary" onClick={onLegacy}>导入旧版名单</Button></div></div> :
    <>
      <div className="now-top-grid">
        {hero ? <section className="action-hero"><div className="row between"><span className="hero-label"><span className="hero-dot"/>建议现在做</span><Badge tone="hero">可开始</Badge></div><div className="hero-school"><span className="school-color-dot" style={{ background: project?.color }}/>{project?.institution}<span>·</span>{project?.name}</div><h2>{hero.title}</h2><p className="hero-instruction">{hero.instruction}</p><div className="hero-bottom"><Button className="hero-button" onClick={() => onAction(hero)}>{hero.buttonLabel || '开始这一步'} <ArrowRight size={17}/></Button><span className="hero-reason">{hero.reason}</span></div><div className="hero-orbit" aria-hidden="true"><div/><div/><div/></div></section> :
        <section className="action-hero calm"><div className="row"><Clock3 size={20}/><span className="hero-label">目前无需操作</span></div><h2>{waiting.length ? '等一个回复，<br/>也算是在推进。' : '给下一步留一点空间。'}</h2><p>{waiting.length ? '等待事项已保留，到回访日期再查看进展。你也可以去项目中补充材料。' : '目前没有可执行事项。打开项目，查看要求或记录最新进度。'}</p><Button className="hero-button" onClick={onSchools}>查看我的学校 <ArrowRight size={17}/></Button></section>}
        <aside className="journey-card"><span className="section-kicker">申请概览</span><div className="journey-count"><strong>{projects.length}</strong><span>个目标项目</span></div><div className="journey-summary"><div><span className="mini-dot green"/><span>已准备事项</span><strong>{ready}</strong></div><div><span className="mini-dot blue"/><span>现在可做</span><strong>{available.length}</strong></div><div><span className="mini-dot amber"/><span>正在等待</span><strong>{waiting.length}</strong></div></div><Button className="text-button" onClick={onSchools}>查看项目 <ArrowUpRight size={14}/></Button></aside>
      </div>
      <section className="now-section"><div className="section-heading"><div><h2>也可以从这里开始</h2><p>这些准备可以并行，选择适合你今天的一件。</p></div><span className="muted small">{Math.max(0, available.length - 1)} 项</span></div>
        {available.length > 1 ? <div className="action-list">{available.slice(1, 5).map(a => <ActionRow key={a.id} action={a} snapshot={s} onClick={() => onAction(a)}/>)}</div> : <div className="quiet-note"><ListChecks size={18}/><p>{hero ? '先完成当前这一步；有新的可执行事项时，会在这里出现。' : '项目中尚未有其他可执行事项。'}</p></div>}
        {available.length > 5 && <Disclosure title={`展开其余 ${available.length - 5} 项可做事项`}><div className="action-list">{available.slice(5).map(a => <ActionRow key={a.id} action={a} snapshot={s} onClick={() => onAction(a)}/>)}</div></Disclosure>}
      </section>
      <div className="now-bottom-grid"><section className="now-section"><div className="section-heading"><h2>等待与回访</h2><span className="muted small">{waiting.length} 项</span></div>{waiting.length ? <div className="waiting-list">{waiting.slice(0, 4).map(a => <button key={a.id} className="waiting-row" onClick={() => onAction(a)}><Clock3 size={16}/><span className="grow"><strong>{a.title}</strong><small>{s.projects.find(p => p.id === a.projectId)?.institution}</small></span><span>{a.revisitOn ? shortDate(a.revisitOn) : '日期待安排'}</span></button>)}</div> : <p className="muted small">没有正在等待的事项。</p>}</section>
      <section className="now-section"><div className="section-heading"><h2>已知的官方截止</h2><BookOpen size={17} className="muted"/></div>{deadlines.length ? deadlines.map(r => <div className="deadline-row" key={r.id}><div><strong>{s.projects.find(p => p.id === r.projectId)?.institution}</strong><small>{r.title}</small></div><span>{shortDate(r.deadline)}</span></div>) : <p className="muted small">项目要求中暂未记录官方截止。未知日期不会用个人目标替代。</p>}</section></div>
    </>}
    <footer className="page-foot"><ShieldCheck size={14}/>进度由你记录，准备完成与正式提交分别保存。</footer>
  </div>;
}
function ActionRow({ action: a, snapshot: s, onClick }: { action: Action; snapshot: Snapshot; onClick: () => void }) {
  const project = s.projects.find(p => p.id === a.projectId), r = s.requirements.find(r => r.id === a.requirementId);
  return <button className="action-row" onClick={onClick}><span className="action-row-icon">{r?.kind === 'document' ? <FileText size={18}/> : r?.kind === 'recommendation' ? <UserIcon/> : <ListChecks size={18}/>}</span><span className="grow"><strong>{a.title}</strong><small>{project?.institution} · {project?.name} · {a.reason}</small></span><ChevronRight size={18}/></button>;
}
function UserIcon() { return <GraduationCap size={18}/>; }

function SchoolsPage({ snapshot: s, onProject, onAdd, onLegacy }: { snapshot: Snapshot; onProject: (id: string) => void; onAdd: () => void; onLegacy: () => void }) {
  const [query, setQuery] = useSessionState('schools:query', '');
  const active = s.projects.filter(p => !p.archived && `${p.institution} ${p.name} ${projectLabel(p)}`.toLowerCase().includes(query.toLowerCase()));
  const grouped = new Map<string, Project[]>();
  active.forEach(p => grouped.set(p.institution, [...(grouped.get(p.institution) || []), p]));
  return <div className="page schools-page">
    <header className="page-heading"><div><span className="eyebrow">想去的地方，都在这里</span><h1>我的学校</h1><p>按项目整理要求和进度，让每份申请各有条理。</p></div><Button className="primary" onClick={onAdd}><Plus size={16}/>添加项目</Button></header>
    <div className="school-toolbar"><span className="collection-title">目标清单 <Badge>{s.projects.filter(p => !p.archived).length} 个项目</Badge></span><div className="search-box"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索学校或项目" aria-label="搜索学校或项目"/></div></div>
    {grouped.size ? <div className="school-grid">{[...grouped.entries()].map(([institution, projects]) => {
      const first = projects[0], reqs = s.requirements.filter(r => projects.some(p => p.id === r.projectId) && r.necessity !== 'not_required'), completed = reqs.filter(r => s.progress.some(p => p.requirementId === r.id && p.status === 'ready')).length;
      const next = s.actions.find(a => !a.waiting && projects.some(p => p.id === a.projectId));
      return <article className="school-card" key={institution} style={{ '--school-color': first.color } as React.CSSProperties}>
        <div className="school-card-top"><Crest name={institution} color={first.color} large/><span className="school-card-cycle">{[...new Set(projects.map(p => p.entryYear))].length > 1 ? '多个入学目标' : entryLabel(first)}</span></div>
        <h2>{institution}</h2>
        <div className="school-programs">{projects.map(p => <button onClick={() => onProject(p.id)} key={p.id}><span>{p.name}<small className="program-meta">{projectLabel(p)}</small></span><ChevronRight size={15}/></button>)}</div>
        <div className="school-card-progress"><span>{reqs.length ? `${completed} / ${reqs.length} 项已准备` : '尚未建立准备清单'}</span><div className="progress-track"><span style={{ width: `${reqs.length ? completed / reqs.length * 100 : 0}%` }}/></div></div>
        <div className="school-next"><span className="section-kicker">下一步</span><p>{next?.title || (reqs.length ? '查看项目与最新进度' : '查明本轮申请要求')}</p></div>
        <Button className="school-open" onClick={() => onProject(first.id)}>打开项目 <ArrowRight size={15}/></Button>
      </article>;
    })}</div> : <Empty icon={<GraduationCap size={30}/>} title={query ? '没有找到匹配项目' : '添加你的第一所学校'} body={query ? '换一个学校或项目名称试试。' : '选好学校、项目和入学目标，之后再逐步完善。'} action={!query && <div className="row"><Button className="primary" onClick={onAdd}><Plus size={15}/>添加项目</Button><Button className="secondary" onClick={onLegacy}>导入旧版名单</Button></div>}/>}
    <footer className="page-foot"><span className="small muted">同校项目合并展示，材料与提交进度按项目分别保存。</span><Button className="text-button" onClick={onLegacy}>导入旧版名单</Button></footer>
  </div>;
}

function ProjectPage({ snapshot: s, project, focusRequirement, focusAction, onActionHandled, onBack, onSettings }: { snapshot: Snapshot; project: Project; focusRequirement: string; focusAction: Action | null; onActionHandled: () => void; onBack: () => void; onSettings: () => void }) {
  const [tab, setTab] = useSessionState<'preparation' | 'requirements' | 'submission'>(`project:${project.id}:tab`, 'preparation');
  const [research, setResearch] = useSessionState(`project:${project.id}:research`, false);
  const [selected, setSelected] = useSessionState(`project:${project.id}:selected`, focusRequirement);
  const [mobileDetail, setMobileDetail] = useSessionState(`project:${project.id}:detail`, !!focusRequirement);
  const [copyOpen, setCopyOpen] = useState(false);
  const [recommendationFocus, setRecommendationFocus] = useState('');
  const [projectOpen, setProjectOpen] = useState(false), [requirementOpen, setRequirementOpen] = useState(false), [editing, setEditing] = useState<Requirement | undefined>();
  const task = useTask();
  useEffect(() => { if (focusRequirement) { setSelected(focusRequirement); setTab('preparation'); setMobileDetail(true); } }, [focusRequirement]);
  useEffect(() => {
    if (!focusAction || focusAction.projectId !== project.id) return;
    const destination = focusAction.destination || { section: 'requirement', recordId: focusAction.requirementId };
    if (destination.section === 'research') { setTab('requirements'); setResearch(true); }
    if (destination.section === 'submission') setTab('submission');
    if (destination.section === 'project') setProjectOpen(true);
    if (destination.section === 'requirement') { setTab('preparation'); setSelected(destination.recordId || ''); setMobileDetail(true); }
    if (destination.section === 'recommendation') { setTab('preparation'); setRecommendationFocus(destination.recordId || ''); }
    onActionHandled();
  }, [focusAction]);
  const all = s.requirements.filter(r => r.projectId === project.id), prep = all.filter(r => r.necessity !== 'not_required' && r.applicability !== 'not_applicable');
  const chosen = prep.find(r => r.id === selected) || prep[0];
  const complete = prep.filter(r => s.progress.some(p => p.requirementId === r.id && p.status === 'ready')).length;
  const edit = (r?: Requirement) => { setEditing(r); setRequirementOpen(true); };
  return <div className="page project-page">
    <Button className="text-button back-button" onClick={onBack}><ArrowLeft size={15}/>全部学校</Button>
    <header className="project-heading"><Crest name={project.institution} color={project.color} large/><div className="grow"><span className="eyebrow">{project.institution} · {entryLabel(project)}</span><h1>{project.name}</h1><div className="row wrap gap-sm"><span className="muted small">{projectLabel(project)}</span><span className="muted small">·</span><span className="muted small">{complete} / {prep.length} 项已准备</span>{project.officialUrl && <Button className="text-button small" onClick={() => void task.run(() => window.desk.openExternal({ url: project.officialUrl }), '已打开官网')}>项目官网 <ArrowUpRight size={13}/></Button>}</div></div><div className="row wrap"><Button className="text-button" onClick={() => setCopyOpen(true)}>复制为新目标</Button><Button className="secondary" onClick={() => setProjectOpen(true)}>编辑项目</Button></div></header>
    <Feedback task={task}/>
    <nav className="project-tabs" aria-label="项目区域">{[
      { id: 'preparation' as const, title: '准备清单', description: '把要求变成行动', icon: ListChecks },
      { id: 'requirements' as const, title: '项目要求', description: '官方依据与研究', icon: BookOpen },
      { id: 'submission' as const, title: '提交与收件', description: '记录真正发生的事', icon: CheckCircle2 }
    ].map(item => <button key={item.id} className={tab === item.id ? 'selected' : ''} onClick={() => setTab(item.id)}><item.icon size={20}/><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</nav>
    {tab === 'preparation' && <>
      <div className="section-heading checklist-heading"><h2>一步步准备</h2><div className="row"><Button className="text-button" onClick={() => { setTab('requirements'); setResearch(true); }}><Sparkles size={15}/>研究官网</Button><Button className="secondary" onClick={() => edit()}><Plus size={15}/>添加事项</Button></div></div>
      {prep.length ? <div className={`workbench ${mobileDetail ? 'show-detail' : ''}`}><aside className="requirement-list"><div className="list-label">{prep.length} 项准备事项</div>{prep.map(r => {
        const progress = s.progress.find(p => p.requirementId === r.id), status = progress?.status || 'todo', next = s.actions.find(a => a.requirementId === r.id);
        return <button key={r.id} className={`requirement-row ${chosen?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r.id); setMobileDetail(true); }}><span className={`requirement-status ${status}`}>{status === 'ready' ? <Check size={14}/> : status === 'waiting' || status === 'deferred' ? <Clock3 size={15}/> : <Circle size={15}/>}</span><span className="grow"><strong>{r.title}</strong><small>{statusText[status]}{r.necessity === 'optional' ? ' · 选交' : r.necessity === 'unknown' ? ' · 必交性待核实' : ''}</small>{progress?.revisitOn ? <span className="row-caption">{shortDate(progress.revisitOn)}回访</span> : next?.reason && <span className="row-caption">{next.reason}</span>}</span><ChevronRight size={14}/></button>;
      })}</aside>{chosen && <RequirementDetail key={chosen.id} requirement={chosen} snapshot={s} onEdit={() => edit(chosen)} onBack={() => setMobileDetail(false)}/>}</div> :
      <Empty icon={<ListChecks size={31}/>} title="先把项目要求整理清楚" body="从官网研究并采用要求，或手动添加已确认的准备事项。" action={<div className="row"><Button className="primary" onClick={() => { setTab('requirements'); setResearch(true); }}><Search size={15}/>研究官方要求</Button><Button className="secondary" onClick={() => edit()}>手动添加</Button></div>}/>}
      <Recommendations project={project} snapshot={s} focusId={recommendationFocus} onFocused={() => setRecommendationFocus('')}/>
    </>}
    {tab === 'requirements' && <>
      <div className="requirements-toolbar"><div className="segmented"><button className={!research ? 'selected' : ''} onClick={() => setResearch(false)}>已采用的要求 <span>{all.length}</span></button><button className={research ? 'selected' : ''} onClick={() => setResearch(true)}>官网研究</button></div><Button className="secondary" onClick={() => edit()}><Plus size={14}/>手动添加</Button></div>
      {research ? <ResearchPanel project={project} snapshot={s} onSettings={onSettings}/> : all.length ? <div className="adopted-list">{all.map(r => <article className="adopted-requirement" key={r.id}><div className="row between wrap"><h3>{r.title}</h3><div className="row wrap gap-sm"><Badge tone={r.necessity === 'required' ? 'blue' : ''}>{necessityText[r.necessity]}</Badge><Badge tone={r.support === 'supported' ? 'green' : 'amber'}>{supportText[r.support]}</Badge><Button className="text-button" onClick={() => edit(r)}>编辑</Button></div></div><p>{r.summary}</p>{!!r.unresolvedFields?.length && <p className="inline-warning">待核对：{unresolvedText(r.unresolvedFields)}</p>}{r.condition && <p className="small">适用条件：{r.condition}</p>}<div className="row wrap"><span className="small limit-summary">{limitsText(r) || '长度限制待核实'}</span>{r.deadline && <span className="small">官方截止 {r.deadline}{r.deadlineTimezone && ` · ${r.deadlineTimezone}`}</span>}</div><Disclosure title={`原文与适用范围（${r.evidence.length}）`}><SourceList evidence={r.evidence}/></Disclosure><p className="muted small">要求版本 {r.revision}{r.userEdited ? ' · 含个人编辑' : ''}{r.necessity === 'not_required' ? ' · 不生成准备任务' : ''}</p></article>)}</div> : <Empty icon={<BookOpen size={30}/>} title="还没有采用的项目要求" body="官网研究结果会先保留为草稿，由你决定哪些要求接入准备流程。" action={<Button className="primary" onClick={() => setResearch(true)}>开始官网研究 <ArrowRight size={15}/></Button>}/>}
    </>}
    {tab === 'submission' && <SubmissionPanel project={project} snapshot={s}/>}
    <footer className="page-foot"><span>个人进度、官方要求、提交与收件分别记录。</span><Button className="text-button muted" onClick={() => void task.run(async () => { await window.desk.archiveProject({ id: project.id, archived: true, expectedRevision: project.revision }); onBack(); }, '项目已移出，可在设置中恢复')}><Archive size={14}/>移出计划</Button></footer>
    <ProjectEditor open={projectOpen} onClose={() => setProjectOpen(false)} project={project} cycle={project.cycle} snapshot={s}/>
    <ProjectEditor open={copyOpen} onClose={() => setCopyOpen(false)} copyFrom={project} cycle={s.workspace!.cycle} snapshot={s}/>
    <RequirementEditor key={editing?.id || 'new'} open={requirementOpen} onClose={() => setRequirementOpen(false)} project={project} requirement={all.find(r => r.id === editing?.id)} all={all}/>
  </div>;
}
