// Stemming utilities for fuzzy search
// Porter stemmer vendored from https://github.com/words/stemmer (MIT License)
// Copyright (c) 2014 Titus Wormer <tituswormer@gmail.com>

// --- Vendored Porter Stemmer ---

const step2list = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize',
  bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous',
  ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive',
  fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble',
  logi: 'log'
};

const step3list = {
  icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic',
  ful: '', ness: ''
};

const consonant = '[^aeiou]';
const vowel = '[aeiouy]';
const consonants = '(' + consonant + '[^aeiouy]*)';
const vowels = '(' + vowel + '[aeiou]*)';

const gt0 = new RegExp('^' + consonants + '?' + vowels + consonants);
const eq1 = new RegExp('^' + consonants + '?' + vowels + consonants + vowels + '?$');
const gt1 = new RegExp('^' + consonants + '?(' + vowels + consonants + '){2,}');
const vowelInStem = new RegExp('^' + consonants + '?' + vowel);
const consonantLike = new RegExp('^' + consonants + vowel + '[^aeiouwxy]$');

const sfxLl = /ll$/;
const sfxE = /^(.+?)e$/;
const sfxY = /^(.+?)y$/;
const sfxIon = /^(.+?(s|t))(ion)$/;
const sfxEdOrIng = /^(.+?)(ed|ing)$/;
const sfxAtOrBlOrIz = /(at|bl|iz)$/;
const sfxEED = /^(.+?)eed$/;
const sfxS = /^.+?[^s]s$/;
const sfxSsesOrIes = /^.+?(ss|i)es$/;
const sfxMultiConsonantLike = /([^aeiouylsz])\1$/;
const step2 = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
const step3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
const step4 = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;

function porterStemmer(value) {
  let result = String(value).toLowerCase();
  if (result.length < 3) return result;

  let firstCharacterWasLowerCaseY = false;
  if (result.codePointAt(0) === 121) {
    firstCharacterWasLowerCaseY = true;
    result = 'Y' + result.slice(1);
  }

  if (sfxSsesOrIes.test(result)) {
    result = result.slice(0, -2);
  } else if (sfxS.test(result)) {
    result = result.slice(0, -1);
  }

  let match;
  if ((match = sfxEED.exec(result))) {
    if (gt0.test(match[1])) result = result.slice(0, -1);
  } else if ((match = sfxEdOrIng.exec(result)) && vowelInStem.test(match[1])) {
    result = match[1];
    if (sfxAtOrBlOrIz.test(result)) {
      result += 'e';
    } else if (sfxMultiConsonantLike.test(result)) {
      result = result.slice(0, -1);
    } else if (consonantLike.test(result)) {
      result += 'e';
    }
  }

  if ((match = sfxY.exec(result)) && vowelInStem.test(match[1])) {
    result = match[1] + 'i';
  }
  if ((match = step2.exec(result)) && gt0.test(match[1])) {
    result = match[1] + step2list[match[2]];
  }
  if ((match = step3.exec(result)) && gt0.test(match[1])) {
    result = match[1] + step3list[match[2]];
  }
  if ((match = step4.exec(result))) {
    if (gt1.test(match[1])) result = match[1];
  } else if ((match = sfxIon.exec(result)) && gt1.test(match[1])) {
    result = match[1];
  }

  if ((match = sfxE.exec(result)) &&
    (gt1.test(match[1]) || (eq1.test(match[1]) && !consonantLike.test(match[1])))) {
    result = match[1];
  }
  if (sfxLl.test(result) && gt1.test(result)) {
    result = result.slice(0, -1);
  }

  if (firstCharacterWasLowerCaseY) {
    result = 'y' + result.slice(1);
  }
  return result;
}

// --- Normalization & Public API ---

/**
 * Normalize a word for stemming: expand music contractions, strip punctuation.
 * @param {string} word
 * @returns {string}
 */
export function normalizeWord(word) {
  let w = word.toLowerCase();
  // Expand music contractions: rollin' → rolling, cryin' → crying
  w = w.replace(/in'$/, 'ing');
  // Strip remaining punctuation (possessives, quotes, etc.)
  w = w.replace(/[^a-z0-9]/g, '');
  return w;
}

/**
 * Normalize then stem a word.
 * @param {string} word
 * @returns {string}
 */
export function stemWord(word) {
  const normalized = normalizeWord(word);
  if (!normalized) return '';
  return porterStemmer(normalized);
}

/**
 * Tokenize text into a Set of stemmed words.
 * @param {string} text
 * @returns {Set<string>}
 */
export function buildStemSet(text) {
  const stems = new Set();
  const words = text.split(/\s+/);
  for (const word of words) {
    const stem = stemWord(word);
    if (stem) stems.add(stem);
  }
  return stems;
}
