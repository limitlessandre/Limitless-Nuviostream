import baseWorker from './router.js';

const VERSION = '0.5.4';
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
function isHttpsM3u8(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /\.m3u8(?:$|\?)/i.test(url.toString());
  } catch (_) { return false; }
}
function isDirectMediaUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /\.(?:m3u8|mp4)(?:$|\?)/i.test(url.toString());
  } catch (_) { return false; }
}
function abs(value, base) {
  try { return new URL(clean(value), base).toString(); } catch (_) { return ''; }
}
function deriveMasterUrl(stream) {
  try {
    const source = clean(stream && (stream.sourceUrl || stream.url));
    const url = new URL(source);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 3) return '';
    const codec = clean(stream && stream.codec).toLowerCase();
    url.pathname = `/${parts[0]}/${codec === 'vp9' ? 'playlist_vp9.m3u8' : 'playlist.m3u8'}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_) { return ''; }
}
function absolutizeUriAttribute(line, masterUrl) {
  return String(line).replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/gi, (all, quoted, dquoted, squoted, bare) => {
    const raw = dquoted || squoted || bare || '';
    const resolved = abs(raw, masterUrl);
    return resolved ? `URI="${resolved}"` : all;
  });
}
function isAudioMediaLine(line) {
  return /^#EXT-X-MEDIA:/i.test(line) && /TYPE=(?:"?AUDIO"?)/i.test(line);
}
function removeSubtitleAttributes(line) {
  return String(line)
    .replace(/,?SUBTITLES=(?:"[^"]*"|'[^']*'|[^,\s]+)/gi, '')
    .replace(/,?CLOSED-CAPTIONS=(?:"[^"]*"|'[^']*'|[^,\s]+)/gi, '')
    .replace(/,,+/g, ',');
}
function selectedAudioMaster(source, masterUrl, videoUrl) {
  const lines = String(source || '').split(/\r?\n/);
  const out = ['#EXTM3U'];
  const version = lines.find(line => /^#EXT-X-VERSION:/i.test(line));
  if (version) out.push(version);

  const audioLines = lines.filter(isAudioMediaLine).map(line => absolutizeUriAttribute(line, masterUrl));
  if (!audioLines.length) throw new Error('source master has no audio group');
  out.push(...audioLines);

  let selectedInf = '';
  let selectedUri = '';
  for (let i = 0; i < lines.length; i++) {
    if (!/^#EXT-X-STREAM-INF:/i.test(lines[i])) continue;
    let next = i + 1;
    while (next < lines.length && (!clean(lines[next]) || clean(lines[next]).startsWith('#'))) next++;
    if (next >= lines.length) continue;
    const candidate = abs(clean(lines[next]), masterUrl);
    if (candidate === videoUrl) {
      selectedInf = removeSubtitleAttributes(lines[i]);
      selectedUri = candidate;
      break;
    }
  }
  if (!selectedInf || !selectedUri) throw new Error('selected quality not found in source master');
  if (!/\bAUDIO=/i.test(selectedInf)) throw new Error('selected quality does not reference audio group');
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
    let match;
    while ((match = re.exec(String(html || '')))) values.push(stripTags(match[1]));
  }
  return unique(values).join(' ').toLowerCase();
}
function variantFor(audioLanguages, subtitleLanguages) {
  const audio = unique(audioLanguages).map(value => value.toLowerCase());
  const subs = unique(subtitleLanguages).map(value => value.toLowerCase());
  if (audio.length > 1) return 'dual';
  if (audio.includes('en') && subs.length) return 'dub+sub';
  if (audio.includes('en')) return 'dub';
  if (subs.length) return 'sub';
  return '';
}
async function normalizeSemanticAudio(data) {
  if (!data || !data.metadata || typeof data.metadata !== 'object') return data;
  const metadata = data.metadata;
  const transportAudioLanguages = unique(metadata.audioLanguages || []).map(value => value.toLowerCase());
  const subtitleLanguages = unique(metadata.subtitleLanguages || []).map(value => value.toLowerCase());
  let description = '';
  const ref = clean(data.match && data.match.url);
  if (ref) {
    try {
      const response = await fetch(ref, {
        redirect: 'follow',
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,*/*',
          referer: new URL(ref).origin + '/'
        }
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
async function audioHls(url) {
  const master = clean(url.searchParams.get('master'));
  const video = clean(url.searchParams.get('video'));
  const ref = clean(url.searchParams.get('ref')) || 'https://hentaihaven.com/';
  if (!isHttpsM3u8(master) || !isHttpsM3u8(video)) return new Response('invalid source', { status: 400 });
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
    const body = selectedAudioMaster(text, master, video);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'private, max-age=300',
        'x-scarlet-peach-track-mode': 'video-plus-audio-no-subtitles'
      }
    });
  } catch (error) {
    return new Response(`HLS audio master error: ${error && error.message ? error.message : error}`, { status: 502 });
  }
}
async function wrappedResolve(request, requestUrl) {
  const response = await baseWorker.fetch(request);
  if (!response.ok) return response;
  let data;
  try { data = await response.json(); } catch (_) { return response; }
  if (!Array.isArray(data.streams)) return json({ ...data, version: VERSION });

  data = await normalizeSemanticAudio(data);
  const ref = clean(data.match && data.match.url) || 'https://hentaihaven.com/';
  data.streams = data.streams.map(stream => {
    const directUrl = clean(stream && (stream.sourceUrl || stream.url));
    if (!isDirectMediaUrl(directUrl)) return null;
    const next = { ...stream, sourceUrl: directUrl };
    if (!isHttpsM3u8(directUrl)) {
      next.url = directUrl;
      next.nativeTracks = false;
      return next;
    }
    const masterUrl = deriveMasterUrl({ ...stream, sourceUrl: directUrl });
    if (!isHttpsM3u8(masterUrl)) {
      next.url = directUrl;
      next.nativeTracks = false;
      return next;
    }
    const play = new URL('/play.m3u8', requestUrl.origin);
    play.searchParams.set('master', masterUrl);
    play.searchParams.set('video', directUrl);
    play.searchParams.set('ref', ref);
    next.url = play.toString();
    next.masterUrl = masterUrl;
    next.nativeTracks = true;
    return next;
  }).filter(Boolean);

  data.version = VERSION;
  data.nativeTrackPreservation = true;
  data.audioTrackPreservation = true;
  data.playbackTransport = 'quality-scoped-audio-hls-master';
  data.subtitleTransport = 'addon-resource';
  data.androidSubtitleTransport = 'addon-resource';
  data.desktopSubtitleTransport = 'addon-resource';
  data.verifiedDubLabels = true;
  return json(data);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': '*'
        }
      });
    }
    if (url.pathname === '/health') {
      const base = await baseWorker.fetch(request);
      let data = {};
      try { data = await base.json(); } catch (_) {}
      return json({
        ...data,
        status: 'ok',
        name: 'Scarlet Peach HentaiHaven Resolver',
        version: VERSION,
        nativeTrackPreservation: true,
        audioTrackPreservation: true,
        playbackTransport: 'quality-scoped-audio-hls-master',
        subtitleTransport: 'addon-resource',
        androidSubtitleTransport: 'addon-resource',
        desktopSubtitleTransport: 'addon-resource',
        verifiedDubLabels: true
      });
    }
    if (url.pathname === '/play.m3u8' && request.method === 'GET') return audioHls(url);
    if (url.pathname === '/resolve' && request.method === 'POST') return wrappedResolve(request, url);
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', version: VERSION, endpoints: ['/health', '/resolve', '/play.m3u8'] });
  }
};
