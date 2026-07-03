// filter.js — Slur/hate speech/profanity filter for BossCord
// Opt-in for keyed accounts. Replaces matched words with ***

const SLUR_LIST = [
  // ===== Racial / ethnic slurs (sourced from Wikipedia's List of ethnic slurs + common knowledge) =====

  // Anti-Black
  'nigger', 'nigga', 'niggas', 'niggers', 'nigg3r', 'n1gger', 'n1gga', 'nig nog', 'nig',
  'coon', 'coons', 'darkie', 'darkies', 'darky',
  'jungle bunny', 'junglebunny',
  'porch monkey', 'porchmonkey',
  'spook', 'spooks',
  'sambo', 'sambos',
  'jigaboo', 'jiggaboo', 'jigaboos',
  'pickaninny', 'picaninny',
  'tar baby', 'tarbaby',
  'golliwog', 'golliwogs',
  'spade', 'spades',
  'moon cricket',
  'mud shark',
  'negro', 'negroid',

  // Anti-Asian
  'chink', 'chinks', 'ch1nk',
  'gook', 'gooks',
  'jap', 'japs',
  'zipperhead', 'zipperheads',
  'chinaman', 'chinamen',
  'chinky', 'chonky',
  'slant', 'slanteye', 'slant eye', 'slant-eye',
  'coolie', 'coolies',
  'ching chong', 'chingchong',
  'nip', 'nips',
  'slope', 'slopes',
  'gong',

  // Anti-Hispanic/Latino
  'spic', 'spics', 'sp1c', 'spick', 'spicks',
  'wetback', 'wetbacks',
  'beaner', 'beaners',
  'greaser', 'greasers',
  'gringo', 'gringos',

  // Anti-South Asian
  'paki', 'pakis',
  'raghead', 'ragheads',
  'towelhead', 'towelheads',
  'curry muncher',
  'dot head', 'dothead',
  'pajeet',

  // Anti-Middle Eastern / Arab
  'camel jockey', 'cameljockey',
  'sand nigger', 'sandnigger',
  'sand monkey',
  'hajji', 'haji', 'hadji',
  'muzrat',

  // Anti-Jewish
  'kike', 'kikes', 'k1ke',
  'hebe', 'hebes',
  'yid', 'yids',
  'sheeny', 'sheenies',
  'shylock', 'shylocks',
  'heeb',

  // Anti-White (included for completeness)
  'cracker', 'crackers',
  'honky', 'honkey', 'honkies',
  'peckerwood', 'peckerwoods',
  'redneck', 'rednecks',
  'trailer trash',
  'white trash',

  // Anti-European specific
  'dago', 'dagos',
  'wop', 'wops',
  'guinea', 'guineas',
  'kraut', 'krauts',
  'hun', 'huns',
  'frog', 'frogs',
  'limey', 'limeys',
  'mic', 'mick', 'micks',
  'polack', 'polacks',
  'bohunk', 'bohunks',
  'wog', 'wogs',

  // Anti-Native American
  'redskin', 'redskins',
  'injun', 'injuns',
  'squaw', 'squaws',
  'prairie nigger',
  'savage', 'savages',

  // Anti-Roma/Traveller
  'gyppo', 'gyppos',
  'pikey', 'pikeys',

  // General ethnic
  'halfbreed', 'half-breed', 'half breed',
  'mongrel', 'mongrels',
  'mulatto', 'mulattos',
  'miscegenation',
  'mud people', 'mudpeople',
  'coloreds', 'coloureds',
  'abo', 'abos',
  'boong', 'boongs',
  'chugg',
  'lubra',

  // ===== LGBTQ slurs =====
  'faggot', 'faggots', 'fag', 'fags', 'fagg0t', 'faggy',
  'dyke', 'dykes',
  'tranny', 'trannies', 'trannys',
  'shemale', 'shemales', 'she-male',
  'ladyboy', 'ladyboys',
  'heshe', 'he-she', 'he she',
  'sodomite', 'sodomites',
  'homo', 'homos',
  'battyboy', 'batty boy', 'battyman', 'batty man',
  'pansy', 'pansies',
  'poofter', 'poofters', 'poof', 'poofs',
  'nancy', 'nancy boy',
  'cocksucker', 'cocksuckers',
  'carpet muncher',
  'shirt lifter',
  'pillow biter',
  'rug muncher',
  'moffie', 'moffies',
  'queen',

  // ===== Religious slurs =====
  'christkiller', 'christ-killer', 'christ killer',
  'muzzie', 'muzzies',
  'goatfucker', 'goatfuckers',
  'papist', 'papists',
  'fenian', 'fenians',
  'proddy', 'proddies',
  'kafir', 'kafirs', 'kaffir', 'kaffirs',
  'infidel', 'infidels',
  'bible thumper',
  'bible basher',
  'holy roller',
  'fundie', 'fundies',
  'sky fairy',

  // ===== Ableist slurs =====
  'retard', 'retards', 'retarded', 'tard', 'tards',
  'spaz', 'spazz', 'spastic', 'spastics',
  'cripple', 'cripples',
  'mongoloid', 'mongoloids',
  'downie', 'downies',
  'window licker',

  // ===== General hate / extremism =====
  'subhuman', 'subhumans', 'sub-human',
  'untermensch',
  'master race',
  'white power', 'whitepower',
  'heil hitler', 'sieg heil',
  'gas the', 'gas them',
  'kill all',
  'ethnic cleansing',
  'final solution',
  'race war',
  'race traitor',
  'blood and soil',
  'fourteen words',

  // ===== Profanity / extreme pejoratives =====
  'fuck', 'fucks', 'fucker', 'fuckers', 'fucked', 'fucking', 'fck', 'fuk', 'fuq',
  'motherfucker', 'motherfuckers', 'motherfucking', 'mofo',
  'shit', 'shits', 'shitty', 'shitter', 'bullshit', 'horseshit', 'dipshit',
  'bitch', 'bitches', 'bitchy', 'bitchass',
  'ass', 'asses', 'asshole', 'assholes', 'arsehole', 'arseholes',
  'bastard', 'bastards',
  'damn', 'damnit', 'goddamn', 'goddamnit',
  'cunt', 'cunts',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'cock', 'cocks',
  'pussy', 'pussies',
  'whore', 'whores',
  'slut', 'sluts', 'slutty',
  'skank', 'skanks', 'skanky',
  'hoe', 'hoes',
  'twat', 'twats',
  'wanker', 'wankers',
  'tosser', 'tossers',
  'bollocks',
  'piss', 'pissed', 'pissing',
  'crap', 'crappy',
  'douche', 'douchebag', 'douchebags',
  'scumbag', 'scumbags',
  'jackass', 'jackasses',
  'dumbass', 'dumbasses',
  'shithead', 'shitheads',
  'son of a bitch',
  'stfu', 'gtfo', 'kys',
];

