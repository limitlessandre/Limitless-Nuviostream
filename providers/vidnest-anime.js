// VidnestAnime Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach only
// Extracts anime streaming links using AniList IDs for Vidnest anime servers with AES-GCM decryption

// VidnestAnime Configuration
const VIDNEST_BASE_URL = 'https://backend.vidnest.fun';
const PASSPHRASE = 'A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6o=';

// TMDB API Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Anime Servers Configuration
const ANIME_SERVERS = {
    'hindi': {
        url: (id, ep) => `${VIDNEST_BASE_URL}/animeworld/${id}/${ep}/server/my%20server`,
        language: 'Hindi',
        needsDecryption: true
    },
    'satoru': {
        url: (id, ep) => `${VIDNEST_BASE_URL}/satoru/${id}/${ep}`,
        language: 'Original',
        needsDecryption: true
    },
    'miko': {
        url: (id, ep, lang) => `${VIDNEST_BASE_URL}/aniwave/${id}/${ep}/${lang}/wave`,
        language: 'Original',
        needsDecryption: true,
        supportsSubDub: true
    },
    'pahe': {
        url: (id, ep, lang) => `${VIDNEST_BASE_URL}/aniwave/${id}/${ep}/${lang}/pahe`,
        language: 'Original',
        needsDecryption: true,
        supportsSubDub: true
    },
    'anya': {
        url: (id, ep, lang) => `${VIDNEST_BASE_URL}/aniwave/${id}/${ep}/${lang}/anya`,
        language: 'Original',
        needsDecryption: true,
        supportsSubDub: true
    }
};

// Working headers for VidnestAnime API
const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://vidnest.fun/',
    'Origin': 'https://vidnest.fun',
    'DNT': '1'
};

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function base64ToBytes(base64) {
    if (!base64) return new Uint8Array(0);
    let input = String(base64).replace(/=+$/, '');
    let output = '';
    let bc = 0, bs, buffer, idx = 0;
    while ((buffer = input.charAt(idx++))) {
        buffer = BASE64_CHARS.indexOf(buffer);
        if (~buffer) {
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
        }
    }
    const bytes = new Uint8Array(output.length);
    for (let i = 0; i < output.length; i++) bytes[i] = output.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes) {
    if (!bytes || bytes.length === 0) return '';
    let output = '';
    let i = 0;
    const len = bytes.length;
    while (i < len) {
        const a = bytes[i++];
        const b = i < len ? bytes[i++] : 0;
        const c = i < len ? bytes[i++] : 0;
        const bitmap = (a << 16) | (b << 8) | c;
        output += BASE64_CHARS.charAt((bitmap >> 18) & 63);
        output += BASE64_CHARS.charAt((bitmap >> 12) & 63);
        output += i - 2 < len ? BASE64_CHARS.charAt((bitmap >> 6) & 63) : '=';
        output += i - 1 < len ? BASE64_CHARS.charAt(bitmap & 63) : '=';
    }
    return output;
}

function atob(str) {
    return base64ToBytes(str).map(byte => String.fromCharCode(byte)).join('');
}

function decryptAesGcm(encryptedB64, passphraseB64) {
    console.log('[VidnestAnime] Starting AES-GCM decryption via server...');
    return fetch('https://aesdec.nuvioapp.space/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptedData: encryptedB64, passphrase: passphraseB64 })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        console.log('[VidnestAnime] Server decryption successful');
        return data.decrypted;
    })
    .catch(error => {
        console.error(`[VidnestAnime] Server decryption failed: ${error.message}`);
        throw error;
    });
}

function makeRequest(url, options = {}) {
    const defaultHeaders = { ...WORKING_HEADERS };
    return fetch(url, {
        method: options.method || 'GET',
        headers: { ...defaultHeaders, ...options.headers },
        ...options
    }).then(function(response) {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return response;
    }).catch(function(error) {
        console.error(`[VidnestAnime] Request failed for ${url}: ${error.message}`);
        throw error;
    });
}

function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return makeRequest(url)
        .then(response => response.json())
        .then(function(data) {
            const title = mediaType === 'tv' ? data.name : data.title;
            const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
            const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
            return { title, year };
        });
}

function mapTMDBToAniList(tmdbId, title, year) {
    console.log(`[VidnestAnime] Mapping TMDB ${tmdbId} to AniList...`);
    const query = `
        query ($search: String, $year: Int) {
            Media(search: $search, seasonYear: $year, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
                id
                title { romaji english native }
                seasonYear
            }
        }
    `;
    return fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables: { search: title, year } })
    })
    .then(response => response.json())
    .then(function(data) {
        if (data.data && data.data.Media) {
            const anilistId = data.data.Media.id;
            console.log(`[VidnestAnime] Mapped to AniList ID: ${anilistId} (${data.data.Media.title.english || data.data.Media.title.romaji})`);
            return anilistId;
        }
        throw new Error(`No AniList mapping found for "${title}" (${year})`);
    });
}

