import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parse } from 'yaml';
import type { LegacyEntry, LegacyPreview } from '../shared/types';

export const DEFAULT_LEGACY_SOURCE = path.join(os.homedir(), 'master-application-os');

function text(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const result = String(value).trim();
  return /^(unknown|null|undefined|n\/a)$/i.test(result) ? '' : result;
}

/** Read identities only. Never import requirement, material, or application facts. */
export function previewLegacy(source = DEFAULT_LEGACY_SOURCE): LegacyPreview {
  const absolute = path.resolve(source);
  const directory = path.join(absolute, 'canonical', 'programs');
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error('没有找到旧工作区的 canonical/programs 文件夹，请选择旧工作区根目录。');
  }
  const canonical = fs.realpathSync(absolute);
  const sourceId = crypto.createHash('sha256').update(canonical.toLocaleLowerCase()).digest('hex').slice(0, 16);
  const entries: LegacyEntry[] = [];
  const warnings: string[] = [];
  for (const filename of fs.readdirSync(directory).sort()) {
    if (!/\.ya?ml$/i.test(filename)) continue;
    try {
      const filepath = path.join(directory, filename);
      if (fs.lstatSync(filepath).isSymbolicLink()) throw new Error('不读取符号链接');
      if (fs.statSync(filepath).size > 1024 * 1024) throw new Error('文件过大');
      const value = parse(fs.readFileSync(filepath, 'utf8'), { maxAliasCount: 20 }) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('格式不是项目记录');
      const id = text(value.id);
      const institution = text(value.institution);
      const name = text(value.program_name);
      if (!id || !institution || !name) throw new Error('缺少项目编号、学校或项目名称');
      const officialUrl = text(value.official_url);
      let verifiedUrl = officialUrl;
      if (officialUrl) {
        try {
          const parsed = new URL(officialUrl);
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) verifiedUrl = '';
        } catch { verifiedUrl = ''; }
      }
      const cycle = text(value.application_cycle);
      const warning = [!verifiedUrl && '官网待补充', !cycle && '申请季待补充'].filter(Boolean).join('；');
      entries.push({
        key: `${sourceId}:${id}`, institution, name, degree: text(value.degree),
        officialUrl: verifiedUrl, cycle,
        archived: value.pool_status === 'removed_from_core_pool',
        warning,
      });
    } catch (error) {
      warnings.push(`${filename}：${error instanceof Error ? error.message : '无法读取'}`);
    }
  }
  const seen = new Set<string>();
  return {
    source: canonical,
    entries: entries.filter(entry => {
      if (seen.has(entry.key)) {
        warnings.push(`项目编号重复：${entry.name}，仅保留第一条。`);
        return false;
      }
      seen.add(entry.key);
      return true;
    }),
    warnings,
  };
}
