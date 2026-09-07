const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const file = 'custom/providers/asiaflix-nexus-probe-v3.js';
const source = fs.readFileSync(path.join(root, file), 'utf8');
const baseline = execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), 'show', '6b829a1:' + file], { cwd: root, encoding: 'utf8' });
const pending = () => new Promise(() => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

function runtime(code, fetch, extra = {}) {
  const active = new Set();
  const budgets = [];
  const logs = [];
  const context = vm.createContext({ module: { exports: {} }, URL, AbortController,
    console: { log: line => logs.push(line) }, fetch,
    setTimeout(fn, ms) {
      budgets.push(ms);
      const timer = setTimeout(() => { active.delete(timer); fn(); }, Math.min(ms, 25));
      active.add(timer);
      return timer;
    },
    clearTimeout(timer) { active.delete(timer); clearTimeout(timer); },
    ...extra
  });
  vm.runInContext(code, context);
  return { context, active, budgets, logs, getStreams: context.module.exports.getStreams,
    json: (url, ms = 30) => vm.runInContext('fetchJson', context)(url, {}, ms) };
}

for (const title of ['Kamen Rider Ex-Aid', 'Kamen Rider Den-O']) {
  const id = title.includes('Ex-Aid') ? 262158 : 259906;
  const hosts = [{ source: 'watchasian', url: '//embasic.pro/z2pqlftjhs?id=test' },
    { source: title.includes('Ex-Aid') ? 'Streamwish' : 'vidbasic', url: 'https://example.org/embed/second' }];
  function fixture(blockStage, phase, searchFallback = false) {
    const calls = [];
    let details = 0;
    const fetch = async (url, opts) => {
      let stage;
      let data;
      if (url.includes('/find/')) { stage = 'tmdb-id'; data = { tv_results: [{ id }] }; }
      else if (url.includes('themoviedb')) { stage = 'tmdb-info'; data = { name: title, original_language: 'ja' }; }
      else if (url.includes('/detail')) {
        stage = ++details === 1 ? 'direct-detail' : 'search-detail';
        data = { name: title, episodes: [{ number: 1, streamUrls: hosts }] };
        if (searchFallback && details === 1 && stage !== blockStage) return response(null, 404);
      } else if (url.includes('/search')) { stage = 'search'; data = { body: [{ name: title, slug: 'found-title' }] }; }
      else {
        stage = url.includes('server=watchasian') ? 'resolver-1' : 'resolver-2';
        data = { sources: [{ url: 'https://cdn.example/720.m3u8', isM3U8: true }] };
        assert.equal(opts.headers['X-Access-Control'], 'web');
        assert.equal(new URL(url).searchParams.get('value'), Buffer.from(hosts[stage === 'resolver-1' ? 0 : 1].url).toString('base64'));
      }
      calls.push(stage);
      if (stage === blockStage) return phase === 'headers' ? pending() : { ok: true, status: 200, json: pending };
      return response(data);
    };
    return { fetch, calls };
  }

  test(`${title}: original timerless path stalls in first resolver`, async () => {
    const f = fixture('resolver-1', 'headers');
    const r = runtime(baseline, f.fetch, { setTimeout: undefined, clearTimeout: undefined });
    const result = await Promise.race([r.getStreams(id, 'tv', 1, 1), sleep(60).then(() => 'stalled')]);
    assert.equal(result, 'stalled');
    assert.deepEqual(f.calls, ['tmdb-info', 'direct-detail', 'resolver-1']);
  });

  for (const stage of ['tmdb-id', 'tmdb-info', 'direct-detail', 'search', 'search-detail', 'resolver-1', 'resolver-2']) {
    for (const phase of ['headers', 'body']) {
      test(`${title}: ${stage} stalled ${phase} settles`, async () => {
        const f = fixture(stage, phase, stage === 'search' || stage === 'search-detail');
        const r = runtime(source, f.fetch);
        const rows = await Promise.race([r.getStreams('tt12345', 'tv', 1, 1), sleep(400).then(() => null)]);
        assert.ok(rows, 'provider exceeded external watchdog');
        assert.ok(f.calls.includes(stage));
        assert.ok(r.logs.some(line => line.includes('TIMEOUT>')));
        assert.equal(r.active.size, 0, 'timer leaked');
        assert.ok(r.budgets.every(ms => [1400, 1500, 1600].includes(ms)));
        if (stage.startsWith('resolver')) {
          assert.ok(f.calls.includes('resolver-1') && f.calls.includes('resolver-2'));
          assert.equal(rows.filter(row => row.quality !== 'DIAG').length, 1, 'other resolver result lost');
        }
      });
    }
  }

  test(`${title}: happy path preserves stream headers and deduplicates`, async () => {
    const f = fixture();
    const r = runtime(source, f.fetch);
    const rows = await r.getStreams(id, 'tv', 1, 1);
    const streams = rows.filter(row => row.quality !== 'DIAG');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].type, 'm3u8');
    assert.equal(streams[0].headers.Referer, 'https://asiaflix.net/');
    assert.equal(streams[0].headers.Origin, 'https://asiaflix.net');
    assert.ok(rows.some(row => row.title.includes('watchasian@embasic.pro')));
    assert.equal(r.active.size, 0);
  });
}

