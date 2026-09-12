import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNuvioCollections } from '../src/collections.mjs';

const snapshot = { titles: [
  {
    id: 'sp:test:milf', type: 'series', adult: true, title: 'Adult Art',
    titles: { english: null, romaji: 'Adult Art', japanese: null, aliases: [] },
    tags: ['milf'], genres: [], poster: 'https://example.com/adult-poster.jpg', background: 'https://example.com/adult-bg.jpg', censorStatus: 'unknown'
  },
  {
    id: 'sp:test:minor-coded', type: 'series', adult: true, title: 'Minor Coded Art',
    titles: { english: null, romaji: 'Minor Coded Art', japanese: null, aliases: [] },
    tags: ['milf', 'loli'], genres: [], poster: 'https://example.com/excluded.jpg', background: 'https://example.com/excluded-bg.jpg', censorStatus: 'unknown'
  }
] };

test('builds four Nuvio collections with genre-aware catalog sources', () => {
  const collections = buildNuvioCollections(snapshot, 'org.limitlessnexus.scarletpeach.catalog');
  assert.equal(collections.length, 4);
  const main = collections.find((collection) => collection.id === 'scarlet-peach.main');
  assert.ok(main);
  const milf = main.folders.find((folder) => folder.title === 'MILF');
  assert.equal(milf.catalogSources[0].catalogId, 'scarlet-peach-main');
  assert.equal(milf.catalogSources[0].genre, 'MILF');
  assert.equal(milf.coverImageUrl, 'https://example.com/adult-poster.jpg');
  assert.equal(milf.heroBackdropUrl, 'https://example.com/adult-bg.jpg');
});

test('minor-coded source art is not selected for collection tiles', () => {
  const onlyMinor = { titles: [snapshot.titles[1]] };
  const collections = buildNuvioCollections(onlyMinor, 'org.limitlessnexus.scarletpeach.catalog');
  const main = collections.find((collection) => collection.id === 'scarlet-peach.main');
  const milf = main.folders.find((folder) => folder.title === 'MILF');
  assert.ok(!milf.coverImageUrl.includes('excluded.jpg'));
});
