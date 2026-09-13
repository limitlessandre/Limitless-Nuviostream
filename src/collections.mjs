import { TAXONOMY_GROUPS } from './taxonomy.mjs';

const FALLBACK_ART = 'https://raw.githubusercontent.com/rrevanth/nuvio-assets/main/genres/adult-animation/adult-animation-landscape.png';
const MINOR_CODED = /(?:^|\b)(?:loli|lolicon|shota|shotacon|school\s*girl|schoolgirl)(?:\b|$)/i;

export function buildNuvioCollections(snapshot, addonInput) {
  const addon = addonConfig(addonInput);
  const artworkIndex = buildCollectionArtworkIndex(snapshot);

  return TAXONOMY_GROUPS.map((group) => {
    const folders = group.categories.map((category) => {
      const genres = [category.name, ...(category.tabs || []).map((item) => item.name)];
      const sources = genres.map((genre) => addonSource(addon, group, genre));
      const catalogSources = genres.map((genre) => catalogSource(addon, group, genre));
      const artwork = resolveCollectionArtwork(artworkIndex, group.id, category.name);

      return {
        id: `scarlet-peach.${group.key}.${slug(category.name)}`,
        title: category.name,
        coverImageUrl: artwork.cover,
        focusGifUrl: null,
        focusGifEnabled: true,
        coverEmoji: null,
        tileShape: 'LANDSCAPE',
        hideTitle: false,
        sources,
        catalogSources,
        heroBackdropUrl: artwork.backdrop,
        heroVideoUrl: null,
        titleLogoUrl: null
      };
    });

    return {
      id: `scarlet-peach.${group.key}`,
      title: group.name,
      backdropImageUrl: folders.find((folder) => folder.heroBackdropUrl)?.heroBackdropUrl || FALLBACK_ART,
      // Latest and Popular are normal addon title rows and should stay above these four collection rows.
      pinToTop: false,
      focusGlowEnabled: true,
      viewMode: 'ROWS',
      showAllTab: true,
      folders
    };
  });
}

export function buildCollectionArtworkIndex(snapshot) {
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

export function resolveCollectionArtwork(index, groupId, categoryName) {
  return index?.get(artworkKey(groupId, categoryName)) || fallbackArtwork();
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

function addonConfig(input) {
  if (typeof input === 'string') {
    return {
      id: input,
      name: 'Limitless Nexus: Scarlet Peach',
      baseUrl: 'https://scarlet-peach-catalog.limitlessandre.workers.dev'
    };
  }
  return {
    id: clean(input?.id) || 'org.limitlessnexus.scarletpeach.catalog',
    name: clean(input?.name) || 'Limitless Nexus: Scarlet Peach',
    baseUrl: clean(input?.baseUrl) || 'https://scarlet-peach-catalog.limitlessandre.workers.dev'
  };
}

function addonSource(addon, group, genre) {
  return {
    provider: 'addon',
    addonId: addon.id,
    addonBaseUrl: addon.baseUrl,
    addonName: addon.name,
    type: 'series',
    catalogId: group.id,
    catalogName: group.name,
    title: genre,
    genre
  };
}

function catalogSource(addon, group, genre) {
  return {
    addonId: addon.id,
    addonBaseUrl: addon.baseUrl,
    addonName: addon.name,
    type: 'series',
    catalogId: group.id,
    catalogName: group.name,
    title: genre,
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
