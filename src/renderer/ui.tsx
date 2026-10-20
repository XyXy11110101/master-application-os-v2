import React, { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, CircleAlert, Loader2, X } from 'lucide-react';
import { Evidence, Necessity, ProgressStatus, Requirement, Support } from '../shared/types';
import { schoolBrand } from './branding';

const modalStack: symbol[] = [];
export const necessityText: Record<Necessity, string> = { required: '必交', conditional: '符合条件时提交', optional: '选交', not_required: '不要求', unknown: '必交性待核实' };
export const supportText: Record<Support, string> = { supported: '有来源依据', unknown: '待核实', conflict: '来源存在分歧' };
export const statusText: Record<ProgressStatus, string> = { todo: '还没开始', doing: '正在准备', ready: '准备好了', waiting: '正在等待', deferred: '稍后处理' };
export const unitText = { words: '词', characters: '字符', pages: '页', files: '份', seconds: '秒' };
export function unresolvedText(fields: string[] = []) {
  return [...new Set(fields.map(field => field === 'application_cycle' ? '目标入学年份' : field === 'entry_month' ? '入学批次' : field === 'scope' ? '项目适用范围' : field.startsWith('limits') ? '长度限制' : field.startsWith('deadline') ? '截止日期' : field === 'necessity' ? '必交性' : field === 'condition' ? '适用条件' : '要求细节'))].join('、');
}
export function shortDate(value: string) {
  if (!value) return '日期待确认';
  const d = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  return d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : value;
}
export function limitsText(r: Pick<Requirement, 'limits'>) {
  return r.limits.map(l => `${l.nature === 'maximum' ? '最多' : l.nature === 'minimum' ? '至少' : '建议'} ${l.value} ${unitText[l.unit]}`).join(' · ');
}
export function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const running = useRef(false);
  const run = async (fn: () => Promise<unknown>, success = '已保存') => {
    if (running.current) return false;
    running.current = true; setBusy(true); setError(''); setMessage('');
    try { const result = await fn(); if (result !== false) setMessage(success); return true; }
    catch (e) { setError(errorText(e)); return false; }
    finally { running.current = false; setBusy(false); }
  };
  return { busy, error, message, run, clear: () => { setError(''); setMessage(''); } };
}
export function Feedback({ task }: { task: ReturnType<typeof useTask> }) {
  return <div className="feedback" aria-live="polite">
    {task.busy ? <span><Loader2 size={14} className="spin" /> 正在保存…</span> : task.error ? <span className="error"><CircleAlert size={15} />{task.error}</span> : task.message ? <span className="success"><Check size={14} />{task.message}</span> : null}
  </div>;
}
export function Button({ children, className = '', busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button type="button" className={`button ${className}`} {...props} disabled={props.disabled || busy}>
    {busy && <Loader2 size={15} className="spin" />}{children}
  </button>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const controls = React.Children.map(children, child => {
    if (!React.isValidElement(child) || typeof child.type !== 'string' || !['input', 'select', 'textarea'].includes(child.type)) return child;
    return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, { 'aria-labelledby': `${id}-label`, 'aria-describedby': hint ? `${id}-hint` : undefined });
  });
  return <label className="field"><span id={`${id}-label`} className="field-label">{label}</span>{controls}{hint && <span id={`${id}-hint`} className="field-hint">{hint}</span>}</label>;
}
export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state">{icon && <div className="empty-icon">{icon}</div>}<h3>{title}</h3><p>{body}</p>{action}</div>;
}
export function Modal({ open, title, subtitle, onClose, children, wide = false }: {
  open: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    modalStack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const target = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
      (target || ref.current)?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (modalStack.at(-1) !== token) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter(n => n.offsetParent !== null);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); const index = modalStack.indexOf(token); if (index >= 0) modalStack.splice(index, 1); previous?.focus(); };
  }, [open]);
  return <div className="modal-backdrop" hidden={!open} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} className={`modal ${wide ? 'wide' : ''}`}>
      <header className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><Button className="icon-button modal-close" aria-label="关闭" onClick={onClose}><X size={20}/></Button></header>
      {children}
    </div>
  </div>;
}
export function SourceList({ evidence }: { evidence: Evidence[] }) {
  const task = useTask();
  if (!evidence.length) return <p className="muted small">暂未附上可核对的来源。</p>;
  return <div className="sources">{evidence.map((e, i) => <article className="source" key={`${e.id}-${i}`}>
    <div className="row between"><strong>{e.title || '来源原文'}</strong>
      {e.url && <Button className="text-button" onClick={() => void task.run(() => window.desk.openExternal({ url: e.url }), '已在浏览器中打开来源')}>查看官网 <ArrowUpRight size={13}/></Button>}
    </div>
    {e.quote && <blockquote>{e.quote}</blockquote>}
    <p className="muted small">{e.scope}{e.locator && ` · ${e.locator}`}{e.fetchedAt && ` · 获取于 ${e.fetchedAt.slice(0, 10)}`}</p>
  </article>)}<Feedback task={task}/></div>;
}
export function Disclosure({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="disclosure" open={open || undefined}><summary><ChevronRight size={15}/>{title}</summary><div className="disclosure-body">{children}</div></details>;
}
export function Form({ children, onSubmit, className = '' }: { children: ReactNode; onSubmit: () => void | Promise<unknown>; className?: string }) {
  return <form className={className} onSubmit={(e: FormEvent) => { e.preventDefault(); void onSubmit(); }}>{children}</form>;
}
export function Crest({ name, color, large = false }: { name: string; color: string; large?: boolean }) {
  const brand = schoolBrand(name);
  const [failedSource, setFailedSource] = useState('');
  if (brand && failedSource !== brand.image) {
    return <div className={`school-logo-frame ${large ? 'large' : ''} ${brand.wide ? 'wide' : ''}`}><img src={brand.image} alt={`${name} 校徽`} draggable={false} onError={() => setFailedSource(brand.image)}/></div>;
  }
  const latin = name.match(/[A-Za-z]+/g);
  const initials = latin?.length ? latin.slice(0, 2).map(p => p[0]).join('').toUpperCase() : name.slice(0, 2);
  return <div className={`crest ${large ? 'large' : ''}`} style={{ '--school-color': color || '#38736b' } as React.CSSProperties}><span>{initials}</span></div>;
}
