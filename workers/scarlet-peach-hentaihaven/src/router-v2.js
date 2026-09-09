import baseWorker from './router.js';

const VERSION = '0.5.2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function clean(value) { return String(value == null ? '' : value).trim(); }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    }
  });
}
function isHttpsUrl(value, suffix) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    if (suffix && !u.pathname.toLowerCase().endsWith(suffix)) return false;
    return true;
  } catch (_) { return false; }
}
function isAndroidPlayback(request) {
  const userAgent = clean(request && request.headers && request.headers.get('user-agent'));
  return /(?:android|exoplayer|media3)/i.test(userAgent);
}
function abs(value, base) {
  try { return new URL(clean(value), base).toString(); } catch (_) { return ''; }
}
function deriveMasterUrl(stream) {
  try {
    const u = new URL(stream.url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return '';
    u.pathname = `/${parts[0]}/${clean(stream.codec).toLowerCase() === 'vp9' ? 'playlist_vp9.m3u8' : 'playlist.m3u8'}`;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (_) { return ''; }
}
function absolutizeUriAttribute(line, masterUrl) {
  return String(line).replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/gi, (all, quoted, dquoted, squoted, bare) => {
    const raw = dquoted || squoted || bare || '';
    const url = abs(raw, masterUrl);
    if (!url) return all;
    return `URI="${url}"`;
  });
}
function isSubtitleMediaLine(line) {
  if (!/^#EXT-X-MEDIA:/i.test(line)) return false;
  return /TYPE=(?:"?SUBTITLES"?|"?CLOSED-CAPTIONS"?)/i.test(line);
}
function isAudioMediaLine(line) {
  return /^#EXT-X-MEDIA:/i.test(line) && /TYPE=(?:"?AUDIO"?)/i.test(line);
}
function removeSubtitleGroupAttribute(line) {
  return String(line)
    .replace(/,?SUBTITLES=(?:"[^"]*"|'[^']*'|[^,\s]+)/gi, '')
    .replace(/,,+/g, ',');
}
function rewriteAudioMediaLine(line, language) {
  const lang = clean(language).toLowerCase();
  if (!isAudioMediaLine(line) || !['ja', 'en'].includes(lang)) return line;
  const label = lang === 'ja' ? 'Japanese' : 'English';
  let out = String(line);
  if (/LANGUAGE=/i.test(out)) out = out.replace(/LANGUAGE=("[^"]*"|'[^']*'|[^,\s]+)/i, `LANGUAGE="${lang}"`);
  else out += `,LANGUAGE="${lang}"`;
  if (/NAME=/i.test(out)) out = out.replace(/NAME=("[^"]*"|'[^']*'|[^,\s]+)/i, `NAME="${label}"`);
  else out += `,NAME="${label}"`;
  return out;
}
function selectedMaster(source, masterUrl, videoUrl, includeSubtitles = true, audioLanguage = '') {
  const lines = String(source || '').split(/\r?\n/);
  const out = ['#EXTM3U'];
  const version = lines.find(line => /^#EXT-X-VERSION:/i.test(line));
  if (version) out.push(version);

  for (const line of lines) {
    if (!/^#EXT-X-MEDIA:/i.test(line)) continue;
    if (!includeSubtitles && isSubtitleMediaLine(line)) continue;
    const normalized = rewriteAudioMediaLine(line, audioLanguage);
    out.push(absolutizeUriAttribute(normalized, masterUrl));
  }

  let selectedInf = '';
  let selectedUri = '';
  for (let i = 0; i < lines.length; i++) {
    if (!/^#EXT-X-STREAM-INF:/i.test(lines[i])) continue;
    let next = i + 1;
    while (next < lines.length && (!clean(lines[next]) || clean(lines[next]).startsWith('#'))) next++;
    if (next >= lines.length) continue;
    const candidate = abs(clean(lines[next]), masterUrl);
    if (candidate === videoUrl) {
      selectedInf = lines[i];
      selectedUri = candidate;
      break;
    }
  }
  if (!selectedInf || !selectedUri) throw new Error('selected quality not found in source master');
  if (!includeSubtitles) selectedInf = removeSubtitleGroupAttribute(selectedInf);
  out.push(selectedInf, selectedUri);
  return out.join('\n') + '\n';
}
function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
function pageDescription(html) {
  const values = [];
  const patterns = [
    /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name=["']description["']|property=["']og:description["'])/ig
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(String(html || '')))) values.push(stripTags(m[1]));
  }
  return unique(values).join(' ').toLowerCase();
}
function variantFor(audioLanguages, subtitleLanguages) {
  const audio = unique(audioLanguages).map(x => x.toLowerCase());
  const subs = unique(subtitleLanguages).map(x => x.toLowerCase());
  if (audio.length > 1) return 'dual';
  if (audio.includes('en') && subs.length) return 'dub+sub';
  if (audio.includes('en')) return 'dub';
  if (subs.length) return 'sub';
  return '';
}
async function normalizeSemanticAudio(data) {
  if (!data || !data.metadata || typeof data.metadata !== 'object') return data;
  const metadata = data.metadata;
  const transportAudioLanguages = unique(metadata.audioLanguages || []).map(x => x.toLowerCase());
  const subtitleLanguages = unique(metadata.subtitleLanguages || []).map(x => x.toLowerCase());
  let description = '';
  const ref = clean(data.match && data.match.url);
  if (ref) {
    try {
      const response = await fetch(ref, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', referer: new URL(ref).origin + '/' }
      });
      if (response.ok) description = pageDescription(await response.text());
    } catch (_) {}
  }

  const explicitEnglish = /\b(?:english\s+dub(?:bed)?|dubbed\s+english|english\s+audio)\b/i.test(description);
  const explicitJapanese = /\bjapanese\s+audio\b/i.test(description);
  let audioLanguages = [];
  let audioEvidence = 'unknown';

  if (explicitEnglish && explicitJapanese) {
    audioLanguages = ['ja', 'en'];
    audioEvidence = 'page-explicit-dual-audio';
  } else if (explicitEnglish) {
    audioLanguages = ['en'];
    audioEvidence = 'page-explicit-english-audio';
  } else if (explicitJapanese) {
    audioLanguages = ['ja'];
    audioEvidence = 'page-explicit-japanese-audio';
  } else if (subtitleLanguages.length) {
    // HentaiHaven currently labels some single Japanese AAC tracks as LANGUAGE=en in HLS.
    // Do not treat that transport tag as proof of a dub. Subtitled titles default to Japanese
    // unless the page itself explicitly advertises English audio/dubbing.
    audioLanguages = ['ja'];
    audioEvidence = 'subtitle-conservative-japanese';
  } else if (transportAudioLanguages.includes('ja')) {
    audioLanguages = ['ja'];
    audioEvidence = 'hls-japanese-audio';
  }

  data.metadata = {
    ...metadata,
    transportAudioLanguages,
    audioLanguages,
    audioVariant: variantFor(audioLanguages, subtitleLanguages),
    audioEvidence
  };
  return data;
}
async function nativeHls(request, url) {
  const master = clean(url.searchParams.get('master'));
  const video = clean(url.searchParams.get('video'));
  const ref = clean(url.searchParams.get('ref')) || 'https://hentaihaven.com/';
  const audio = clean(url.searchParams.get('audio')).toLowerCase();
  if (!isHttpsUrl(master, '.m3u8') || !isHttpsUrl(video, '.m3u8')) return new Response('invalid source', { status: 400 });
  try {
    const response = await fetch(master, {
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
        referer: ref
      }
    });
    const text = await response.text();
    if (!response.ok || !/^#EXTM3U/m.test(text)) throw new Error(`master HTTP ${response.status}`);
    const android = isAndroidPlayback(request);
    const body = selectedMaster(text, master, video, !android, audio);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'private, max-age=300',
        'x-scarlet-peach-track-mode': android ? 'android-native-audio-external-subs' : 'desktop-native-audio-subs'
      }
    });
  } catch (error) {
    return new Response(`HLS master error: ${error && error.message ? error.message : error}`, { status: 502 });
  }
}
async function wrappedResolve(request, requestUrl) {
  const response = await baseWorker.fetch(request);
  if (!response.ok) return response;
  let data;
  try { data = await response.json(); } catch (_) { return response; }
  if (!Array.isArray(data.streams)) return json({ ...data, version: VERSION });
  data = await normalizeSemanticAudio(data);
  const ref = data.match && data.match.url ? data.match.url : 'https://hentaihaven.com/';
  const semanticAudio = data.metadata && Array.isArray(data.metadata.audioLanguages) && data.metadata.audioLanguages.length === 1
    ? clean(data.metadata.audioLanguages[0]).toLowerCase()
    : '';
  data.streams = data.streams.map(stream => {
    const masterUrl = deriveMasterUrl(stream);
    if (!masterUrl || !isHttpsUrl(stream.url, '.m3u8')) return stream;
    const play = new URL('/play.m3u8', requestUrl.origin);
    play.searchParams.set('master', masterUrl);
    play.searchParams.set('video', stream.url);
    play.searchParams.set('ref', ref);
    if (semanticAudio) play.searchParams.set('audio', semanticAudio);
    return {
      ...stream,
      sourceUrl: stream.url,
      masterUrl,
      url: play.toString(),
      nativeTracks: true
    };
  });
  data.version = VERSION;
  data.nativeTrackPreservation = true;
  data.androidSubtitleTransport = 'external-sidecar';
  data.verifiedDubLabels = true;
  return json(data);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' } });
    }
    if (url.pathname === '/health') {
      const base = await baseWorker.fetch(request);
      let data = {};
      try { data = await base.json(); } catch (_) {}
      return json({ ...data, status: 'ok', name: 'Scarlet Peach HentaiHaven Resolver', version: VERSION, nativeTrackPreservation: true, nativeTrackTransport: 'quality-scoped-hls-master', androidSubtitleTransport: 'external-sidecar', desktopSubtitleTransport: 'native-hls-webvtt', verifiedDubLabels: true });
    }
    if (url.pathname === '/play.m3u8' && request.method === 'GET') return nativeHls(request, url);
    if (url.pathname === '/resolve' && request.method === 'POST') return wrappedResolve(request, url);
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', version: VERSION, endpoints: ['/health', '/resolve', '/play.m3u8'] });
  }
};
