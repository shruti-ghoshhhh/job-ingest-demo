const { XMLParser } = require('fast-xml-parser');

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true
});

/**
 * Parses a RemoteOK-style JSON array response into raw candidate records.
 * RemoteOK's first array element is a legal/metadata blob, not a listing —
 * that's left in deliberately; validate.js is responsible for quarantining
 * it, not this layer, so the "bad record survives to validation and gets
 * caught" path stays real rather than pre-filtered away here.
 */
function parseJsonSource(rawText) {
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed)) {
        throw new Error('Expected a JSON array from source');
    }
    return parsed;
}

/**
 * Parses a WeWorkRemotely-style RSS feed into the same raw-record shape
 * validate.js already expects (id/title/company/url/tags/date), so both
 * sources can flow through one validation + storage path.
 *
 * WWR item titles are conventionally "Company: Job Title" — split on the
 * first colon. If a title doesn't follow that convention, company falls
 * back to null, which validate.js will correctly flag as missing rather
 * than silently guessing.
 */
function parseRssSource(rawText) {
    const doc = xmlParser.parse(rawText);
    const items = doc?.rss?.channel?.item;
    const list = Array.isArray(items) ? items : items ? [items] : [];

    return list.map((item) => {
        const rawTitle = typeof item.title === 'string' ? item.title : '';
        const splitIdx = rawTitle.indexOf(':');
        const company = splitIdx > -1 ? rawTitle.slice(0, splitIdx).trim() : null;
        const title = splitIdx > -1 ? rawTitle.slice(splitIdx + 1).trim() : rawTitle.trim() || null;

        return {
            id: item.guid?.['#text'] || item.guid || item.link,
            position: title,
            company,
            url: item.link,
            tags: [],
            date: item.pubDate || null
        };
    });
}

function parseSource(sourceType, rawText) {
    if (sourceType === 'json') return parseJsonSource(rawText);
    if (sourceType === 'rss') return parseRssSource(rawText);
    throw new Error(`Unknown source type: ${sourceType}`);
}

module.exports = { parseSource, parseJsonSource, parseRssSource };
