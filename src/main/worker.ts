import type { Project, ResearchRun, Requirement, MaterialVersion } from '../shared/types';
import { runResearch, testApi } from '../research/engine';
import { parseDocument, checkDocument } from '../research/documents';

type Config = { baseUrl: string; model: string; key: string };
type Request =
  | { type: 'research'; run: ResearchRun; project: Project; settings: Config; cacheDir: string }
  | { type: 'check'; file: string; requirement: Requirement; version: MaterialVersion }
  | { type: 'test'; settings: Config }
  | { type: 'cancel' };
const controller = new AbortController();
let busy = false;
process.parentPort?.on('message', async ({ data }: { data: Request }) => {
  if (data.type === 'cancel') { controller.abort(); return; }
  if (busy) return;
  busy = true;
  try {
    if (data.type === 'research') {
      const result = await runResearch(data, run => process.parentPort?.postMessage({ type: 'update', run }), controller.signal);
      process.parentPort?.postMessage({ type: 'result', result });
    } else if (data.type === 'check') {
      const parsed = await parseDocument(data.file);
      const result = checkDocument(data.requirement, data.version, parsed);
      process.parentPort?.postMessage({ type: 'result', result });
    } else {
      const result = await testApi(data.settings);
      process.parentPort?.postMessage({ type: 'result', result });
    }
  } catch (error) {
    process.parentPort?.postMessage({ type: 'error', error: error instanceof Error ? error.message : '后台任务失败' });
  }
});
