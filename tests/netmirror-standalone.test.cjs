const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const providerFile = path.resolve(__dirname, '../custom/providers/netmirror-standalone-nexus-v1.js');
const source = fs.readFileSync(providerFile, 'utf8');
const API = 'https://api.netmirror.test';

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => plain(value) };
}

function defaultMeta(title = 'The Rising of the Shield Hero') {
  return {
    id: 83095,
    name: title,
    original_name: title === 'The Rising of the Shield Hero' ? '盾の勇者の成り上がり' : title,
    first_air_date: '2019-01-09'
  };
}

function harness({
  meta = defaultMeta(),
  seasonMeta = { id: 408098, name: 'Season 4', season_number: 4, air_date: '2025-07-09' },
  alternatives = { results: [] },
  direct = { ok: false },
  search = () => [],
  posts = {},
  episodePages = {},
  players = {},
  settings = {}
} = {}) {
  const calls = [];
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, error() {}, warn() {} },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    SCRAPER_SETTINGS: settings,
    fetch: async (input, options = {}) => {
      const url = String(input);
      calls.push({ url, options: plain(options) });
      const parsed = new URL(url);
      if (parsed.hostname === 'api.themoviedb.org') {
        if (/\/season\/\d+$/.test(parsed.pathname)) return jsonResponse(seasonMeta);
        if (/\/alternative_titles$/.test(parsed.pathname)) return jsonResponse(alternatives);
        return jsonResponse(meta);
      }
      if (parsed.hostname === 'net27.cc') {
        return jsonResponse(typeof direct === 'function' ? direct(parsed) : direct);
      }
      if (parsed.pathname === '/checknewtv.php') {
        return jsonResponse({ token_hash: Buffer.from(API).toString('base64') });
      }
      if (parsed.origin !== API) throw new Error('Unexpected runtime dependency: ' + url);
      const ott = options.headers && options.headers.Ott;
      if (parsed.pathname === '/newtv/search.php') {
        const query = parsed.searchParams.get('s');
        return jsonResponse(search({ ott, query }));
      }
      if (parsed.pathname === '/newtv/post.php') {
        const id = parsed.searchParams.get('id');
        if (!Object.hasOwn(posts, id)) throw new Error('Missing post fixture: ' + id);
        return jsonResponse(posts[id]);
      }
      if (parsed.pathname === '/newtv/episodes.php') {
        const id = parsed.searchParams.get('id');
        const page = Number(parsed.searchParams.get('page'));
        const key = `${ott}:${id}:${page}`;
        return jsonResponse(episodePages[key] || { episodes: [], nextPageShow: 0 });
      }
      if (parsed.pathname === '/newtv/player.php') {
        const id = parsed.searchParams.get('id');
        return jsonResponse(players[id] || { status: 'error' });
      }
      throw new Error('Unexpected request: ' + url);
    }
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(source, context, { filename: path.basename(providerFile) });
  const api = context.module.exports;
  return {
    calls,
    api,
    run: async (...args) => plain(await api.getStreams(...args)),
    diagnostics: () => plain(api.__test.diagnostics())
  };
}

function multiSeasonPost(selectedSeason = 1) {
  return {
    type: 't',
    season: [1, 2, 3, 4].map(number => ({ id: `season-${number}`, name: `Season ${number}`, selected: number === selectedSeason })),
    episodes: [{ id: `shield-s${selectedSeason}e1`, ep: '1' }],
    nextPageShow: 0
  };
}

function multiSeasonPages(prefix = 'shield') {
  const pages = {};
  for (const ott of ['nf', 'pv', 'hs']) {
    for (const season of [1, 2, 3, 4]) {
      pages[`${ott}:season-${season}:1`] = {
        episodes: [1, 2, 3].map(ep => ({ id: `${prefix}-s${season}e${ep}`, ep: String(ep) })),
        nextPageShow: 0
      };
    }
  }
  return pages;
}

