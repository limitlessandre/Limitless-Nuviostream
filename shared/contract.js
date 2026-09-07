/** Provider input is catalog-owned identity, never a site-private ID. */
function validateMedia(input) {
  if (!input || !/^(mal|anilist|sp):/.test(input.id || '')) throw new Error('id must be a stable mal:, anilist:, or sp: ID');
  if (input.type !== 'series') throw new Error('MVP supports series only');
  if (!input.title || !Array.isArray(input.aliases)) throw new Error('title and aliases are required');
  if (input.episode != null && (!Number.isInteger(input.episode) || input.episode < 1)) throw new Error('episode must be a positive integer');
  return Object.freeze({ id: input.id, type: input.type, title: input.title, aliases: input.aliases, year: input.year || null, episode: input.episode || 1 });
}
module.exports = { validateMedia };