// Build a single regex from the word list (case-insensitive, word boundaries)
// Sort by length descending so multi-word phrases match before single words
const sortedSlurs = [...SLUR_LIST].sort((a, b) => b.length - a.length);

// Escape regex special characters in each word/phrase
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build regex: word boundary matching, case-insensitive
const FILTER_REGEX = new RegExp(
  '\\b(' + sortedSlurs.map(escapeRegex).join('|') + ')\\b',
  'gi'
);

/**
 * Censor slurs in text, replacing matched words with ***
 * @param {string} text
 * @returns {string}
 */
function censor(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(FILTER_REGEX, '***');
}

/**
 * Get the regex pattern as a string for client-side use
 * @returns {{ source: string, flags: string }}
 */
function getFilterPattern() {
  return { source: FILTER_REGEX.source, flags: 'gi' };
}

/**
 * Get the word list for sending to opted-in clients
 * @returns {string[]}
 */
function getFilterWords() {
  return sortedSlurs;
}

module.exports = {
  censor,
  getFilterPattern,
  getFilterWords,
  // Note: FILTER_REGEX uses /g flag which has stateful lastIndex.
  // External code should NOT call .test() or .exec() on it directly.
  // Use censor() instead, or create a new RegExp from getFilterPattern().
  FILTER_REGEX,
};
