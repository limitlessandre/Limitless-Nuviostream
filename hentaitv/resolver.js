const { validateMedia } = require('../shared/contract');
const { rank } = require('../shared/title-match');
const { createHentaiTvClient } = require('./client');

async function resolve(mediaInput, client = createHentaiTvClient()) {
  const media = validateMedia(mediaInput);
  if (!client || typeof client.search !== 'function' || typeof client.episode !== 'function') {
    throw new Error('HentaiTV client must implement search() and episode()');
  }

  const queries = [...new Set([media.title, ...media.aliases].filter(Boolean))].slice(0, 4);
  const settled = await Promise.allSettled(queries.map((query) => client.search(query)));
  const candidates = [];
  const seen = new Set();
  let upstreamFailures = 0;

  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      upstreamFailures += 1;
      continue;
    }
    for (const candidate of result.value || []) {
      const key = candidate.slug || candidate.url || `${candidate.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  const matches = rank(media, candidates);
  if (!matches.length) {
    return {
      streams: [],
      reason: upstreamFailures === settled.length ? 'upstream-error' : 'no-title-match',
      provider: 'hentaitv'
    };
  }

  try {
    const result = await client.episode(matches[0], media.episode);
    return {
      streams: result.streams || [],
      reason: result.reason,
      provider: 'hentaitv',
      match: { title: matches[0].title, score: matches[0].score, slug: result.slug || matches[0].slug }
    };
  } catch (error) {
    return { streams: [], reason: 'upstream-error', provider: 'hentaitv', error: error.message };
  }
}

module.exports = { resolve };
