import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogMetas, parseCatalogRequest } from '../src/catalog.mjs';

const snapshot = { titles: [
  { id: 'mal:368', type: 'series', adult: true, title: 'Bible Black', titles: { english: null, romaji: 'Bible Black', japanese: 'バイブルブラック', aliases: [] }, genres: [], releaseDate: '2001-07-21' },
  { id: 'mal:49095', type: 'series', adult: true, title: 'Kuroinu II The Animation', titles: { english: null, romaji: 'Kuroinu II The Animation', japanese: null, aliases: [] }, genres: [], releaseDate: '2021-08-27' }
] };
test('parses Bible Black from a path-encoded search extra', () => assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=bible%20black.json')).search, 'bible black'));
test('parses Naruto from a path-encoded search extra', () => assert.equal(parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=naruto.json')).search, 'naruto'));
test('unmatched search returns no metas', () => assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-search/search=naruto.json'))), []));
test('latest and all ignore encoded search extras', () => {
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-latest/search=naruto.json'))).map((meta) => meta.id), ['mal:49095', 'mal:368']);
  assert.deepEqual(catalogMetas(snapshot, parseCatalogRequest(new URL('https://test/catalog/series/scarlet-peach-all/search=naruto.json'))).map((meta) => meta.id), ['mal:368', 'mal:49095']);
});
