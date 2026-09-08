import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, validateSnapshot } from '../src/schema.mjs';
import { catalogMetas, toMeta } from '../src/catalog.mjs';

const legacy = {
  schemaVersion: 1,
  generatedAt: '2026-09-08T00:00:00.000Z',
  titles: [{
    id: 'mal:44044',
    type: 'series',
    adult: true,
    sourceConfidence: 'MAL',
    sourceMetadata: { source: 'MyAnimeList public title page', rating: 'Rx - Hentai' },
    title: 'Jimihen!!: Jimiko wo Kaechau Jun Isei Kouyuu!!',
    titles: { english: null, romaji: 'Jimihen!!: Jimiko wo Kaechau Jun Isei Kouyuu!!', japanese: null, aliases: ['Jimihen'] },
    description: 'Test description',
    poster: 'https://example.com/poster.jpg',
    year: 2021,
    studio: 'Studio Hokiboshi',
    genres: ['Hentai'],
    tags: ['hentai'],
    languageVersions: [],
    censorStatus: 'unknown',
    episodes: [{ number: 1, title: 'Episode 1', releaseDate: null }],
    providerMappings: []
  }]
};

test('legacy records normalize to schema v2 without losing stable identity', () => {
  const normalized = normalizeSnapshot(legacy);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.titles[0].id, 'mal:44044');
  assert.equal(normalized.titles[0].contentRating.classification, 'Rx - Hentai');
  assert.deepEqual(normalized.titles[0].availability.providers, []);
  assert.equal(validateSnapshot(normalized).ok, true);
});

test('provider mappings aggregate availability and preserve censorship/language/quality metadata', () => {
  const normalized = normalizeSnapshot({ titles: [{
    ...legacy.titles[0],
    censorStatus: 'censored',
    providerMappings: [{
      provider: 'hanime',
      slug: 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1',
      title: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu Season 1',
      censorStatus: 'censored',
      audioLanguages: ['Japanese'],
      subtitleLanguages: ['English'],
      tags: ['Glasses'],
      qualities: [360, 480, 720]
    }]
  }] });
  const record = normalized.titles[0];
  assert.deepEqual(record.availability.providers, ['hanime']);
  assert.deepEqual(record.availability.audioLanguages, ['ja']);
  assert.deepEqual(record.availability.subtitleLanguages, ['en']);
  assert.deepEqual(record.availability.qualities, [360, 480, 720]);
  assert.deepEqual(record.availability.censorStatuses, ['censored']);
});

test('detailed meta exposes schema v2 provider and episode metadata without breaking Stremio fields', () => {
  const record = normalizeSnapshot({ titles: [{
    ...legacy.titles[0],
    tags: ['hentai', 'glasses'],
    providerMappings: [{ provider: 'hanime', slug: 'jimihen-season-1', censorStatus: 'censored', qualities: [720] }]
  }] }).titles[0];
  const meta = toMeta(record, true);
  assert.equal(meta.id, 'mal:44044');
  assert.equal(meta.schemaVersion, 2);
  assert.ok(meta.aliases.includes('Jimihen'));
  assert.equal(meta.providerMappings[0].provider, 'hanime');
  assert.equal(meta.videos[0].episode, 1);
});

test('catalog search includes provider titles, tags, genres, and studio', () => {
  const snapshot = normalizeSnapshot({ titles: [{
    ...legacy.titles[0],
    tags: ['Glasses'],
    providerMappings: [{ provider: 'hanime', title: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu Season 1', slug: 'jimihen-season-1' }]
  }] });
  assert.equal(catalogMetas(snapshot, { id: 'scarlet-peach-search', search: 'glasses' }).length, 1);
  assert.equal(catalogMetas(snapshot, { id: 'scarlet-peach-search', search: 'studio hokiboshi' }).length, 1);
  assert.equal(catalogMetas(snapshot, { id: 'scarlet-peach-search', search: 'kae chau' }).length, 1);
});
