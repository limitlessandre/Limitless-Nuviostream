const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const manifest = {
  id: 'org.limitlessnexus.scarletpeach.catalog',
  version: '0.3.0',
  name: 'Limitless Nexus: Scarlet Peach',
  description: 'Adult-only normalized metadata catalog with schema v2 provider merging, censorship, language, tags, episode metadata, and Hanime catalog coverage.',
  resources: ['catalog', 'meta'],
  types: ['series'],
  catalogs: [
    { type: 'series', id: 'scarlet-peach-search', name: 'Scarlet Peach Search', extra: [{ name: 'search', isRequired: true }] },
    { type: 'series', id: 'scarlet-peach-latest', name: 'Scarlet Peach Latest' },
    { type: 'series', id: 'scarlet-peach-all', name: 'Scarlet Peach All' }
  ]
};
const respond = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

function catalogSummary(data) {
  const providerCounts = {};
  const censorStatusCounts = { censored: 0, uncensored: 0, mixed: 0, unknown: 0 };
  let spTitleCount = 0;
  let mappedTitleCount = 0;

  for (const title of data.titles || []) {
    if (String(title.id || '').startsWith('sp:')) spTitleCount += 1;
    const status = censorStatusCounts[title.censorStatus] === undefined ? 'unknown' : title.censorStatus;
    censorStatusCounts[status] += 1;
    const providers = new Set((title.providerMappings || []).map((mapping) => mapping.provider).filter(Boolean));
    if (providers.size) mappedTitleCount += 1;
    for (const provider of providers) providerCounts[provider] = (providerCounts[provider] || 0) + 1;
  }

  return { providerCounts, censorStatusCounts, spTitleCount, mappedTitleCount };
}

async function main() {
  const [{ catalogMetas, parseCatalogRequest, toMeta }, { normalizeSnapshot, schemaDescriptor, validateSnapshot }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'src', 'catalog.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'schema.mjs')).href)
  ]);

  const loadSnapshot = () => {
    const live = path.join(root, 'data', 'snapshots', 'current.json');
    const fallback = path.join(root, 'data', 'seed.json');
    const normalized = normalizeSnapshot(JSON.parse(fs.readFileSync(fs.existsSync(live) ? live : fallback, 'utf8')));
    const validation = validateSnapshot(normalized);
    if (!validation.ok) throw new Error(`Invalid local Scarlet Peach snapshot: ${validation.errors.join('; ')}`);
    return normalized;
  };

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/manifest.json') return respond(res, manifest);
    const data = loadSnapshot();
    if (url.pathname === '/health') return respond(res, {
      ok: true,
      service: 'Scarlet Peach Catalog',
      version: manifest.version,
      schemaVersion: data.schemaVersion,
      generatedAt: data.generatedAt,
      titleCount: data.titles.length,
      ...catalogSummary(data)
    });
    if (url.pathname === '/schema.json') return respond(res, schemaDescriptor());
    if (url.pathname === '/dataset.json' || url.pathname === '/data/current.json') return respond(res, data);
    const request = parseCatalogRequest(url);
    if (request) return respond(res, { metas: catalogMetas(data, request) });
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'meta' && parts[2]) {
      const id = decodeURIComponent(parts[2]).replace(/\.json$/, '');
      const item = data.titles.find((title) => title.id === id);
      return respond(res, item ? { meta: toMeta(item, true) } : { meta: null }, item ? 200 : 404);
    }
    respond(res, { error: 'Not found' }, 404);
  }).listen(process.env.PORT || 7001, () => console.log('Scarlet Peach catalog listening on port 7001'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
