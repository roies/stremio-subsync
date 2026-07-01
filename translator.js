'use strict';

const SMALL_HEB_MAP = {
  hello: 'שלום',
  world: 'עולם',
  goodbye: 'להתראות',
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
};

// Parse SRT into blocks: [{ index, timing, text }]
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

function localTranslateText(text, targetLang) {
  if (targetLang && !/^he|hebrew$/i.test(targetLang)) return null;
  const words = text.split(/(\s|[.,!?;:'"()\-]+)/).filter(Boolean);
  const translated = words.map(word => {
    const key = word.toLowerCase();
    return SMALL_HEB_MAP[key] || word;
  });
  return translated.join('');
}

// Unofficial Google Translate endpoint — no API key, uses existing node-fetch
async function googleTranslate(text, targetLang, fetchFn = require('node-fetch')) {
  const url =
    'https://translate.googleapis.com/translate_a/single?' +
    `client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Google Translate returned ${res.status}`);
  const data = await res.json();
  return data[0].map(item => item[0]).join(''); // data[0] = [[chunk, original], ...]
}

async function translateText(text, targetLang, fetchFn) {
  try {
    return await googleTranslate(text, targetLang, fetchFn);
  } catch {
    const local = localTranslateText(text, targetLang);
    return local || text;
  }
}

// Translate all subtitle text blocks, CONCURRENCY at a time.
// Falls back to the original text on any per-block error.
async function translateSrt(content, targetLang, fetchFn = require('node-fetch')) {
  const blocks = parseSrt(content);
  if (!blocks.length) return content;

  const CONCURRENCY = 10;
  const translated = new Array(blocks.length);

  for (let i = 0; i < blocks.length; i += CONCURRENCY) {
    const slice = blocks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(b => translateText(b.text, targetLang, fetchFn))
    );
    results.forEach((t, j) => { translated[i + j] = t; });
  }

  return buildSrt(blocks.map((b, i) => ({ ...b, text: translated[i] })));
}

module.exports = { parseSrt, buildSrt, googleTranslate, translateSrt, localTranslateText };
