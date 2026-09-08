class HentaiTvUpstreamError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HentaiTvUpstreamError';
    this.cause = cause;
  }
}

const DEFAULT_BASE_URL = 'https://hentai.tv';
const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function createHentaiTvClient(options = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchImpl = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  async function request(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: init.accept || '*/*',
          'accept-language': 'en-US,en;q=0.9',
          ...(init.headers || {})
        }
      });
      return response;
    } catch (error) {
      const reason = error?.name === 'AbortError' ? `request timed out after ${timeoutMs}ms` : error?.message || 'request failed';
      throw new HentaiTvUpstreamError(reason, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function apiSearch(query) {
    const url = `${baseUrl}/wp-json/wp/v2/episodes?search=${encodeURIComponent(query)}&per_page=50&_fields=id,slug,title,date`;
    const response = await request(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new HentaiTvUpstreamError(`HentaiTV search returned HTTP ${response.status}`);
    let payload;
    try { payload = await response.json(); } catch (error) { throw new HentaiTvUpstreamError('HentaiTV search returned invalid JSON', error); }
    if (!Array.isArray(payload)) throw new HentaiTvUpstreamError('HentaiTV search returned an unexpected payload');
    return payload;
  }

  async function search(query) {
    if (!String(query || '').trim()) return [];
    const episodes = await apiSearch(query);
    const grouped = new Map();
    for (const item of episodes) {
      const slug = String(item?.slug || '');
      const rendered = decodeHtml(String(item?.title?.rendered || ''));
      if (!slug || !rendered) continue;
      const episodeNumber = parseEpisodeNumber(slug) || parseEpisodeNumber(rendered);
      const title = cleanSeriesTitle(rendered);
      if (!title) continue;
      const key = normalize(title);
      if (!grouped.has(key)) grouped.set(key, { title, slug, episodes: {}, url: `${baseUrl}/hentai/${slug}/` });
      const candidate = grouped.get(key);
      if (episodeNumber) candidate.episodes[episodeNumber] = slug;
      if (!candidate.slug || episodeNumber === 1) {
        candidate.slug = slug;
        candidate.url = `${baseUrl}/hentai/${slug}/`;
      }
    }
    return [...grouped.values()];
  }

  async function episode(candidate, episodeNumber = 1) {
    if (!candidate || !candidate.title) throw new Error('A HentaiTV title candidate is required');
    let slug = candidate.episodes?.[episodeNumber];
    if (!slug) {
      const refreshed = await search(candidate.title);
      const exact = refreshed.find((entry) => normalize(entry.title) === normalize(candidate.title)) || refreshed[0];
      slug = exact?.episodes?.[episodeNumber];
    }
    if (!slug) return { streams: [], reason: 'no-episode-match' };

    const pageUrl = `${baseUrl}/hentai/${slug}/`;
    let html = '';
    try {
      const page = await request(pageUrl, { headers: { accept: 'text/html,*/*;q=0.8', cookie: 'inter=1' } });
      if (page.ok) html = await page.text();
    } catch (_) {
      // Direct CDN probing below is an intentional fallback when the page is blocked.
    }

    const discovered = extractMediaUrls(html);
    const streams = dedupe(discovered).map(toStream);
    if (streams.length) return { streams, slug, pageUrl };

    for (const videoSlug of generateVideoSlugVariations(slug)) {
      const url = `https://r2.1hanime.com/${videoSlug}.mp4`;
      if (await probe(url)) return { streams: [toStream(url)], slug, pageUrl };
    }
    return { streams: [], slug, pageUrl, reason: 'no-playable-source' };
  }

  async function probe(url) {
    try {
      const head = await request(url, { method: 'HEAD', redirect: 'follow' });
      if (head.ok) return true;
      if (head.status !== 405 && head.status !== 403) return false;
      const ranged = await request(url, { method: 'GET', redirect: 'follow', headers: { range: 'bytes=0-0' } });
      return ranged.ok || ranged.status === 206;
    } catch (_) {
      return false;
    }
  }

  return { search, episode, baseUrl };
}

function parseEpisodeNumber(value) {
  const text = String(value || '');
  const match = text.match(/(?:episode|ep)[-\s_]*(\d+)(?:\D*$)/i) || text.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function cleanSeriesTitle(value) {
  return decodeHtml(String(value || ''))
    .replace(/\s+(?:episode|ep)\s*\d+.*$/i, '')
    .replace(/\s*[-–—:]\s*(?:episode|ep)\s*\d+.*$/i, '')
    .trim();
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function extractMediaUrls(html) {
  if (!html) return [];
  const normalized = String(html).replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const urls = normalized.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
  return urls.map((url) => url.replace(/[),;]+$/, '')).filter((url) => /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url));
}

function generateVideoSlugVariations(episodeSlug) {
  const base = String(episodeSlug || '').replace(/-episode-(\d+)$/i, '-$1');
  const variations = [base];
  for (const prefix of ['ova-', 'ona-', 'special-']) {
    if (base.toLowerCase().startsWith(prefix)) variations.unshift(base.slice(prefix.length));
  }
  if (/^1ldk-jk-/i.test(base)) variations.unshift(base.replace(/^1ldk-jk-/i, '1ldk-+-jk-'));
  return dedupe(variations.filter(Boolean));
}

function toStream(url) {
  const quality = String(url).match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i)?.[1];
  const container = /\.m3u8(?:[?#]|$)/i.test(url) ? 'HLS' : /\.mp4(?:[?#]|$)/i.test(url) ? 'MP4' : null;
  const details = [quality ? `${quality}p` : null, container].filter(Boolean).join(' • ');
  return { name: 'HentaiTV', title: details ? `HentaiTV • ${details}` : 'HentaiTV', url };
}

function dedupe(values) { return [...new Set(values)]; }

module.exports = {
  createHentaiTvClient,
  HentaiTvUpstreamError,
  parseEpisodeNumber,
  cleanSeriesTitle,
  extractMediaUrls,
  generateVideoSlugVariations
};
