import React, { useEffect, useState } from 'react';
import { ArchiveRestore, ArrowRight, Database, Download, FolderInput, KeyRound, Plus, ShieldCheck, Sparkles, Upload, UserRound } from 'lucide-react';
import { ApiSettingsInput, LegacyPreview, Snapshot } from '../shared/types';
import { isOfficialDeepSeek } from '../shared/api';
import { Badge, Button, Disclosure, Feedback, Field, Form, Modal, useTask } from './ui';
import { ContactEditor } from './forms';
import { entryLabel } from '../shared/target';
import { EntryFields, TimezoneField } from './choices';
import { useDraft, useSessionState } from './session';

export function SettingsPage({ snapshot: s, initialSection = 'workspace' }: { snapshot: Snapshot; initialSection?: string }) {
  const [section, setSection] = useSessionState('settings:section', initialSection);
  useEffect(() => { if (initialSection === 'api') setSection(initialSection); }, [initialSection]);
  return <div className="page settings-page">
    <header className="page-heading"><div><span className="eyebrow">按你的方式准备</span><h1>设置</h1><p>资料在你的电脑里，联网和模型服务由你掌控。</p></div></header>
    <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类">{[['workspace', '工作区与偏好', <UserRound size={17}/>], ['api', '模型服务', <Sparkles size={17}/>], ['data', '导入与备份', <Database size={17}/>]].map(([key, title, icon]) => <button className={section === key ? 'selected' : ''} key={String(key)} onClick={() => setSection(String(key))}>{icon}{title}</button>)}</nav>
      <div className="settings-content">
        <div hidden={section !== 'workspace'}><WorkspaceSettings snapshot={s}/></div>
        <div hidden={section !== 'api'}><ApiSettingsPanel snapshot={s}/></div>
        <div hidden={section !== 'data'}><DataSettings snapshot={s}/></div>
      </div>
    </div>
  </div>;
}
function WorkspaceSettings({ snapshot: s }: { snapshot: Snapshot }) {
  const preferences = useDraft('workspace', () => ({ entryYear: s.workspace?.entryYear ?? null, entryMonth: s.workspace?.entryMonth ?? null, timezone: s.workspace?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, expectedRevision: s.workspace?.revision || 0 }));
  const draft = preferences.value;
  const task = useTask(), switching = useTask();
  const [contactOpen, setContactOpen] = useState(false), [editingContact, setEditingContact] = useState<string | undefined>();
  return <>
    <section className="settings-section"><div className="section-heading"><h2>你的工作区</h2><Badge tone={s.workspace?.demo ? 'amber' : 'green'}>{s.workspace?.demo ? '虚构演示' : '个人工作区'}</Badge></div>
      <Form onSubmit={() => task.run(async () => { await window.desk.saveWorkspace({ ...draft, cycle: entryLabel(draft) }); const next = await window.desk.getSnapshot(); preferences.saved({ ...draft, expectedRevision: next.workspace!.revision }); })}>
        <EntryFields value={draft} onChange={value => preferences.set(d => ({ ...d, ...value }))}/><TimezoneField value={draft.timezone} onChange={timezone => preferences.set(d => ({ ...d, timezone }))}/>
        <p className="muted small">默认入学时间只用于新增项目，已有项目保持自己的目标。</p>
        <div className="save-bar"><Button type="submit" className="primary" busy={task.busy}>保存偏好</Button><Feedback task={task}/>{preferences.dirty && <Button onClick={preferences.discard}>放弃修改</Button>}</div>
      </Form>
      <div className="setting-row"><div><strong>{s.workspace?.demo ? '进入个人工作区' : '体验虚构演示'}</strong><p>两个工作区相互隔离，切换不会删除资料。</p></div><Button className="secondary" busy={switching.busy} onClick={() => void switching.run(() => window.desk.switchWorkspace({ demo: !s.workspace?.demo }), '已切换工作区')}>切换 <ArrowRight size={15}/></Button></div><Feedback task={switching}/>
    </section>
    <section className="settings-section"><div className="section-heading"><div><h2>推荐人联系人</h2><p className="muted small">联系方式在本机保存，可关联不同项目。</p></div><Button className="secondary" onClick={() => { setEditingContact(undefined); setContactOpen(true); }}><Plus size={15}/>添加</Button></div>
      {s.contacts.length === 0 ? <p className="muted">暂时没有联系人。</p> : s.contacts.map(c => <button className="contact-row" key={c.id} onClick={() => { setEditingContact(c.id); setContactOpen(true); }}><span className="avatar">{c.name.slice(0, 1)}</span><span><strong>{c.name}</strong><small>{c.email || '尚未填写邮箱'}</small></span></button>)}
      <ContactEditor key={editingContact || 'new'} open={contactOpen} onClose={() => setContactOpen(false)} contact={s.contacts.find(c => c.id === editingContact)}/>
    </section>
    <section className="settings-section"><h2>使用边界</h2><div className="quiet-note"><ShieldCheck size={21}/><p>本版不会生成申请文书、自动网申或读取邮箱。核心清单、文件管理和提交记录无需 AI；通知暂未启用。</p></div></section>
  </>;
}
function ApiSettingsPanel({ snapshot: s }: { snapshot: Snapshot }) {
  const apiDraft = useDraft<ApiSettingsInput>('api', () => ({ baseUrl: s.apiSettings.baseUrl || '', model: s.apiSettings.model || '', thinkingMode: s.apiSettings.thinkingMode ?? 'provider_default', key: '', expectedRevision: s.apiSettings.revision }));
  const draft = apiDraft.value, setDraft = apiDraft.set;
  const task = useTask(), testing = useTask();
  return <>
    <section className="settings-section"><div className="section-heading"><h2>项目研究 API</h2><Badge tone={s.apiSettings.hasKey ? 'green' : ''}>{s.apiSettings.hasKey ? '已保存凭据' : '尚未配置'}</Badge></div><p className="muted">使用兼容接口的服务地址、模型名称和你自己的密钥。</p>
      <Form onSubmit={() => task.run(async () => { await window.desk.saveApiSettings({ ...draft, key: draft.key || undefined }); const next = await window.desk.getSnapshot(); apiDraft.saved({ ...draft, key: '', expectedRevision: next.apiSettings.revision }); }, '模型设置已保存')}>
        <Field label="服务地址"><input type="url" value={draft.baseUrl} onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))} placeholder="https://your-provider.example/v1" autoComplete="off" required/></Field>
        <Field label="模型名称"><input value={draft.model} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} placeholder="服务商提供的模型标识" autoComplete="off" required/></Field>
        {isOfficialDeepSeek(draft.baseUrl) && <Field label="思考模式" hint="连接测试和官网研究使用同一模式。服务默认可能随服务商调整。"><select value={draft.thinkingMode ?? 'provider_default'} onChange={e => setDraft(d => ({ ...d, thinkingMode: e.target.value as ApiSettingsInput['thinkingMode'] }))}><option value="provider_default">服务默认</option><option value="disabled">关闭</option><option value="enabled">开启</option></select></Field>}
        <Field label="API 密钥" hint={s.apiSettings.hasKey ? '留空保留已保存的密钥；输入新密钥可替换。' : '密钥独立加密保存，不进入备份和导出文件。'}><input type="password" value={draft.key || ''} onChange={e => setDraft(d => ({ ...d, key: e.target.value }))} placeholder={s.apiSettings.hasKey ? '已保存，输入以替换' : '粘贴密钥'} autoComplete="new-password"/></Field>
        <div className="save-bar"><Button className="primary" type="submit" busy={task.busy}><KeyRound size={15}/>保存设置</Button><Feedback task={task}/>{apiDraft.dirty && <Button onClick={apiDraft.discard}>放弃修改</Button>}</div>
      </Form>
      <div className="setting-row"><div><strong>测试已保存的连接</strong><p>发送一条小请求，可能产生 API 费用。</p></div><Button className="secondary" disabled={!s.apiSettings.hasKey} busy={testing.busy} onClick={() => void testing.run(async () => { const result = await window.desk.testApi(); if (!result.message) throw new Error('服务未返回测试结果'); }, '连接测试通过')}>测试连接</Button></div><Feedback task={testing}/>
    </section>
    <section className="settings-section"><h2>研究的范围与用量</h2><dl className="facts spacious"><dt>发送内容</dt><dd>研究所需的官方公开文本</dd><dt>个人资料</dt><dd>不自动上传背景、成绩单或文书</dd><dt>单轮上限</dt><dd>30 页 / 12 次模型调用 / 15 分钟</dd><dt>结果采用</dt><dd>模型只产生草稿，由你选择接入项目</dd><dt>继续研究</dt><dd>需要主动操作；重启不会自动付费续查</dd></dl></section>
  </>;
}
export function LegacyImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<LegacyPreview | null>(null), [keys, setKeys] = useState<string[]>([]);
  const task = useTask(), importing = useTask();
  return <Modal open={open} onClose={onClose} title="导入旧版项目名单" subtitle="只带入学校、项目、官网和申请季，要求和准备进度重新建立。" wide>
    <Form onSubmit={() => task.run(async () => { const p = await window.desk.previewLegacy(path.trim() ? { path: path.trim() } : undefined); setPreview(p); setKeys(p.entries.filter(e => !e.archived).map(e => e.key)); }, '名单已读取，请选择要导入的项目')}>
      <div className="row end align-end"><Field label="旧版工作区目录"><input value={path} onChange={e => { setPath(e.target.value); setPreview(null); }} placeholder="留空查找当前用户目录下的旧工作区"/></Field><Button className="secondary" type="submit" busy={task.busy}>读取名单</Button></div><Feedback task={task}/>
    </Form>
    {preview && <>
      <p className="muted small break-anywhere">来源：{preview.source}</p>
      {preview.warnings.length > 0 && <div className="inline-warning"><ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      <div className="legacy-list">{preview.entries.map(entry => <label className="legacy-row" key={entry.key}><input type="checkbox" checked={keys.includes(entry.key)} onChange={e => setKeys(v => e.target.checked ? [...v, entry.key] : v.filter(k => k !== entry.key))}/><span className="grow"><strong>{entry.institution} · {entry.name}</strong><small>{entry.degree} · {entry.cycle}{entry.warning && ` · ${entry.warning}`}</small></span>{entry.archived && <Badge>已移出，导入后仍移出</Badge>}</label>)}</div>
      <footer className="modal-footer"><Feedback task={importing}/><span className="muted small">已选 {keys.length} 个项目</span><Button onClick={onClose}>关闭</Button><Button className="primary" disabled={!keys.length} busy={importing.busy} onClick={() => void importing.run(async () => { await window.desk.importLegacy({ source: preview.source, keys }); onClose(); }, '名单已导入')}><FolderInput size={16}/>导入所选项目</Button></footer>
    </>}
  </Modal>;
}
function DataSettings({ snapshot: s }: { snapshot: Snapshot }) {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const backup = useTask(), restore = useTask(), archive = useTask();
  const [backupPath, setBackupPath] = useState(''), [restorePath, setRestorePath] = useState('');
  const removed = s.projects.filter(p => p.archived);
  return <>
    <section className="settings-section"><h2>项目名单</h2><div className="setting-row"><div><strong>从旧版带入目标项目</strong><p>先预览再选择；已移出项目保持移出，重复导入不新增副本。</p></div><Button className="secondary" onClick={() => setLegacyOpen(true)}><FolderInput size={15}/>导入名单</Button></div><LegacyImport open={legacyOpen} onClose={() => setLegacyOpen(false)}/></section>
    <section className="settings-section"><h2>工作区备份</h2><p className="muted">保存要求、证据、准备进度和托管文件副本。API 密钥不包含在备份中。</p>
      <div className="setting-row"><div><strong>导出完整备份</strong><p>你可以选择保存位置，独立保留一份资料。</p></div><Button className="secondary" busy={backup.busy} onClick={() => void backup.run(async () => { const r = await window.desk.createBackup(); if (r) setBackupPath(r.path); }, '备份操作已结束')}><Download size={15}/>创建备份</Button></div><Feedback task={backup}/>{backupPath && <p className="small muted break-anywhere">{backupPath}</p>}
      <div className="setting-row"><div><strong>从备份恢复</strong><p>校验后恢复到独立工作区，保留当前工作区。</p></div><Button className="secondary" busy={restore.busy} onClick={() => void restore.run(async () => { const r = await window.desk.restoreBackup(); if (r) setRestorePath(r.path); }, '恢复操作已结束')}><Upload size={15}/>选择备份</Button></div><Feedback task={restore}/>{restorePath && <p className="small muted break-anywhere">{restorePath}</p>}
    </section>
    <section className="settings-section"><h2>已移出的项目</h2>{removed.length ? removed.map(p => <div className="setting-row" key={p.id}><div><strong>{p.institution} · {p.name}</strong><p>{p.cycle}</p></div><Button className="text-button" busy={archive.busy} onClick={() => void archive.run(() => window.desk.archiveProject({ id: p.id, archived: false, expectedRevision: p.revision }), '项目已恢复')}><ArchiveRestore size={15}/>恢复</Button></div>) : <p className="muted">没有已移出的项目。</p>}<Feedback task={archive}/></section>
    <Disclosure title="本机数据位置"><p className="small break-anywhere">{s.dataPath}</p><p className="muted small">程序与个人资料分开保存，卸载程序不会自动删除工作区。</p></Disclosure>
  </>;
}
