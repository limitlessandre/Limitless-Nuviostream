const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const feedUrl = process.env.HANIME_CATALOG_FEED || 'https://scarlet-peach-hanime.limitlessandre.workers.dev/catalog.json';

async function main() {
  const response = await fetch(feedUrl, {
    headers: { 'user-agent': 'ScarletPeachCatalog/0.3 HanimeImporter' },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`Hanime catalog feed HTTP ${response.status}`);

  const feed = await response.json();
  if (feed.provider !== 'hanime' || !Array.isArray(feed.records) || feed.records.length < 1000) {
    throw new Error(`Refusing partial Hanime import: provider=${feed.provider} records=${feed.records?.length || 0}`);
  }

  const { buildHanimeProviderImport } = await import(pathToFileURL(path.join(root, 'src', 'hanime-import.mjs')).href);
  const payload = buildHanimeProviderImport(feed, new Date().toISOString());
  if (!Array.isArray(payload.records) || payload.records.length < 500) {
    throw new Error(`Hanime grouping produced suspiciously few series records: ${payload.records?.length || 0}`);
  }

  const dir = path.join(root, 'data', 'imports', 'providers');
  fs.mkdirSync(dir, { recursive: true });
  const staged = path.join(dir, 'hanime.candidate.json');
  const target = path.join(dir, 'hanime.json');
  fs.writeFileSync(staged, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(staged, target);

  const censored = payload.records.filter((record) => record.censorStatus === 'censored').length;
  const uncensored = payload.records.filter((record) => record.censorStatus === 'uncensored').length;
  const mixed = payload.records.filter((record) => record.censorStatus === 'mixed').length;
  const unknown = payload.records.filter((record) => record.censorStatus === 'unknown').length;
  const multiEpisode = payload.records.filter((record) => (record.episodes || []).length > 1).length;

  console.log(JSON.stringify({
    provider: payload.provider,
    sourceRecords: payload.sourceRecordCount,
    groupedRecords: payload.records.length,
    multiEpisode,
    censorship: { censored, uncensored, mixed, unknown },
    output: target
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
