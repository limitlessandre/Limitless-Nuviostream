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
    id: 'sp:test:breasts', type: 'series', adult: true, title: 'Breasts Art',
    titles: { english: null, romaji: 'Breasts Art', japanese: null, aliases: [] },
    tags: ['big boobs'], genres: [], poster: 'https://example.com/breasts-poster.jpg', background: 'https://example.com/breasts-bg.jpg', censorStatus: 'unknown'
  },
  {
    id: 'sp:test:minor-coded', type: 'series', adult: true, title: 'Minor Coded Art',
    titles: { english: null, romaji: 'Minor Coded Art', japanese: null, aliases: [] },
    tags: ['milf', 'loli'], genres: [], poster: 'https://example.com/excluded.jpg', background: 'https://example.com/excluded-bg.jpg', censorStatus: 'unknown'
  }
] };

test('builds exactly four pinned Nuvio home rows with landscape folders', () => {
  const collections = buildNuvioCollections(snapshot, 'org.limitlessnexus.scarletpeach.catalog');
  assert.deepEqual(collections.map((collection) => collection.title), [
    'Scarlet Peach Main',
    'Scarlet Peach Kinks',
    'Scarlet Peach Characters',
    'Scarlet Peach Niche'
  ]);
  assert.ok(collections.every((collection) => collection.pinToTop === true));
  assert.ok(collections.every((collection) => collection.viewMode === 'TABBED_GRID'));
  assert.ok(collections.every((collection) => collection.showAllTab === true));
  assert.ok(collections.flatMap((collection) => collection.folders).every((folder) => folder.tileShape === 'LANDSCAPE'));
});

test('leaf folders use one catalog source and landscape website artwork', () => {
  const collections = buildNuvioCollections(snapshot, 'org.limitlessnexus.scarletpeach.catalog');
  const main = collections.find((collection) => collection.id === 'scarlet-peach.main');
  const milf = main.folders.find((folder) => folder.title === 'MILF');
  assert.equal(milf.catalogSources.length, 1);
  assert.equal(milf.catalogSources[0].catalogId, 'scarlet-peach-main');
  assert.equal(milf.catalogSources[0].genre, 'MILF');
  assert.equal(milf.coverImageUrl, 'https://example.com/adult-bg.jpg');
  assert.equal(milf.heroBackdropUrl, 'https://example.com/adult-bg.jpg');
});

test('parent folders expose their sub-genres as folder-detail tab sources', () => {
  const collections = buildNuvioCollections(snapshot, 'org.limitlessnexus.scarletpeach.catalog');
  const main = collections.find((collection) => collection.id === 'scarlet-peach.main');
  const breasts = main.folders.find((folder) => folder.title === 'Breasts');
  assert.deepEqual(breasts.catalogSources.map((source) => source.genre), ['Breasts', 'Big Boobs', 'Small Breasts']);

  const niche = collections.find((collection) => collection.id === 'scarlet-peach.niche');
  const action = niche.folders.find((folder) => folder.title === 'Action');
  assert.deepEqual(action.catalogSources.map((source) => source.genre), ['Action', 'Adventure', 'Martial Arts', 'Super Power']);

  const characters = collections.find((collection) => collection.id === 'scarlet-peach.characters');
  const roles = characters.folders.find((folder) => folder.title === 'Roles');
  assert.ok(roles.catalogSources.some((source) => source.genre === 'Maid'));
  assert.ok(roles.catalogSources.some((source) => source.genre === 'Teacher'));
});

test('minor-coded source art is not selected for collection tiles', () => {
  const onlyMinor = { titles: [snapshot.titles[2]] };
  const collections = buildNuvioCollections(onlyMinor, 'org.limitlessnexus.scarletpeach.catalog');
  const main = collections.find((collection) => collection.id === 'scarlet-peach.main');
  const milf = main.folders.find((folder) => folder.title === 'MILF');
  assert.ok(!milf.coverImageUrl.includes('excluded'));
});