test('original clears deadline before stalled JSON body', async () => {
  const r = runtime(baseline, async () => ({ ok: true, status: 200, json: pending }));
  assert.equal(await Promise.race([r.json('https://example.org'), sleep(60).then(() => 'stalled')]), 'stalled');
  assert.equal(r.active.size, 0);
});

for (const [name, extra] of Object.entries({
  'no timers': { setTimeout: undefined, clearTimeout: undefined },
  'no clearTimeout': { clearTimeout: undefined },
  'native synchronous bridge': { __native_fetch() { throw new Error('must never call'); } }
})) {
  test(`${name}: return diagnostic before starting network`, async () => {
    let calls = 0;
    const r = runtime(source, () => { calls++; return pending(); }, extra);
    const rows = await r.getStreams(262158, 'tv', 1, 1);
    assert.match(rows[0].name, /RUNTIME UNSUPPORTED/);
    assert.equal(calls, 0);
    const result = await r.json('https://example.org');
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  });
}

for (const [name, fetch] of Object.entries({
  'HTTP error': async () => response(null, 500),
  'malformed JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } }),
  'network rejection': async () => { throw new Error('network failure'); },
  'no response': async () => null,
  'synchronous exception': () => { throw new Error('fetch failed'); }
})) {
  test(`${name}: settles and clears timer`, async () => {
    const r = runtime(source, fetch);
    assert.equal((await r.json('https://example.org')).ok, false);
    assert.equal(r.active.size, 0);
  });
}

test('deadline works without AbortController and with fetch ignoring abort', async () => {
  for (const extra of [{ AbortController: undefined }, {}]) {
    const r = runtime(source, pending, extra);
    assert.match((await r.json('https://example.org')).error, /TIMEOUT/);
    assert.equal(r.active.size, 0);
  }
});

test('late rejection after timeout is handled', async () => {
  const r = runtime(source, () => new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 50)));
  assert.match((await r.json('https://example.org')).error, /TIMEOUT/);
  await sleep(70);
  assert.equal(r.active.size, 0);
});

test('both resolvers start before either completes', async () => {
  const started = [];
  const release = [];
  const r = runtime(source, url => {
    if (url.includes('themoviedb')) return Promise.resolve(response({ name: 'Example' }));
    if (url.includes('/detail')) return Promise.resolve(response({ name: 'Example', episodes: [{ number: 1,
      streamUrls: [{ source: 'one', url: 'https://example.org/one' }, { source: 'two', url: 'https://example.org/two' }] }] }));
    started.push(url);
    return new Promise(resolve => release.push(() => resolve(response({ sources: [] }))));
  });
  const operation = r.getStreams(1, 'tv', 1, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.length, 2);
  release.forEach(fn => fn());
  await operation;
  assert.equal(r.active.size, 0);
});

test('manifest changes only the experimental AsiaFlix entry', () => {
  const original = JSON.parse(execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), 'show', '6b829a1:manifest.json'], { cwd: root, encoding: 'utf8' }));
  const current = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(current.scrapers.find(row => row.id === 'asiaflix-nexus').version, '0.2.3');
  current.scrapers = current.scrapers.filter(row => row.id !== 'asiaflix-nexus');
  original.scrapers = original.scrapers.filter(row => row.id !== 'asiaflix-nexus');
  assert.deepEqual(current, original);
});
