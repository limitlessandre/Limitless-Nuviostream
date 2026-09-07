const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const snapshot = () => {
  const live = path.join(root, 'data', 'snapshots', 'current.json');
  const fallback = path.join(root, 'data', 'seed.json');
  return JSON.parse(fs.readFileSync(fs.existsSync(live) ? live : fallback, 'utf8'));
};
const manifest = { id: 'org.limitlessnexus.scarletpeach.catalog', version: '0.1.0-test', name: 'Limitless Nexus: Scarlet Peach (Test)', resources: ['catalog', 'meta'], types: ['series'], catalogs: [
  { type: 'series', id: 'scarlet-peach-search', name: 'Scarlet Peach Search', extra: [{ name: 'search', isRequired: true }] },
  { type: 'series', id: 'scarlet-peach-latest', name: 'Scarlet Peach Latest' },
  { type: 'series', id: 'scarlet-peach-all', name: 'Scarlet Peach All' }
] };
const respond = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts.join('/') === 'manifest.json') return respond(res, manifest);
  const data = snapshot();
  if (parts[0] === 'catalog') {
    const query = (new URL(req.url, 'http://localhost').searchParams.get('search') || '').toLowerCase();
    const titles = data.titles.filter((item) => item.adult === true).filter((item) => !query || [item.title, ...item.titles.aliases].join(' ').toLowerCase().includes(query));
    return respond(res, { metas: titles.map(toMeta) });
  }
  if (parts[0] === 'meta' && parts[2]) { const id = decodeURIComponent(parts[2]).replace(/\.json$/, ''); const item = data.titles.find((title) => title.id === id); return respond(res, item ? { meta: toMeta(item, true) } : { meta: null }, item ? 200 : 404); }
  respond(res, { error: 'Not found' }, 404);
}).listen(process.env.PORT || 7001, () => console.log('Scarlet Peach catalog listening on port 7001'));
function toMeta(item, detailed = false) { return { id: item.id, type: item.type, name: item.title, poster: item.poster || undefined, description: detailed ? item.description : undefined, year: item.year || undefined, genres: item.genres, videos: detailed ? item.episodes.map((episode) => ({ id: `${item.id}:${episode.number}`, title: episode.title || `Episode ${episode.number}`, episode: episode.number })) : undefined }; }
