const PROVIDER_NAME = "CineStream";
const MULTI_DECRYPT_API = "https://enc-dec.app/api";
const HEXA_API = "https://theemoviedb.hexa.su";
const VIDFAST_API = "https://vidfast.vc";
const VIDCORE_API = "https://vidcore.net";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const parseJson = text => {
  try { return JSON.parse(text); } catch (_) { return null; }
};

const fetchText = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"} for ${url}`);
  return await res.text();
};

const fetchJson = async (url, options = {}) => parseJson(await fetchText(url, options));

const postJson = async (url, payload, headers = {}) => fetchJson(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(payload || {})
});

const postText = async (url, headers = {}) => fetchText(url, {
  method: "POST",
  headers,
  body: ""
});

const randomHex = length => {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const extractEncryptedToken = text => {
  const patterns = [
    /\\"(?:en|token)\\"\s*:\s*\\"([^\\"]+)\\"/i,
    /"(?:en|token)"\s*:\s*"([^"]+)"/i
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
};

const normalizeTracks = tracks => (Array.isArray(tracks) ? tracks : [])
  .filter(x => x && (x.file || x.url))
  .map((x, i) => ({
    url: x.file || x.url,
    language: x.label || x.language || x.lang || "Unknown",
    name: x.label || x.language || x.lang || `${PROVIDER_NAME} Subtitle ${i + 1}`
  }));

const hexa = async (tmdbId, mediaType, season, episode) => {
  const path = mediaType === "movie"
    ? `/api/tmdb/movie/${tmdbId}/images`
    : `/api/tmdb/tv/${tmdbId}/season/${season || 1}/episode/${episode || 1}/images`;

  const key = randomHex(64);
  const tokenPayload = await fetchJson(`${MULTI_DECRYPT_API}/enc-hexa`, {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });
  const token = tokenPayload?.result?.token;
  if (!token) return [];

  const headers = {
    "User-Agent": UA,
    "Accept": "text/plain",
    "X-Api-Key": key,
    "X-Fingerprint-Lite": "e9136c41504646444",
    "Referer": "https://hexa.su/",
    "X-Cap-Token": token
  };

  const encrypted = await fetchText(`${HEXA_API}${path}`, { headers });
  const decrypted = await postJson(`${MULTI_DECRYPT_API}/dec-hexa`, { text: encrypted, key });
  const sources = Array.isArray(decrypted?.result?.sources) ? decrypted.result.sources : [];

  return sources
    .filter(x => x && x.url)
    .map((x, i) => ({
      name: `${PROVIDER_NAME} [Hexa${x.server ? ` ${x.server}` : ""}] - Auto`,
      title: `Hexa ${x.server || `Server ${i + 1}`}`,
      url: x.url,
      quality: "Auto",
      provider: PROVIDER_NAME,
      type: x.url.includes("m3u8") ? "m3u8" : "mp4",
      headers: {
        "Referer": "https://hexa.su/",
        "User-Agent": UA
      }
    }));
};

const vidfast = async (tmdbId, mediaType, season, episode) => {
  const pageUrl = mediaType === "movie"
    ? `${VIDFAST_API}/movie/${tmdbId}/`
    : `${VIDFAST_API}/tv/${tmdbId}/${season || 1}/${episode || 1}/`;

  const headers = {
    "User-Agent": UA,
    "Referer": `${VIDFAST_API}/`,
    "X-Requested-With": "XMLHttpRequest"
  };

  const page = await fetchText(pageUrl, { headers });
  const encoded = extractEncryptedToken(page);
  if (!encoded) return [];

  const bootstrap = await fetchJson(`${MULTI_DECRYPT_API}/enc-vidfast?text=${encodeURIComponent(encoded)}`);
  const serversUrl = bootstrap?.result?.servers;
  const streamBase = bootstrap?.result?.stream;
  const token = bootstrap?.result?.token;
  if (!serversUrl || !streamBase || !token) return [];

  const requestHeaders = { ...headers, "X-CSRF-Token": token };
  const serversEncrypted = await postText(serversUrl, requestHeaders);
  const serversPayload = await postJson(`${MULTI_DECRYPT_API}/dec-vidfast`, { text: serversEncrypted });
  const servers = Array.isArray(serversPayload?.result) ? serversPayload.result : [];
  const out = [];

  for (const server of servers.slice(0, 4)) {
    if (!server?.data) continue;
    try {
      const encryptedStream = await postText(`${streamBase}/${server.data}`, requestHeaders);
      if (!encryptedStream) continue;
      const payload = await postJson(`${MULTI_DECRYPT_API}/dec-vidfast`, { text: encryptedStream });
      const stream = payload?.result;
      if (!stream?.url) continue;
      const is4k = stream.is4kAvailable === true || /4k|2160/i.test(String(server.description || ""));
      out.push({
        name: `${PROVIDER_NAME} [VidFast ${server.name || "Server"}] - ${is4k ? "2160p" : "1080p"}`,
        title: server.description || `VidFast ${server.name || "Server"}`,
        url: stream.url,
        quality: is4k ? "2160p" : "1080p",
        provider: PROVIDER_NAME,
        type: stream.url.includes("m3u8") ? "m3u8" : "mp4",
        headers: requestHeaders,
        subtitles: normalizeTracks(stream.tracks)
      });
    } catch (e) {
      console.error(`[${PROVIDER_NAME}] VidFast ${server.name || "server"}: ${e.message}`);
    }
  }
  return out;
};

