import { TAXONOMY_GROUPS } from './taxonomy.mjs';

const FALLBACK_ART = 'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/genres/adult-animation/adult-animation-landscape.png';
const MINOR_CODED = /(?:^|\b)(?:loli|lolicon|shota|shotacon|school\s*girl|schoolgirl)(?:\b|$)/i;

export function buildNuvioCollections(snapshot, addonId) {
  const artworkIndex = buildArtworkIndex(snapshot);

  return TAXONOMY_GROUPS.map((group) => {
    const folders = group.categories.map((category) => {
      const genres = [category.name, ...(category.tabs || []).map((item) => item.name)];
      const sources = genres.map((genre) => addonSource(addonId, group.id, genre));
      const catalogSources = genres.map((genre) => catalogSource(addonId, group.id, genre));
      const artwork = artworkIndex.get(artworkKey(group.id, category.name)) || fallbackArtwork();

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

function buildArtworkIndex(snapshot) {
  const candidates = TAXONOMY_GROUPS.flatMap((group) =>
    group.categories.map((category) => ({
      key: artworkKey(group.id, category.name),
      category
    }))
  );
  const index = new Map();

  for (const title of snapshot?.titles || []) {
    if (title?.adult !== true || hasMinorCodedSignals(title)) continue;

    const background = clean(title.background || title.artwork?.background);
    const poster = clean(title.poster || title.artwork?.poster);
    if (!background && !poster) continue;

    const labels = taxonomyLabels(title);
    for (const candidate of candidates) {
      const current = index.get(candidate.key);
      if (current?.landscape) continue;
      if (!matchesCategory(title, labels, candidate.category)) continue;

      if (background) {
        index.set(candidate.key, { cover: background, backdrop: background, landscape: true });
      } else if (!current && poster) {
        index.set(candidate.key, { cover: poster, backdrop: poster, landscape: false });
      }
    }
  }

  return index;
}

function matchesCategory(title, labels, category) {
  const censor = String(title?.censorStatus || '').toLowerCase();
  if (category.special === 'uncensored') return censor === 'uncensored';
  if (category.special === 'censored') return censor === 'censored';
  for (const alias of category.normalizedAliases || []) if (labels.has(alias)) return true;
  return false;
}

function taxonomyLabels(title) {
  const values = [
    ...(Array.isArray(title?.genres) ? title.genres : []),
    ...(Array.isArray(title?.tags) ? title.tags : [])
  ];
  for (const mapping of Array.isArray(title?.providerMappings) ? title.providerMappings : []) {
    values.push(...(Array.isArray(mapping?.tags) ? mapping.tags : []));
  }
  return new Set(values.map(normalize).filter(Boolean));
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

function fallbackArtwork() {
  return { cover: FALLBACK_ART, backdrop: FALLBACK_ART, landscape: true };
}

function hasMinorCodedSignals(meta) {
  const values = [
    ...(Array.isArray(meta?.genres) ? meta.genres : []),
    ...(Array.isArray(meta?.tags) ? meta.tags : []),
    ...(Array.isArray(meta?.providerMappings) ? meta.providerMappings.flatMap((mapping) => Array.isArray(mapping?.tags) ? mapping.tags : []) : [])
  ];
  return values.some((value) => MINOR_CODED.test(String(value || '')));
}

function artworkKey(groupId, categoryName) {
  return `${groupId}:${categoryName}`;
}

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function titleCase(value) {
  return String(value || '').replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}
