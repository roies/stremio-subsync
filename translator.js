'use strict';

const { spawn } = require('child_process');

const SMALL_HEB_MAP = {
  hello: 'שלום',
  hi: 'היי',
  world: 'עולם',
  goodbye: 'להתראות',
  bye: 'להתראות',
  yes: 'כן',
  no: 'לא',
  the: 'ה',
  and: 'ו',
  to: 'ל',
  of: 'של',
  in: 'ב',
  on: 'על',
  for: 'ל',
  with: 'עם',
  this: 'זה',
  that: 'זה',
  is: 'הוא',
  are: 'הם',
  be: 'להיות',
  my: 'השלי',
  your: 'השלך',
  we: 'אנחנו',
  you: 'אתה',
  they: 'הם',
  i: 'אני',
  it: 'זה',
  have: 'יש',
  has: 'יש',
  can: 'יכול',
  cannot: 'לא יכול',
  not: 'לא',
  what: 'מה',
  where: 'איפה',
  when: 'מתי',
  who: 'מי',
  why: 'למה',
  how: 'איך',
  do: 'לעשות',
  dont: 'אל תעשה',
  please: 'בבקשה',
  wait: 'תחכה',
  stop: 'עצור',
  run: 'רוץ',
  go: 'לך',
  come: 'בוא',
  help: 'עזרה',
  friend: 'חבר',
  home: 'בית',
  family: 'משפחה',
  love: 'אהבה',
  time: 'זמן',
  day: 'יום',
  night: 'לילה',
  morning: 'בוקר',
  evening: 'ערב',
  good: 'טוב',
  sorry: 'סליחה',
  thank: 'תודה',
  thanks: 'תודה',
  me: 'אותי',
  us: 'אותנו',
  them: 'אותם',
  name: 'שם',
  call: 'לקרוא',
  need: 'צריך',
  want: 'רוצה',
  know: 'יודע',
  think: 'חושב',
  feel: 'מרגיש',
  safe: 'בטוח',
  danger: 'סכנה',
  stay: 'להישאר',
  leave: 'לעזוב',
  back: 'בחזרה',
  now: 'עכשיו',
  later: 'מאוחר יותר',
};

const PHRASE_MAP = {
  'good morning': 'בוקר טוב',
  'good evening': 'ערב טוב',
  'good night': 'לילה טוב',
  'goodbye for now': 'להתראות לעכשיו',
  'thank you': 'תודה',
  'thanks a lot': 'תודה רבה',
  'sorry about that': 'סליחה על זה',
  'excuse me': 'סליחה',
  'please wait': 'בבקשה תחכה',
  'please stop': 'בבקשה תעצור',
  'please help': 'בבקשה עזרה',
  'i need help': 'אני צריך עזרה',
  'i need to go': 'אני צריך ללכת',
  'where are you': 'איפה אתה',
  'what is your name': 'מה שמך',
  'my name is': 'שמי הוא',
  'i do not know': 'אני לא יודע',
  'i dont know': 'אני לא יודע',
  'i am fine': 'אני בסדר',
  'i am hungry': 'אני רעב',
  'i am tired': 'אני עייף',
  'i am scared': 'אני מפחד',
  'i love you': 'אני אוהב אותך',
  'be careful': 'היו זהירים',
  'stay calm': 'הישאר רגוע',
  'call the police': 'התקשר למשטרה',
  'call me': 'תתקשר אליי',
  'come here': 'בוא הנה',
  'go away': 'לך מכאן',
  'wait here': 'תחכה כאן',
  'take care': 'תשמור על עצמך',
  'see you later': 'נתראה מאוחר יותר',
  'see you soon': 'נתראה בקרוב',
};

const DEFAULT_OFFLINE_TRANSLATIONS = {
  he: { map: SMALL_HEB_MAP, phrases: PHRASE_MAP },
};

function parseSrt(content) {
  return content
    .trim()
    .split(/\r?\n\r?\n/)
    .map(block => {
      const lines = block.split(/\r?\n/);
      return { index: lines[0] || '', timing: lines[1] || '', text: lines.slice(2).join('\n') };
    })
    .filter(b => b.timing.includes('-->'));
}

