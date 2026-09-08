const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data', 'imports', 'mal-adult-candidates.json'), 'utf8'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (value) => String(value || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, '').trim();
const capture = (html, expression) => decode((html.match(expression) || [])[1]);
const date = (aired) => { const match = aired.match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/); return match ? new Date(match[0]).toISOString().slice(0, 10) : null; };

async function loadRecord(malId) {
  const response = await fetch(`https://myanimelist.net/anime/${malId}`, { headers: { 'user-agent': 'ScarletPeachCatalog/0.2 (offline metadata build)' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`MAL request failed for ${malId}: ${response.status}`);
  const html = await response.text();
  const rating = capture(html, /Rating:<\/span>\s*([^<]+)/);
  if (rating !== 'Rx - Hentai') return null;
  const canonical = capture(html, /<link rel="canonical" href="([^"]+)"/);
  const title = capture(html, /<meta property="og:title" content="([^"]+)"/);
  const japanese = capture(html, /Japanese:<\/span>\s*([^<]+)/) || null;
  const synonyms = capture(html, /Synonyms:<\/span>\s*([^<]+)/).split(',').map((name) => name.trim()).filter(Boolean);
  const studioBlock = (html.match(/Studios:<\/span>([\s\S]*?)<\/div>/) || [])[1] || '';
  const studio = (studioBlock.match(/title="([^"]+)"/) || [])[1] || null;
  const genres = [...html.matchAll(/itemprop="genre"[^>]*>([^<]+)/g)].map((match) => decode(match[1])).filter(Boolean);
  const aired = capture(html, /Aired:<\/span>\s*([^<]+)/);
  const episodes = Number(capture(html, /Episodes:<\/span>\s*(\d+)/));
  if (!title) throw new Error(`MAL record ${malId} is missing a title`);
  const episodeCount = Number.isInteger(episodes) && episodes > 0 ? episodes : 0;
  return {
    id: `mal:${malId}`,
    type: 'series',
    adult: true,
    sourceConfidence: 'MAL',
    sourceMetadata: {
      source: 'MyAnimeList public title page',
      sourceUrl: canonical || `https://myanimelist.net/anime/${malId}`,
      rating,
      retrievedAt: new Date().toISOString()
    },
    contentRating: { adult: true, classification: rating, source: 'MyAnimeList' },
    title,
    titles: { english: null, romaji: title, japanese, aliases: synonyms },
    description: capture(html, /<meta property="og:description" content="([^"]*)"/) || null,
    poster: capture(html, /<meta property="og:image" content="([^"]+)"/) || null,
    background: null,
    year: date(aired) ? Number(date(aired).slice(0, 4)) : null,
    releaseDate: date(aired),
    updatedAt: null,
    studio,
    genres: [...new Set(genres)],
    tags: ['hentai'],
    languageVersions: [],
    censorStatus: 'unknown',
    episodes: Array.from({ length: episodeCount }, (_, index) => ({
      number: index + 1,
      title: `Episode ${index + 1}`,
      releaseDate: null,
      runtimeSeconds: null,
      thumbnail: null,
      overview: null,
      censorStatus: 'unknown',
      audioLanguages: [],
      subtitleLanguages: [],
      providerMappings: []
    })),
    providerMappings: []
  };
}

async function main() {
  const { normalizeSnapshot, validateSnapshot } = await import(pathToFileURL(path.join(root, 'src', 'schema.mjs')).href);
  const titles = [];
  for (let index = 0; index < source.candidateMalIds.length; index += 4) {
    const batch = await Promise.all(source.candidateMalIds.slice(index, index + 4).map(loadRecord));
    titles.push(...batch.filter(Boolean));
    await delay(900);
  }
  if (titles.length < 50) throw new Error(`Only ${titles.length} verified Rx - Hentai records found; refusing to publish a partial expansion`);
  const candidate = normalizeSnapshot({ schemaVersion: 2, generatedAt: new Date().toISOString(), titles });
  const validation = validateSnapshot(candidate);
  if (!validation.ok) throw new Error(`MAL import validation failed:\n- ${validation.errors.join('\n- ')}`);
  const staged = path.join(root, 'data', 'seed.candidate.json');
  const target = path.join(root, 'data', 'seed.json');
  fs.writeFileSync(staged, JSON.stringify(candidate, null, 2) + '\n');
  fs.renameSync(staged, target);
  console.log(`Imported ${titles.length} MAL adult-only schema v${candidate.schemaVersion} records`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
