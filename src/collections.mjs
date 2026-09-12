import { catalogMetas } from './catalog.mjs';
import { TAXONOMY_GROUPS } from './taxonomy.mjs';

const FALLBACK_ART = 'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/genres/adult-animation/adult-animation-landscape.png';
const MINOR_CODED = /(?:^|\b)(?:loli|lolicon|shota|shotacon|school\s*girl|schoolgirl)(?:\b|$)/i;

export function buildNuvioCollections(snapshot, addonId) {
  return TAXONOMY_GROUPS.map((group) => {
    const folders = group.categories.map((category) => {
      const metas = catalogMetas(snapshot, { id: group.id, search: null, genre: category.name });
      const artwork = pickArtwork(metas);
      const genres = [category.name, ...(category.tabs || []).map((item) => item.name)];
      const sources = genres.map((genre) => addonSource(addonId, group.id, genre));
      const catalogSources = genres.map((genre) => catalogSource(addonId, group.id, genre));

      return {
        id: `scarlet-peach.${group.key}.${slug(category.name)}`,
        title: category.name,
        tileShape: 'LANDSCAPE',
        hideTitle: false,
        focusGifEnabled: false,
        sources,
        catalogSources,
        coverImageUrl: artwork.cover,
        heroBackdropUrl: artwork.backdrop
      };
    });

    return {
      id: `scarlet-peach.${group.key}`,
      title: `Scarlet Peach ${titleCase(group.key)}`,
      folders,
      pinToTop: true,
      viewMode: 'TABBED_GRID',
      showAllTab: true,
      focusGlowEnabled: true,
      backdropImageUrl: folders.find((folder) => folder.heroBackdropUrl)?.heroBackdropUrl || FALLBACK_ART
    };
  });
}

function addonSource(addonId, catalogId, genre) {
  return {
    provider: 'addon',
    addonId,
    type: 'series',
    catalogId,
    genre
  };
}

function catalogSource(addonId, catalogId, genre) {
  return {
    addonId,
    type: 'series',
    catalogId,
    genre
  };
}

function pickArtwork(metas) {
  const safe = metas.filter((meta) => !hasMinorCodedSignals(meta));
  const both = safe.find((meta) => meta.background && meta.poster);
  if (both) return { cover: both.background, backdrop: both.background };
  const landscape = safe.find((meta) => meta.background);
  if (landscape) return { cover: landscape.background, backdrop: landscape.background };
  const poster = safe.find((meta) => meta.poster);
  return {
    cover: poster?.poster || FALLBACK_ART,
    backdrop: poster?.poster || FALLBACK_ART
  };
}

function hasMinorCodedSignals(meta) {
  const values = [
    ...(Array.isArray(meta?.genres) ? meta.genres : []),
    ...(Array.isArray(meta?.tags) ? meta.tags : []),
    ...(Array.isArray(meta?.providerMappings) ? meta.providerMappings.flatMap((mapping) => Array.isArray(mapping?.tags) ? mapping.tags : []) : [])
  ];
  return values.some((value) => MINOR_CODED.test(String(value || '')));
}

function slug(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function titleCase(value) {
  return String(value || '').replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}