function buildSrt(blocks) {
  return blocks.map(b => `${b.index}\n${b.timing}\n${b.text}`).join('\n\n') + '\n';
}

function normalizePhrase(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLangCode(lang) {
  return (lang || '').toLowerCase().trim();
}

function remoteTranslationEnabled() {
  const value = normalizeLangCode(process.env.ENABLE_REMOTE_TRANSLATION);
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function isEnglishLike(lang) {
  const normalized = normalizeLangCode(lang);
  return ['en', 'eng', 'english', 'auto', ''].includes(normalized);
}

function looksLikeTargetLanguage(text, targetLang) {
  const lang = normalizeLangCode(targetLang);
  if (lang === 'he' || lang === 'heb' || lang === 'hebrew') {
    return /[\u0590-\u05FF]/.test(text);
  }
  return false;
}

function getOfflineTranslator(targetLang, sourceLang = 'en') {
  const lang = normalizeLangCode(targetLang);
  if ((lang === 'he' || lang === 'heb' || lang === 'hebrew') && isEnglishLike(sourceLang)) {
    return { map: SMALL_HEB_MAP, phrases: PHRASE_MAP };
  }
  return null;
}

function localTranslateText(text, targetLang, sourceLang = 'en') {
  const translator = getOfflineTranslator(targetLang, sourceLang);
  if (!translator) return null;

  const normalized = normalizePhrase(text);
  if (!normalized) return '';

  if (translator.phrases[normalized]) return translator.phrases[normalized];

  const tokens = text.split(/(\s+|[.,!?;:'"()\-]+)/);
  return tokens.map(token => {
    if (!token.trim()) return token;
    const match = token.match(/[A-Za-z']+/);
    if (!match) return token;

    const word = match[0];
    const lower = word.toLowerCase();
    const translated = translator.map[lower] || word;
    if (word === word.toUpperCase()) return translated.toUpperCase();
    if (/[A-Z]/.test(word[0])) return translated.charAt(0).toUpperCase() + translated.slice(1);
    return translated;
  }).join('');
}

async function googleTranslate(text, targetLang, fetchFn = require('node-fetch'), sourceLang = 'en') {
  const url =
    'https://translate.googleapis.com/translate_a/single?' +
    `client=gtx&sl=${encodeURIComponent(sourceLang || 'en')}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Google Translate returned ${res.status}`);
  const data = await res.json();
  return data[0].map(item => item[0]).join('');
}

function argosTranslate(text, targetLang, sourceLang = 'en') {
  return new Promise((resolve) => {
    const proc = spawn('argos-translate', ['-t', targetLang, '-s', sourceLang || 'en'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else resolve(null);
    });
    proc.on('error', () => resolve(null));
    proc.stdin.end(text);
  });
}

async function translateText(text, targetLang, fetchFn, sourceLang = 'en') {
  if (looksLikeTargetLanguage(text, targetLang)) {
    return text;
  }

  const lang = normalizeLangCode(targetLang);
  if (lang !== 'he' && lang !== 'heb' && lang !== 'hebrew') {
    return localTranslateText(text, targetLang, sourceLang) || text;
  }

  const argosResult = await argosTranslate(text, targetLang, sourceLang);
  if (argosResult) return argosResult;

  if (!remoteTranslationEnabled()) {
    const local = localTranslateText(text, targetLang, sourceLang);
    return local || text;
  }

  try {
    return await googleTranslate(text, targetLang, fetchFn, sourceLang);
  } catch {
    const local = localTranslateText(text, targetLang, sourceLang);
    return local || text;
  }
}

async function translateSrt(content, targetLang, fetchFn = require('node-fetch'), sourceLang = 'en') {
  const blocks = parseSrt(content);
  if (!blocks.length) return content;

  const CONCURRENCY = 10;
  const translated = new Array(blocks.length);

  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const slice = blocks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(b => translateText(b.text, targetLang, fetchFn, sourceLang)));
    results.forEach((t, j) => { translated[i + j] = t; });
  }

  return buildSrt(blocks.map((b, i) => ({ ...b, text: translated[i] })));
}

module.exports = { parseSrt, buildSrt, googleTranslate, translateSrt, localTranslateText, argosTranslate };

