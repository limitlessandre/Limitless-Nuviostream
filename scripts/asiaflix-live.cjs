// Run with Node 22+: node scripts/asiaflix-live.cjs [provider-file]
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const provider = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'custom/providers/asiaflix-nexus-probe-v3.js';
const nativeFetch = global.fetch;
const key = fs.readFileSync(provider, 'utf8').match(/TMDB_API_KEY = "([^"]+)"/)[1];
async function main() {
  for (const title of ['Kamen Rider Ex-Aid', 'Kamen Rider Den-O']) {
    const search = await nativeFetch(`https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(title)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    const match = search.results.find(r => r.name.toLowerCase() === title.toLowerCase());
    if (!match) throw new Error(`No exact TMDB match: ${title}`);
    console.log(JSON.stringify({ title, tmdb: match.id, episode: 'S1E1', provider }));
    const context = { module: { exports: {} }, console, URL, setTimeout, clearTimeout, AbortController,
      fetch: async (url, options) => {
        const start = Date.now();
        const safeUrl = url.replace(key, 'REDACTED');
        console.log('START', safeUrl);
        try {
          const response = await nativeFetch(url, { ...options, signal: AbortSignal.any([options?.signal || new AbortController().signal, AbortSignal.timeout(8000)]) });
          console.log('HEADERS', response.status, Date.now() - start, safeUrl);
          return { ok: response.ok, status: response.status, json: async () => {
            const data = await response.json();
            console.log('BODY', Date.now() - start, safeUrl);
            if (url.includes('/drama/detail')) console.log('EPISODE', JSON.stringify(data.episodes?.find(e => Number(e.number) === 1)));
            return data;
          }};
        } catch (error) { console.log('ERROR', Date.now() - start, error.message, safeUrl); throw error; }
      }
    };
    if (process.argv.includes('--no-timers')) { delete context.setTimeout; delete context.clearTimeout; }
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.resolve(provider), 'utf8'), context);
    const start = Date.now();
    const rows = await context.module.exports.getStreams(match.id, 'tv', 1, 1);
    console.log('RESULT', Date.now() - start, JSON.stringify(rows));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
