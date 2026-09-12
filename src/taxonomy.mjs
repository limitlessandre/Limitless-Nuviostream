const tab = (name, aliases = [], special = null) => ({ name, aliases, special });
const entry = (name, aliases = [], special = null, tabs = []) => ({ name, aliases, special, tabs });

export const TAXONOMY_GROUPS = [
  {
    id: 'scarlet-peach-main',
    key: 'main',
    name: 'Scarlet Peach Main',
    categories: [
      entry('3D', ['3d', 'umemaro 3d']),
      entry('Anal', ['anal']),
      entry('BDSM', ['bdsm', 'bondage', 'femdom', 'humiliation'], null, [
        tab('Bondage', ['bondage']),
        tab('Femdom', ['femdom']),
        tab('Humiliation', ['humiliation'])
      ]),
      entry('Breasts', ['breasts', 'big boobs', 'big breasts', 'large breasts', 'huge breasts', 'small breasts', 'small boobs', 'big tits'], null, [
        tab('Big Boobs', ['big boobs', 'big breasts', 'large breasts', 'huge breasts', 'big tits']),
        tab('Small Breasts', ['small breasts', 'small boobs'])
      ]),
      entry('Cosplay', ['cosplay']),
      entry('Fantasy', ['fantasy']),
      entry('Furry', ['furry', 'animal girls', 'animal girl', 'nekomimi', 'catgirl', 'cat girl'], null, [
        tab('Animal Girls', ['animal girls', 'animal girl']),
        tab('Nekomimi', ['nekomimi', 'catgirl', 'cat girl'])
      ]),
      entry('Futanari', ['futanari', 'futa']),
      entry('Group', ['group sex', 'gangbang', 'orgy', 'threesome'], null, [
        tab('Group Sex', ['group sex']),
        tab('Gangbang', ['gangbang']),
        tab('Orgy', ['orgy']),
        tab('Threesome', ['threesome'])
      ]),
      entry('Harem', ['harem']),
      entry('Incest', ['incest', 'step family', 'step-family', 'step mother', 'stepmother', 'step sister', 'stepsister', 'step daughter', 'stepdaughter'], null, [
        tab('Step Mother', ['step mother', 'stepmother']),
        tab('Step Sister', ['step sister', 'stepsister']),
        tab('Step Daughter', ['step daughter', 'stepdaughter'])
      ]),
      entry('MILF', ['milf']),
      entry('Monsters', ['monster', 'monsters', 'demon', 'orc / goblin', 'orc', 'goblin', 'succubus', 'vampire'], null, [
        tab('Demon', ['demon']),
        tab('Orc / Goblin', ['orc / goblin', 'orc', 'goblin']),
        tab('Succubus', ['succubus']),
        tab('Vampire', ['vampire'])
      ]),
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
      entry('Body Play', ['armpit fetish', 'boob job', 'facesitting', 'nipple fuck'], null, [
        tab('Armpit Fetish', ['armpit fetish']),
        tab('Boob Job', ['boob job']),
        tab('Facesitting', ['facesitting']),
        tab('Nipple Fuck', ['nipple fuck'])
      ]),
      entry('Breeding', ['impregnation'], null, [
        tab('Impregnation', ['impregnation'])
      ]),
      entry('Exhibition', ['exhibitionism', 'public sex'], null, [
        tab('Exhibitionism', ['exhibitionism']),
        tab('Public Sex', ['public sex'])
      ]),
      entry('Fluids', ['creampie', 'facial', 'lactation', 'squirting', 'watersports'], null, [
        tab('Creampie', ['creampie']),
        tab('Facial', ['facial']),
        tab('Lactation', ['lactation']),
        tab('Squirting', ['squirting']),
        tab('Watersports', ['watersports'])
      ]),
      entry('Inflation', ['inflation']),
      entry('Manual', ['foot job', 'hand job'], null, [
        tab('Foot Job', ['foot job']),
        tab('Hand Job', ['hand job'])
      ]),
      entry('Masturbation', ['masturbation']),
      entry('Mind Play', ['mind break', 'mind control', 'corruption'], null, [
        tab('Mind Break', ['mind break']),
        tab('Mind Control', ['mind control']),
        tab('Corruption', ['corruption'])
      ]),
      entry('Oral', ['blow job', 'blowjob', 'deep throat', 'deepthroat'], null, [
        tab('Blow Job', ['blow job', 'blowjob']),
        tab('Deep Throat', ['deep throat', 'deepthroat'])
      ]),
      entry('Penetration', ['double penetration', 'fisting'], null, [
        tab('Double Penetration', ['double penetration']),
        tab('Fisting', ['fisting'])
      ]),
      entry('Rape', ['rape', 'reverse rape', 'molestation', 'train molestation'], null, [
        tab('Reverse Rape', ['reverse rape']),
        tab('Molestation', ['molestation']),
        tab('Train Molestation', ['train molestation'])
      ]),
      entry('Scat', ['scat']),
      entry('Teasing', ['teasing']),
      entry('Toys', ['toys', 'sex toys', 'strap-on', 'strap on'], null, [
        tab('Strap-on', ['strap-on', 'strap on'])
      ])
    ]
  },
  {
    id: 'scarlet-peach-characters',
    key: 'characters',
    name: 'Scarlet Peach Characters',
    categories: [
      entry('Archetypes', ['gyaru', 'tsundere', 'ugly bastard'], null, [
        tab('Gyaru', ['gyaru']),
        tab('Tsundere', ['tsundere']),
        tab('Ugly Bastard', ['ugly bastard'])
      ]),
      entry('Looks', ['bbw', 'plus size', 'plus-size', 'blonde', 'dark skin', 'glasses', 'pregnant', 'stocking', 'stockings', 'swimsuit'], null, [
        tab('BBW / Plus-size', ['bbw', 'plus size', 'plus-size']),
        tab('Blonde', ['blonde']),
        tab('Dark Skin', ['dark skin']),
        tab('Glasses', ['glasses']),
        tab('Pregnant', ['pregnant']),
        tab('Stockings', ['stocking', 'stockings']),
        tab('Swimsuit', ['swimsuit'])
      ]),
      entry('Roles', ['doctor', 'housewife', 'maid', 'nun', 'nuns', 'nurse', 'office lady', 'police', 'princess', 'teacher', 'widow'], null, [
        tab('Doctor', ['doctor']),
        tab('Housewife', ['housewife']),
        tab('Maid', ['maid']),
        tab('Nun', ['nun', 'nuns']),
        tab('Nurse', ['nurse']),
        tab('Office Lady', ['office lady']),
        tab('Police', ['police']),
        tab('Princess', ['princess']),
        tab('Teacher', ['teacher']),
        tab('Widow', ['widow'])
      ]),
      entry('Styles', ['cross-dressing', 'cross dressing', 'femboy', 'gender bender', 'trap'], null, [
        tab('Cross-Dressing', ['cross-dressing', 'cross dressing']),
        tab('Femboy', ['femboy']),
        tab('Gender Bender', ['gender bender']),
        tab('Trap', ['trap'])
      ])
    ]
  },
  {
    id: 'scarlet-peach-niche',
    key: 'niche',
    name: 'Scarlet Peach Niche',
    categories: [
      entry('Action', ['action', 'adventure', 'martial arts', 'super power'], null, [
        tab('Adventure', ['adventure']),
        tab('Martial Arts', ['martial arts']),
        tab('Super Power', ['super power'])
      ]),
      entry('Censored', ['censored'], 'censored'),
      entry('Comedy', ['comedy']),
      entry('Dark', ['horror', 'gore'], null, [
        tab('Horror', ['horror']),
        tab('Gore', ['gore'])
      ]),
      entry('Drama', ['drama']),
      entry('Erotic Game', ['erotic game']),
      entry('Historical', ['historical']),
      entry('Non-Japanese', ['non-japanese', 'non japanese']),
      entry('Sci-Fi', ['sci-fi', 'sci fi', 'science fiction']),
      entry('Soft', ['ecchi', 'softcore', 'nudity', 'vanilla'], null, [
        tab('Ecchi', ['ecchi']),
        tab('Softcore', ['softcore']),
        tab('Nudity', ['nudity']),
        tab('Vanilla', ['vanilla'])
      ]),
      entry('Sports', ['sports']),
      entry('Style', ['filmed', 'pov', 'x-ray', 'x ray'], null, [
        tab('Filmed', ['filmed']),
        tab('POV', ['pov']),
        tab('X-Ray', ['x-ray', 'x ray'])
      ]),
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
    prepareEntry(category);
    for (const child of category.tabs || []) prepareEntry(child);
  }
}

function prepareEntry(item) {
  item.normalizedName = normalize(item.name);
  item.normalizedAliases = new Set([item.normalizedName, ...item.aliases.map(normalize)].filter(Boolean));
}

export const TAXONOMY_CATALOG_IDS = TAXONOMY_GROUPS.map((group) => group.id);

export function taxonomyGroup(id) {
  return groupMap.get(String(id || '')) || null;
}

export function taxonomyCategory(group, value) {
  if (!group) return null;
  const wanted = normalize(value);
  if (!wanted) return null;
  for (const category of group.categories) {
    if (category.normalizedName === wanted) return category;
    const child = (category.tabs || []).find((item) => item.normalizedName === wanted);
    if (child) return child;
  }
  return null;
}

export function taxonomyManifestCatalogs() {
  return TAXONOMY_GROUPS.map((group) => ({
    type: 'series',
    id: group.id,
    name: group.name,
    extra: [{ name: 'genre', options: uniqueNames(group.categories.flatMap((category) => [category, ...(category.tabs || [])])), isRequired: false }]
  }));
}

export function publicTaxonomy() {
  return TAXONOMY_GROUPS.map((group) => ({
    id: group.id,
    key: group.key,
    name: group.name,
    categories: group.categories.map((category) => category.name),
    folders: group.categories.map((category) => ({
      name: category.name,
      tabs: (category.tabs || []).map((item) => item.name)
    }))
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

function uniqueNames(items) {
  return [...new Set(items.map((item) => item.name).filter(Boolean))];
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
