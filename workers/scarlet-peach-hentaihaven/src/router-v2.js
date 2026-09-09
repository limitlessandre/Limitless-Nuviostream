import baseWorker from './router.js';

const VERSION = '0.5.3';
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
function isDirectMediaUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /\.(?:m3u8|mp4)(?:$|\?)/i.test(url.toString());
  } catch (_) { return false; }
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
async function wrappedResolve(request) {
  const response = await baseWorker.fetch(request);
  if (!response.ok) return response;
  let data;
  try { data = await response.json(); } catch (_) { return response; }
  if (!Array.isArray(data.streams)) return json({ ...data, version: VERSION });

  data = await normalizeSemanticAudio(data);
  data.streams = data.streams.map(stream => {
    const directUrl = clean(stream && (stream.sourceUrl || stream.url));
    const next = { ...stream, url: directUrl, sourceUrl: directUrl, nativeTracks: false };
    delete next.masterUrl;
    return next;
  }).filter(stream => isDirectMediaUrl(stream.url));

  data.version = VERSION;
  data.nativeTrackPreservation = false;
  data.playbackTransport = 'direct-source-hls';
  data.subtitleTransport = 'external-sidecar';
  data.androidSubtitleTransport = 'external-sidecar';
  data.desktopSubtitleTransport = 'external-sidecar';
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
        nativeTrackPreservation: false,
        playbackTransport: 'direct-source-hls',
        subtitleTransport: 'external-sidecar',
        androidSubtitleTransport: 'external-sidecar',
        desktopSubtitleTransport: 'external-sidecar',
        verifiedDubLabels: true
      });
    }
    if (url.pathname === '/play.m3u8' && request.method === 'GET') {
      const video = clean(url.searchParams.get('video'));
      if (!isDirectMediaUrl(video)) return new Response('invalid source', { status: 400 });
      return Response.redirect(video, 302);
    }
    if (url.pathname === '/resolve' && request.method === 'POST') return wrappedResolve(request);
    return json({ name: 'Scarlet Peach HentaiHaven Resolver', version: VERSION, endpoints: ['/health', '/resolve'] });
  }
};
