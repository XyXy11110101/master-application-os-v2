/**
 * Public-source smoke only. Does not load API settings, credentials or applicant data.
 * Usage: npx tsx scripts/retrieval-smoke.ts <legacy-repository-root>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { allowedOfficialUrl, extractHtml, selectSourceText } from '../src/research/engine';
import type { Project } from '../src/shared/types';

interface PageResult {
  requestedUrl: string; finalUrl: string; status: number | null; title: string;
  textCharacters: number; hasUsefulText: boolean; links: Array<{ url: string; label: string; score: number }>;
  selectedCharacters?: number; excerptPartial?: boolean; targetProgrammeMentioned?: boolean;
  error?: string;
}
async function retrieve(url: string, project: Project, directory: string): Promise<PageResult> {
  const base: PageResult = {
    requestedUrl: url, finalUrl: url, status: null, title: '', textCharacters: 0, hasUsefulText: false, links: [],
  };
  try {
    for (let redirect = 0; redirect < 6; redirect++) {
      if (!allowedOfficialUrl(base.finalUrl, project.officialUrl)) throw new Error('Redirect left the official university domain.');
      const response = await fetch(base.finalUrl, {
        redirect: 'manual', signal: AbortSignal.timeout(25000),
        headers: { 'User-Agent': 'ApplicationDesk/0.1 (public retrieval smoke)', Accept: 'text/html' },
      });
      base.status = response.status;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Redirect had no location.');
        base.finalUrl = new URL(location, base.finalUrl).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}; not treated as application content.`);
      }
      const type = response.headers.get('content-type') || '';
      if (!type.includes('html')) {
        await response.body?.cancel();
        throw new Error(`This HTML smoke does not inspect ${type || 'unknown content type'}.`);
      }
      const html = await response.text();
      if (html.length > 12 * 1024 * 1024) throw new Error('HTML exceeded smoke size limit.');
      const source = extractHtml(html, base.finalUrl, project);
      base.title = source.title;
      base.textCharacters = source.text.length;
      base.hasUsefulText = source.text.length > 300 &&
        /admission|application|apply|requirements|entry|graduate/i.test(source.text) &&
        !/checking your browser|verify you are human|access denied/i.test(source.text.slice(0, 1200));
      base.links = source.links;
      const selected = selectSourceText(source.text, project);
      base.selectedCharacters = selected.text.length;
      base.excerptPartial = selected.partial;
      base.targetProgrammeMentioned = project.name.toLowerCase().split(/[^a-z]+/).filter(t => t.length > 4)
        .filter(token => selected.text.toLowerCase().includes(token)).length >= 2;
      await fs.writeFile(path.join(directory, `${source.hash}.json`), JSON.stringify({
        url: source.url, title: source.title, fetchedAt: source.fetchedAt,
        text: source.text, links: source.links, hash: source.hash,
      }, null, 2));
      return base;
    }
    throw new Error('Too many redirects.');
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
    return base;
  }
}
async function main() {
  const legacyRoot = process.argv[2];
  if (!legacyRoot) throw new Error('Provide the old repository root. This script only reads project identity fields.');
  const outputRoot = path.resolve('artifacts/retrieval-smoke');
  await fs.mkdir(outputRoot, { recursive: true });
  const keys = ['stanford_ldt', 'harvard_hde', 'ucl_msc_psych_ed'];
  const projects: Project[] = [];
  for (const key of keys) {
    const data = YAML.parse(await fs.readFile(path.join(legacyRoot, 'canonical/programs', `${key}.yaml`), 'utf8'));
    projects.push({
      id: data.id, institution: data.institution, name: data.program_name,
      degree: data.degree, officialUrl: data.official_url, cycle: data.application_cycle,
      color: '#547261', archived: false, revision: 1,
    });
  }
  const results = await Promise.all(projects.map(async project => {
    const initial = await retrieve(project.officialUrl, project, outputRoot);
    const followups = initial.links
      .filter(link => link.url !== initial.finalUrl && !/scholarship|funding|financial|tuition|fees|phd|doctoral|undergraduate/i.test(`${link.label} ${link.url}`))
      .filter((link, index, all) => all.findIndex(other => other.url === link.url) === index)
      .slice(0, 2);
    const pages = [initial, ...await Promise.all(followups.map(link => retrieve(link.url, project, outputRoot)))];
    const links = pages.flatMap(page => page.links).filter((link, index, all) => all.findIndex(other => other.url === link.url) === index);
    const result = {
      project: { institution: project.institution, name: project.name, degree: project.degree, officialUrl: project.officialUrl, cycle: project.cycle },
      pages, discoveredOfficialLinks: links.length,
      centralPolicyCandidates: links.filter(link => /graduate|policy|policies|requirements|language|english|transcript|recommend/i.test(`${link.label} ${link.url}`)).slice(0, 12),
    };
    console.log(JSON.stringify({ institution: project.institution, pages: pages.length,
      usefulPages: pages.filter(p => p.hasUsefulText).length, discoveredOfficialLinks: links.length,
      errors: pages.filter(p => p.error).map(p => ({ url: p.requestedUrl, error: p.error })) }));
    return result;
  }));
  const report = {
    recordedAt: new Date().toISOString(),
    method: 'Real public HTTP retrieval and production extractHtml helper; up to two discovered follow-up links per seed. No model, API configuration or credentials accessed.',
    modelCalls: 0,
    limitations: [
      'Retrieval smoke is not research quality or application-fact verification.',
      'Sources may describe a different cycle; this run does not adopt requirements or assert current-cycle applicability.',
      'Central-policy candidates are navigation candidates, not confirmed requirements.',
      'Only these programme identities and limited pages were checked; coverage and completeness are not established.',
    ],
    results,
  };
  await fs.writeFile(path.resolve('artifacts/retrieval-smoke.json'), JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
