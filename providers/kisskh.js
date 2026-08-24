const cheerio = require('cheerio-without-node-native');

// Konstanta dari file Adicinemax21Extractor.kt
const MAIN_URL = "https://kisskh.ovh";
// URL Google Script untuk generate key (PENTING)
const KISSKH_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise((resolve, reject) => {
        // Karena Kisskh butuh judul untuk mencari, kita gunakan placeholder atau fetch dari TMDB dulu jika perlu.
        // Di sini saya asumsikan Nuvio mengirim tmdbId, tapi Kisskh butuh "Query String" (Judul).
        // CATATAN: Karena kita tidak punya judul teks di parameter getStreams, 
        // kita harus fetch detail TMDB dulu.
        
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=b030404650f279792a8d3287232358e3`; // API Key umum dari source code Kotlin

        fetch(tmdbUrl)
            .then(res => res.json())
            .then(tmdbData => {
                const title = tmdbData.title || tmdbData.name || tmdbData.original_title;
                const year = (tmdbData.release_date || tmdbData.first_air_date || "").substring(0, 4);
                
                // 1. Cari Drama di Kisskh
                const searchUrl = `${MAIN_URL}/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`;
                
                return fetch(searchUrl)
                    .then(res => res.json())
                    .then(searchList => {
                        // Logika pencarian mirip Kotlin: Cek exact match, lalu fuzzy match
                        let matched = searchList.find(item => item.title.toLowerCase() === title.toLowerCase());
                        
                        if (!matched && searchList.length > 0) {
                             matched = searchList[0]; // Fallback ke hasil pertama
                        }

                        if (!matched) throw new Error("Drama tidak ditemukan di Kisskh");
                        
                        return matched.id;
                    });
            })
            .then(dramaId => {
                // 2. Ambil Detail Drama untuk dapat List Episode
                return fetch(`${MAIN_URL}/api/DramaList/Drama/${dramaId}?isq=false`)
                    .then(res => res.json())
                    .then(detail => {
                        const episodes = detail.episodes;
                        if (!episodes || episodes.length === 0) throw new Error("Episode kosong");

                        // Tentukan target episode
                        // Jika movie, biasanya episode terakhir atau satu-satunya
                        let targetEp;
                        if (mediaType === 'movie') {
                            targetEp = episodes[episodes.length - 1];
                        } else {
                            // Jika TV, cari nomor episode yang pas
                            targetEp = episodes.find(ep => parseInt(ep.number) === parseInt(episodeNum));
                        }

                        if (!targetEp) throw new Error(`Episode ${episodeNum} tidak ditemukan`);
                        
                        return targetEp.id;
                    });
            })
            .then(epsId => {
                // 3. Ambil Kunci Video (Wajib untuk Kisskh)
                // Source: invokeKisskh di Kotlin
                const keyUrl = `${KISSKH_API}${epsId}&version=2.8.10`;
                
                return fetch(keyUrl)
                    .then(res => res.json())
                    .then(keyData => {
                        if (!keyData.key) throw new Error("Gagal mengambil kunci video");
                        
                        // 4. Ambil Source Video
                        const videoApi = `${MAIN_URL}/api/DramaList/Episode/${epsId}.png?err=false&ts=&time=&kkey=${keyData.key}`;
                        return fetch(videoApi);
                    })
                    .then(res => res.json())
                    .then(sources => {
                        const streams = [];
                        
                        // Proses link video
                        const links = [sources.Video, sources.ThirdParty].filter(l => l);
                        
                        links.forEach(link => {
                            if (link.includes('.m3u8')) {
                                streams.push({
                                    name: "Kisskh HLS",
                                    title: `Kisskh Stream`,
                                    url: link,
                                    quality: "Auto",
                                    headers: { "Origin": MAIN_URL, "Referer": MAIN_URL },
                                    provider: "kisskh"
                                });
                            } else if (link.includes('.mp4')) {
                                streams.push({
                                    name: "Kisskh MP4",
                                    title: `Kisskh Stream`,
                                    url: link,
                                    quality: "Auto", // Biasanya 720p/1080p
                                    headers: { "Referer": MAIN_URL },
                                    provider: "kisskh"
                                });
                            }
                        });
                        
                        resolve(streams);
                    });
            })
            .catch(err => {
                console.error("Kisskh Error:", err);
                resolve([]); // Jangan reject, kembalikan array kosong
            });
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}

;(function limitlessNormalizeStreamTags() {
  if (typeof module === "undefined" || !module.exports || typeof module.exports.getStreams !== "function") return;
  const originalGetStreams = module.exports.getStreams;
  module.exports.getStreams = async function(...args) {
    const value = await originalGetStreams.apply(this, args);
    const rows = Array.isArray(value) ? value : [];
    return rows.map(function(row) {
      if (!row || typeof row !== "object") return row;

      const originalLabel = `${row.name || ""} ${row.title || ""}`;
      const isDub = /(^|[\s(\[])dub(?:bed)?(?=$|[\s)\]])/i.test(originalLabel) || /english\s*dub/i.test(originalLabel);
      const isHard = /hard[\s_-]*sub|hardsub/i.test(originalLabel);
      const saysSoft = /soft[\s_-]*sub|softsub/i.test(originalLabel);

      let subtitles = Array.isArray(row.subtitles) ? row.subtitles : [];
      subtitles = subtitles.map(function(sub) {
        if (!sub) return null;
        if (typeof sub === "string") {
          return { url: sub, language: "Unknown", name: "Subtitle [SOFTSUB]" };
        }
        const url = sub.url || sub.file || sub.src;
        if (!url) return null;
        let language = sub.language || sub.lang || "Unknown";
        if (String(language).toLowerCase() === "eng") language = "en";
        let baseName = sub.name || sub.label || sub.id || language || "Subtitle";
        baseName = String(baseName)
          .replace(/\s*\[(?:softsub|hardsub|dub(?:\+subs)?|hardsub\+subs)\]\s*/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        return Object.assign({}, sub, {
          url,
          language,
          name: `${baseName} [SOFTSUB]`
        });
      }).filter(Boolean);
      row.subtitles = subtitles;

      const hasSoft = subtitles.length > 0 || saysSoft;
      const tag = isDub
        ? (subtitles.length ? "DUB+SUBS" : "DUB")
        : isHard
          ? (subtitles.length ? "HARDSUB+SUBS" : "HARDSUB")
          : hasSoft
            ? "SOFTSUB"
            : "";

      const clean = function(input) {
        return String(input || "")
          .replace(/\s*[\[(](?:SUB|DUB)[\])]\s*/gi, " ")
          .replace(/\s*\[(?:SOFTSUB|HARDSUB|DUB(?:\+SUBS)?|HARDSUB\+SUBS)\]\s*/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      };

      row.name = clean(row.name) + (tag ? ` [${tag}]` : "");
      row.title = clean(row.title) + (tag ? ` [${tag}]` : "");
      return row;
    });
  };
})();