const vidcore = async (tmdbId, mediaType, season, episode) => {
  const pageUrl = mediaType === "movie"
    ? `${VIDCORE_API}/movie/${tmdbId}`
    : `${VIDCORE_API}/tv/${tmdbId}/${season || 1}/${episode || 1}`;

  const headers = {
    "User-Agent": UA,
    "Referer": `${VIDCORE_API}/`,
    "X-Requested-With": "XMLHttpRequest"
  };

  const page = await fetchText(pageUrl, { headers });
  const encoded = extractEncryptedToken(page);
  if (!encoded) return [];

  const bootstrap = await fetchJson(`${MULTI_DECRYPT_API}/enc-vidcore?text=${encodeURIComponent(encoded)}`);
  const serversUrl = bootstrap?.result?.servers;
  const streamBase = bootstrap?.result?.stream;
  const token = bootstrap?.result?.token;
  if (!serversUrl || !streamBase || !token) return [];

  const requestHeaders = { ...headers, "X-CSRF-Token": token };
  const serversEncrypted = await postText(serversUrl, requestHeaders);
  const serversPayload = await postJson(`${MULTI_DECRYPT_API}/dec-vidcore`, { text: serversEncrypted });
  const servers = Array.isArray(serversPayload?.result) ? serversPayload.result : [];
  const out = [];

  for (const server of servers.slice(0, 4)) {
    if (!server?.data) continue;
    try {
      const encryptedStream = await postText(`${streamBase}/${server.data}`, requestHeaders);
      const payload = await postJson(`${MULTI_DECRYPT_API}/dec-vidcore`, { text: encryptedStream });
      const stream = payload?.result;
      if (!stream?.url) continue;
      out.push({
        name: `${PROVIDER_NAME} [VidCore ${server.name || "Server"}] - Auto`,
        title: `VidCore ${server.name || "Server"}`,
        url: stream.url,
        quality: "Auto",
        provider: PROVIDER_NAME,
        type: stream.url.includes("m3u8") ? "m3u8" : "mp4",
        headers: {
          "User-Agent": UA,
          "Referer": `${VIDCORE_API}/`
        },
        subtitles: normalizeTracks(stream.tracks)
      });
    } catch (e) {
      console.error(`[${PROVIDER_NAME}] VidCore ${server.name || "server"}: ${e.message}`);
    }
  }
  return out;
};

const getStreams = async (tmdbId, mediaType, season, episode) => {
  console.log(`[${PROVIDER_NAME}] clean core tmdb=${tmdbId} type=${mediaType} season=${season || "-"} episode=${episode || "-"}`);
  const output = [];
  const tasks = [
    ["Hexa", hexa],
    ["VidFast", vidfast],
    ["VidCore", vidcore]
  ];

  // Intentionally sequential. The original CineStream fans out across many
  // providers; Limitless keeps this core small to reduce QuickJS/network pressure.
  for (const [name, task] of tasks) {
    try {
      const streams = await task(tmdbId, mediaType, season, episode);
      if (Array.isArray(streams)) output.push(...streams);
    } catch (e) {
      console.error(`[${PROVIDER_NAME}] ${name}: ${e.message}`);
    }
  }

  const seen = new Set();
  return output.filter(stream => {
    if (!stream?.url || seen.has(stream.url)) return false;
    seen.add(stream.url);
    return true;
  });
};

module.exports = { getStreams };
