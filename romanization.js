const kroman = require('kroman');
const pinyin = require('pinyin');
const Kuroshiro = require('kuroshiro').default;
const KuromojiAnalyzer = require('kuroshiro-analyzer-kuromoji');

const kuroshiro = new Kuroshiro();
const analyzer = new KuromojiAnalyzer();

let isJpReady = false;
kuroshiro.init(analyzer).then(() => {
    isJpReady = true;
});

async function autoRomanize(text) {
    if (!text) return '';

    // Check for Hiragana or Katakana FIRST
    const hasJapaneseKana = /[\u3040-\u309f\u30a0-\u30ff]/.test(text);

    if (hasJapaneseKana) {
        try {
            if (isJpReady) {
                return await kuroshiro.convert(text, { to: "romaji", mode: "spaced" });
            }
        } catch (e) { return text; }
    }

    // Check for Hangul
    if (/[\uac00-\ud7af]/.test(text)) {
        try { return kroman.parse(text); } catch (e) { return text; }
    }

    // If it has Hanzi/Kanji but NO Kana --> Chinese
    if (/[\u4e00-\u9fff]/.test(text)) {
        try {
            const pinyinFunc = (typeof pinyin === 'function') ? pinyin : pinyin.default;
            const pinyinArray = pinyinFunc(text, { style: 1, heteronym: false, segment: true });
            return pinyinArray.flat().join(' ');
        } catch (e) { return text; }
    }

    return text;
}

module.exports = { autoRomanize };