test('provider is standalone and exports without eval, require, timers, or downloaded code', async () => {
  assert.doesNotMatch(source, /raw\.githubusercontent\.com|new Function\s*\(|\beval\s*\(/);
  const h = harness({
    direct: { ok: true, tmdbId: 83095, type: 'tv', title: 'The Rising of the Shield Hero', currentSeason: 1, currentEpisode: 1,
      streams: [{ resolution: 720, url: 'https://cdn.example/shield-s1e1.mp4' }], captions: [] }
  });
  const rows = await h.run('83095', 'tv', 1, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://cdn.example/shield-s1e1.mp4');
  assert.equal(rows[0].name, 'NetMirror • HD 720p • [UNK]');
  assert.equal(h.calls.some(call => call.url.includes('github')), false);
});

test('manifest activates only the standalone 1.0.0 NetMirror provider', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf8'));
  const entries = manifest.scrapers.filter(item => item.id === 'limitless-netmirror');
  assert.equal(manifest.version, '2.3.0');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].version, '1.0.0');
  assert.match(entries[0].filename, /\/custom\/providers\/netmirror-standalone-nexus-v1\.js\?rev=100$/);
  assert.doesNotMatch(entries[0].filename, /NuvioPlugin|All-in-One-Nuvio/);
});

test('non-Latin alternative titles compare exactly instead of collapsing to an empty key', () => {
  const h = harness();
  assert.equal(h.api.__test.titleKey('盾の勇者の成り上がり'), 'raw:盾の勇者の成り上がり');
  assert.notEqual(h.api.__test.titleKey('盾の勇者の成り上がり'), h.api.__test.titleKey('進撃の巨人'));
});

