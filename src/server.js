const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const manifest = {
  id: 'org.limitlessnexus.scarletpeach.catalog',
  version: '0.2.0',
  name: 'Limitless Nexus: Scarlet Peach',
  description: 'Adult-only normalized metadata catalog with reusable schema v2 provider mappings, censorship, language, tags, and episode metadata.',
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
    if (url.pathname === '/health') return respond(res, { ok: true, service: 'Scarlet Peach Catalog', schemaVersion: data.schemaVersion, generatedAt: data.generatedAt, titleCount: data.titles.length });
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
