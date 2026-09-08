import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHanimeProviderImport } from '../src/hanime-import.mjs';
import { mergeProviderPayload } from '../src/provider-merge.mjs';
import { normalizeSnapshot } from '../src/schema.mjs';

const now = '2026-09-08T10:30:00.000Z';

function record(overrides = {}) {
  return {
    providerId: overrides.slug || 'id',
    slug: overrides.slug || 'slug',
    title: overrides.title || 'Title',
    providerTitle: overrides.title || 'Title',
    seriesTitle: overrides.seriesTitle || overrides.title || 'Title',
    episode: overrides.episode || 1,
    aliases: overrides.aliases || [],
    description: 'Provider description',
    poster: 'https://example.com/poster.jpg',
    background: 'https://example.com/background.jpg',
    brand: overrides.brand || 'Studio Hokiboshi',
    year: overrides.year || 2021,
    releaseDate: overrides.releaseDate || '2021-01-01T00:00:00.000Z',
    tags: overrides.tags || ['Censored', 'Glasses'],
    censorStatus: overrides.censorStatus || 'censored',
    audioLanguages: overrides.audioLanguages || [],
    subtitleLanguages: overrides.subtitleLanguages || [],
    url: `https://hanime.tv/videos/hentai/${overrides.slug || 'slug'}`,
    metadata: overrides.metadata || {}
  };
}

test('Jimihen Season 1 becomes a single series record and keeps exact Hanime slug', () => {
  const feed = {
    provider: 'hanime',
    generatedAt: now,
    records: [record({
      title: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu Season 1',
      seriesTitle: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu',
      slug: 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1',
      episode: 1
    })]
  };
  const payload = buildHanimeProviderImport(feed, now, { minRecords: 1 });
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].title, 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu');
  assert.equal(payload.records[0].episodes[0].slug, 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1');
});

test('multiple explicit Hanime seasons stay separate instead of becoming episodes of one title', () => {
  const feed = {
    provider: 'hanime',
    generatedAt: now,
    records: [
      record({ title: 'Example Story Season 1', seriesTitle: 'Example Story', slug: 'example-story-season-1', episode: 1 }),
      record({ title: 'Example Story Season 2', seriesTitle: 'Example Story', slug: 'example-story-season-2', episode: 2 })
    ]
  };
  const payload = buildHanimeProviderImport(feed, now, { minRecords: 1 });
  assert.deepEqual(payload.records.map((item) => item.title).sort(), ['Example Story Season 1', 'Example Story Season 2']);
  assert.deepEqual(payload.records.map((item) => item.episodes[0].number), [1, 1]);
});

test('Bible Black numbered videos group into ordered episodes', () => {
  const feed = {
    provider: 'hanime',
    generatedAt: now,
    records: [
      record({ title: 'Bible Black 2', seriesTitle: 'Bible Black', slug: 'bible-black-2', episode: 2 }),
      record({ title: 'Bible Black 1', seriesTitle: 'Bible Black', slug: 'bible-black-1', episode: 1 })
    ]
  };
  const payload = buildHanimeProviderImport(feed, now, { minRecords: 1 });
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].title, 'Bible Black');
  assert.deepEqual(payload.records[0].episodes.map((episode) => episode.number), [1, 2]);
});

test('a lone title ending in a bare number is not automatically collapsed into a different series', () => {
  const feed = {
    provider: 'hanime',
    generatedAt: now,
    records: [record({ title: 'Example Saga 2', seriesTitle: 'Example Saga', slug: 'example-saga-2', episode: 2 })]
  };
  const payload = buildHanimeProviderImport(feed, now, { minRecords: 1 });
  assert.equal(payload.records[0].title, 'Example Saga 2');
  assert.equal(payload.records[0].episodes[0].number, 1);
});

test('Hanime romanization variant merges into MAL Jimihen instead of creating a duplicate sp record', () => {
  const base = normalizeSnapshot({ titles: [{
    id: 'mal:44044',
    type: 'series',
    adult: true,
    sourceConfidence: 'MAL',
    sourceMetadata: { source: 'MAL', rating: 'Rx - Hentai' },
    title: 'Jimihen!!: Jimiko wo Kaechau Jun Isei Kouyuu!!',
    titles: { english: null, romaji: 'Jimihen!!: Jimiko wo Kaechau Jun Isei Kouyuu!!', japanese: null, aliases: [] },
    year: 2021,
    genres: ['Hentai'],
    tags: ['hentai'],
    languageVersions: [],
    censorStatus: 'unknown',
    episodes: [{ number: 1, title: 'Episode 1' }],
    providerMappings: []
  }] });
  const payload = buildHanimeProviderImport({
    provider: 'hanime',
    generatedAt: now,
    records: [record({
      title: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu Season 1',
      seriesTitle: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu',
      slug: 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1',
      episode: 1,
      year: 2020
    })]
  }, now, { minRecords: 1 });
  const merged = mergeProviderPayload(base, payload);
  assert.equal(merged.snapshot.titles.length, 1);
  assert.equal(merged.snapshot.titles[0].id, 'mal:44044');
  assert.equal(merged.snapshot.titles[0].providerMappings[0].provider, 'hanime');
  assert.equal(merged.snapshot.titles[0].episodes[0].providerMappings[0].slug, 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1');
});
