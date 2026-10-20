import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DeskStore } from '../src/main/store';
import { schemas } from '../src/main/validation';
import { isOfficialDeepSeek } from '../src/shared/api';
import { createResearchRun, runResearch, testApi } from '../src/research/engine';
import type { Project, ThinkingMode } from '../src/shared/types';

function temporaryDirectory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'desk-api-')); }
function removeTemporary(directory: string) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('desk-api-'));
  fs.rmSync(directory, { recursive: true, force: true });
}

test('legacy API settings default without migration and explicit thinking modes persist with revision protection', () => {
  const directory = temporaryDirectory();
  let store = new DeskStore(directory);
  const input = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', hasKey: true };
  try {
    assert.equal(store.snapshot().apiSettings.thinkingMode, 'provider_default');
    store.saveApiSettings({ ...input, expectedRevision: 0 });
    store.close();
    // Reproduce the JSON settings record written before thinkingMode existed.
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
    db.prepare("UPDATE entities SET data=json_remove(data, '$.thinkingMode') WHERE kind='settings' AND id='api'").run();
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    db.close();
    store = new DeskStore(directory);
    assert.equal(store.snapshot().apiSettings.thinkingMode, 'provider_default');
    store.saveApiSettings({ ...input, thinkingMode: 'disabled', expectedRevision: 1 });
    assert.throws(() => store.saveApiSettings({ ...input, thinkingMode: 'enabled', expectedRevision: 1 }), /已发生变化/);
    assert.equal(store.snapshot().apiSettings.thinkingMode, 'disabled');
    store.close();
    store = new DeskStore(directory);
    assert.equal(store.snapshot().apiSettings.thinkingMode, 'disabled');
    // An older client omitting the optional field must preserve a saved choice.
    store.saveApiSettings({ ...input, expectedRevision: 2 });
    assert.equal(store.snapshot().apiSettings.thinkingMode, 'disabled');
    store.saveApiSettings({ ...input, thinkingMode: 'enabled', expectedRevision: 3 });
    assert.equal(store.snapshot().apiSettings.thinkingMode, 'enabled');
    assert.equal(store.snapshot().apiSettings.hasKey, true);
    assert.throws(() => store.saveApiSettings({ ...input, thinkingMode: 'invalid' as ThinkingMode, expectedRevision: 4 }), /思考模式/);
    assert.equal(store.snapshot().apiSettings.revision, 4);
  } finally { store.close(); removeTemporary(directory); }
});

test('API IPC accepts known optional modes and rejects unrecognized values', () => {
  const input = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', expectedRevision: 0 };
  assert.equal(schemas.saveApiSettings.safeParse(input).success, true);
  for (const thinkingMode of ['provider_default', 'disabled', 'enabled']) {
    assert.equal(schemas.saveApiSettings.safeParse({ ...input, thinkingMode }).success, true);
  }
  for (const thinkingMode of ['', 'high', true, null]) {
    assert.equal(schemas.saveApiSettings.safeParse({ ...input, thinkingMode }).success, false);
  }
});

test('provider options are limited to the exact official HTTPS DeepSeek host', () => {
  for (const url of ['https://api.deepseek.com', 'https://api.deepseek.com/v1', 'https://API.DEEPSEEK.COM:443/chat/completions']) {
    assert.equal(isOfficialDeepSeek(url), true, url);
  }
  for (const url of ['https://api.deepseek.com.example.org', 'https://proxy.api.deepseek.com', 'https://example.org/api.deepseek.com',
    'http://api.deepseek.com', 'https://api.deepseek.com:8443', 'https://user@api.deepseek.com', 'not a URL']) {
    assert.equal(isOfficialDeepSeek(url), false, url);
  }
});

test('connection requests honor official modes and retain compatible payloads for other providers', async () => {
  const cases: Array<{ baseUrl: string; mode?: ThinkingMode; expected?: string }> = [
    { baseUrl: 'https://api.deepseek.com', mode: 'disabled', expected: 'disabled' },
    { baseUrl: 'https://api.deepseek.com/v1', mode: 'enabled', expected: 'enabled' },
    { baseUrl: 'https://api.deepseek.com', mode: 'provider_default' },
    { baseUrl: 'https://api.deepseek.com' },
    { baseUrl: 'https://compatible.example/v1', mode: 'enabled' },
    { baseUrl: 'https://api.deepseek.com.example.org/v1', mode: 'disabled' },
    { baseUrl: 'https://api.deepseek.com:8443', mode: 'disabled' },
  ];
  for (const row of cases) {
    let requests = 0;
    const transport: typeof fetch = async (_, init) => {
      requests++;
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.max_tokens, 64);
      assert.equal(payload.model, 'deepseek-flash');
      assert.equal(payload.thinking?.type, row.expected);
      assert.deepEqual(Object.keys(payload).sort(), ['max_tokens', 'messages', 'model', ...(row.expected ? ['thinking'] : [])].sort());
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }));
    };
    const result = await testApi({ baseUrl: row.baseUrl, model: 'deepseek-flash', thinkingMode: row.mode, key: '' }, transport);
    assert.match(result.message, /连接成功/);
    assert.equal(requests, 1);
  }
});

