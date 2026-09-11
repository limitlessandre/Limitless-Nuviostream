const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const providers = path.resolve(__dirname, '../custom/providers');
const rebuild = 'vidlink-standalone-rebuild-v1.js';
const fixturePath = path.join(__dirname, 'fixtures/vidlink-den-o-s1e1.json');
const denO = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const expectedHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  Connection: 'keep-alive', Referer: 'https://vidlink.pro/', Origin: 'https://vidlink.pro'
};

// Only these request classes are available. A dynamic provider download cannot
// accidentally succeed, and no test makes a real network request.
function harness({ file = rebuild, payload = denO, token = 'fixed-token',
  metadata = { name: 'Kamen Rider Den-O', first_air_date: '2007-01-28' },
  playlists = {}, fail, globalExport = false } = {}) {
  const calls = [];
  const sandbox = {
    URL,
    fetch: async (url, options) => {
      url = String(url);
      const kind = url.startsWith('https://api.themoviedb.org/3/') ? 'metadata'
        : url.startsWith('https://enc-dec.app/api/enc-vidlink?') ? 'encryption'
          : url.startsWith('https://vidlink.pro/api/b/') ? 'api'
            : Object.hasOwn(playlists, url) ? 'playlist' : 'unexpected';
      calls.push({ url, options: options === undefined ? undefined : plain(options), kind });
      if (kind === 'unexpected') throw new Error('Unexpected runtime dependency: ' + url);
      if (fail === kind + ':throw') throw new Error('Network unavailable');
      const body = kind === 'metadata' ? metadata
        : kind === 'encryption' ? { result: token }
          : kind === 'api' ? payload : playlists[url];
      return {
        ok: fail !== kind + ':status',
        json: async () => {
          if (fail === kind + ':json') throw new SyntaxError('Invalid response');
          return plain(body);
        },
        text: async () => typeof body === 'string' ? body : JSON.stringify(body)
      };
    }
  };
  if (!globalExport) sandbox.module = { exports: {} };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(fs.readFileSync(path.join(providers, file), 'utf8'), context, { filename: file });
  const getStreams = globalExport ? context.getStreams : context.module.exports.getStreams;
  assert.equal(typeof getStreams, 'function');
  return {
    calls, context,
    run: async (...args) => plain(await getStreams(...(args.length ? args : ['259906', 'tv', 1, 1])))
  };
}

test('Den-O S1E1 keeps the control single 720p direct-file row and playback contract', async () => {
  const h = harness();
  const rows = await h.run();
  assert.equal(rows.length, 1);
  const row = rows[0];
  const source720 = Object.entries(denO.stream.qualities).find(([quality]) => /720/.test(quality))[1];
  assert.equal(source720.requiresProxy, true);
  assert.equal(denO.stream.captions.length, 7);
  assert.equal(row.url, source720.url);
  assert.equal(row.name, 'Vidlink Standalone Rebuild • HD 720p • [UNK]');
  assert.equal(row.quality, '720p');
  assert.equal(row.type, 'video');
  assert.deepEqual(Object.keys(row).sort(), ['name', 'quality', 'title', 'type', 'url']);
  assert.equal(h.calls.filter(call => call.kind === 'api').length, 1);
  assert.equal(h.calls.some(call => call.kind === 'unexpected'), false);
});

test('the same Den-O response recreates the failed v1/v2 three-row divergence', async () => {
  for (const file of ['vidlink-standalone-nexus-v1.js', 'vidlink-standalone-nexus-v2.js']) {
    const rows = await harness({ file }).run();
    assert.equal(rows.length, 3, file);
    assert.deepEqual(rows.map(row => row.quality).sort(), ['360p', '480p', '720p'], file);
    assert.ok(rows.every(row => row.type === 'mp4' && row.headers), file);
  }
});

