import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogMetas, parseCatalogRequest } from '../src/catalog.mjs';
import { publicTaxonomy, taxonomyManifestCatalogs } from '../src/taxonomy.mjs';

const snapshot = { titles: [
  { id: 'mal:368', type: 'series', adult: true, title: 'Bible Black', titles: { english: null, romaji: 'Bible Black', japanese: 'バイブルブラック', aliases: [] }, genres: ['Horror'], tags: ['incest'], censorStatus: 'censored', releaseDate: '2001-07-21' },
  { id: 'mal:49095', type: 'series', adult: true, title: 'Kuroinu II The Animation', titles: { english: null, romaji: 'Kuroinu II The Animation', japanese: null, aliases: [] }, genres: [], tags: [], censorStatus: 'unknown', releaseDate: '2021-08-27' },
  { id: 'sp:test:milf', type: 'series', adult: true, title: 'MILF Test', titles: { english: null, romaji: 'MILF Test', japanese: null, aliases: [] }, genres: [], tags: ['milf'], censorStatus: 'uncensored', releaseDate: '2024-01-01' },
  { id: 'sp:test:rape', type: 'series', adult: true, title: 'Rape Tag Test', titles: { english: null, romaji: 'Rape Tag Test', japanese: null, aliases: [] }, genres: [], tags: [], providerMappings: [{ provider: 'test', tags: ['rape'] }], censorStatus: 'unknown', releaseDate: '2023-01-01' },
  { id: 'sp:test:minor-coded', type: 'series', adult: true, title: 'Excluded Minor-Coded Tag Test', titles: { english: null, romaji: 'Excluded Minor-Coded Tag Test', japanese: null, aliases: [] }, genres: [], tags: ['loli', 'school girl'], censorStatus: 'unknown', releaseDate: '2022-01-01' }
] };

test('parses Bible Black from a path-encoded search extra', () => assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=bible%20black.json')).search, 'bible black'));
test('parses Naruto from a path-encoded search extra', () => assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=naruto.json')).search, 'naruto'));
test('unmatched search returns no metas', () => assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=naruto.json'))), []));

test('parses taxonomy genre extras from path and query forms', () => {
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=MILF.json')).genre, 'MILF');
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-kinks.json?genre=Rape')).genre, 'Rape');
});

test('taxonomy filters title tags, provider tags, and censorship state', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=MILF.json'))).map((meta) => meta.id), ['sp:test:milf']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-kinks/genre=Rape.json'))).map((meta) => meta.id), ['sp:test:rape']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main/genre=Uncensored.json'))).map((meta) => meta.id), ['sp:test:milf']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-niche/genre=Censored.json'))).map((meta) => meta.id), ['mal:368']);
});

test('taxonomy exposes the four browse groups without minor-coded sexual categories', () => {
  assert.deepEqual(taxonomyManifestCatalogs().map((catalog) => catalog.id), ['scarlet-peach-main', 'scarlet-peach-kinks', 'scarlet-peach-characters', 'scarlet-peach-niche']);
  const names = publicTaxonomy().flatMap((group) => group.categories).map((name) => name.toLowerCase());
  assert.ok(names.includes('rape'));
  assert.ok(!names.some((name) => /loli|shota|school/.test(name)));
});

test('minor-coded source tags alone do not enter Characters or Main', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-characters.json'))).map((meta) => meta.id), []);
  assert.ok(!catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-main.json'))).some((meta) => meta.id === 'sp:test:minor-coded'));
});

test('latest and all ignore encoded search extras', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-latest/search=naruto.json'))).map((meta) => meta.id), ['sp:test:milf', 'sp:test:rape', 'sp:test:minor-coded', 'mal:49095', 'mal:368']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-all/search=naruto.json'))).map((meta) => meta.id), ['mal:368', 'mal:49095', 'sp:test:milf', 'sp:test:rape', 'sp:test:minor-coded']);
});

test('latest and all accept their normal .json route form', () => {
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-latest.json')).id, 'scarlet-peach-latest');
  assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-all.json')).id, 'scarlet-peach-all');
});
