"use strict";

const BASE_URL = 'https://anidb.app';
const TMDB_KEY = '307b7b8ef035c6aa336900aef4e203bd';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': BASE_URL + '/',
    'Accept': 'application/json, text/plain, */*'
};

function normalizeTitle(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function computeTitleSimilarity(titleA, titleB) {
    titleA = normalizeTitle(titleA);
    titleB = normalizeTitle(titleB);
    if (!titleA || !titleB) return 0;
    const tokensA = titleA.split(' ');
    const tokensB = titleB.split(' ');
    let intersection = 0;
    for (let i = 0; i < tokensA.length; i++) if (tokensB.indexOf(tokensA[i]) !== -1) intersection++;
    return (2 * intersection) / (tokensA.length + tokensB.length);
}

function deduplicateByUrl(streams) {
    const seen = new Set();
    return streams.filter(function (s) { return s.url && !seen.has(s.url) && seen.add(s.url); });
}

async function fetchText(url, headers) {
    try {
        const res = await fetch(url, { headers: headers || { 'User-Agent': USER_AGENT } });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}

async function fetchJson(url, headers) {
    try {
        const res = await fetch(url, { headers: headers || { 'User-Agent': USER_AGENT } });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function fetchTmdbSeriesTitle(tmdbId) {
    const data = await fetchJson(
        'https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + TMDB_KEY,
        { 'Accept': 'application/json' }
    );
    if (!data) return null;
    return data.name || data.original_name || null;
}

async function searchAnime(query) {
    const html = await fetchText(
        BASE_URL + '/search/suggestions?q=' + encodeURIComponent(query),
        HEADERS
    );
    if (!html) return [];

    const results = [];
    const pattern = /<a href="(?:https?:\/\/anidb\.app)?\/anime\/([a-z0-9-]+?)-(\d+)"[^>]*>[\s\S]{0,400}?<img[^>]*alt="([^"]*)"/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        results.push({ numId: match[2], title: match[3] || match[1].replace(/-/g, ' ') });
    }
    return results;
}

function selectBestMatch(candidates, targetTitle) {
    let bestMatch = null, bestScore = 0;
    for (let i = 0; i < candidates.length; i++) {
        if (normalizeTitle(candidates[i].title) === normalizeTitle(targetTitle)) return candidates[i];
        const score = computeTitleSimilarity(candidates[i].title, targetTitle);
        if (score > bestScore) { bestScore = score; bestMatch = candidates[i]; }
    }
    return bestScore >= 0.5 ? bestMatch : null;
}

async function resolveEpisodeId(animeId, episodeNumber) {
    const json = await fetchJson(BASE_URL + '/api/frontend/anime/' + animeId + '/episodes', HEADERS);
    if (!json) return null;
    const episodes = json.episodes || [];
    for (let i = 0; i < episodes.length; i++) {
        if (String(episodes[i].number) === String(episodeNumber)) return episodes[i].id;
    }
    return null;
}

async function fetchEpisodeLanguages(episodeId) {
    const data = await fetchJson(BASE_URL + '/api/frontend/episode/' + episodeId + '/languages', HEADERS);
    if (!data) return [];
    return Array.isArray(data) ? data : (Array.isArray(data.languages) ? data.languages : []);
}

async function resolveStreamFromLanguage(language) {
    const embedUrl = language.embed_url || '';
    if (!embedUrl) return null;

    const html = await fetchText(embedUrl, { 'User-Agent': USER_AGENT, 'Referer': BASE_URL + '/' });
    if (!html) return null;

    const match = html.match(/file\s*:\s*'(https?:\/\/[^']+\.m3u8[^']*)'/);
    if (!match) return null;

    const langCode = String(language.code || '').toLowerCase();
    const label = langCode === 'eng' ? 'English' : 'Japanese';

    return {
        name: 'AniDB \u2022 ' + label,
        title: 'AniDB \u2022 ' + label,
        url: match[1],
        quality: '1080p',
        headers: { 'User-Agent': USER_AGENT, 'Referer': embedUrl },
    };
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return [];

    try {
        const seriesTitle = await fetchTmdbSeriesTitle(tmdbId);
        if (!seriesTitle) return [];

        const episodeNumber = episode || 1;
        const candidates = await searchAnime(seriesTitle);
        const bestMatch = selectBestMatch(candidates, seriesTitle);
        if (!bestMatch) return [];

        const episodeId = await resolveEpisodeId(bestMatch.numId, episodeNumber);
        if (!episodeId) return [];

        const languages = await fetchEpisodeLanguages(episodeId);
        if (!languages.length) return [];

        const streams = await Promise.all(languages.map(function (lang) { return resolveStreamFromLanguage(lang); }));

        return deduplicateByUrl(streams.filter(Boolean));
    } catch {
        return [];
    }
}

module.exports = { getStreams };