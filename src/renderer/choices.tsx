import React, { useId, useState } from 'react';
import type { EntryTarget } from '../shared/types';
import { dateInZone } from '../shared/target';
import { Button, Field } from './ui';

export function EntryFields({ value, onChange, required = false }: { value: EntryTarget; onChange: (value: EntryTarget) => void; required?: boolean }) {
  const year = new Date().getFullYear();
  const options = Array.from({ length: 7 }, (_, i) => year - 1 + i);
  const [custom, setCustom] = useState(!!value.entryYear && !options.includes(value.entryYear));
  const outside = !!value.entryYear && !options.includes(value.entryYear);
  return <div className="form-grid"><div>
    <Field label="目标入学年份"><select value={custom || outside ? 'custom' : value.entryYear || ''} required={required} onChange={e => {
      if (e.target.value === 'custom') { setCustom(true); onChange({ ...value, entryYear: null }); }
      else { setCustom(false); onChange({ ...value, entryYear: e.target.value ? Number(e.target.value) : null, ...(!e.target.value ? { entryMonth: null } : {}) }); }
    }}><option value="">尚未确定</option>{options.map(y => <option key={y} value={y}>{y} 年入学</option>)}<option value="custom">其他年份…</option></select></Field>
    {(custom || outside) && <Field label="自定义入学年份"><input type="number" min={1900} max={9999} step={1} required value={value.entryYear ?? ''} onChange={e => onChange({ ...value, entryYear: e.target.value ? Number(e.target.value) : null })}/></Field>}
  </div><Field label="入学月份（可选）"><select value={value.entryMonth || ''} disabled={!value.entryYear} onChange={e => onChange({ ...value, entryMonth: e.target.value ? Number(e.target.value) : null })}><option value="">尚未确定</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 月</option>)}</select></Field></div>;
}
const cities: Record<string, string> = { 'Europe/London': '伦敦', 'Asia/Shanghai': '北京 / 上海', 'Asia/Hong_Kong': '香港', 'Asia/Tokyo': '东京', 'Asia/Singapore': '新加坡', 'America/New_York': '纽约', 'America/Los_Angeles': '洛杉矶', 'America/Chicago': '芝加哥', 'America/Toronto': '多伦多', 'America/Vancouver': '温哥华', 'Europe/Paris': '巴黎', 'Europe/Berlin': '柏林', 'Australia/Sydney': '悉尼', 'Australia/Melbourne': '墨尔本', 'Pacific/Auckland': '奥克兰', UTC: '协调世界时' };
const zones = [...new Set([Intl.DateTimeFormat().resolvedOptions().timeZone, ...Object.keys(cities), ...Intl.supportedValuesOf('timeZone')])];
const zoneLabel = (zone: string) => `${cities[zone] || zone.split('/').at(-1)!.replace(/_/g, ' ')} · ${zone}`;
export function TimezoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = zones.filter(z => `${zoneLabel(z)} ${z.replace(/_/g, ' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="timezone-choice"><Field label="搜索城市或时区"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="例如：伦敦、上海、New York"/></Field><Field label="个人时区" hint="用于个人等待和回访，不替代官方截止时区。"><select value={value} onChange={e => onChange(e.target.value)} required>{[...new Set([value, ...matches])].map(zone => <option key={zone} value={zone}>{zoneLabel(zone)}</option>)}</select></Field>{query && !matches.length && <p className="muted small">没有匹配时区，请换一个城市名。</p>}</div>;
}
export function PersonalDate({ label, value, onChange, timezone, today = false, required = false }: { label: string; value: string; onChange: (value: string) => void; timezone: string; today?: boolean; required?: boolean }) {
  const id = useId();
  return <div><Field label={label}><input id={id} type="date" value={value} onChange={e => onChange(e.target.value)} required={required}/></Field><div className="date-shortcuts">{(today ? [[0, '今天']] : [[1, '明天'], [3, '3 天后'], [7, '一周后']]).map(([offset, title]) => <Button key={offset} className="text-button small" onClick={() => onChange(dateInZone(timezone, Number(offset)))}>{title}</Button>)}<Button className="text-button small" onClick={() => { const el = document.getElementById(id) as HTMLInputElement; el.focus(); try { el.showPicker(); } catch { /* Keyboard editing remains available. */ } }}>自定义</Button></div></div>;
}