test('connection tests reject empty, reasoning-only, malformed and truncated responses without retry', async () => {
  const responses = [
    { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: ' \n\t ' } }] },
    { choices: [{ finish_reason: 'stop', message: { reasoning_content: 'Reasoning only.' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: null, reasoning_content: 'Reasoning only.' } }] },
    { choices: [{ finish_reason: 'length', message: { content: 'OK' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: [{ type: 'reasoning', reasoning: 'Only reasoning' }] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: [{ type: 'reasoning', text: 'Only reasoning' }] } }] },
    'not-json',
  ];
  for (const response of responses) {
    let requests = 0;
    const transport: typeof fetch = async () => {
      requests++;
      return new Response(typeof response === 'string' ? response : JSON.stringify(response));
    };
    await assert.rejects(testApi({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', thinkingMode: 'disabled', key: '' }, transport), /正文|文本响应/);
    assert.equal(requests, 1);
  }
});

test('research cache separates DeepSeek generation modes while ignoring unsupported provider options', async () => {
  const directory = temporaryDirectory();
  const project: Project = {
    id: 'api-fixture', institution: 'Example University', name: 'Learning Design MA', degree: 'MA',
    degreeLevel: 'master', degreeName: 'MA', entryYear: 2027, entryMonth: null,
    officialUrl: 'https://education.example.edu/admissions', cycle: '2027 年入学', color: '#447766', archived: false, revision: 1,
  };
  const scope = 'Learning Design MA admissions for 2027 entry.';
  const quote = 'Applicants must submit a personal statement of no more than 500 words.';
  const raw = { key: 'statement', title: '个人陈述', kind: 'document', summary: '提交个人陈述，最多 500 词。', necessity: 'required',
    quote, scopeQuote: scope, cycleQuote: scope, limits: [{ unit: 'words', value: 500, nature: 'maximum', quote }] };
  const verdict = { key: 'statement', factSupported: true, necessitySupported: true, conditionSupported: true,
    scopeSupported: true, deadlineSupported: true, validLimitIndexes: [0], reason: '' };
  const payloads: Array<Record<string, any>> = [];
  const transport: typeof fetch = async (_, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      payloads.push(body);
      const review = body.messages[0].content.includes('Independently check');
      assert.equal(body.max_tokens, review ? 2000 : 5000);
      assert.equal(body.temperature, 0);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify(review ? { verdicts: [verdict] } : { requirements: [raw] }),
      } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    }
    return new Response(`<main>${scope}\n${quote}</main>`, { headers: { 'content-type': 'text/html' } });
  };
  const run = (baseUrl: string, thinkingMode?: ThinkingMode) => runResearch({
    run: createResearchRun(project), project, settings: { baseUrl, model: 'deepseek-flash', key: '', thinkingMode },
    cacheDir: directory, fetchImpl: transport,
  }, () => {}, new AbortController().signal);
  try {
    for (const mode of ['disabled', 'enabled', 'provider_default'] as const) {
      const first = await run('https://api.deepseek.com', mode);
      assert.equal(first.status, 'completed');
      assert.equal(first.calls, 2);
      assert.equal(first.candidates[0].requirement.support, 'supported');
      assert.ok(payloads.slice(-2).every(payload => payload.thinking?.type === (mode === 'provider_default' ? undefined : mode)));
      assert.equal((await run('https://api.deepseek.com', mode)).calls, 0);
    }
    assert.equal((await run('https://api.deepseek.com')).calls, 0);
    assert.equal((await run('https://compatible.example/v1', 'enabled')).calls, 2);
    assert.ok(payloads.slice(-2).every(payload => !('thinking' in payload)));
    assert.equal((await run('https://compatible.example/v1', 'disabled')).calls, 0);
    assert.equal(payloads.length, 8);
  } finally { removeTemporary(directory); }
});
