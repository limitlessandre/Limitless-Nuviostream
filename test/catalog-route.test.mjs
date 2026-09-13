import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogMetas, parseCatalogRequest } from '../src/catalog.mjs';
import { publicTaxonomy, taxonomyManifestCatalogs } from '../src/taxonomy.mjs';

const snapshot = { titles: [
  { id: 'mal:368', type: 'series', adult: true, title: 'Bible Black', titles: { english: null, romaji: 'Bible Black', japanese: 'バイブルブラック', aliases: [] }, genres: ['Horror'], tags: ['incest'], censorStatus: 'censored', releaseDate: '2001-07-21' },
  { id: 'mal:49095', type: 'series', adult: true, title: 'Kuroinu II The Animation', titles: { english: null, romaji: 'Kuroinu II The Animation', japanese: null, aliases: [] }, genres: [], tags: [], censorStatus: 'unknown', releaseDate: '2021-08-27' },
  { id: 'sp:test:milf', type: 'series', adult: true, title: 'MILF Test', titles: { english: null, romaji: 'MILF Test', japanese: null, aliases: [] }, genres: [], tags: ['milf'], providerMappings: [{ provider: 'hanime', tags: ['milf'], metadata: { views: 80, rating: 9.1 } }, { provider: 'hstream', tags: ['milf'] }], censorStatus: 'uncensored', releaseDate: '2024-01-01', episodes: [{ number: 1, providerMappings: [] }] },
  { id: 'sp:test:breasts', type: 'series', adult: true, title: 'Big Boobs Test', titles: { english: null, romaji: 'Big Boobs Test', japanese: null, aliases: [] }, genres: [], tags: ['big boobs'], providerMappings: [{ provider: 'hanime', tags: ['big boobs'], metadata: { views: 1200, likes: 70 } }], censorStatus: 'unknown', releaseDate: '2024-02-01', episodes: [{ number: 1, providerMappings: [] }] },
  { id: 'sp:test:rape', type: 'series', adult: true, title: 'Rape Tag Test', titles: { english: null, romaji: 'Rape Tag Test', japanese: null, aliases: [] }, genres: [], tags: [], providerMappings: [{ provider: 'test', tags: ['rape'], metadata: { views: 300 } }], censorStatus: 'unknown', releaseDate: '2023-01-01', episodes: [{ number: 1, providerMappings: [] }, { number: 2, providerMappings: [] }] },
  { id: 'sp:test:minor-coded', type: 'series', adult: true, title: 'Excluded Minor-Coded Tag Test', titles: { english: null, romaji: 'Excluded Minor-Coded Tag Test', japanese: null, aliases: [] }, genres: [], tags: ['loli', 'school girl'], providerMappings: [{ provider: 'hanime', tags: ['loli'], metadata: { views: 999999 } }], censorStatus: 'unknown', releaseDate: '2022-01-01' }
] };

test('parses Bible Black from a path-encoded search extra', () => assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=bible%20black.json')).search, 'bible black'));
test('parses Naruto from a path-encoded search extra', () => assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=naruto.json')).search, 'naruto'));
test('unmatched search returns no metas', () => assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=naruto.json'))), []));

test('parses parent and nested taxonomy genre extras', () => {
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=MILF.json')).genre, 'MILF');
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=Big%20Boobs.json')).genre, 'Big Boobs');
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-kinks.json?genre=Rape')).genre, 'Rape');
});

test('taxonomy filters parent tags, child tabs, provider tags, and censorship state', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=MILF.json'))).map((meta) => meta.id), ['sp:test:milf']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=Breasts.json'))).map((meta) => meta.id), ['sp:test:breasts']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=Big%20Boobs.json'))).map((meta) => meta.id), ['sp:test:breasts']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-kinks/genre=Rape.json'))).map((meta) => meta.id), ['sp:test:rape']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=Uncensored.json'))).map((meta) => meta.id), ['sp:test:milf']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-niche/genre=Censored.json'))).map((meta) => meta.id), ['mal:368']);
});

test('manifest taxonomy catalogs expose four parent catalogs and child genre options', () => {
  const catalogs = taxonomyManifestCatalogs();
  assert.deepEqual(catalogs.map((catalog) => catalog.id), ['scarlet-peach-main', 'scarlet-peach-kinks', 'scarlet-peach-characters', 'scarlet-peach-niche']);
  const mainOptions = catalogs.find((catalog) => catalog.id === 'scarlet-peach-main').extra[0].options;
  const kinkOptions = catalogs.find((catalog) => catalog.id === 'scarlet-peach-kinks').extra[0].options;
  const characterOptions = catalogs.find((catalog) => catalog.id === 'scarlet-peach-characters').extra[0].options;
  assert.ok(mainOptions.includes('Big Boobs'));
  assert.ok(mainOptions.includes('Step Mother'));
  assert.ok(kinkOptions.includes('Blow Job'));
  assert.ok(characterOptions.includes('Maid'));
});

test('taxonomy exposes the four browse rows without minor-coded sexual categories', () => {
  const taxonomy = publicTaxonomy();
  const names = [
    ...taxonomy.flatMap((group) => group.categories),
    ...taxonomy.flatMap((group) => group.folders.flatMap((folder) => folder.tabs))
  ].map((name) => name.toLowerCase());
  assert.ok(names.includes('rape'));
  assert.ok(!names.some((name) => /loli|shota|school/.test(name)));
});

test('minor-coded source tags alone do not enter Characters or Main', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-characters.json'))).map((meta) => meta.id), []);
  assert.ok(!catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main.json'))).some((meta) => meta.id === 'sp:test:minor-coded'));
});

test('latest and popular featured rows exclude minor-coded source labels', () => {
  const latest = catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-latest.json'))).map((meta) => meta.id);
  const popular = catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-popular.json'))).map((meta) => meta.id);
  assert.ok(!latest.includes('sp:test:minor-coded'));
  assert.ok(!popular.includes('sp:test:minor-coded'));
});

test('popular catalog uses source engagement first and metadata depth as fallback', () => {
  assert.deepEqual(
    catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-popular.json'))).slice(0, 3).map((meta) => meta.id),
    ['sp:test:breasts', 'sp:test:rape', 'sp:test:milf']
  );
});

test('latest and all ignore encoded search extras', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-latest/search=naruto.json'))).map((meta) => meta.id), ['sp:test:breasts', 'sp:test:milf', 'sp:test:rape', 'mal:49095', 'mal:368']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-all/search=naruto.json'))).map((meta) => meta.id), ['mal:368', 'mal:49095', 'sp:test:milf', 'sp:test:breasts', 'sp:test:rape', 'sp:test:minor-coded']);
});

test('latest, popular, and all accept their normal .json route form', () => {
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-latest.json')).id, 'scarlet-peach-latest');
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-popular.json')).id, 'scarlet-peach-popular');
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-all.json')).id, 'scarlet-peach-all');
});
