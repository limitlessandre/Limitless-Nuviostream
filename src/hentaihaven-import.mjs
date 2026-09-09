const clean = (value) => String(value == null ? '' : value).trim();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];

function decodeEntities(value) {
  return clean(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value, base = 'https://hentaihaven.vip/') {
  const raw = clean(value).replace(/&amp;/g, '&');
  if (!raw) return null;
  try { return new URL(raw, base).toString(); } catch (_) { return null; }
}

function termMap(terms) {
  const map = new Map();
  for (const term of terms || []) {
    const id = Number(term && term.id);
    const name = decodeEntities(term && term.name);
    if (Number.isInteger(id) && name) map.set(id, { id, name, slug: clean(term.slug) });
  }
  return map;
}

function namesFor(ids, map) {
  return unique((ids || []).map((id) => map.get(Number(id))?.name));
}

function slugsFor(ids, map) {
  return unique((ids || []).map((id) => map.get(Number(id))?.slug));
}

function censorshipFrom(post, genreNames, tagNames, genreSlugs, tagSlugs) {
  const classes = unique(post && post.class_list || []).map((value) => value.toLowerCase());
  const names = unique([...genreNames, ...tagNames]).map((value) => value.toLowerCase());
  const slugs = unique([...genreSlugs, ...tagSlugs]).map((value) => value.toLowerCase());
  const haystack = [...classes, ...names, ...slugs];

  const uncensored = haystack.some((value) =>
    /(^|[-_\s])uncensored($|[-_\s])/.test(value) || value === 'uncensored hentai'
  );
  const censored = haystack.some((value) =>
    !/uncensored/.test(value) && (/(^|[-_\s])censored($|[-_\s])/.test(value) || value === 'censored')
  );

  if (censored && uncensored) return 'mixed';
  if (uncensored) return 'uncensored';
  if (censored) return 'censored';
  return 'unknown';
}

const GENERIC_TAGS = new Set([
  'anime hentai', 'anime porn', 'e hentai', 'ehentai', 'free hentai', 'ge hentai',
  'hanime', 'hanime tv', 'hd', 'hentai', 'hentai anime', 'hentai chan', 'hentai foundry',
  'hentai haven', 'hentai manga', 'hentai porn', 'hentai stream', 'hentai tv', 'hentai vid',
  'hentai video', 'hentai videos', 'hentaidude', 'mp4hentai', 'nhentai', 'rule 34',
  'watch hentai', 'xanimeporn', 'censored', 'uncensored', 'uncensored hentai'
]);

function usefulTags(values) {
  return unique(values).filter((value) => !GENERIC_TAGS.has(value.toLowerCase()));
}

function yearFromRelease(values) {
  for (const value of values || []) {
    const match = clean(value).match(/\b(19|20)\d{2}\b/);
    if (match) return Number(match[0]);
  }
  return null;
}

function sitemapEntries(xml) {
  const out = [];
  const source = String(xml || '');
  const re = /<url>([\s\S]*?)<\/url>/gi;
  let match;
  while ((match = re.exec(source))) {
    const block = match[1];
    const loc = decodeEntities(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]);
    if (!loc) continue;
    const lastmod = decodeEntities(block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]) || null;
    const image = decodeEntities(block.match(/<image:loc>([\s\S]*?)<\/image:loc>/i)?.[1]) || null;
    out.push({ url: loc, lastmod, image });
  }
  return out;
}

