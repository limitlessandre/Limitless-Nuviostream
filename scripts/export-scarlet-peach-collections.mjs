import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TAXONOMY_GROUPS } from '../src/taxonomy.mjs';

const ADDON_ID = 'org.limitlessnexus.scarletpeach.catalog';
const BASE_URL = 'https://scarlet-peach-catalog.limitlessandre.workers.dev';
const ART_VERSION = 'hanime-browse-1';
const OUTPUT = fileURLToPath(new URL('../ScarletPeach.json', import.meta.url));

const slug = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const artworkUrl = (groupId, categoryName) =>
  `${BASE_URL}/collection-art/${encodeURIComponent(groupId)}/${encodeURIComponent(categoryName)}?v=${ART_VERSION}`;

const catalogSource = (groupId, genre) => ({
  addonId: ADDON_ID,
  type: 'series',
  catalogId: groupId,
  genre
});

const collections = TAXONOMY_GROUPS.map((group) => ({
  id: `scarlet-peach.${group.key}`,
  title: group.name,
  pinToTop: false,
  viewMode: 'ROWS',
  showAllTab: true,
  folders: group.categories.map((category) => {
    const genres = [category.name, ...(category.tabs || []).map((tab) => tab.name)];
    const artwork = artworkUrl(group.id, category.name);
    return {
      id: `scarlet-peach.${group.key}.${slug(category.name)}`,
      title: category.name,
      coverImageUrl: artwork,
      tileShape: 'LANDSCAPE',
      catalogSources: genres.map((genre) => catalogSource(group.id, genre)),
      heroBackdropUrl: artwork
    };
  })
}));

fs.writeFileSync(OUTPUT, `${JSON.stringify(collections, null, 2)}\n`, 'utf8');
console.log(`Wrote ${collections.length} Scarlet Peach collections to ${OUTPUT}`);
console.log(`Folders: ${collections.reduce((sum, collection) => sum + collection.folders.length, 0)}`);
