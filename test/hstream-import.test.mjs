import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHStreamProviderImport } from '../src/hstream-import.mjs';
import { mergeProviderPayload } from '../src/provider-merge.mjs';

const NOW = '2026-09-09T20:00:00.000Z';

const fixture = [{
  title: 'Deco x Deco The Animation - 1',
  title_jpn: 'デコ×デコ THE ANIMATION',
  slug: 'deco-x-deco-the-animation',
  episodes: [
    { episode: 1, slug: 'deco-x-deco-the-animation-1' },
    { episode: 2, slug: 'deco-x-deco-the-animation-2' }
  ]
}];

function titleRecord(id, title, providerMappings = []) {
  return {
    id,
    type: 'series',
    adult: true,
    sourceConfidence: 'hanime',
    title,
    titles: { english: null, romaji: title, japanese: null, aliases: [] },
    description: null,
    poster: null,
    background: null,
    year: 2026,
    releaseDate: null,
    studio: 'Seven',
    genres: ['Hentai'],
    tags: [],
    censorStatus: 'censored',
    languageVersions: [],
    episodes: [
      { number: 1, title: 'Episode 1', censorStatus: 'censored', audioLanguages: [], subtitleLanguages: [], providerMappings: [] },
      { number: 2, title: 'Episode 2', censorStatus: 'censored', audioLanguages: [], subtitleLanguages: [], providerMappings: [] }
    ],
    providerMappings
  };
}

test('normalizes HStream first-episode display titles into exact series and episode mappings', () => {
  const payload = buildHStreamProviderImport(fixture, NOW, { minRecords: 1 });
  assert.equal(payload.provider, 'hstream');
  assert.equal(payload.records.length, 1);
  const record = payload.records[0];
  assert.equal(record.title, 'Deco x Deco The Animation');
  assert.equal(record.providerTitle, 'Deco x Deco The Animation - 1');
  assert.ok(record.aliases.includes('Deco x Deco The Animation - 1'));
  assert.equal(record.seriesId, 'hstream:series:deco-x-deco-the-animation');
  assert.equal(record.japaneseTitle, 'デコ×デコ THE ANIMATION');
  assert.equal(record.censorStatus, 'unknown');
  assert.deepEqual(record.audioLanguages, []);
  assert.deepEqual(record.subtitleLanguages, []);
  assert.equal(record.episodes.length, 2);
  assert.equal(record.episodes[0].slug, 'deco-x-deco-the-animation-1');
  assert.equal(record.episodes[1].slug, 'deco-x-deco-the-animation-2');
  assert.equal(record.episodes[0].url, 'https://hstream.moe/hentai/deco-x-deco-the-animation-1');
});

test('does not strip a legitimate numbered title without matching episode evidence', () => {
  const payload = buildHStreamProviderImport([{
    title: 'Example 2',
    slug: 'example-2',
    episodes: [{ episode: 1, slug: 'example-2-1' }]
  }], NOW, { minRecords: 1 });
  assert.equal(payload.records[0].title, 'Example 2');
});

test('HStream episode display title merges into an existing Scarlet Peach identity instead of duplicating Deco', () => {
  const payload = buildHStreamProviderImport(fixture, NOW, { minRecords: 1 });
  const input = {
    schemaVersion: 2,
    generatedAt: NOW,
    titles: [titleRecord('sp:hanime:deco-x-deco-the-animation', 'Deco x Deco The Animation')]
  };
  const result = mergeProviderPayload(input, payload);
  assert.equal(result.snapshot.titles.length, 1);
  const title = result.snapshot.titles[0];
  const mapping = title.providerMappings.find((item) => item.provider === 'hstream');
  assert.ok(mapping);
  assert.equal(mapping.seriesId, 'hstream:series:deco-x-deco-the-animation');
  const episodeMapping = title.episodes[0].providerMappings.find((item) => item.provider === 'hstream');
  assert.ok(episodeMapping);
  assert.equal(episodeMapping.slug, 'deco-x-deco-the-animation-1');
});

test('exact provider series identity breaks an otherwise ambiguous title tie', () => {
  const payload = buildHStreamProviderImport(fixture, NOW, { minRecords: 1 });
  const input = {
    schemaVersion: 2,
    generatedAt: NOW,
    titles: [
      titleRecord('sp:hanime:deco-x-deco-the-animation', 'Deco x Deco The Animation'),
      titleRecord('sp:hentaihaven:deco-x-deco-the-animation-special', 'Deco x Deco The Animation')
    ]
  };
  const result = mergeProviderPayload(input, payload);
  assert.equal(result.snapshot.titles.length, 2);
  const correct = result.snapshot.titles.find((item) => item.id === 'sp:hanime:deco-x-deco-the-animation');
  const competing = result.snapshot.titles.find((item) => item.id === 'sp:hentaihaven:deco-x-deco-the-animation-special');
  assert.ok(correct.providerMappings.some((mapping) => mapping.provider === 'hstream'));
  assert.ok(!competing.providerMappings.some((mapping) => mapping.provider === 'hstream'));
});
