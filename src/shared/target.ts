import type { DegreeLevel, EntryTarget, Project } from './types';

export const degreeLabels: Record<DegreeLevel, string> = { undergraduate: '本科', master: '硕士', doctorate: '博士', unknown: '待确认' };
export function explicitLevel(value: string): DegreeLevel {
  const levels: Record<string, DegreeLevel> = { '本科': 'undergraduate', '硕士': 'master', '博士': 'doctorate', undergraduate: 'undergraduate', bachelor: 'undergraduate', master: 'master', doctorate: 'doctorate', doctoral: 'doctorate' };
  return levels[value.trim().toLowerCase()] || 'unknown';
}
export function entryLabel(target: EntryTarget): string {
  return target.entryYear ? `${target.entryYear} 年${target.entryMonth ? ` ${target.entryMonth} 月` : ''}入学` : '入学年份待确认';
}
export function projectLabel(project: Project): string {
  return `${degreeLabels[project.degreeLevel || 'unknown']}${project.degreeName ? ` · ${project.degreeName}` : ''} · ${entryLabel(project)}`;
}
export function targetKey(target: EntryTarget & { degreeLevel?: DegreeLevel; degreeName?: string }): string {
  return JSON.stringify([target.degreeLevel || 'unknown', target.degreeName || '', target.entryYear ?? null, target.entryMonth ?? null]);
}
export function projectScope(project: Project): string {
  return JSON.stringify({ version: 2, institution: project.institution, name: project.name, target: targetKey(project), degree: project.degree, cycle: project.cycle, officialUrl: project.officialUrl });
}
export function validateEntry(target: EntryTarget): EntryTarget {
  const entryYear = target.entryYear ?? null, entryMonth = target.entryMonth ?? null;
  if (entryYear !== null && (!Number.isInteger(entryYear) || entryYear < 1900 || entryYear > 9999)) throw new Error('请选择有效的四位入学年份。');
  if (entryMonth !== null && (!entryYear || !Number.isInteger(entryMonth) || entryMonth < 1 || entryMonth > 12)) throw new Error('入学月份需要有效年份和 1–12 月。');
  return { entryYear, entryMonth };
}
export function dateInZone(zone: string, offset = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
