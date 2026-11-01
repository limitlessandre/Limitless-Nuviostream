"use strict";

// WCO Nexus presentation wrapper using NAMING_STANDARDS.md.
// Invocation-scoped request budgets and caches are shared by the nested WCO
// modules. Presentation follows the canonical quality, tag and mirror grammar.
const PROVIDER_NAME = "WCO";
const BASE_URL = "https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/custom/providers/wco-verification-safety-v1.js";
// One context per extraction. It is passed lexically through dynamic modules;
// neither global fetch nor the shared anime identity provider is modified.
function createRequestContext(nativeFetch, budgetMs = 52000) {
  const deadline = Date.now() + budgetMs;
  const responses = new Map(), players = new Map(), failedOptionalHosts = new Set(), unavailableSearch = new Set();
  let optionalDeadline = null, closed = false;
  const context = {
    remaining: () => closed ? 0 : Math.max(0, deadline - Date.now()),
    close: () => { closed = true; },
    async bounded(work, milliseconds, fallback) {
      const wait = Math.min(milliseconds, context.remaining());
      if (wait <= 0) return fallback;
      const expires = Date.now() + wait;
      let timer, settled = false;
      // Desktop clearTimeout removes the callback but does not cancel its native
      // coroutine sleep. Keep each sleep short so successful work is not held
      // until an unused 52-second timer finishes. This is asynchronous, not a spin.
      const timeout = new Promise(resolve => {
        const check = () => {
          if (settled) return;
          const left = expires - Date.now();
          if (left <= 0) { resolve(fallback); return; }
          timer = setTimeout(check, Math.min(200, left));
        };
        check();
      });
      try { return await Promise.race([Promise.resolve().then(work), timeout]); }
      finally { settled = true; clearTimeout(timer); }
    },
    player(url, work) {
      if (!players.has(url)) players.set(url, Promise.resolve().then(work));
      return players.get(url);
    }
  };
  function failure(url) { return { ok: false, status: 0, url, headers: { get: () => null }, text: async () => '', json: async () => null }; }
  function snapshot(response, body) {
    return { ok: response.ok, status: response.status, statusText: response.statusText, url: response.url,
      headers: response.headers, text: async () => body, json: async () => JSON.parse(body) };
  }
  // Desktop's URL polyfill does not synchronize searchParams mutations to href.
  // Serialize explicitly instead of assuming browser URL accessor semantics.
  function serializedUrl(parsed) {
    const query = parsed.searchParams.toString();
    return parsed.origin + parsed.pathname + (query ? '?' + query : '') + (parsed.hash || '');
  }
  function fetchFor(identity) {
    return async function scopedFetch(url, options = {}) {
      const parsed = new URL(String(url)), method = String(options.method || 'GET').toUpperCase();
      if (parsed.hostname === 'raw.githubusercontent.com' && /^\/limitlessandre\/Limitless-Nuviostream\/refs\/heads\/Limitless-nexus\/custom\/providers\/wco[^/]*\.js$/.test(parsed.pathname)) {
        parsed.searchParams.set('rev', '281');
        url = serializedUrl(parsed);
      }
      const optional = identity || /(^|\.)(jikan\.moe|anilist\.co|ani\.zip)$/.test(parsed.hostname);
      if (optional && optionalDeadline === null) optionalDeadline = Date.now() + 2500;
      if (!context.remaining() || (optional && (failedOptionalHosts.has(parsed.hostname) || Date.now() >= optionalDeadline))) return failure(url);
      const search = parsed.pathname === '/search' && /(^|\.)(wcostream\.tv|wcoflix\.tv|wcoforever\.net|wco\.tv)$/.test(parsed.hostname);
      if (search && unavailableSearch.has(parsed.origin)) return failure(url);
      // Player endpoints are session-sensitive. Cache their resolved lookup via
      // player(), not individual beacon/player HTTP responses.
      const session = /\/ad-verify$|\/inc\/embed\/(?:index|video-js[^/]*)\.php$/.test(parsed.pathname);
      const metadata = parsed.hostname === 'api.themoviedb.org';
      const key = method + ' ' + String(url) + ' ' + String(options.body || '') + (metadata ? '' : ' ' + JSON.stringify(options.headers || {}));
      const cacheable = !session && (method === 'GET' || search);
      if (cacheable && responses.has(key)) return responses.get(key);
      const request = async () => {
        const ms = Math.min(4000, context.remaining(), optional ? Math.max(0, optionalDeadline - Date.now()) : Infinity);
        if (ms <= 0) return failure(url);
        // Logical expiry works even where native transport cancellation is unsupported.
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const perform = async () => { const r = await nativeFetch(url, controller ? { ...options, signal: controller.signal } : options); return snapshot(r, String(await r.text() || '')); };
        let result;
        try { result = await context.bounded(perform, ms, failure(url)); }
        catch (_) { result = failure(url); }
        if (controller && result.status === 0) controller.abort();
        if (optional && !result.ok) failedOptionalHosts.add(parsed.hostname);
        if (search && (result.status === 0 || result.status === 429)) unavailableSearch.add(parsed.origin);
        if (search && result.status === 503) {
          // A single retry can recover a transient failure; stop trying aliases
          // on this origin if it is still unavailable.
          if (context.remaining() > 24000) {
            await new Promise(resolve => setTimeout(resolve, 250));
            try { result = await context.bounded(perform, Math.min(4000, context.remaining()), failure(url)); }
            catch (_) { result = failure(url); }
          }
          if (controller && result.status === 0) controller.abort();
          if (!result.ok) unavailableSearch.add(parsed.origin);
        }
        if (metadata && result.ok && parsed.searchParams.has('append_to_response')) {
          const base = new URL(parsed.href); base.searchParams.delete('append_to_response');
          responses.set(method + ' ' + serializedUrl(base) + ' ', Promise.resolve(result));
        }
        return result;
      };
      const pending = request();
      if (cacheable) responses.set(key, pending);
      return pending;
    };
  }
  context.fetch = fetchFor(false);
  // Functions created by downloaded modules inherit the same invocation context.
  // Identity code gets a separate aggregate budget, including its TMDB searches.
  const NativeFunction = Function;
  function ScopedFunction(...parameters) {
    const body = parameters.pop();
    const identity = /module\.exports\s*=\s*\{\s*resolveAnimeIdentity\s*\}/.test(body);
    const compiled = NativeFunction(...parameters, 'fetch', 'Function', '__wcoContext', body);
    return function(...args) { return compiled(...args, identity ? fetchFor(true) : context.fetch, ScopedFunction, context); };
  }
  context.Function = ScopedFunction;
  return context;
}


