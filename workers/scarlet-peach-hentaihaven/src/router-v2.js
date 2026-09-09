import baseWorker from './router.js';

const VERSION = '0.5.1';

function clean(value) { return String(value == null ? '' : value).trim(); }
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
function removeSubtitleGroupAttribute(line) {
  return String(line)
    .replace(/,?SUBTITLES=(?:"[^"]*"|'[^']*'|[^,\s]+)/gi, '')
    .replace(/,,+/g, ',');
}
function selectedMaster(source, masterUrl, videoUrl, includeSubtitles = true) {
  const lines = String(source || '').split(/\r?\n/);
  const out = ['#EXTM3U'];
  const version = lines.find(line => /^#EXT-X-VERSION:/i.test(line));
  if (version) out.push(version);

  for (const line of lines) {
    if (!/^#EXT-X-MEDIA:/i.test(line)) continue;
    if (!includeSubtitles && isSubtitleMediaLine(line)) continue;
    out.push(absolutizeUriAttribute(line, masterUrl));
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
async function nativeHls(request, url) {
  const master = clean(url.searchParams.get('master'));
  const video = clean(url.searchParams.get('video'));
  const ref = clean(url.searchParams.get('ref')) || 'https://hentaihaven.com/';
  if (!isHttpsUrl(master, '.m3u8') || !isHttpsUrl(video, '.m3u8')) return new Response('invalid source', { status: 400 });
  try {
    const response = await fetch(master, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
        referer: ref
      }
    });
    const text = await response.text();
    if (!response.ok || !/^#EXTM3U/m.test(text)) throw new Error(`master HTTP ${response.status}`);
    const android = isAndroidPlayback(request);
    const body = selectedMaster(text, master, video, !android);
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
  const ref = data.match && data.match.url ? data.match.url : 'https://hentaihaven.com/';
  data.streams = data.streams.map(stream => {
    const masterUrl = deriveMasterUrl(stream);
    if (!masterUrl || !isHttpsUrl(stream.url, '.m3u8')) return stream;
    const play = new URL('/play.m3u8', requestUrl.origin);
    play.searchParams.set('master', masterUrl);
    play.searchParams.set('video', stream.url);
    play.searchParams.set('ref', ref);
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
      return json({ ...data, status: 'ok', name: 'Scarlet Peach HentaiHaven Resolver', version: VERSION, nativeTrackPreservation: true, nativeTrackTransport: 'quality-scoped-hls-master', androidSubtitleTransport: 'external-sidecar', desktopSubtitleTransport: 'native-hls-webvtt' });
    }
    if (url.pathname === '/play.m3u8' && request.method === 'GET') return nativeHls(request, url);
    if (url.pathname === '/resolve' && request.method === 'POST') return wrappedResolve(request, url);
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', version: VERSION, endpoints: ['/health', '/resolve', '/play.m3u8'] });
  }
};
