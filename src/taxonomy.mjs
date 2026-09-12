const entry = (name, aliases = [], special = null) => ({ name, aliases, special });

export const TAXONOMY_GROUPS = [
  {
    id: 'scarlet-peach-main',
    key: 'main',
    name: 'Scarlet Peach Main',
    categories: [
      entry('3D', ['3d', 'umemaro 3d']),
      entry('Anal', ['anal']),
      entry('BDSM', ['bdsm', 'bondage', 'femdom', 'humiliation']),
      entry('Breasts', ['breasts', 'big boobs', 'big breasts', 'large breasts', 'huge breasts', 'small breasts', 'small boobs', 'big tits']),
      entry('Cosplay', ['cosplay']),
      entry('Fantasy', ['fantasy']),
      entry('Furry', ['furry', 'animal girls', 'animal girl', 'nekomimi', 'catgirl', 'cat girl']),
      entry('Futanari', ['futanari', 'futa']),
      entry('Group', ['group sex', 'gangbang', 'orgy', 'threesome']),
      entry('Harem', ['harem']),
      entry('Incest', ['incest', 'step family', 'step-family', 'step mother', 'stepmother', 'step sister', 'stepsister', 'step daughter', 'stepdaughter']),
      entry('MILF', ['milf']),
      entry('Monsters', ['monster', 'monsters', 'demon', 'orc / goblin', 'orc', 'goblin', 'succubus', 'vampire']),
      entry('NTR', ['ntr', 'netorare']),
      entry('Romance', ['romance']),
      entry('Tentacle', ['tentacle', 'tentacles']),
      entry('Uncensored', ['uncensored'], 'uncensored'),
      entry('Yaoi', ['yaoi', 'boys love', 'bl']),
      entry('Yuri', ['yuri', 'girls love'])
    ]
  },
  {
    id: 'scarlet-peach-kinks',
    key: 'kinks',
    name: 'Scarlet Peach Kinks',
    categories: [
      entry('Ahegao', ['ahegao']),
      entry('Body Play', ['armpit fetish', 'boob job', 'facesitting', 'nipple fuck']),
      entry('Breeding', ['impregnation']),
      entry('Exhibition', ['exhibitionism', 'public sex']),
      entry('Fluids', ['creampie', 'facial', 'lactation', 'squirting', 'watersports']),
      entry('Inflation', ['inflation']),
      entry('Manual', ['foot job', 'hand job']),
      entry('Masturbation', ['masturbation']),
      entry('Mind Play', ['mind break', 'mind control', 'corruption']),
      entry('Oral', ['blow job', 'blowjob', 'deep throat', 'deepthroat']),
      entry('Penetration', ['double penetration', 'fisting']),
      entry('Rape', ['rape', 'reverse rape', 'molestation', 'train molestation']),
      entry('Scat', ['scat']),
      entry('Teasing', ['teasing']),
      entry('Toys', ['toys', 'sex toys', 'strap-on', 'strap on'])
    ]
  },
  {
    id: 'scarlet-peach-characters',
    key: 'characters',
    name: 'Scarlet Peach Characters',
    categories: [
      entry('Archetypes', ['gyaru', 'tsundere', 'ugly bastard']),
      entry('Looks', ['bbw', 'plus size', 'plus-size', 'blonde', 'dark skin', 'glasses', 'pregnant', 'stocking', 'stockings', 'swimsuit']),
      entry('Roles', ['doctor', 'housewife', 'maid', 'nun', 'nuns', 'nurse', 'office lady', 'police', 'princess', 'teacher', 'widow']),
      entry('Styles', ['cross-dressing', 'cross dressing', 'femboy', 'gender bender', 'trap'])
    ]
  },
  {
    id: 'scarlet-peach-niche',
    key: 'niche',
    name: 'Scarlet Peach Niche',
    categories: [
      entry('Action', ['action', 'adventure', 'martial arts', 'super power']),
      entry('Censored', ['censored'], 'censored'),
      entry('Comedy', ['comedy']),
      entry('Dark', ['horror', 'gore']),
      entry('Drama', ['drama']),
      entry('Erotic Game', ['erotic game']),
      entry('Historical', ['historical']),
      entry('Non-Japanese', ['non-japanese', 'non japanese']),
      entry('Sci-Fi', ['sci-fi', 'sci fi', 'science fiction']),
      entry('Soft', ['ecchi', 'softcore', 'nudity', 'vanilla']),
      entry('Sports', ['sports']),
      entry('Style', ['filmed', 'pov', 'x-ray', 'x ray']),
      entry('Supernatural', ['supernatural']),
      entry('Womb Tattoo', ['womb tattoo'])
    ]
  }
];

const normalize = (value) => String(value ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const groupMap = new Map(TAXONOMY_GROUPS.map((group) => [group.id, group]));
for (const group of TAXONOMY_GROUPS) {
  for (const category of group.categories) {
    category.normalizedName = normalize(category.name);
    category.normalizedAliases = new Set([category.normalizedName, ...category.aliases.map(normalize)].filter(Boolean));
  }
}

export const TAXONOMY_CATALOG_IDS = TAXONOMY_GROUPS.map((group) => group.id);

export function taxonomyGroup(id) {
  return groupMap.get(String(id || '')) || null;
}

export function taxonomyCategory(group, value) {
  if (!group) return null;
  const wanted = normalize(value);
  if (!wanted) return null;
  return group.categories.find((category) => category.normalizedName === wanted) || null;
}

export function taxonomyManifestCatalogs() {
  return TAXONOMY_GROUPS.map((group) => ({
    type: 'series',
    id: group.id,
    name: group.name,
    extra: [{ name: 'genre', options: group.categories.map((category) => category.name), isRequired: false }]
  }));
}

export function publicTaxonomy() {
  return TAXONOMY_GROUPS.map((group) => ({
    id: group.id,
    key: group.key,
    name: group.name,
    categories: group.categories.map((category) => category.name)
  }));
}

export function matchesTaxonomyCategory(title, category) {
  if (!title || !category) return false;
  if (category.special === 'uncensored' && String(title.censorStatus || '').toLowerCase() === 'uncensored') return true;
  if (category.special === 'censored' && String(title.censorStatus || '').toLowerCase() === 'censored') return true;

  const labels = taxonomyLabels(title);
  for (const alias of category.normalizedAliases) if (labels.has(alias)) return true;
  return false;
}

export function matchesTaxonomyGroup(title, group) {
  return !!group && group.categories.some((category) => matchesTaxonomyCategory(title, category));
}

function taxonomyLabels(title) {
  const values = [
    ...(Array.isArray(title.genres) ? title.genres : []),
    ...(Array.isArray(title.tags) ? title.tags : [])
  ];
  for (const mapping of Array.isArray(title.providerMappings) ? title.providerMappings : []) {
    values.push(...(Array.isArray(mapping?.tags) ? mapping.tags : []));
  }
  return new Set(values.map(normalize).filter(Boolean));
}
