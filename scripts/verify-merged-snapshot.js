const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const snapshotPath = path.join(root, 'data', 'snapshots', 'current.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

function requireTitle(id) {
  const title = snapshot.titles.find((item) => item.id === id);
  if (!title) throw new Error(`Required canonical title missing: ${id}`);
  return title;
}

function requireHanimeMapping(title, expectedSlugFragment) {
  const titleMapping = (title.providerMappings || []).find((mapping) => mapping.provider === 'hanime');
  if (!titleMapping) throw new Error(`${title.id} is missing a Hanime title mapping`);
  const episodeMappings = (title.episodes || []).flatMap((episode) => (episode.providerMappings || []).filter((mapping) => mapping.provider === 'hanime'));
  if (!episodeMappings.length) throw new Error(`${title.id} is missing Hanime episode mappings`);
  const exact = episodeMappings.find((mapping) => String(mapping.slug || '').includes(expectedSlugFragment));
  if (!exact) {
    throw new Error(`${title.id} is missing expected Hanime episode slug fragment ${expectedSlugFragment}; saw ${episodeMappings.map((mapping) => mapping.slug).filter(Boolean).join(', ')}`);
  }
  return { titleMapping, exact, episodeMappings };
}

const jimihen = requireHanimeMapping(requireTitle('mal:44044'), 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1');
const bibleBlack = requireHanimeMapping(requireTitle('mal:368'), 'bible-black');

const hanimeMapped = snapshot.titles.filter((title) => (title.providerMappings || []).some((mapping) => mapping.provider === 'hanime')).length;
const spTitles = snapshot.titles.filter((title) => String(title.id || '').startsWith('sp:hanime:')).length;
if (hanimeMapped < 1000) throw new Error(`Hanime mapped title count unexpectedly low: ${hanimeMapped}`);
if (spTitles < 500) throw new Error(`Hanime provider-only title count unexpectedly low: ${spTitles}`);

console.log(JSON.stringify({
  ok: true,
  titleCount: snapshot.titles.length,
  hanimeMapped,
  spTitles,
  jimihen: {
    titleMapping: jimihen.titleMapping.seriesId || jimihen.titleMapping.slug || jimihen.titleMapping.providerId,
    episodeSlug: jimihen.exact.slug
  },
  bibleBlack: {
    titleMapping: bibleBlack.titleMapping.seriesId || bibleBlack.titleMapping.slug || bibleBlack.titleMapping.providerId,
    episodeCount: bibleBlack.episodeMappings.length,
    sampleSlug: bibleBlack.exact.slug
  }
}));
