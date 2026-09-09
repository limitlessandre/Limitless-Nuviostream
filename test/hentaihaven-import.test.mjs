import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHentaiHavenProviderImport } from '../src/hentaihaven-import.mjs';

const posts = [
  {
    id: 1, slug: 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu', link: 'https://hentaihaven.vip/watch/jimihen-jimiko-o-kae-chau-jun-isei-kouyuu/',
    title: { rendered: 'Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu' },
    content: { rendered: '<p>Jimihen description.</p>' },
    class_list: ['wp-manga', 'wp-manga-genre-censored'],
    'wp-manga-genre': [10], 'wp-manga-tag': [20], 'wp-manga-release': [30], 'wp-manga-author': [40], meta: {}
  },
  {
    id: 2, slug: 'bible-black', link: 'https://hentaihaven.vip/watch/bible-black/',
    title: { rendered: 'Bible Black' }, content: { rendered: '<p>Bible Black description.</p>' },
    class_list: ['wp-manga', 'wp-manga-genre-uncensored-hentai'],
    'wp-manga-genre': [11], 'wp-manga-tag': [21], 'wp-manga-release': [31], 'wp-manga-author': [41], meta: {}
  }
];

const input = {
  baseUrl: 'https://hentaihaven.vip', posts,
  terms: {
    genres: [{ id: 10, name: 'Censored', slug: 'censored' }, { id: 11, name: 'Uncensored Hentai', slug: 'uncensored-hentai' }],
    tags: [{ id: 20, name: 'Glasses', slug: 'glasses' }, { id: 21, name: 'BDSM', slug: 'bdsm' }],
    releases: [{ id: 30, name: '2021', slug: '2021' }, { id: 31, name: '2001', slug: '2001' }],
    authors: [{ id: 40, name: 'Studio Hokiboshi', slug: 'studio-hokiboshi' }, { id: 41, name: 'MS Pictures', slug: 'ms-pictures' }]
  },
  titleSitemaps: ['<urlset><url><loc>https://hentaihaven.vip/watch/bible-black/</loc><image:loc>https://img.example/bible.jpg</image:loc></url></urlset>'],
  chapterSitemaps: ['<urlset><url><loc>https://hentaihaven.vip/watch/jimihen-jimiko-o-kae-chau-jun-isei-kouyuu/episode-1/</loc></url><url><loc>https://hentaihaven.vip/watch/bible-black/episode-1/</loc></url><url><loc>https://hentaihaven.vip/watch/bible-black/episode-2/</loc></url></urlset>']
};

test('normalizes HentaiHaven provider records and exact episode mappings', () => {
  const payload = buildHentaiHavenProviderImport(input, '2026-09-09T00:00:00.000Z', { minRecords: 2 });
  assert.equal(payload.provider, 'hentaihaven');
  assert.equal(payload.records.length, 2);
  const jimihen = payload.records.find((x) => x.slug.startsWith('jimihen'));
  const bible = payload.records.find((x) => x.slug === 'bible-black');
  assert.equal(jimihen.censorStatus, 'censored');
  assert.equal(jimihen.year, 2021);
  assert.equal(jimihen.episodes[0].slug, 'jimihen-jimiko-o-kae-chau-jun-isei-kouyuu/episode-1');
  assert.equal(bible.censorStatus, 'uncensored');
  assert.equal(bible.poster, 'https://img.example/bible.jpg');
  assert.equal(bible.episodes.length, 2);
  assert.equal(bible.studio, 'MS Pictures');
});