function titleSitemapMap(xmlDocuments) {
  const map = new Map();
  for (const xml of xmlDocuments || []) {
    for (const entry of sitemapEntries(xml)) {
      const match = entry.url.match(/\/watch\/([^/?#]+)\/?(?:[?#]|$)/i);
      if (!match) continue;
      map.set(match[1], entry);
    }
  }
  return map;
}

function chapterSitemapMap(xmlDocuments) {
  const map = new Map();
  let skippedNonNumeric = 0;
  for (const xml of xmlDocuments || []) {
    for (const entry of sitemapEntries(xml)) {
      const match = entry.url.match(/\/watch\/([^/?#]+)\/episode-([^/?#]+)\/?(?:[?#]|$)/i);
      if (!match) continue;
      const slug = match[1];
      const token = match[2];
      const numberMatch = token.match(/^(\d+)$/);
      if (!numberMatch) {
        skippedNonNumeric += 1;
        continue;
      }
      const number = Number(numberMatch[1]);
      if (!Number.isInteger(number) || number <= 0) continue;
      if (!map.has(slug)) map.set(slug, []);
      const list = map.get(slug);
      if (!list.some((item) => item.number === number)) list.push({ number, url: entry.url, lastmod: entry.lastmod });
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.number - b.number);
  return { map, skippedNonNumeric };
}

function providerPoster(post, sitemap, baseUrl) {
  if (sitemap?.image) return absoluteUrl(sitemap.image, baseUrl);
  const remote = clean(post?.meta?.vraven_remote_thumbnail);
  if (remote) return absoluteUrl(remote, baseUrl);
  return null;
}

function makeEpisode(post, episode, seriesId, censorStatus, now) {
  const providerId = Number(post.id);
  const slug = clean(post.slug);
  return {
    number: episode.number,
    title: `Episode ${episode.number}`,
    releaseDate: null,
    runtimeSeconds: null,
    thumbnail: null,
    overview: null,
    censorStatus,
    audioLanguages: [],
    subtitleLanguages: [],
    providerId: Number.isInteger(providerId) ? `${providerId}:episode:${episode.number}` : null,
    seriesId,
    slug: `${slug}/episode-${episode.number}`,
    url: episode.url,
    tags: [],
    qualities: [],
    lastVerifiedAt: now,
    metadata: {
      sitemapLastmod: episode.lastmod || null,
      sourceBackend: 'vip',
      sourceHost: 'hentaihaven.vip'
    }
  };
}

export function buildHentaiHavenProviderImport(input, now = new Date().toISOString(), options = {}) {
  const minRecords = Number.isInteger(options.minRecords) ? options.minRecords : 500;
  const posts = Array.isArray(input?.posts) ? input.posts : [];
  if (posts.length < minRecords) throw new Error(`HentaiHaven feed is unexpectedly small: ${posts.length}`);

  const genres = termMap(input?.terms?.genres);
  const tags = termMap(input?.terms?.tags);
  const authors = termMap(input?.terms?.authors);
  const releases = termMap(input?.terms?.releases);
  const titleSitemaps = titleSitemapMap(input?.titleSitemaps);
  const chapterResult = chapterSitemapMap(input?.chapterSitemaps);
  const chapterMap = chapterResult.map;
  const baseUrl = clean(input?.baseUrl) || 'https://hentaihaven.vip/';

  const records = [];
  for (const post of posts) {
    const title = decodeEntities(post?.title?.rendered || post?.title);
    const slug = clean(post?.slug);
    if (!title || !slug) continue;

    const genreNames = namesFor(post['wp-manga-genre'], genres);
    const tagNames = namesFor(post['wp-manga-tag'], tags);
    const genreSlugs = slugsFor(post['wp-manga-genre'], genres);
    const tagSlugs = slugsFor(post['wp-manga-tag'], tags);
    const authorNames = namesFor(post['wp-manga-author'], authors);
    const releaseNames = namesFor(post['wp-manga-release'], releases);
    const censorStatus = censorshipFrom(post, genreNames, tagNames, genreSlugs, tagSlugs);
    const seriesId = `hentaihaven:series:${slug}`;
    const sitemap = titleSitemaps.get(slug);
    const episodeRows = chapterMap.get(slug) || [];
    const episodes = episodeRows.map((episode) => makeEpisode(post, episode, seriesId, censorStatus, now));
    const providerId = Number(post.id);
    const description = stripHtml(post?.content?.rendered || post?.excerpt?.rendered || '');
    const genresNormalized = usefulTags(genreNames.filter((value) => !/^(?:censored|uncensored hentai)$/i.test(value)));
    if (!genresNormalized.some((value) => value.toLowerCase() === 'hentai')) genresNormalized.unshift('Hentai');

    records.push({
      providerId: Number.isInteger(providerId) ? String(providerId) : slug,
      seriesId,
      slug,
      title,
      providerTitle: title,
      seriesTitle: title,
      aliases: [],
      description: description || null,
      poster: providerPoster(post, sitemap, baseUrl),
      background: null,
      brand: authorNames[0] || null,
      studio: authorNames[0] || null,
      year: yearFromRelease(releaseNames),
      releaseDate: null,
      genres: genresNormalized,
      tags: usefulTags(tagNames),
      censorStatus,
      audioLanguages: [],
      subtitleLanguages: [],
      qualities: [],
      url: absoluteUrl(post.link, baseUrl) || `${baseUrl.replace(/\/$/, '')}/watch/${slug}/`,
      lastVerifiedAt: now,
      metadata: {
        wordpressId: Number.isInteger(providerId) ? providerId : null,
        wordpressModifiedAt: clean(post.modified_gmt || post.modified) || null,
        sourceBackend: 'vip',
        sourceHost: 'hentaihaven.vip',
        titleSitemapLastmod: sitemap?.lastmod || null,
        rawGenreNames: genreNames,
        rawTagNames: tagNames,
        studioTerms: authorNames,
        releaseTerms: releaseNames,
        sourceEpisodeCount: episodeRows.length
      },
      episodes
    });
  }

  records.sort((a, b) => a.title.localeCompare(b.title));
  return {
    provider: 'hentaihaven',
    schemaVersion: 1,
    generatedAt: now,
    source: `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/wp-manga`,
    sourceRecordCount: posts.length,
    skippedNonNumericEpisodes: chapterResult.skippedNonNumeric,
    records
  };
}

export const _test = { sitemapEntries, titleSitemapMap, chapterSitemapMap, censorshipFrom, stripHtml };
