"use strict";

// Nexus-owned standalone Vidlink implementation based on the measured and
// user-verified Haylox/Vidlink playback contract. Keep extraction headers off
// returned media rows: that is part of the confirmed Nuvio playback behavior.
// Den-O S1E1 was manually verified as hard-subbed, so this verified stream
// class uses [HSUB] under NAMING_STANDARDS.md.
const PROVIDER_NAME = "Vidlink";
const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "307b7b8ef035c6aa336900aef4e203bd";
const API_BASE = "https://vidlink.pro/api/b";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Connection": "keep-alive",
  "Referer": "https://vidlink.pro/",
  "Origin": "https://vidlink.pro"
};
const QUALITY_HEIGHTS = { "4K": 2160, "1440p": 1440, "1080p": 1080, "720p": 720 };

function controlQuality(value) {
  if (!value) return null;
  const text = String(value).toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return "4K";
  if (text.includes("1440") || text.includes("2k")) return "1440p";
  if (text.includes("1080") || text.includes("fhd")) return "1080p";
  if (text.includes("720") || text.includes("hd")) return "720p";
  const match = text.match(/(\d{3,4})[p]?/);
  const height = match ? Number(match[1]) : 0;
  for (const quality of Object.keys(QUALITY_HEIGHTS)) {
    if (height >= QUALITY_HEIGHTS[quality]) return quality;
  }
  return null;
}

function candidate(url, qualityValue) {
  const quality = controlQuality(qualityValue);
  if (!url || !quality) return null;
  return {
    name: "Vidlink",
    title: "Vidlink",
    url,
    quality,
    type: url.toLowerCase().includes(".m3u8") ? "m3u8" : "video"
  };
}

function extract(data) {
  if (!data) return [];
  const rows = [];
  const add = (url, quality) => {
    const row = candidate(url, quality);
    if (row) rows.push(row);
  };
  const stream = data.stream;
  if (stream && stream.qualities) {
    for (const key of Object.keys(stream.qualities)) {
      const item = stream.qualities[key];
      if (item && item.url) add(item.url, key);
    }
    if (stream.playlist) rows.push({ _playlist: true, url: stream.playlist });
  } else if (stream && stream.playlist) {
    rows.push({ _playlist: true, url: stream.playlist });
  } else if (data.url) {
    add(data.url, data.quality || null);
  } else if (Array.isArray(data.streams)) {
    for (const item of data.streams) {
      if (item && item.url) add(item.url, item.quality || item.resolution || null);
    }
  } else if (Array.isArray(data.links)) {
    for (const item of data.links) {
      if (item && item.url) add(item.url, item.quality || null);
    }
  } else {
    // Preserve the confirmed control's legacy response support without adding
    // subtitle/caption URLs as media candidates.
    const visit = object => {
      if (!object || typeof object !== "object") return;
      for (const key of Object.keys(object)) {
        if (/subtitle|caption/.test(key.toLowerCase())) continue;
        const value = object[key];
        if (typeof value === "string" && value.startsWith("http")) {
          if (![".srt", ".vtt", "subtitle", "caption"].some(part => value.includes(part))) {
            add(value, key);
          }
        } else if (value && typeof value === "object") {
          visit(value);
        }
      }
    };
    visit(data);
  }
  return rows;
}

async function playlistRows(url) {
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) return [];
    const text = await response.text();
    const rows = [];
    let resolution;
    let pending = false;
    for (const line of text.split("\n").map(value => value.trim()).filter(Boolean)) {
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const match = line.match(/RESOLUTION=(\d+x\d+)/);
        resolution = match ? match[1].split("x").pop() + "p" : null;
        pending = true;
      } else if (pending && !line.startsWith("#")) {
        let resolved = line;
        if (!line.startsWith("http")) {
          try {
            resolved = new URL(line, url).toString();
          } catch (_) {}
        }
        const row = candidate(resolved, resolution);
        if (row) rows.push(row);
        pending = false;
      }
    }
    // A media playlist, unknown resolution or failed fetch is not a fallback row.
    return rows;
  } catch (_) {
    return [];
  }
}

function present(rows) {
  const seen = new Set();
  const accepted = rows
    .filter(row => QUALITY_HEIGHTS[row.quality] && row.url && row.url.startsWith("https"))
    .filter(row => !seen.has(row.url) && seen.add(row.url));
  accepted.sort((a, b) => QUALITY_HEIGHTS[b.quality] - QUALITY_HEIGHTS[a.quality]);
  return accepted.map((row, index) => {
    const sortTag = (index + 1)
      .toString(2)
      .padStart(20, "0")
      .replace(/0/g, "\u200B")
      .replace(/1/g, "\uFEFF");
    const height = QUALITY_HEIGHTS[row.quality];
    const tier = height >= 2160 ? "4K" : height >= 1440 ? "Enhanced QHD" : height >= 1080 ? "FHD" : "HD";
    return {
      ...row,
      name: `${PROVIDER_NAME} • ${tier} ${height}p • [HSUB]`,
      title: sortTag + "Vidlink"
    };
  });
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const isTv = mediaType === "tv";
    if (isTv && (season == null || episode == null)) return [];

    const [metadata, encryption] = await Promise.all([
      fetch(`${TMDB_API_URL}/${isTv ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`)
        .then(response => response.ok ? response.json() : null)
        .catch(() => null),
      fetch(`https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`)
        .then(response => response.ok ? response.json() : null)
        .catch(() => null)
    ]);

    if (!metadata || !(isTv ? metadata.name : metadata.title) || !encryption || !encryption.result) {
      return [];
    }

    const endpoint = isTv
      ? `${API_BASE}/tv/${encryption.result}/${season}/${episode}`
      : `${API_BASE}/movie/${encryption.result}`;
    const response = await fetch(endpoint, { headers: HEADERS });
    if (!response.ok) return [];

    const extracted = extract(await response.json());
    const direct = extracted.filter(row => !row._playlist);
    const playlists = await Promise.all(
      extracted.filter(row => row._playlist).map(row => playlistRows(row.url))
    );
    return present(direct.concat(...playlists));
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else globalThis.getStreams = getStreams;
