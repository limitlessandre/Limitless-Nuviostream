const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const sourceUrl = process.env.HSTREAM_CATALOG_URL || 'https://hstream.moe/v1/hentai-list';
const UA = 'ScarletPeachCatalog/0.5 HStreamImporter';

async function fetchWithRetry(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(60000)
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

async function main() {
  const response = await fetchWithRetry(sourceUrl);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('HStream /v1/hentai-list did not return an array');
  if (data.length < 100) throw new Error(`Refusing partial HStream import: titles=${data.length}`);

  const { buildHStreamProviderImport } = await import(pathToFileURL(path.join(root, 'src', 'hstream-import.mjs')).href);
  const parsedSource = new URL(sourceUrl);
  const baseUrl = `${parsedSource.protocol}//${parsedSource.host}`;
  const payload = buildHStreamProviderImport(data, new Date().toISOString(), { minRecords: 100, baseUrl });

  if (!Array.isArray(payload.records) || payload.records.length < 100) {
    throw new Error(`HStream normalization produced suspiciously few records: ${payload.records?.length || 0}`);
  }
  const episodeCount = payload.records.reduce((sum, record) => sum + (record.episodes || []).length, 0);
  if (episodeCount < 100) throw new Error(`HStream episode coverage unexpectedly low: ${episodeCount}`);

  const dir = path.join(root, 'data', 'imports', 'providers');
  fs.mkdirSync(dir, { recursive: true });
  const staged = path.join(dir, 'hstream.candidate.json');
  const target = path.join(dir, 'hstream.json');
  fs.writeFileSync(staged, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(staged, target);

  console.log(JSON.stringify({
    provider: payload.provider,
    sourceTitles: data.length,
    normalizedTitles: payload.records.length,
    exactEpisodeMappings: episodeCount,
    skippedEpisodes: payload.skippedEpisodes || 0,
    output: target
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
