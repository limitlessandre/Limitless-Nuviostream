const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const baseUrl = (process.env.HENTAIHAVEN_CATALOG_BASE || 'https://hentaihaven.vip').replace(/\/$/, '');
const UA = 'ScarletPeachCatalog/0.4 HentaiHavenImporter';

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'user-agent': UA, accept: '*/*', ...(options.headers || {}) },
        signal: AbortSignal.timeout(45000)
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
  return { response, data: await response.json() };
}

async function fetchText(url) {
  const response = await fetchWithRetry(url, { headers: { accept: 'text/xml,application/xml,text/plain,*/*' } });
  return await response.text();
}

async function fetchPagedCollection(restBase, fields) {
  const firstUrl = new URL(`${baseUrl}/wp-json/wp/v2/${restBase}`);
  firstUrl.searchParams.set('per_page', '100');
  firstUrl.searchParams.set('page', '1');
  if (fields?.length) firstUrl.searchParams.set('_fields', fields.join(','));

  const first = await fetchJson(firstUrl.toString());
  if (!Array.isArray(first.data)) throw new Error(`${restBase} did not return an array`);
  const total = Number(first.response.headers.get('x-wp-total') || first.data.length);
  const totalPages = Number(first.response.headers.get('x-wp-totalpages') || 1);
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 100) throw new Error(`Invalid ${restBase} total pages: ${totalPages}`);

  const pages = [first.data];
  const pending = [];
  for (let page = 2; page <= totalPages; page++) pending.push(page);

  const concurrency = 4;
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (page) => {
      const url = new URL(firstUrl);
      url.searchParams.set('page', String(page));
      const { data } = await fetchJson(url.toString());
      if (!Array.isArray(data)) throw new Error(`${restBase} page ${page} did not return an array`);
      return data;
    }));
    pages.push(...results);
  }

  const items = pages.flat();
  if (items.length < Math.min(total, 1)) throw new Error(`${restBase} returned no items`);
  return { items, total, totalPages };
}

function sitemapLocations(xml, pattern) {
  const out = [];
  const re = /<loc>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const url = String(match[1] || '').trim().replace(/&amp;/g, '&');
    if (url && pattern.test(url)) out.push(url);
  }
  return [...new Set(out)];
}

async function main() {
  const postFields = [
    'id', 'date', 'date_gmt', 'modified', 'modified_gmt', 'slug', 'link', 'title', 'content', 'excerpt', 'meta',
    'wp-manga-genre', 'wp-manga-tag', 'wp-manga-release', 'wp-manga-author', 'class_list'
  ];
  const termFields = ['id', 'name', 'slug'];

  const [postsResult, genresResult, tagsResult, authorsResult, releasesResult, sitemapIndex] = await Promise.all([
    fetchPagedCollection('wp-manga', postFields),
    fetchPagedCollection('wp-manga-genre', termFields),
    fetchPagedCollection('wp-manga-tag', termFields),
    fetchPagedCollection('wp-manga-author', termFields),
    fetchPagedCollection('wp-manga-release', termFields),
    fetchText(`${baseUrl}/sitemap_index.xml`)
  ]);

  if (postsResult.items.length < 800) {
    throw new Error(`Refusing partial HentaiHaven import: titles=${postsResult.items.length}`);
  }

  const titleSitemapUrls = sitemapLocations(sitemapIndex, /\/wp-manga-sitemap\d*\.xml(?:$|[?#])/i);
  const chapterSitemapUrls = sitemapLocations(sitemapIndex, /\/wp-manga-chapters-sitemap\d*\.xml(?:$|[?#])/i);
  if (!titleSitemapUrls.length || !chapterSitemapUrls.length) {
    throw new Error(`HentaiHaven sitemap discovery failed: titles=${titleSitemapUrls.length} chapters=${chapterSitemapUrls.length}`);
  }

  const [titleSitemaps, chapterSitemaps] = await Promise.all([
    Promise.all(titleSitemapUrls.map(fetchText)),
    Promise.all(chapterSitemapUrls.map(fetchText))
  ]);

  const { buildHentaiHavenProviderImport } = await import(pathToFileURL(path.join(root, 'src', 'hentaihaven-import.mjs')).href);
  const payload = buildHentaiHavenProviderImport({
    baseUrl,
    posts: postsResult.items,
    terms: {
      genres: genresResult.items,
      tags: tagsResult.items,
      authors: authorsResult.items,
      releases: releasesResult.items
    },
    titleSitemaps,
    chapterSitemaps
  }, new Date().toISOString(), { minRecords: 800 });

  if (!Array.isArray(payload.records) || payload.records.length < 800) {
    throw new Error(`HentaiHaven normalization produced suspiciously few records: ${payload.records?.length || 0}`);
  }

  const episodeCount = payload.records.reduce((sum, record) => sum + (record.episodes || []).length, 0);
  if (episodeCount < 700) throw new Error(`HentaiHaven numeric episode coverage unexpectedly low: ${episodeCount}`);

  const dir = path.join(root, 'data', 'imports', 'providers');
  fs.mkdirSync(dir, { recursive: true });
  const staged = path.join(dir, 'hentaihaven.candidate.json');
  const target = path.join(dir, 'hentaihaven.json');
  fs.writeFileSync(staged, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(staged, target);

  const censorship = { censored: 0, uncensored: 0, mixed: 0, unknown: 0 };
  for (const record of payload.records) censorship[record.censorStatus] = (censorship[record.censorStatus] || 0) + 1;

  console.log(JSON.stringify({
    provider: payload.provider,
    sourceTitles: postsResult.items.length,
    normalizedTitles: payload.records.length,
    numericEpisodes: episodeCount,
    skippedNonNumericEpisodes: payload.skippedNonNumericEpisodes || 0,
    titleSitemaps: titleSitemapUrls.length,
    chapterSitemaps: chapterSitemapUrls.length,
    taxonomyTerms: {
      genres: genresResult.items.length,
      tags: tagsResult.items.length,
      authors: authorsResult.items.length,
      releases: releasesResult.items.length
    },
    censorship,
    output: target
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
