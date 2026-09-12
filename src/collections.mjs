import { catalogMetas } from './catalog.mjs';
import { publicTaxonomy } from './taxonomy.mjs';

const FALLBACK_ART = 'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/genres/adult-animation/adult-animation-landscape.png';
const MINOR_CODED = /(?:^|\b)(?:loli|lolicon|shota|shotacon|school\s*girl|schoolgirl)(?:\b|$)/i;

export function buildNuvioCollections(snapshot, addonId) {
  return publicTaxonomy().map((group) => {
    const folders = group.categories.map((category) => {
      const metas = catalogMetas(snapshot, { id: group.id, search: null, genre: category });
      const artwork = pickArtwork(metas);
      const source = {
        provider: 'addon',
        addonId,
        type: 'series',
        catalogId: group.id,
        genre: category
      };
      return {
        id: `scarlet-peach.${group.key}.${slug(category)}`,
        title: category,
        tileShape: 'POSTER',
        hideTitle: false,
        focusGifEnabled: false,
        sources: [source],
        catalogSources: [source],
        coverImageUrl: artwork.cover,
        heroBackdropUrl: artwork.backdrop
      };
    });

    return {
      id: `scarlet-peach.${group.key}`,
      title: `Scarlet Peach ${titleCase(group.key)}`,
      folders,
      pinToTop: false,
      viewMode: 'TABBED_GRID',
      showAllTab: true,
      focusGlowEnabled: true,
      backdropImageUrl: folders.find((folder) => folder.heroBackdropUrl)?.heroBackdropUrl || FALLBACK_ART
    };
  });
}

function pickArtwork(metas) {
  const safe = metas.filter((meta) => !hasMinorCodedSignals(meta));
  const both = safe.find((meta) => meta.poster && meta.background);
  if (both) return { cover: both.poster, backdrop: both.background };
  const coverMeta = safe.find((meta) => meta.poster) || safe.find((meta) => meta.background);
  const backdropMeta = safe.find((meta) => meta.background) || coverMeta;
  return {
    cover: coverMeta?.poster || coverMeta?.background || FALLBACK_ART,
    backdrop: backdropMeta?.background || backdropMeta?.poster || FALLBACK_ART
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
