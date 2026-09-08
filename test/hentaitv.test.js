const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('../hentaitv/resolver');
const {
  createHentaiTvClient,
  parseEpisodeNumber,
  cleanSeriesTitle,
  extractMediaUrls,
  generateVideoSlugVariations
} = require('../hentaitv/client');

const bibleBlack = { id: 'mal:368', type: 'series', title: 'Bible Black', aliases: ['Bible Black: La Noche de Walpurgis'], year: 2001, episode: 1 };

test('matches Bible Black and selects episode 1', async () => {
  const client = {
    search: async () => [{ title: 'Bible Black', slug: 'bible-black-episode-1', episodes: { 1: 'bible-black-episode-1' } }],
    episode: async (candidate, episode) => ({ slug: candidate.episodes[episode], streams: [{ name: 'HentaiTV', title: 'HentaiTV • MP4', url: 'https://cdn.example/bible-black-1.mp4' }] })
  };
  const result = await resolve(bibleBlack, client);
  assert.equal(result.match.title, 'Bible Black');
  assert.equal(result.match.slug, 'bible-black-episode-1');
  assert.equal(result.streams.length, 1);
});

test('searches aliases as well as the primary title', async () => {
  const client = {
    search: async (query) => query.includes('Walpurgis') ? [{ title: 'Bible Black La Noche de Walpurgis', slug: 'bb-episode-1', episodes: { 1: 'bb-episode-1' } }] : [],
    episode: async () => ({ streams: [] })
  };
  const result = await resolve(bibleBlack, client);
  assert.equal(result.match.title, 'Bible Black La Noche de Walpurgis');
});

test('returns no-title-match when HentaiTV has no candidate', async () => {
  const result = await resolve(bibleBlack, { search: async () => [], episode: async () => ({ streams: [] }) });
  assert.equal(result.reason, 'no-title-match');
  assert.deepEqual(result.streams, []);
});

test('private HentaiStream IDs remain rejected', async () => {
  for (const id of ['htv-private', 'hmm-private', 'hse-private', 'hs-private']) {
    await assert.rejects(() => resolve({ ...bibleBlack, id }, { search: async () => [], episode: async () => ({ streams: [] }) }));
  }
});

test('parses episode/title helpers and direct media URLs', () => {
  assert.equal(parseEpisodeNumber('bible-black-episode-6'), 6);
  assert.equal(cleanSeriesTitle('Bible Black Episode 6'), 'Bible Black');
  assert.deepEqual(extractMediaUrls('<source src="https://cdn.example/video.mp4"><script>"https:\\/\\/cdn.example\\/master.m3u8"</script>'), ['https://cdn.example/video.mp4', 'https://cdn.example/master.m3u8']);
  assert.ok(generateVideoSlugVariations('ova-demo-episode-1').includes('demo-1'));
});

test('client rejects malformed upstream JSON shape', async () => {
  const client = createHentaiTvClient({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }) });
  await assert.rejects(() => client.search('Bible Black'), /unexpected payload/);
});

test('client converts an aborted request into a bounded upstream error', async () => {
  const client = createHentaiTvClient({
    timeoutMs: 5,
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  await assert.rejects(() => client.search('Bible Black'), /timed out/);
});
