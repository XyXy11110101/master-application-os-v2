import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import type { CheckResult, MaterialVersion, ParsedDocument, Requirement } from '../shared/types';

const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;
// Preserve native ESM loading when the Electron main/utility bundle is CommonJS.
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export async function parsePdfBuffer(buffer: Uint8Array): Promise<ParsedDocument> {
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error('PDF 超过 30 MB，请使用较小的文件。');
  const pdfRoot = process.env.DESK_PDFJS_ROOT || path.dirname(require.resolve('pdfjs-dist/package.json'));
  const pdfPath = path.join(pdfRoot, 'legacy/build/pdf.mjs');
  const workerPath = path.join(pdfRoot, 'legacy/build/pdf.worker.mjs');
  const pdfjs = await nativeImport(pathToFileURL(pdfPath).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  const loading = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
    stopAtErrors: true,
  });
  const doc = await loading.promise;
  try {
    if (doc.numPages > 300) throw new Error('PDF 超过 300 页，请先拆分需要检查的内容。');
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim());
    }
    return {
      text: pages.join('\n\n').trim(),
      pages: doc.numPages,
      notes: ['PDF 词数来自可提取的文字；分栏、页眉和断词可能影响统计。扫描图片不自动 OCR。'],
    };
  } finally {
    await loading.destroy();
  }
}

export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('请选择文件。');
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('文件超过 30 MB，请使用较小的文件。');
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);
  if (extension === '.pdf') return parsePdfBuffer(buffer);
  if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
    const hasBom = buffer[0] === 0xff && buffer[1] === 0xfe;
    const text = hasBom ? buffer.subarray(2).toString('utf16le') : buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (text.includes('\u0000')) throw new Error('无法将这个文件可靠地读取为文本，请另存为 UTF-8 TXT。');
    return {
      text: text.replace(/\r\n?/g, '\n').trim(),
      pages: null,
      notes: [extension === '.md' || extension === '.markdown' ? 'Markdown 按原始文本统计，包含标题和标记。' : '文本文件没有固定页数。'],
    };
  }
  if (extension === '.docx') {
    const archive = new AdmZip(buffer);
    const inflated = archive.getEntries().reduce((sum, entry) => sum + entry.header.size, 0);
    if (inflated > 100 * 1024 * 1024) throw new Error('文档解压后过大，无法安全读取。');
    const document = archive.getEntry('word/document.xml');
    if (!document) throw new Error('DOCX 缺少正文，无法可靠读取。');
    const extractXml = (xml: string) => {
      const $ = cheerio.load(xml, { xmlMode: true });
      return $('w\\:p').map((_, paragraph) => $(paragraph).find('w\\:t,w\\:tab,w\\:br').map((__, element) => {
        if (element.tagName === 'w:tab') return '\t';
        if (element.tagName === 'w:br') return '\n';
        return $(element).text();
      }).get().join('')).get().join('\n');
    };
    const parts = [extractXml(document.getData().toString('utf8'))];
    for (const filename of ['word/footnotes.xml', 'word/endnotes.xml']) {
      const entry = archive.getEntry(filename);
      if (entry) parts.push(extractXml(entry.getData().toString('utf8')));
    }
    return {
      text: parts.join('\n').trim(),
      pages: null,
      notes: ['DOCX 统计正文、表格及脚注/尾注文字，不含页眉页脚。修订标记或文本框可能影响统计，请以最终导出版核对。',
        'DOCX 页数取决于字体和排版，本地文本读取不能可靠确认页数。'],
    };
  }
  throw new Error('本地检查支持 TXT、Markdown、DOCX 和可提取文字的 PDF。');
}

export function countWords(text: string): number {
  // Hyphenated English words and apostrophes stay together. CJK counts are explicitly estimates.
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? [];
  const other = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ');
  const words = other.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’‐‑-]*/gu) ?? [];
  return cjk.length + words.length;
}

export function checkDocument(requirement: Requirement, version: MaterialVersion, parsed: ParsedDocument): CheckResult {
  const text = parsed.text.trim();
  const issues: string[] = [];
  const notes = [...parsed.notes];
  const words = text ? countWords(text) : null;
  const characters = text ? Array.from(text).length : null;
  if (!text) {
    return {
      id: randomUUID(), requirementId: requirement.id, versionId: version.id,
      requirementRevision: requirement.revision, checkedAt: new Date().toISOString(),
      words: null, characters: null, pages: parsed.pages,
      issues: ['没有可靠提取到文字，无法判断是否满足长度要求。'], notes,
      status: 'unreadable',
    };
  }
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
    notes.push('含中日韩文字：词数按汉字/假名逐字及英文词组估算，请以学校指定统计口径为准。');
  }
  notes.push('字符数包含空格和文本中的换行；首尾空白不计。只检查已知长度，不代表内容、字体或申请材料合格。');
  if (requirement.support !== 'supported') issues.push('这项要求仍有待核实或冲突，当前检查不能确认符合官方要求。');
  if (requirement.unresolvedFields?.length) {
    issues.push('官方来源之间仍有未解决的字段差异；本次统计不能确认材料符合要求，请先查看来源并解决差异。');
  }
  if (requirement.applicability === 'unknown' && requirement.necessity === 'conditional') {
    notes.push('个人是否适用该条件仍待确认。');
  }
  const labels = { words: '词', characters: '字符', pages: '页', files: '份文件', seconds: '秒' };
  if (!requirement.limits.length) notes.push('尚未记录可检查的长度限制，统计结果不能作为长度合规结论。');
  for (const limit of requirement.limits) {
    const measured = limit.unit === 'words' ? words : limit.unit === 'characters' ? characters : limit.unit === 'pages' ? parsed.pages : null;
    if (measured === null) {
      notes.push(`无法在本次检查中确认 ${limit.value} ${labels[limit.unit]}的限制。`);
      if (limit.nature !== 'recommended') issues.push(`${labels[limit.unit]}要求尚无法可靠检查，需要人工核对。`);
      continue;
    }
    if (limit.nature === 'recommended') {
      notes.push(`官方建议 ${limit.value} ${labels[limit.unit]}；建议不作为强制通过条件。`);
    } else if (limit.nature === 'maximum' && measured > limit.value) {
      issues.push(`超出上限：${measured} / ${limit.value} ${labels[limit.unit]}。`);
    } else if (limit.nature === 'minimum' && measured < limit.value) {
      issues.push(`低于下限：${measured} / ${limit.value} ${labels[limit.unit]}。`);
    }
  }
  return {
    id: randomUUID(), requirementId: requirement.id, versionId: version.id,
    requirementRevision: requirement.revision, checkedAt: new Date().toISOString(),
    words, characters, pages: parsed.pages, issues, notes,
    status: issues.length ? 'issues' : 'within_known_limits',
  };
}

export function documentFingerprint(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