function getTMDBSeasonEpisodeCounts(tmdbId, targetSeason) {
    console.log(`[VidnestAnime] Fetching season info for TMDB ${tmdbId}, seasons 1-${targetSeason}`);
    const seasonPromises = [];
    for (let s = 1; s < targetSeason; s++) {
        const url = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${s}?api_key=${TMDB_API_KEY}`;
        seasonPromises.push(
            makeRequest(url)
                .then(response => response.json())
                .then(data => data.episodes ? data.episodes.length : 0)
                .catch(function(error) {
                    console.error(`[VidnestAnime] Failed to fetch season ${s}: ${error.message}`);
                    return 0;
                })
        );
    }
    return Promise.all(seasonPromises).then(function(episodeCounts) {
        const totalPreviousEpisodes = episodeCounts.reduce((sum, count) => sum + count, 0);
        console.log(`[VidnestAnime] Previous seasons episode counts: ${episodeCounts.join(', ')} = ${totalPreviousEpisodes} total`);
        return totalPreviousEpisodes;
    });
}

function getAnimeMetadata(anilistId, episodeNum) {
    console.log(`[VidnestAnime] Fetching metadata for AniList ID: ${anilistId}, Episode: ${episodeNum}`);
    return makeRequest(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
        .then(response => response.json())
        .then(function(data) {
            const episode = data.episodes?.[String(episodeNum)] || null;
            return {
                anilistId,
                title: data.title?.english || data.titles?.en || `Anime ID: ${anilistId}`,
                episodeTitle: episode?.title || null,
                poster: episode?.image || data.images?.find(i => i.coverType === 'Poster')?.url || '',
                year: data.year || null
            };
        })
        .catch(function(error) {
            console.error(`[VidnestAnime] Failed to fetch anime metadata: ${error.message}`);
            return { anilistId, title: `Anime ID: ${anilistId}`, episodeTitle: null, poster: '', year: null };
        });
}

function fetchFromAnimeServer(serverName, serverConfig, anilistId, episodeNum, subDub) {
    console.log(`[VidnestAnime] Fetching from ${serverName}...`);
    const url = serverConfig.supportsSubDub
        ? serverConfig.url(anilistId, episodeNum, subDub || 'sub')
        : serverConfig.url(anilistId, episodeNum);
    console.log(`[VidnestAnime] ${serverName} API URL: ${url}`);
    return makeRequest(url)
        .then(response => response.text())
        .then(function(responseText) {
            console.log(`[VidnestAnime] ${serverName} response length: ${responseText.length} characters`);
            try {
                const data = JSON.parse(responseText);
                if (serverConfig.needsDecryption && data.encrypted && data.data) {
                    console.log(`[VidnestAnime] ${serverName}: Detected encrypted response, decrypting...`);
                    return decryptAesGcm(data.data, PASSPHRASE).then(function(decryptedText) {
                        console.log(`[VidnestAnime] ${serverName}: Decryption successful`);
                        try {
                            return processAnimeResponse(JSON.parse(decryptedText), serverName, serverConfig, subDub);
                        } catch (parseError) {
                            console.error(`[VidnestAnime] ${serverName}: JSON parse error after decryption: ${parseError.message}`);
                            return [];
                        }
                    });
                }
                return processAnimeResponse(data, serverName, serverConfig, subDub);
            } catch (parseError) {
                console.error(`[VidnestAnime] ${serverName}: Invalid JSON response: ${parseError.message}`);
                return [];
            }
        })
        .catch(function(error) {
            console.error(`[VidnestAnime] ${serverName} error: ${error.message}`);
            return [];
        });
}

function subtitleLanguage(label) {
    const text = String(label || '').toLowerCase();
    if (/english|\beng\b|\ben\b/.test(text)) return 'en';
    if (/japanese|\bjpn\b|\bjp\b|\bja\b/.test(text)) return 'ja';
    if (/korean|\bkor\b|\bko\b/.test(text)) return 'ko';
    if (/chinese|mandarin|\bzh\b/.test(text)) return 'zh';
    return 'Unknown';
}

function processAnimeResponse(data, serverName, serverConfig, subDub) {
    const streams = [];
    try {
        console.log(`[VidnestAnime] Processing response from ${serverName}`);
        const sources = data.sources || data.streams || [];
        const subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
        const intro = data.intro || null;
        const outro = data.outro || null;
        if (!Array.isArray(sources) || sources.length === 0) {
            console.log(`[VidnestAnime] ${serverName}: No sources/streams array found`);
            return streams;
        }

        let language = serverConfig.language;
        if (serverConfig.supportsSubDub && subDub) {
            if (subDub === 'dub') language = 'Dub';
            else if (subDub === 'sub') language = 'Sub';
        }

        sources.forEach((source, index) => {
            if (!source) return;
            const videoUrl = source.file || source.url || source.src || source.link;
            if (!videoUrl) {
                console.log(`[VidnestAnime] ${serverName}: Source ${index} has no video URL`);
                return;
            }

            const streamHeaders = (serverName === 'miko' && source.headers) ? source.headers : WORKING_HEADERS;
            const processedSubtitles = subtitles.map(sub => {
                const url = sub && (sub.file || sub.url || sub.src);
                if (!url) return null;
                const label = sub.label || sub.lang || sub.language || 'Subtitle';
                return {
                    url,
                    language: subtitleLanguage(label),
                    name: `${label} [SOFTSUB]`,
                    headers: streamHeaders
                };
            }).filter(Boolean);

            const tag = language === 'Dub'
                ? (processedSubtitles.length ? 'DUB+SUBS' : 'DUB')
                : processedSubtitles.length
                    ? 'SOFTSUB'
                    : '';
            const tagText = tag ? ` [${tag}]` : '';
            const serverLabel = serverName.charAt(0).toUpperCase() + serverName.slice(1);

            streams.push({
                name: `VidnestAnime ${serverLabel}${tagText} - Adaptive`,
                url: videoUrl,
                quality: 'Adaptive',
                subtitles: processedSubtitles,
                intro,
                outro,
                headers: streamHeaders,
                provider: 'vidnest-anime'
            });

            console.log(`[VidnestAnime] ${serverName}: Added ${language} stream with ${processedSubtitles.length} subtitles`);
            console.log(`[VidnestAnime] ${serverName}: Stream URL: ${videoUrl}`);
        });
    } catch (error) {
        console.error(`[VidnestAnime] Error processing ${serverName} response: ${error.message}`);
    }
    return streams;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[VidnestAnime] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}, S${seasonNum}E${episodeNum}`);
    return new Promise(function(resolve) {
        getTMDBDetails(tmdbId, mediaType)
            .then(function(tmdbInfo) {
                console.log(`[VidnestAnime] TMDB: "${tmdbInfo.title}" (${tmdbInfo.year})`);
                return mapTMDBToAniList(tmdbId, tmdbInfo.title, tmdbInfo.year);
            })
            .then(function(anilistId) {
                const season = seasonNum || 1;
                const episode = episodeNum || 1;
                if (mediaType === 'tv' && season > 1) {
                    return getTMDBSeasonEpisodeCounts(tmdbId, season).then(function(previousEpisodesCount) {
                        const absoluteEpisode = previousEpisodesCount + episode;
                        console.log(`[VidnestAnime] Converted S${season}E${episode} → Absolute Episode ${absoluteEpisode}`);
                        return { anilistId, absoluteEpisode };
                    });
                }
                return { anilistId, absoluteEpisode: episode };
            })
            .then(function(data) {
                return getAnimeMetadata(data.anilistId, data.absoluteEpisode).then(function(metadata) {
                    metadata.anilistId = data.anilistId;
                    metadata.absoluteEpisode = data.absoluteEpisode;
                    return metadata;
                });
            })
            .then(function(metadata) {
                console.log(`[VidnestAnime] Anime: "${metadata.title}" - Episode ${metadata.absoluteEpisode}`);
                const serverPromises = [];
                Object.entries(ANIME_SERVERS).forEach(function([serverName, serverConfig]) {
                    if (serverConfig.supportsSubDub) {
                        serverPromises.push(fetchFromAnimeServer(serverName, serverConfig, metadata.anilistId, metadata.absoluteEpisode, 'sub'));
                        serverPromises.push(fetchFromAnimeServer(serverName, serverConfig, metadata.anilistId, metadata.absoluteEpisode, 'dub'));
                    } else {
                        serverPromises.push(fetchFromAnimeServer(serverName, serverConfig, metadata.anilistId, metadata.absoluteEpisode, 'sub'));
                    }
                });
                return Promise.all(serverPromises).then(function(results) {
                    const allStreams = [];
                    results.forEach(streams => allStreams.push(...streams));
                    allStreams.forEach(function(stream) {
                        stream.title = metadata.episodeTitle
                            ? `${metadata.title} - ${metadata.episodeTitle}`
                            : `${metadata.title} - Episode ${metadata.absoluteEpisode}`;
                        stream.poster = metadata.poster;
                    });
                    const uniqueStreams = [];
                    const seenUrls = new Set();
                    allStreams.forEach(function(stream) {
                        if (!seenUrls.has(stream.url)) {
                            seenUrls.add(stream.url);
                            uniqueStreams.push(stream);
                        }
                    });
                    const sortedStreams = uniqueStreams.sort(function(a, b) {
                        const getPriority = function(stream) {
                            const name = stream.name.toLowerCase();
                            if (name.includes('satoru') && !name.includes('[dub')) return 1;
                            if (name.includes('hindi')) return 2;
                            if (name.includes('[softsub]')) return 3;
                            if (name.includes('[dub')) return 4;
                            return 5;
                        };
                        return getPriority(a) - getPriority(b);
                    });
                    console.log(`[VidnestAnime] Total streams found: ${sortedStreams.length}`);
                    resolve(sortedStreams);
                });
            })
            .catch(function(error) {
                console.error(`[VidnestAnime] Error: ${error.message}`);
                resolve([]);
            });
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
