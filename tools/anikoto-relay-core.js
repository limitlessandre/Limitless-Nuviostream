"use strict";
const {createHash, randomBytes} = require("node:crypto");
const {AsyncLocalStorage} = require("node:async_hooks");
const {allowed, candidates, createTransport, isTs, unwrap, bytes, peek} = require("./anikoto-transport");
const {createAniKotoSources} = require("../custom/providers/anikoto-sources");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 24);
const cors = extra => new Headers({"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges", ...extra});
const fail = (status, message) => new Response(message, {status, headers: cors({"Cache-Control": "no-store"})});

function createRelay(options = {}) {
  const config = {cacheBytes: 64 * 1024 * 1024, cacheEntries: 24, segmentBytes: 12 * 1024 * 1024,
    lookahead: 4, prefetchWorkers: 3, idleMs: 600000, refreshMs: 60000, timeoutMs: 8000, ...options};
  const transport = options.transport ? {request: options.transport, close() {}} : createTransport();
  const sessions = new Map(), cache = new Map(), pending = new Map(), controllers = new Set();
  const stats = {hits: 0, joined: 0, fetched: 0, prefetched: 0, unwrapped: 0, refreshed: 0, reminted: 0, cacheBytes: 0};
  const operations = new AsyncLocalStorage();
  let prefetching = 0, closed = false;
  const now = options.now || Date.now;
  function removeCache(key) { const item = cache.get(key); if (item) stats.cacheBytes -= item.body.length; cache.delete(key); }
  function put(key, value) {
    if (closed || value.body.length > config.cacheBytes) return;
    removeCache(key);
    while (cache.size && (cache.size >= config.cacheEntries || stats.cacheBytes + value.body.length > config.cacheBytes)) removeCache(cache.keys().next().value);
    cache.set(key, {...value, time: now()}); stats.cacheBytes += value.body.length;
  }
  function cached(key) {
    const item = cache.get(key); if (!item) return null;
    if (now() - item.time > config.idleMs) {removeCache(key); return null;}
    cache.delete(key); cache.set(key, item); stats.hits++; return item;
  }
  function expire() {
    for (const [id, s] of sessions) if (now() - s.touched > config.idleMs) {
      s.closed = true; s.generation++; for (const c of s.controllers) c.abort(); sessions.delete(id);
      for (const key of cache.keys()) if (key.startsWith(id + ":")) removeCache(key);
    }
    for (const [key, item] of cache) if (now() - item.time > config.idleMs) removeCache(key);
  }
  const interval = setInterval(expire, Math.min(config.idleMs, 30000)); interval.unref?.();
  async function upstream(s, url, embed = false, extraHeaders = {}, range = "") {
    if (closed || s.closed) throw new Error("session-closed");
    const operation = operations.getStore();
    if (operation && (operation.signal.aborted || Date.now() >= operation.deadline)) throw new Error("request-timeout");
    if (controllers.size >= 8) throw new Error("upstream-capacity");
    const controller = new AbortController(); controllers.add(controller); s.controllers.add(controller);
    const signal = operation ? AbortSignal.any([controller.signal, operation.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new Error("upstream-timeout")), Math.min(config.timeoutMs, operation ? operation.deadline - Date.now() : config.timeoutMs));
    const release = () => {clearTimeout(timer); controllers.delete(controller); s.controllers.delete(controller);};
    const choices = embed ? [url] : candidates(url);
    let last;
    try {
      for (const candidate of choices) {
        let current = candidate;
        for (let i = 0; i <= 3; i++) {
          if (!allowed(current, embed)) throw new Error("unsupported-host");
          if (signal.aborted) throw new Error("upstream-timeout");
          let response;
          try {
            response = await transport.request(current, {signal, headers: {Accept: "*/*", Referer: embed ? new URL(current).origin + "/" : s.referer, "User-Agent": UA, ...extraHeaders, ...(range ? {Range: range} : {})}});
          } catch (error) {last = error; break;}
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location"); await response.body?.cancel();
            if (!location || i === 3) {last = new Error("redirect-limit"); break;}
            current = new URL(location, current).href; continue;
          }
          if (!response.ok) {last = new Error("upstream-" + response.status); last.status = response.status; await response.body?.cancel(); break;}
          stats.fetched++; return {response, url: current, release};
        }
      }
      if (signal.aborted) throw new Error("upstream-timeout");
      throw last || new Error("unsupported-host");
    } catch (error) {release(); throw error;}
  }
  async function text(s, url, embed = false, headers = {}) {
    const r = await upstream(s, url, embed, headers);
    try {return {text: new TextDecoder().decode(await bytes(r.response, 2 * 1024 * 1024)), url: r.url};} finally {r.release();}
  }
  function session(url, embed, mode, referer) {
    if (!allowed(url) || embed && !allowed(embed, true) || referer && !allowed(referer, true)) throw new Error("unsupported-source");
    const key = digest([url, embed, mode, referer].join("|"));
    if (sessions.has(key)) {const s = sessions.get(key); s.touched = now(); return s;}
    expire(); if (sessions.size >= 16) throw new Error("too-many-sessions");
    const s = {id: key, token: randomBytes(12).toString("hex"), embed, mode, referer: referer || "https://megaplay.buzz/", touched: now(), generation: 0, resources: new Map(), controllers: new Set(), background: new Set(), closed: false};
    s.resources.set("root", {id: "root", url, kind: /\.(vtt|srt)(?:[?#]|$)/i.test(url) ? "subtitle" : /\.mp4(?:[?#]|$)/i.test(url) ? "file" : "playlist", children: [], refreshed: 0});
    sessions.set(key, s); return s;
  }
  function link(s, r, origin) {return origin + "/media/" + s.id + "/" + r.id + "?token=" + s.token;}
  function register(s, parent, key, url, kind, sequence) {
    if (!allowed(url)) throw new Error("unsupported-playlist-host");
    const id = digest(parent.id + ":" + key), old = s.resources.get(id);
    if (s.resources.size >= 12000 && !old) throw new Error("playlist-resource-limit");
    const r = old || {id, parent: parent.id, children: [], refreshed: 0};
    if (old && old.url !== url && ["key", "init", "subtitle"].includes(kind)) removeCache(s.id + ":" + id);
    Object.assign(r, {url, kind, sequence}); s.resources.set(id, r); return r;
  }
  function rewrite(s, r, body, base, origin) {
    if (!/^\s*#EXTM3U(?:\s|$)/.test(body)) throw new Error("invalid-playlist");
    const lines = body.replace(/^\uFEFF/, "").split(/\r?\n/);
    let sequence = Number((body.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1] || 0), variant = "", index = 0, resourceIndex = 0;
    const children = [];
    const result = lines.map(line => {
      if (/^#EXT-X-STREAM-INF:/.test(line)) variant = line;
      if (line && !line.startsWith("#")) {
        const kind = variant ? "playlist" : "segment";
        const key = variant ? "variant:" + ((variant.match(/RESOLUTION=([^,]+)/) || [])[1] || index++) + ":" + ((variant.match(/AUDIO="([^"]+)"/) || [])[1] || "") : "segment:" + sequence;
        const child = register(s, r, key, new URL(line.trim(), base).href, kind, sequence++);
        children.push(child.id); variant = ""; return link(s, child, origin);
      }
      return line.replace(/URI=(["'])(.*?)\1/g, (_, quote, ref) => {
        if (ref.startsWith("data:")) return "URI=" + quote + ref + quote;
        const kind = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF)/.test(line) ? "playlist" : /^#EXT-X-KEY/.test(line) ? "key" : "init";
        const child = register(s, r, "attribute:" + resourceIndex++, new URL(ref, base).href, kind);
        return "URI=" + quote + link(s, child, origin) + quote;
      });
    }).join("\n");
    r.url = base; r.children = children; r.refreshed = now(); return result;
  }
  async function playlist(s, r, origin) {
    const value = await text(s, r.url);
    return rewrite(s, r, value.text, value.url, origin);
  }
  async function remint(s) {
    if (!s.embed) throw new Error("reselect-source-required");
    if (!s.minting) s.minting = (async () => {
      const resolver = createAniKotoSources({requestText: async (url, options) => {try {return (await text(s, url, true, options?.headers)).text;} catch (_) {return "";}}, requestJson: async (url, options) => {try {return JSON.parse((await text(s, url, true, options?.headers)).text);} catch (_) {return null;}}});
      const rows = await resolver.external(s.embed, s.mode);
      const usable = rows.find(x => allowed(x.url)); if (!usable) throw new Error("hoster-reresolution-failed");
      s.resources.get("root").url = usable.url;
      s.referer = allowed(usable.headers.Referer, true) ? usable.headers.Referer : s.referer;
      stats.reminted++;
    })().finally(() => {s.minting = null;});
    return s.minting;
  }
  async function refresh(s, r, origin, forceMaster = false) {
    const parent = r.kind === "playlist" ? r : s.resources.get(r.parent);
    if (!parent) throw new Error("no-refresh-context");
    if (!parent.refreshing) parent.refreshing = (async () => {
      if (!forceMaster) {try {await playlist(s, parent, origin); stats.refreshed++; return;} catch (_) {}}
      // Refresh ancestors from the root so stable child IDs acquire fresh URLs.
      const chain = []; let p = parent;
      while (p) {chain.unshift(p); p = s.resources.get(p.parent);}
      try {for (const ancestor of chain) await playlist(s, ancestor, origin);}
      catch (_) {await remint(s); for (const ancestor of chain) await playlist(s, ancestor, origin);}
      stats.refreshed++;
    })().finally(() => {parent.refreshing = null;});
    return parent.refreshing;
  }
  function responseFor(value, request) {
    const headers = cors(value.headers); headers.set("Accept-Ranges", "bytes");
    let body = value.body, status = 200;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || !match[1] && !match[2]) return fail(416, "Unsupported range");
      const start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      if (start > end || start >= body.length) return new Response(null, {status: 416, headers: cors({"Content-Range": "bytes */" + body.length})});
      headers.set("Content-Range", `bytes ${start}-${end}/${body.length}`); body = body.subarray(start, end + 1); status = 206;
    }
    headers.set("Content-Length", String(body.length));
    return new Response(request.method === "HEAD" ? null : body, {status, headers});
  }
  function prefetch(s, r, origin) {
    if (r.kind !== "segment" || s.closed) return;
    const parent = s.resources.get(r.parent); if (!parent) return;
    if (s.active !== parent.id || Math.abs((s.cursor ?? r.sequence) - r.sequence) > config.lookahead + 1) {
      s.generation++;for(const controller of s.background)controller.abort();
    }
    s.active = parent.id; s.cursor = r.sequence;
    const generation = s.generation, at = parent.children.indexOf(r.id);
    for (const id of parent.children.slice(at + 1, at + 1 + config.lookahead)) {
      if (prefetching >= config.prefetchWorkers) break;
      const child = s.resources.get(id), key = s.id + ":" + id;
      if (!child || child.kind !== "segment" || cache.has(key) || pending.has(key)) continue;
      prefetching++;
      const controller = new AbortController();s.background.add(controller);
      Promise.resolve().then(async () => {
        if (closed || s.closed || generation !== s.generation) return;
        const request = new Request(link(s, child, origin));
        const response = await operations.run({signal:controller.signal,deadline:Date.now()+25000},()=>media(s, child, request, true)); await response.body?.cancel(); stats.prefetched++;
      }).catch(() => {}).finally(() => {prefetching--;s.background.delete(controller);});
    }
  }
  async function media(s, r, request, background = false, recovery = 0) {
    const key = s.id + ":" + r.id, origin = new URL(request.url).origin;
    const hit = cached(key); if (hit) {if (!background) prefetch(s, r, origin); return responseFor(hit, request);}
    if (pending.has(key)) {
      stats.joined++; const shared = pending.get(key);
      try {const value = await shared; if (!background) prefetch(s, r, origin); return responseFor(value, request);}
      catch (error) {
        // A failed/cancelled background fetch must not poison the player's request.
        if (background || recovery >= 2 || s.closed) throw error;
        if (pending.get(key) === shared) pending.delete(key);
        return media(s, r, request, false, recovery + 1);
      }
    }
    if (pending.size >= 8) throw new Error("segment-capacity");
    let complete, reject;
    const done = new Promise((resolve, fail) => {complete = resolve; reject = fail;}); pending.set(key, done); done.catch(() => {});
    let fetched, streaming = false;
    try {
      const parent = s.resources.get(r.parent);
      if (parent && now() - parent.refreshed >= config.refreshMs && !background) refresh(s, r, origin).catch(() => {});
      for (let attempt = 0; attempt < 3; attempt++) {
        try {fetched = await upstream(s, r.url); break;}
        catch (error) {if (attempt === 2 || !r.parent) throw error; await refresh(s, r, origin, attempt === 1);}
      }
      let response = fetched.response, prefix;
      if (r.kind === "segment") {
        const sniffed = await peek(response); prefix = sniffed.prefix; response = sniffed.response; fetched.response = response;
      }
      const type = response.headers.get("content-type") || "application/octet-stream";
      const disguised = type.startsWith("image/") || /\.(png|jpe?g)(?:[?#]|$)/i.test(fetched.url) || prefix && (prefix[0] === 137 && prefix[1] === 80 || prefix[0] === 255 && prefix[1] === 216);
      if (prefix && !disguised && !parent?.encrypted && !isTs(prefix) && !/^(ftyp|styp|moof)$/.test(String.fromCharCode(...prefix.slice(4,8)))) throw new Error("invalid-segment");
      const headers = {"Content-Type": type, "Cache-Control": response.headers.get("cache-control") || "private, max-age=60"};
      if (!disguised) for (const name of ["etag", "last-modified"]) {const value = response.headers.get(name); if (value) headers[name] = value;}
      const maximum = r.kind === "subtitle" ? 512 * 1024 : r.kind === "key" ? 1024 : config.segmentBytes;
      // Prefetch/transformation/range requests need a complete bounded representation.
      if (disguised || background || request.method === "HEAD" || request.headers.has("range") || r.kind !== "segment") {
        let body = await bytes(response, maximum);
        if (disguised) {body = unwrap(body); headers["Content-Type"] = "video/mp2t"; stats.unwrapped++;}
        else if (r.kind === "segment" && !isTs(body) && !/^(ftyp|styp|moof)$/.test(String.fromCharCode(...body.slice(4,8))) && !parent?.encrypted) throw new Error("invalid-segment");
        if (r.kind === "subtitle" && /^\s*</.test(new TextDecoder().decode(body.slice(0,64)))) throw new Error("invalid-subtitle");
        const value = {body, headers}; if (!s.closed) put(key, value); complete(value);
        if (!background) prefetch(s, r, origin); return responseFor(value, request);
      }
      // Ordinary segments stream immediately; tee only into the bounded cache.
      const reader = response.body.getReader(); const first = await reader.read();
      if (first.done) throw new Error("empty-segment");
      if (/^\s*(?:<!|<html|\{|\[)/i.test(new TextDecoder().decode(first.value.slice(0,32)))) throw new Error("invalid-segment");
      const chunks = [first.value]; let length = first.value.length, initial = true;
      if (length > maximum) throw new Error("segment-too-large");
      const activeFetched = fetched;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            if (initial) {initial = false; controller.enqueue(first.value); return;}
            const part = await reader.read();
            if (part.done) {
              const body = new Uint8Array(length); let at = 0; for (const chunk of chunks) {body.set(chunk, at); at += chunk.length;}
              const value = {body, headers}; if (!s.closed) put(key, value); complete(value); pending.delete(key); activeFetched.release(); controller.close(); return;
            }
            length += part.value.length; if (length > maximum) throw new Error("segment-too-large");
            chunks.push(part.value); controller.enqueue(part.value);
          } catch (error) {reject(error); pending.delete(key); activeFetched.release(); await reader.cancel().catch(() => {}); controller.error(error);}
        },
        async cancel() {reject(new Error("player-cancelled")); pending.delete(key); activeFetched.release(); await reader.cancel().catch(() => {});}
      });
      prefetch(s, r, origin);
      const lengthHeader = response.headers.get("content-length"); if (lengthHeader) headers["Content-Length"] = lengthHeader;
      const result = new Response(stream, {headers: cors(headers)}); streaming = true; return result;
    } catch (error) {
      const invalid = /invalid-.*segment/.test(error.message);
      const transient = /network|socket|terminated|closed|abort|timeout/i.test(error.message);
      if ((invalid || transient) && r.parent && recovery < 2 && !s.closed && !operations.getStore()?.signal.aborted) {
        if (fetched) {await fetched.response.body?.cancel().catch(() => {}); fetched.release(); fetched = null;}
        pending.delete(key);
        try {
          if (invalid || recovery === 1) await refresh(s, r, origin, recovery === 1);
          const retried = await media(s, r, request, true, recovery + 1);
          // Retry is buffered, so existing waiters receive the same validated representation.
          const value = cached(key); if (!value) throw new Error("recovery-not-cached");complete(value);return retried;
        } catch (failure) {reject(failure);throw failure;}
      }
      reject(error); throw error;
    }
    finally {if (!streaming) {if (fetched) {await fetched.response.body?.cancel().catch(() => {}); fetched.release();} pending.delete(key);}}
  }
  async function handleRequest(request) {
    try {
      const u = new URL(request.url);
      if (u.hostname !== "127.0.0.1" || request.headers.get("host") && request.headers.get("host") !== u.host) return fail(403, "Loopback only");
      if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors()});
      if (!["GET", "HEAD"].includes(request.method)) return fail(405, "GET/HEAD only");
      if (u.pathname === "/health") return Response.json({ok: true, service: "Limitless AniKoto Relay v4", ...stats, sessions: sessions.size, pending: pending.size}, {headers: cors({"Cache-Control": "no-store"})});
      if (u.pathname === "/play" || u.pathname === "/stream" || u.pathname === "/subtitle") {
        const s = session(u.searchParams.get("url"), u.searchParams.get("embed") || "", u.searchParams.get("mode") || "sub", u.searchParams.get("referer") || "");
        if (u.pathname === "/subtitle") s.resources.get("root").kind = "subtitle";
        return new Response(null, {status: 302, headers: cors({Location: link(s, s.resources.get("root"), u.origin)})});
      }
      const match = /^\/media\/([a-f0-9]+)\/([a-f0-9]+|root)$/.exec(u.pathname);
      const s = match && sessions.get(match[1]);
      if (!s || s.closed || u.searchParams.get("token") !== s.token) return fail(404, "Session expired; reselect source");
      const r = s.resources.get(match[2]); if (!r) return fail(404, "Unknown resource"); s.touched = now();
      if (r.kind === "file") {
        const fetched = await upstream(s, r.url, false, {}, request.headers.get("range") || "");
        const headers = cors();
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {const value = fetched.response.headers.get(name); if (value) headers.set(name, value);}
        if (request.method === "HEAD") {await fetched.response.body.cancel(); fetched.release(); return new Response(null, {status:fetched.response.status,headers});}
        const reader = fetched.response.body.getReader();
        fetched.release(); // Large ordinary files use an idle body timeout, not an 8s total download limit.
        return new Response(new ReadableStream({async pull(c) {
          let timer;
          try {const p = await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("body-idle-timeout")),config.timeoutMs);})]);if(p.done)c.close();else c.enqueue(p.value);}
          catch(e){await reader.cancel().catch(()=>{});c.error(e);}finally{clearTimeout(timer);}
        }, async cancel() {await reader.cancel();}}), {status:fetched.response.status,headers});
      }
      if (r.kind === "playlist") {
        let body;
        try {body = await playlist(s, r, u.origin);} catch (_) {await refresh(s, r, u.origin, true); body = await playlist(s, r, u.origin);}
        r.encrypted = /#EXT-X-KEY:.*METHOD=(?!NONE)/.test(body);
        return new Response(request.method === "HEAD" ? null : body, {headers: cors({"Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store"})});
      }
      return await media(s, r, request);
    } catch (error) {return fail(/unsupported|private-address/.test(error.message) ? 400 : /timeout/.test(error.message) ? 504 : 502, "AniKoto relay: " + error.message);}
  }
  async function handle(request) {
    const controller = new AbortController(); let timer;
    const timeout = options.requestMs || 25000;
    try {
      return await Promise.race([
        operations.run({signal: controller.signal, deadline: Date.now() + timeout}, () => handleRequest(request)),
        new Promise(resolve => {timer = setTimeout(() => {controller.abort(); resolve(fail(504, "AniKoto request deadline exceeded"));}, timeout);})
      ]);
    } finally {clearTimeout(timer);}
  }
  function close() {closed = true; clearInterval(interval); for (const s of sessions.values()) s.closed = true; for (const c of controllers) c.abort(); transport.close(); sessions.clear(); cache.clear(); stats.cacheBytes = 0;}
  return {handle, close, expire, stats, session, rewrite, sessions, pending};
}
module.exports = {createRelay};
