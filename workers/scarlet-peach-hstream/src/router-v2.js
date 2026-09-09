import baseWorker from './router.js';

const VERSION = '0.2.1';
const BASE = 'https://hstream.moe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 ScarletPeach/0.2';

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
function xmlEscape(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function isPublicHttpUrl(value, kind) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
    if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return false;
    if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^\[?(?:fc|fd|fe80):/i.test(host)) return false;
    if (kind === 'mpd' && !/\/manifest\.mpd(?:$|\?)/i.test(url.pathname + url.search)) return false;
    if (kind === 'subtitle' && !/\.(?:ass|ssa|vtt)(?:$|\?)/i.test(url.pathname + url.search)) return false;
    return true;
  } catch (_) {
    return false;
  }
}
function sourceDirectory(sourceUrl) {
  const url = new URL(sourceUrl);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/[^/]*$/, '');
  return url.toString();
}
function isAndroidPlayback(request) {
  const userAgent = clean(request && request.headers && request.headers.get('user-agent'));
  return /(?:android|exoplayer|media3)/i.test(userAgent);
}
function assTime(value) {
  const match = clean(value).match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!match) return '';
  const h = String(Number(match[1])).padStart(2, '0');
  const m = match[2];
  const s = match[3];
  const fraction = match[4].padEnd(3, '0').slice(0, 3);
  return `${h}:${m}:${s}.${fraction}`;
}
function assText(value) {
  return String(value || '')
    .replace(/\\N/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/gi, ' ')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\([{}])/g, '$1')
    .trim();
}
function assToVtt(input) {
  const source = String(input || '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  let inEvents = false;
  let format = [];
  const cues = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^\[Events\]$/i.test(line)) { inEvents = true; continue; }
    if (/^\[.+\]$/.test(line)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^Format\s*:/i.test(line)) {
      format = line.replace(/^Format\s*:/i, '').split(',').map(x => x.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(line)) continue;
    const payload = line.replace(/^Dialogue\s*:/i, '');
    const expected = format.length || 10;
    const parts = payload.split(',');
    if (parts.length < expected) continue;
    const head = parts.slice(0, expected - 1);
    const tail = parts.slice(expected - 1).join(',');
    const fields = [...head, tail];
    const startIndex = format.length ? format.indexOf('start') : 1;
    const endIndex = format.length ? format.indexOf('end') : 2;
    const textIndex = format.length ? format.indexOf('text') : expected - 1;
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue;
    const start = assTime(fields[startIndex]);
    const end = assTime(fields[endIndex]);
    const text = assText(fields[textIndex]);
    if (!start || !end || !text) continue;
    cues.push(`${start} --> ${end}\n${text}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
function ensureSourceBaseMpd(xml, originalUrl) {
  let source = String(xml || '');
  if (!/<MPD\b/i.test(source) || !/<Period\b/i.test(source)) throw new Error('invalid MPD');
  if (!/<BaseURL\b/i.test(source)) {
    const baseUrl = sourceDirectory(originalUrl);
    source = source.replace(/(<MPD\b[^>]*>)/i, `$1\n  <BaseURL>${xmlEscape(baseUrl)}</BaseURL>`);
  }
  return source;
}
function injectNativeSubtitleMpd(xml, originalUrl, subtitleUrl) {
  let source = ensureSourceBaseMpd(xml, originalUrl);
  const adaptation = [
    '    <AdaptationSet id="scarlet-peach-text-en" contentType="text" mimeType="text/vtt" lang="en" segmentAlignment="true">',
    '      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="subtitle" />',
    '      <Representation id="scarlet-peach-sub-en" bandwidth="256">',
    `        <BaseURL>${xmlEscape(subtitleUrl)}</BaseURL>`,
    '      </Representation>',
    '    </AdaptationSet>'
  ].join('\n');
  source = source.replace(/<\/Period>/i, `${adaptation}\n  </Period>`);
  return source;
}
async function fetchText(url, referer, accept) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept,
      referer: referer || BASE + '/'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return text;
}
async function nativeMpd(request, url) {
  const src = clean(url.searchParams.get('src'));
  const sub = clean(url.searchParams.get('sub'));
  const ref = clean(url.searchParams.get('ref')) || BASE + '/';
  if (!isPublicHttpUrl(src, 'mpd') || !isPublicHttpUrl(sub, 'subtitle')) return new Response('invalid source', { status: 400 });
  try {
    const xml = await fetchText(src, ref, 'application/dash+xml,application/xml,text/xml,*/*');
    const android = isAndroidPlayback(request);
    let body;
    let mode;
    if (android) {
      body = ensureSourceBaseMpd(xml, src);
      mode = 'android-external-sidecar';
    } else {
      const subtitleUrl = new URL('/subtitle.vtt', url.origin);
      subtitleUrl.searchParams.set('src', sub);
      subtitleUrl.searchParams.set('ref', ref);
      body = injectNativeSubtitleMpd(xml, src, subtitleUrl.toString());
      mode = 'desktop-native-webvtt';
    }
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/dash+xml; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'private, max-age=300',
        'x-scarlet-peach-track-mode': mode
      }
    });
  } catch (error) {
    return new Response(`MPD error: ${error && error.message ? error.message : error}`, { status: 502 });
  }
}
async function subtitleVtt(url) {
  const src = clean(url.searchParams.get('src'));
  const ref = clean(url.searchParams.get('ref')) || BASE + '/';
  if (!isPublicHttpUrl(src, 'subtitle')) return new Response('invalid subtitle source', { status: 400 });
  try {
    const text = await fetchText(src, ref, 'text/plain,text/vtt,*/*');
    const body = /\.vtt(?:$|\?)/i.test(src) || /^WEBVTT/i.test(text.trim()) ? text : assToVtt(text);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'private, max-age=300'
      }
    });
  } catch (error) {
    return new Response(`Subtitle error: ${error && error.message ? error.message : error}`, { status: 502 });
  }
}
async function wrappedResolve(request, requestUrl) {
  const response = await baseWorker.fetch(request);
  if (!response.ok) return response;
  let data;
  try { data = await response.json(); } catch (_) { return response; }
  const tracks = data && data.metadata && Array.isArray(data.metadata.subtitles) ? data.metadata.subtitles : [];
  const english = tracks.find(track => clean(track && track.language).toLowerCase() === 'en' && isPublicHttpUrl(track && track.url, 'subtitle'));
  if (!english || !Array.isArray(data.streams)) return json({ ...data, version: VERSION });
  data.streams = data.streams.map(stream => {
    if (!stream || !isPublicHttpUrl(stream.url, 'mpd')) return stream;
    const play = new URL('/play.mpd', requestUrl.origin);
    play.searchParams.set('src', stream.url);
    play.searchParams.set('sub', english.url);
    play.searchParams.set('ref', data.match && data.match.url ? data.match.url : BASE + '/');
    return { ...stream, sourceUrl: stream.url, url: play.toString(), nativeSubtitles: ['en'] };
  });
  data.version = VERSION;
  data.nativeSubtitleInjection = true;
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
      return json({ ok: true, name: 'Scarlet Peach HStream Resolver', version: VERSION, source: BASE, formats: ['dash/mpd'], qualities: [720, 1080, 2160], nativeSubtitleInjection: true, nativeSubtitleFormat: 'webvtt', androidSubtitleTransport: 'external-sidecar', desktopSubtitleTransport: 'native-dash-webvtt' });
    }
    if (url.pathname === '/play.mpd' && request.method === 'GET') return nativeMpd(request, url);
    if (url.pathname === '/subtitle.vtt' && request.method === 'GET') return subtitleVtt(url);
    if (url.pathname === '/resolve' && request.method === 'POST') return wrappedResolve(request, url);
    return json({ ok: true, name: 'Scarlet Peach HStream Resolver', version: VERSION, endpoints: ['/health', '/resolve', '/play.mpd', '/subtitle.vtt'] });
  }
};