test('API headers and unmodified token match control; metadata and encryption use fetch defaults', async () => {
  const token = 'raw+token/==';
  const h = harness({ token });
  assert.equal((await h.run()).length, 1);
  const api = h.calls.filter(call => call.kind === 'api');
  assert.equal(api.length, 1);
  assert.equal(api[0].url, 'https://vidlink.pro/api/b/tv/' + token + '/1/1');
  assert.deepEqual(api[0].options, { headers: expectedHeaders });
  const encryption = h.calls.find(call => call.kind === 'encryption');
  assert.equal(encryption.url, 'https://enc-dec.app/api/enc-vidlink?text=259906');
  assert.equal(encryption.options, undefined);
  assert.equal(h.calls.find(call => call.kind === 'metadata').options, undefined);
});

test('quality filtering, HTTPS requirement and URL deduplication retain the control selection', async () => {
  const payload = { stream: { qualities: {
    '360p': { url: 'https://media.example/360.mp4' },
    '480p': { url: 'https://media.example/480.mp4' },
    Auto: { url: 'https://media.example/auto.mp4' },
    '720p': { url: 'https://media.example/720.mp4' },
    HD: { url: 'https://media.example/720.mp4' },
    '1080p': { url: 'http://media.example/1080.mp4' },
    '1440p': { url: 'https://media.example/1440.mp4' },
    '4K': { url: 'https://media.example/2160.mp4' },
    '2160p': 'https://media.example/string-valued.mp4'
  } } };
  const rows = await harness({ payload }).run();
  assert.deepEqual(rows.map(row => [row.quality, row.url]), [
    ['4K', 'https://media.example/2160.mp4'],
    ['1440p', 'https://media.example/1440.mp4'],
    ['720p', 'https://media.example/720.mp4']
  ]);
});

test('master playlists contribute only eligible resolved variants and never a raw-playlist fallback', async () => {
  const playlist = 'https://media.example/path/master.m3u8';
  const payload = { stream: { qualities: { '720p': { url: 'https://media.example/path/720.m3u8' } }, playlist } };
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\n360.m3u8\n'
    + '#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720.m3u8\n'
    + '#EXT-X-STREAM-INF:BANDWIDTH=1000000\nunknown.m3u8\n'
    + '#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n../1080.m3u8\n';
  const h = harness({ payload, playlists: { [playlist]: master } });
  const rows = await h.run();
  assert.deepEqual(rows.map(row => [row.quality, row.url, row.type]), [
    ['1080p', 'https://media.example/1080.m3u8', 'm3u8'],
    ['720p', 'https://media.example/path/720.m3u8', 'm3u8']
  ]);
  assert.deepEqual(h.calls.find(call => call.kind === 'playlist').options, { headers: expectedHeaders });
  for (const [text, fail] of [
    ['#EXTM3U\n#EXTINF:10,\nsegment.ts\n', undefined],
    [master, 'playlist:status']
  ]) {
    const result = await harness({ payload, playlists: { [playlist]: text }, fail }).run();
    assert.deepEqual(result.map(row => row.url), ['https://media.example/path/720.m3u8']);
  }
  const ignored = await harness({ payload: { stream: { qualities: { '720p': 'https://media.example/string.mp4' } } } }).run();
  assert.deepEqual(ignored, []);
});

test('missing prerequisites and fetch/JSON failures return no synthetic playable or diagnostic rows', async () => {
  for (const options of [
    { metadata: {} }, { token: '' }, { payload: {} },
    { fail: 'metadata:status' }, { fail: 'encryption:throw' },
    { fail: 'api:status' }, { fail: 'api:json' }
  ]) {
    const h = harness(options);
    assert.deepEqual(await h.run(), [], JSON.stringify(options));
    if (options.metadata || options.token === '' || options.fail?.startsWith('metadata:') || options.fail?.startsWith('encryption:')) {
      assert.equal(h.calls.some(call => call.kind === 'api'), false);
    }
  }
  const h = harness();
  assert.deepEqual(await h.run('259906', 'tv', null, 1), []);
  assert.equal(h.calls.length, 0);
});

test('global export works without timers, require, dynamic evaluation or downloaded provider code', async () => {
  const h = harness({ globalExport: true });
  assert.equal(typeof h.context.setTimeout, 'undefined');
  assert.equal(typeof h.context.require, 'undefined');
  assert.equal((await h.run()).length, 1);
  assert.deepEqual(h.calls.map(call => call.kind).sort(), ['api', 'encryption', 'metadata']);
});