async function loadBase(context) {
  try {
    const response = await context.fetch(BASE_URL, { skipSizeCheck: true });
    if (!response || !response.ok) return null;
    const source = String(await response.text() || "");
    if (!source || !source.includes("module.exports")) return null;
    const mod = { exports: {} };
    const factory = new context.Function("module", "exports", "require", source + "\n;return module.exports;");
    const exported = factory(mod, mod.exports, function(name) { throw new Error("Unsupported nested require: " + name); }) || mod.exports;
    if (!exported || typeof exported.getStreams !== "function") return null;
    return exported;
  } catch (_) { return null; }
}

function qualityNumber(row) {
  const text = `${row && row.quality || ""} ${row && row.name || ""}`;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b4k\b/i.test(text)) return 2160;
  const m = text.match(/\b(4320|2160|1440|1080|720|576|540|480|360|240)p?\b/i);
  return m ? Number(m[1]) : 0;
}

function qualityLabel(height) {
  if (height >= 4320) return `2x4K 8K ${height}p`;
  if (height >= 2160) return `4K ${height}p`;
  if (height >= 1440) return `Enhanced QHD ${height}p`;
  if (height >= 1080) return `FHD ${height}p`;
  if (height >= 720) return `HD ${height}p`;
  if (height >= 540) return `HD-Low ${height}p`;
  if (height >= 480) return `SD ${height}p`;
  if (height >= 360) return `SD-Low ${height}p`;
  if (height > 0) return `SD-Very Low ${height}p`;
  return "Unknown Auto";
}

function subtitleTrack(track) {
  if (!track) return false;
  if (typeof track === "string") return !!track.trim();
  const kind = String(track.kind || track.type || "").toLowerCase();
  if (kind && !/(sub|caption|text|vtt|srt)/.test(kind)) return false;
  return !!(track.url || track.file || track.src || track.uri);
}

function hasSelectableSubs(row) {
  return [row && row.subtitles, row && row.subtitleTracks, row && row.captions, row && row.tracks]
    .some(group => Array.isArray(group) && group.some(subtitleTrack));
}

function hasMultipleAudio(row) {
  if ([row && row.audioTracks, row && row.audios].some(group => Array.isArray(group) && group.filter(Boolean).length > 1)) return true;
  const tracks = Array.isArray(row && row.tracks) ? row.tracks : [];
  return tracks.filter(track => track && typeof track === "object" && /audio/i.test(String(track.kind || track.type || ""))).length > 1;
}

function classification(row) {
  const text = [row && row.name, row && row.audio, row && row.audioType, row && row.audioLanguage, row && row.language, row && row.lang]
    .filter(Boolean).join(" ").toLowerCase();
  const dual = hasMultipleAudio(row) || /dual\s*audio|\[dual\]|\bdual\b/.test(text);
  const selectable = hasSelectableSubs(row);
  const dub = /\[dub(?:\+sub)?\]|english\s*dub|\bdubbed\b|\bdub\b/.test(text);
  // WCO explicitly exposes labels such as "Japanese + English Hard Subs".
  const hsub = /\[hsub\]|hard[\s-]*subs?|hardsub/.test(text);
  if (dual) return "[DUAL]";
  if (selectable) return dub ? "[DUB+SUB]" : "[SUB]";
  if (dub) return "[DUB]";
  if (hsub) return "[HSUB]";
  return "[UNK]";
}

function mirrorLabel(row) {
  const text = String(row && row.name || "");
  const m = text.match(/\bmirror\s*(\d+)\b/i);
  return m ? `Mirror ${m[1]}` : "";
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  if (String(row.quality || "").toUpperCase() === "DIAG" || /\bDIAG\b/i.test(String(row.name || ""))) return row;
  const height = qualityNumber(row);
  if (!row.url && !height) return row;
  const mirror = mirrorLabel(row);
  return { ...row, name: `${PROVIDER_NAME} • ${qualityLabel(height)} • ${classification(row)}${mirror ? ` • ${mirror}` : ""}` };
}

async function getStreams(inputId, mediaType, season, episode) {
  const context = createRequestContext(fetch);
  const base = await loadBase(context);
  if (!base) return [];
  try {
    const rows = await base.getStreams(inputId, mediaType, season, episode);
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
  } catch (_) { return []; }
  finally { context.close(); }
}

async function onSettings() {
  const context = createRequestContext(fetch);
  const base = await loadBase(context);
  if (!base || typeof base.onSettings !== "function") return [];
  try { return await base.onSettings(); } catch (_) { return []; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams, onSettings, createRequestContext };
else { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