test('Net27 direct accepts only an explicitly confirmed requested TV episode', async () => {
  const h = harness({
    direct: {
      ok: true, tmdbId: 83095, type: 'tv', title: 'The Rising of the Shield Hero',
      currentSeason: 4, currentEpisode: 3,
      streams: [{ resolution: 1080, url: 'https://cdn.example/shield-s4e3.mp4' }],
      captions: [{ lang: 'en', name: 'English', url: '/subs/shield-s4e3.srt' }]
    }
  });
  const rows = await h.run('83095', 'tv', 4, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://cdn.example/shield-s4e3.mp4');
  assert.equal(rows[0].name, 'NetMirror • FHD 1080p • [SUB]');
  const directCall = h.calls.find(call => call.url.startsWith('https://net27.cc/api/embed-tmdb/'));
  assert.match(directCall.url, /[?&]se=4(?:&|$)/);
  assert.match(directCall.url, /[?&]ep=3(?:&|$)/);
  assert.doesNotMatch(directCall.url, /[?&]s=|[?&]e=/);
  assert.equal(h.calls.some(call => call.url.includes('/checknewtv.php')), false);
  assert.equal(h.diagnostics().find(item => item.event === 'direct-accepted').returnedSeason, 4);
});

test('Shield Hero S4 rejects Net27 S1 media and falls through to a correct separate-season Prime candidate', async () => {
  const h = harness({
    direct: {
      ok: true, tmdbId: 83095, type: 'tv', title: 'The Rising of the Shield Hero',
      currentSeason: 1, currentEpisode: 1,
      streams: [{ resolution: 720, url: 'https://cdn.example/wrong-s1e1.mp4' }]
    },
    search: ({ ott, query }) => {
      if (ott === 'nf') return { searchResult: [{ id: 'spinoff', title: 'The Rising of the Shield Hero: Reprise' }] };
      if (ott === 'pv' && /season 4|4th season/i.test(query)) {
        return { searchResult: [
          { id: 'wrong-first', title: 'The Rising of the Shield Hero' },
          { id: 'shield-season-4', title: 'The Rising of the Shield Hero Season 4' }
        ] };
      }
      return { searchResult: [] };
    },
    posts: {
      spinoff: { type: 't', season: [{ id: 'spinoff-s1', selected: true }], episodes: [{ id: 'spinoff-e1', ep: '1' }] },
      'wrong-first': { type: 't', season: [{ id: 'only-s1', name: 'Season 1', selected: true }], episodes: [{ id: 'wrong-s1e1', ep: '1' }] },
      'shield-season-4': { type: 't', season: [{ id: 'internal-s1', name: 'Season 1', selected: true }], episodes: [{ id: 'shield-s4e1', ep: '1' }] }
    },
    players: { 'shield-s4e1': { status: 'ok', video_link: 'https://prime.example/shield-s4e1.m3u8', referer: 'https://prime.example/' } }
  });
  const rows = await h.run('83095', 'tv', 4, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://prime.example/shield-s4e1.m3u8');
  assert.equal(rows[0].name, 'NetMirror • Unknown Auto • [UNK]');
  assert.equal(h.calls.some(call => call.url.includes('wrong-s1e1.mp4')), false);
  const rejectedDirect = h.diagnostics().find(item => item.path === 'net27-direct' && item.event === 'rejection');
  assert.equal(rejectedDirect.reason, 'direct-season-episode-mismatch');
  const accepted = h.diagnostics().find(item => item.event === 'generic-accepted');
  assert.equal(accepted.platform, 'primevideo');
  assert.equal(accepted.catalogueLayout, 'separate-season');
  assert.equal(accepted.mappedProviderSeason, 1);
  assert.equal(accepted.mappedProviderEpisode, 1);
  assert.equal(accepted.internalEpisodeId, 'shield-s4e1');
});

test('generic matching examines every result and maps exact seasons in a multi-season catalogue', async () => {
  const h = harness({
    meta: { id: 2316, name: 'The Office', original_name: 'The Office', first_air_date: '2005-03-24' },
    seasonMeta: { name: 'Season 3', season_number: 3, air_date: '2006-09-21' },
    direct: { ok: true, tmdbId: 2316, type: 'tv', title: 'The Office', currentSeason: 1, currentEpisode: 2, streams: [] },
    search: ({ ott }) => ott === 'nf' ? { searchResult: [
      { id: 'office-uk', title: 'The Office UK' },
      { id: 'office-us', title: 'The Office', type: 'tv' }
    ] } : { searchResult: [] },
    posts: {
      'office-uk': { type: 't', season: [{ id: 'uk-s1', selected: true }], episodes: [{ id: 'uk-s1e2', ep: '2' }] },
      'office-us': multiSeasonPost(1)
    },
    episodePages: multiSeasonPages('office'),
    players: { 'office-s3e2': { status: 'ok', video_link: 'https://netflix.example/office-s3e2.mp4' } }
  });
  const rows = await h.run('2316', 'tv', 3, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://netflix.example/office-s3e2.mp4');
  const accepted = h.diagnostics().find(item => item.event === 'generic-accepted');
  assert.equal(accepted.candidateId, 'office-us');
  assert.equal(accepted.mappedProviderSeason, 3);
  assert.equal(accepted.mappedProviderEpisode, 2);
  assert.equal(accepted.internalEpisodeId, 'office-s3e2');
});

test('a parent candidate missing S4 does not suppress a valid season-specific catalogue result', async () => {
  const h = harness({
    direct: { ok: true, tmdbId: 83095, type: 'tv', title: 'The Rising of the Shield Hero', currentSeason: 1, currentEpisode: 3 },
    search: ({ ott, query }) => ott === 'nf' ? { searchResult: [
      { id: 'parent-s1-only', title: 'The Rising of the Shield Hero' },
      ...(/season 4|4th season/i.test(query) ? [{ id: 'separate-s4', title: 'The Rising of the Shield Hero 4th Season' }] : [])
    ] } : { searchResult: [] },
    posts: {
      'parent-s1-only': { type: 't', season: [{ id: 'p-s1', name: 'Season 1', selected: true }], episodes: [{ id: 'p-s1e3', ep: '3' }] },
      'separate-s4': { type: 't', episodes: [{ id: 'separate-s4e3', sNum: 'S1', epNum: 'E3' }] }
    },
    players: { 'separate-s4e3': { status: 'ok', video_link: 'https://cdn.example/shield-s4e3.mp4' } }
  });
  const rows = await h.run('83095', 'tv', 4, 3);
  assert.equal(rows[0].url, 'https://cdn.example/shield-s4e3.mp4');
  const accepted = h.diagnostics().find(item => item.event === 'generic-accepted');
  assert.equal(accepted.candidateId, 'separate-s4');
  assert.equal(accepted.mappedProviderSeason, 1);
  assert.equal(accepted.mappedProviderEpisode, 3);
});

test('ambiguous equally owned candidates fail closed and the next platform is checked', async () => {
  const h = harness({
    direct: { ok: false },
    search: ({ ott }) => {
      if (ott === 'nf') return { searchResult: [
        { id: 'duplicate-a', title: 'The Rising of the Shield Hero' },
        { id: 'duplicate-b', title: 'The Rising of the Shield Hero' }
      ] };
      if (ott === 'pv') return { searchResult: [{ id: 'prime-owned', title: 'The Rising of the Shield Hero' }] };
      return { searchResult: [] };
    },
    posts: {
      'duplicate-a': multiSeasonPost(4),
      'duplicate-b': multiSeasonPost(4),
      'prime-owned': multiSeasonPost(4)
    },
    episodePages: multiSeasonPages('fallback'),
    players: { 'shield-s4e1': { status: 'ok', video_link: 'https://prime.example/fallback-s4e1.mp4' } }
  });
  const rows = await h.run('83095', 'tv', 4, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://prime.example/fallback-s4e1.mp4');
  assert.ok(h.diagnostics().some(item => item.platform === 'netflix' && item.reason === 'ambiguous-top-candidates'));
  assert.equal(h.diagnostics().find(item => item.event === 'generic-accepted').platform, 'primevideo');
});

test('movie matching uses title, year, and media type and still resolves the player', async () => {
  const h = harness({
    meta: { id: 438631, title: 'Dune', original_title: 'Dune', release_date: '2021-09-15' },
    seasonMeta: null,
    direct: { ok: false },
    search: ({ ott }) => ott === 'nf' ? { searchResult: [
      { id: 'dune-1984', title: 'Dune', year: '1984', type: 'movie' },
      { id: 'dune-2021', title: 'Dune', year: '2021', type: 'movie' },
      { id: 'dune-series', title: 'Dune', year: '2021', type: 'tv' }
    ] } : { searchResult: [] },
    posts: {
      'dune-1984': { type: 'm', main_id: 'movie-1984' },
      'dune-2021': { type: 'm', main_id: 'movie-2021' },
      'dune-series': { type: 't', episodes: [{ id: 'series-e1', ep: '1' }] }
    },
    players: { 'movie-2021': { status: 'ok', video_link: 'https://cdn.example/dune-2021.mp4' } }
  });
  const rows = await h.run('438631', 'movie');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://cdn.example/dune-2021.mp4');
  assert.equal(h.diagnostics().find(item => item.event === 'generic-accepted').candidateId, 'dune-2021');
});

test('Shield Hero resolver matrix never substitutes the same episode number from another season', async () => {
  for (const [season, episode] of [[1, 1], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3]]) {
    const h = harness({
      seasonMeta: { name: `Season ${season}`, season_number: season, air_date: `${2018 + season}-07-01` },
      direct: {
        ok: true, tmdbId: 83095, type: 'tv', title: 'The Rising of the Shield Hero',
        currentSeason: 1, currentEpisode: episode,
        streams: [{ resolution: 720, url: `https://direct.example/shield-s1e${episode}.mp4` }]
      },
      search: ({ ott }) => ott === 'nf' ? { searchResult: [{ id: 'shield-parent', title: 'The Rising of the Shield Hero' }] } : { searchResult: [] },
      posts: { 'shield-parent': multiSeasonPost(1) },
      episodePages: multiSeasonPages('shield'),
      players: { [`shield-s${season}e${episode}`]: { status: 'ok', video_link: `https://generic.example/shield-s${season}e${episode}.mp4` } }
    });
    const rows = await h.run('83095', 'tv', season, episode);
    assert.equal(rows.length, 1, `S${season}E${episode}`);
    const expectedPath = season === 1 ? 'direct' : 'generic';
    assert.match(rows[0].url, new RegExp(`${expectedPath}\\.example/shield-s${season}e${episode}\\.mp4$`), `S${season}E${episode}`);
    if (season > 1) assert.doesNotMatch(rows[0].url, /shield-s1e\d+\.mp4$/, `S${season}E${episode} must not silently map to S1`);
  }
});

test('settings schema and preferred-platform ordering remain compatible', async () => {
  const h = harness({
    settings: { preferredPlatform: 'primevideo', forceHd: false },
    direct: { ok: false },
    search: ({ ott }) => ott === 'pv' ? { searchResult: [{ id: 'prime-first', title: 'The Rising of the Shield Hero Season 4' }] } : { searchResult: [] },
    posts: { 'prime-first': { type: 't', episodes: [{ id: 'prime-s4e1', sNum: 'S1', ep: '1' }] } },
    players: { 'prime-s4e1': { status: 'ok', video_link: 'https://prime.example/first.mp4' } }
  });
  const settings = plain(await h.api.onSettings());
  assert.deepEqual(settings[1].options.map(item => item.value), ['all', 'netflix', 'primevideo', 'hotstar']);
  assert.equal(settings[1].defaultValue, 'all');
  assert.equal(settings[3].key, 'forceHd');
  assert.equal(settings[3].defaultValue, true);
  const rows = await h.run('83095', 'tv', 4, 1);
  assert.equal(rows[0].url, 'https://prime.example/first.mp4');
  assert.equal(h.diagnostics().find(item => item.event === 'platform').platform, 'primevideo');
  assert.equal(h.calls.some(call => call.url.startsWith('https://net27.cc/')), false);
});
