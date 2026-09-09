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

function requireProviderMapping(title, provider, expectedSlugFragment) {
  const titleMapping = (title.providerMappings || []).find((mapping) => mapping.provider === provider);
  if (!titleMapping) throw new Error(`${title.id} is missing a ${provider} title mapping`);
  const episodeMappings = (title.episodes || []).flatMap((episode) =>
    (episode.providerMappings || []).filter((mapping) => mapping.provider === provider)
  );
  if (!episodeMappings.length) throw new Error(`${title.id} is missing ${provider} episode mappings`);
  const exact = episodeMappings.find((mapping) => String(mapping.slug || '').includes(expectedSlugFragment));
  if (!exact) {
    throw new Error(`${title.id} is missing expected ${provider} episode slug fragment ${expectedSlugFragment}; saw ${episodeMappings.map((mapping) => mapping.slug).filter(Boolean).join(', ')}`);
  }
  return { titleMapping, exact, episodeMappings };
}

const jimihenTitle = requireTitle('mal:44044');
const bibleBlackTitle = requireTitle('mal:368');
const jimihenHanime = requireProviderMapping(jimihenTitle, 'hanime', 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1');
const bibleBlackHanime = requireProviderMapping(bibleBlackTitle, 'hanime', 'bible-black');
const jimihenHentaiHaven = requireProviderMapping(jimihenTitle, 'hentaihaven', 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu/episode-1');
const bibleBlackHentaiHaven = requireProviderMapping(bibleBlackTitle, 'hentaihaven', 'bible-black-1/episode-1');

const hanimeMapped = snapshot.titles.filter((title) => (title.providerMappings || []).some((mapping) => mapping.provider === 'hanime')).length;
const hentaiHavenMapped = snapshot.titles.filter((title) => (title.providerMappings || []).some((mapping) => mapping.provider === 'hentaihaven')).length;
const spHanimeTitles = snapshot.titles.filter((title) => String(title.id || '').startsWith('sp:hanime:')).length;
const spHentaiHavenTitles = snapshot.titles.filter((title) => String(title.id || '').startsWith('sp:hentaihaven:')).length;

if (hanimeMapped < 1000) throw new Error(`Hanime mapped title count unexpectedly low: ${hanimeMapped}`);
if (spHanimeTitles < 500) throw new Error(`Hanime provider-only title count unexpectedly low: ${spHanimeTitles}`);
if (hentaiHavenMapped < 900) throw new Error(`HentaiHaven mapped title count unexpectedly low: ${hentaiHavenMapped}`);
if (spHentaiHavenTitles < 150) throw new Error(`HentaiHaven provider-only title count unexpectedly low: ${spHentaiHavenTitles}`);

console.log(JSON.stringify({
  ok: true,
  titleCount: snapshot.titles.length,
  providerCoverage: {
    hanime: { mapped: hanimeMapped, providerOnly: spHanimeTitles },
    hentaihaven: { mapped: hentaiHavenMapped, providerOnly: spHentaiHavenTitles }
  },
  jimihen: {
    hanimeTitleMapping: jimihenHanime.titleMapping.seriesId || jimihenHanime.titleMapping.slug || jimihenHanime.titleMapping.providerId,
    hanimeEpisodeSlug: jimihenHanime.exact.slug,
    hentaiHavenTitleMapping: jimihenHentaiHaven.titleMapping.seriesId || jimihenHentaiHaven.titleMapping.slug || jimihenHentaiHaven.titleMapping.providerId,
    hentaiHavenEpisodeSlug: jimihenHentaiHaven.exact.slug
  },
  bibleBlack: {
    hanimeTitleMapping: bibleBlackHanime.titleMapping.seriesId || bibleBlackHanime.titleMapping.slug || bibleBlackHanime.titleMapping.providerId,
    hanimeEpisodeCount: bibleBlackHanime.episodeMappings.length,
    hentaiHavenTitleMapping: bibleBlackHentaiHaven.titleMapping.seriesId || bibleBlackHentaiHaven.titleMapping.slug || bibleBlackHentaiHaven.titleMapping.providerId,
    hentaiHavenEpisodeCount: bibleBlackHentaiHaven.episodeMappings.length,
    hentaiHavenSampleSlug: bibleBlackHentaiHaven.exact.slug
  }
}));
