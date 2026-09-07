const { validateMedia } = require('../shared/contract');
const { rank } = require('../shared/title-match');

/**
 * Adapter boundary for HentaiTV. Supply fetchSearch/fetchEpisode from the approved
 * runtime integration. The resolver does not accept or emit HentaiStream IDs.
 */
async function resolve(mediaInput, client) {
  const media = validateMedia(mediaInput);
  if (!client || typeof client.search !== 'function' || typeof client.episode !== 'function') throw new Error('HentaiTV client must implement search() and episode()');
  const matches = rank(media, await client.search(media.title));
  if (!matches.length) return { streams: [], reason: 'no-title-match', provider: 'hentaitv' };
  const result = await client.episode(matches[0].url, media.episode);
  return { streams: result.streams || [], provider: 'hentaitv', match: { title: matches[0].title, score: matches[0].score } };
}
module.exports = { resolve };
