"use strict";

const NAME = "AllAnime";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const SITE = "https://mkissa.to";
const API = "https://api.mkissa.net";
const API_URL = API + "/api";
const PLAYER = "https://allanime.day";
const LANE = "k7";
const KEY_GROUP = "mkissa";
const SITE_HOST = "mkissa.to";
const BOOT_EPOCH_MS = 7 * 24 * 60 * 60 * 1000;
const BOOT_GRACE_MS = 24 * 60 * 60 * 1000;
const AA_WINDOW_MS = 5 * 60 * 1000;
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const MAL_MAP = "https://id-mapping-api-malid.hf.space/api/resolve";
const LEGACY_SECRET = "Xot36i3lK3";

const SEARCH_QUERY = `query(
  $search: SearchInput
  $limit: Int
  $page: Int
  $translationType: VaildTranslationTypeEnumType
  $countryOrigin: VaildCountryOriginEnumType
) {
  shows(
    search: $search
    limit: $limit
    page: $page
    translationType: $translationType
    countryOrigin: $countryOrigin
  ) {
    pageInfo { total }
    edges {
      _id
      name
      englishName
      nativeName
      slugTime
      availableEpisodes
      availableEpisodesDetail
      aniListId
    }
  }
}`;

const STREAM_QUERY = `query(
  $showId: String!
  $translationType: VaildTranslationTypeEnumType!
  $episodeString: String!
) {
  episode(
    showId: $showId
    translationType: $translationType
    episodeString: $episodeString
  ) {
    sourceUrls
    show {
      _id
    }
  }
}`;

let materialPromise = null;
const sessionCookies = new Map();

function baseHeaders(extra) {
  return Object.assign({
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9"
  }, extra || {});
}

function saveCookies(response) {
  try {
    const raw = response && response.headers && response.headers.get
      ? response.headers.get("set-cookie")
      : null;
    if (!raw) return;
    const chunks = String(raw).split(/,(?=[^;,]+=)/);
    for (const chunk of chunks) {
      const pair = chunk.split(";")[0].trim();
      const i = pair.indexOf("=");
      if (i > 0) sessionCookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  } catch (_) {}
}

function cookieHeader() {
  return Array.from(sessionCookies.entries())
    .map(function (p) { return p[0] + "=" + p[1]; })
    .join("; ");
}

async function sessionFetch(url, options) {
  options = options || {};
  const h = Object.assign({}, options.headers || {});
  const cookie = cookieHeader();
  if (cookie && !h.Cookie) h.Cookie = cookie;
  const r = await fetch(url, Object.assign({}, options, { headers: h }));
  saveCookies(r);
  return r;
}

async function fetchText(url, h) {
  const r = await sessionFetch(url, { headers: baseHeaders(h) });
  if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?") + " " + url);
  return r.text();
}

async function fetchJson(url, options) {
  try {
    const r = await fetch(url, options || {});
    if (!r || !r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

function utf8(s) { return new TextEncoder().encode(String(s)); }
function fromUtf8(b) { return new TextDecoder("utf-8").decode(b); }

function concatBytes() {
  let n = 0;
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    const p = arguments[i] instanceof Uint8Array ? arguments[i] : new Uint8Array(arguments[i]);
    parts.push(p); n += p.length;
  }
  const out = new Uint8Array(n);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function bytesToBase64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(value) {
  let s = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 255;
  return out;
}

async function sha256Bytes(value) {
  const data = value instanceof Uint8Array ? value : utf8(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
async function sha256Hex(value) { return bytesToHex(await sha256Bytes(value)); }

async function hmacBytes(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const data = value instanceof Uint8Array ? value : utf8(value);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function aesGcmEncrypt(keyBytes, iv, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, key, value));
}

async function aesGcmDecrypt(keyBytes, iv, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, key, value));
}

function xorHexSource(value) {
  value = String(value || "");
  let payload = value;
  let mask = null;
  if (value.startsWith("--")) { payload = value.slice(2); mask = 56; }
  else if (value.startsWith("#-")) { payload = value.slice(2); mask = 49; }
  else if (value.startsWith("##")) { payload = value.slice(2); mask = 48; }
  else if (value.startsWith("-#")) { payload = value.slice(2); mask = 59; }
  else if (value.startsWith("#")) { payload = value.slice(1); mask = 0; }

  if (!/^[0-9a-f]+$/i.test(payload) || payload.length % 2) return value;
  const bytes = [];
  for (let i = 0; i < payload.length; i += 2) bytes.push(parseInt(payload.slice(i, i + 2), 16));

  function decode(m) {
    let out = "";
    for (const b of bytes) out += String.fromCharCode((b ^ m) & 255);
    return out;
  }

  if (mask !== null) return decode(mask);
  for (const m of [56, 0, 48, 49, 59]) {
    const d = decode(m);
    if (d.indexOf("/clock") >= 0 || d.indexOf("http") >= 0) return d;
  }
  return value;
}

/* ---------------- MKissa bundle parser ---------------- */

const IDENT = "[$A-Za-z0-9_]+";
const CALL_SRC = IDENT + "\\(\\s*-?\\d+\\s*(?:,\\s*-?\\d+\\s*)?\\)";
const SEED_RE = /^[A-Za-z0-9+/]{11}=$/;
const BUILD_DIGITS_RE = /^\d{2,10}$/;

function foldMath(expression) {
  const terms = String(expression || "").replace(/\s/g, "").match(/[-+]*[^-+]+/g) || [];
  let total = 0;
  for (let term of terms) {
    let sign = 1;
    while (term[0] === "+" || term[0] === "-") {
      if (term[0] === "-") sign = -sign;
      term = term.slice(1);
    }
    if (!term) continue;
    let value = 1;
    const factors = term.split("*");
    for (const f of factors) {
      const n = parseInt(f, 10);
      if (!Number.isFinite(n)) return 0;
      value *= n;
    }
    total += sign * value;
  }
  return total;
}

function readStringArray(jsText, openIndex) {
  const items = [];
  let i = openIndex + 1;
  while (i < jsText.length) {
    const c = jsText[i];
    if (c === "]") return items;
    if (c === "," || c === " " || c === "\n" || c === "\r" || c === "\t") { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let s = "";
      i++;
      while (i < jsText.length && jsText[i] !== quote) {
        if (jsText[i] === "\\") {
          if (i + 1 >= jsText.length) return null;
          s += jsText[i + 1];
          i += 2;
        } else {
          s += jsText[i++];
        }
      }
      if (i >= jsText.length) return null;
      i++;
      items.push(s);
      continue;
    }
    return null;
  }
  return null;
}

function decoderMaps(jsText) {
  const tables = new Map();
  const tableRe = new RegExp("function\\s+(" + IDENT + ")\\(\\)\\s*\\{\\s*(?:const|let|var)\\s+" + IDENT + "\\s*=\\s*\\[", "g");
  let m;
  while ((m = tableRe.exec(jsText))) {
    const open = m.index + m[0].lastIndexOf("[");
    const arr = readStringArray(jsText, open);
    if (arr && arr.length) tables.set(m[1], arr);
  }

  const bases = new Map();
  const baseRe = new RegExp(
    "function\\s+(" + IDENT + ")\\((" + IDENT + ")(?:," + IDENT + ")*\\)\\{return\\s+\\2=\\2-\\(?([-\\d+*\\s]+?)\\)?,(" + IDENT + ")\\(\\)\\[\\2\\]\\}",
    "g"
  );
  while ((m = baseRe.exec(jsText))) {
    bases.set(m[1], { table: m[4], offset: foldMath(m[3]) });
  }

  const aliases = new Map();
  for (const k of bases.keys()) aliases.set(k, { base: k, argIndex: 0, delta: 0 });

  const aliasRe = new RegExp(
    "function\\s+(" + IDENT + ")\\((" + IDENT + "),(" + IDENT + ")\\)\\{return\\s+(" + IDENT + ")\\((" + IDENT + ")((?:[-+][\\d+*\\s-]+)?)\\)\\}",
    "g"
  );
  while ((m = aliasRe.exec(jsText))) {
    if (!bases.has(m[4])) continue;
    aliases.set(m[1], {
      base: m[4],
      argIndex: m[5] === m[2] ? 0 : 1,
      delta: m[6] ? foldMath(m[6]) : 0
    });
  }
  return { tables: tables, bases: bases, aliases: aliases };
}

function parseCall(call) {
  const re = new RegExp("^(" + IDENT + ")\\(\\s*(-?\\d+)\\s*(?:,\\s*(-?\\d+)\\s*)?\\)$");
  const m = re.exec(String(call || ""));
  if (!m) return null;
  return { name: m[1], args: [parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null] };
}

function resolveCall(call, rotation, maps) {
  const c = parseCall(call);
  if (!c) return null;
  const alias = maps.aliases.get(c.name);
  if (!alias) return null;
  const base = maps.bases.get(alias.base);
  if (!base) return null;
  const table = maps.tables.get(base.table);
  if (!table || !table.length) return null;
  const args = c.args.filter(function (x) { return x !== null; });
  const arg = args[alias.argIndex];
  if (!Number.isFinite(arg)) return null;
  const rawIndex = arg + alias.delta - base.offset + rotation;
  const idx = ((rawIndex % table.length) + table.length) % table.length;
  return table[idx];
}

function seedBodies(jsText) {
  const bodies = [];
  const arrayRe = /=\[([^\]]{20,900})\]/g;
  let m;
  while ((m = arrayRe.exec(jsText))) {
    const body = m[1];
    if ((body.match(/\+/g) || []).length < 4) continue;
    const calls = body.match(new RegExp(CALL_SRC, "g")) || [];
    if (calls.length === 8) bodies.push(calls);
  }
  return bodies;
}

function seedsAt(calls, rotation, maps) {
  if (!calls || calls.length !== 8) return null;
  const out = [];
  for (let i = 0; i < 8; i += 2) {
    const a = resolveCall(calls[i], rotation, maps);
    const b = resolveCall(calls[i + 1], rotation, maps);
    if (a === null || b === null) return null;
    const seed = a + b;
    if (!SEED_RE.test(seed)) return null;
    out.push(seed);
  }
  return out.length === 4 ? out : null;
}

function extractSeeds(jsText, maps, forcedRotation) {
  const groups = seedBodies(jsText);
  for (const calls of groups) {
    const first = parseCall(calls[0]);
    if (!first) continue;
    const alias = maps.aliases.get(first.name);
    const base = alias && maps.bases.get(alias.base);
    const table = base && maps.tables.get(base.table);
    if (!table || !table.length) continue;

    if (forcedRotation !== undefined && forcedRotation !== null) {
      const s = seedsAt(calls, forcedRotation, maps);
      if (s) return s;
      continue;
    }

    const matches = [];
    for (let rot = 0; rot < table.length; rot++) {
      const s = seedsAt(calls, rot, maps);
      if (s) matches.push({ rotation: rot, seeds: s });
    }
    if (matches.length === 1) return matches[0].seeds;
  }
  return null;
}

function extractBuildIdNew(jsText, maps) {
  const candidates = [];
  const defaultRe = new RegExp("function\\s+" + IDENT + "\\s*\\(\\s*" + IDENT + "\\s*=\\s*(" + IDENT + ")\\s*[,)]", "g");
  let m;
  let defaultVar = null;
  while ((m = defaultRe.exec(jsText))) {
    const varName = m[1];
    const assignRe = new RegExp("\\b" + varName.replace(/\\$/g, "\\$&") + "\\s*=\\s*(" + CALL_SRC + ")");
    if (assignRe.test(jsText)) { defaultVar = varName; break; }
  }
  if (defaultVar) {
    const esc = defaultVar.replace(/[$]/g, "\\$&");
    const r = new RegExp("\\b" + esc + "\\s*=\\s*(" + CALL_SRC + ")", "g");
    while ((m = r.exec(jsText))) candidates.push(m[1]);
  }

  const sfIndex = jsText.indexOf("sf=");
  if (sfIndex >= 0) {
    const win = jsText.slice(Math.max(0, sfIndex - 2500), sfIndex);
    const r = new RegExp("\\b" + IDENT + "\\s*=\\s*(" + CALL_SRC + ")\\s*(?:,|;|\\n)", "g");
    while ((m = r.exec(win))) candidates.push(m[1]);
  }

  if (!candidates.length) {
    const r = new RegExp("\\b" + IDENT + "\\s*=\\s*(" + CALL_SRC + ")", "g");
    while ((m = r.exec(jsText))) candidates.push(m[1]);
  }

  function tryCall(call) {
    const c = parseCall(call);
    if (!c) return null;
    const alias = maps.aliases.get(c.name);
    const base = alias && maps.bases.get(alias.base);
    const table = base && maps.tables.get(base.table);
    if (!table) return null;
    for (let rot = 0; rot < table.length; rot++) {
      const decoded = resolveCall(call, rot, maps);
      if (!decoded || !BUILD_DIGITS_RE.test(decoded)) continue;
      if (extractSeeds(jsText, maps, rot)) return decoded;
    }
    return null;
  }

  for (const call of candidates) {
    const id = tryCall(call);
    if (id) return id;
  }

  const allCalls = jsText.match(new RegExp(CALL_SRC, "g")) || [];
  for (const call of allCalls) {
    const id = tryCall(call);
    if (id && id.length >= 2 && id.length <= 8) return id;
  }
  return null;
}

function parseBundle(jsText) {
  const legacy = /!==\s*["']string["']\s*\?\s*["'](\d+)["']\s*:\s*["']["']/.exec(jsText);
  const maps = decoderMaps(jsText);
  if (legacy) {
    const seeds = extractSeeds(jsText, maps, null);
    if (seeds) return { buildId: legacy[1], seeds: seeds };
  }
  const buildId = extractBuildIdNew(jsText, maps);
  if (!buildId) return null;
  const seeds = extractSeeds(jsText, maps, null);
  return seeds ? { buildId: buildId, seeds: seeds } : null;
}

/* ---------------- current MKissa crypto ---------------- */

function maskCandidates(buildId, seeds) {
  const params = [
    { saltMul: 211, saltAdd: 222, fragMul: 200, fragAdd: 176 },
    { saltMul: 17, saltAdd: 31, fragMul: 41, fragAdd: 7 }
  ];
  const out = [];
  for (const p of params) {
    const stream = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      stream[i] = (buildId.charCodeAt(i % buildId.length) ^ ((i * p.saltMul + p.saltAdd) & 255)) & 255;
    }
    const mask = new Uint8Array(32);
    let ok = true;
    for (let index = 0; index < 4; index++) {
      let bytes;
      try { bytes = base64ToBytes(seeds[index]); } catch (_) { ok = false; break; }
      if (!bytes || bytes.length < 8) { ok = false; break; }
      const base = index * 8;
      for (let off = 0; off < 8; off++) {
        mask[base + off] = (bytes[off] ^ stream[base + off] ^ ((index * p.fragMul + off * p.fragAdd) & 255)) & 255;
      }
    }
    if (ok) out.push(mask);
  }
  return out;
}

function epochCandidates(now) {
  now = now || Date.now();
  const current = Math.floor(now / BOOT_EPOCH_MS);
  const inGrace = now - current * BOOT_EPOCH_MS < BOOT_GRACE_MS && current > 0;
  return inGrace ? [current - 1, current] : [current];
}
function skewedEpochCandidates(now) {
  now = now || Date.now();
  const current = Math.floor(now / BOOT_EPOCH_MS);
  const normal = new Set(epochCandidates(now));
  return [current + 1, current - 1].filter(function (x) { return x > 0 && !normal.has(x); });
}

async function bootTokenNew(mask, buildId, epoch) {
  const inner = await hmacBytes(mask, "kNk1YgwkSI:" + buildId);
  const msg = [String(epoch), KEY_GROUP, SITE_HOST, buildId, LANE].join(".");
  return bytesToHex(await hmacBytes(inner, msg));
}
async function bootTokenLegacy(mask, buildId, epoch) {
  const inner = await hmacBytes(mask, "aa-boot:" + buildId);
  const msg = buildId + ":" + KEY_GROUP + ":" + SITE_HOST + ":" + epoch + ":" + LANE;
  return bytesToHex(await hmacBytes(inner, msg));
}

async function bootstrap(build, masks, epochs) {
  const url = API + "/client-crypto/v1/bootstrap?buildId=" + encodeURIComponent(build.buildId) + "&k=" + encodeURIComponent(LANE);
  for (const mask of masks) {
    for (const epoch of epochs) {
      const tokens = [
        await bootTokenNew(mask, build.buildId, epoch),
        await bootTokenLegacy(mask, build.buildId, epoch)
      ];
      for (const token of tokens) {
        try {
          const r = await sessionFetch(url, {
            headers: baseHeaders({
              "x-build-id": build.buildId,
              "x-aa-boot": token,
              "Origin": SITE,
              "Referer": SITE + "/"
            })
          });
          if (!r || !r.ok) continue;
          const d = await r.json();
          if (!d || !d.partB) continue;
          if (d.k && d.k !== LANE) continue;
          const partB = base64ToBytes(d.partB);
          if (partB.length < 32) continue;
          const key = new Uint8Array(32);
          for (let i = 0; i < 32; i++) key[i] = partB[i] ^ mask[i % mask.length];
          return {
            key: key,
            epoch: d.epoch !== undefined ? d.epoch : epoch,
            buildId: build.buildId
          };
        } catch (_) {}
      }
    }
  }
  return null;
}

function resolveRelative(value, base) {
  try { return new URL(value, base).toString(); }
  catch (_) {
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return "https:" + value;
    if (value.startsWith("/")) return SITE + value;
    return SITE + "/" + value.replace(/^\.?\//, "");
  }
}

async function resolveBuild() {
  const pages = [SITE + "/", SITE + "/anime/attack-on-titan-Ycid9tDZd2FxGCJ8o/sub/1"];
  let html = null;
  let basePage = null;
  for (const page of pages) {
    try {
      html = await fetchText(page, { "Referer": SITE + "/", "Accept": "text/html,*/*" });
      if (html && /entry\/app\.[^"'()]+\.js/.test(html)) { basePage = page; break; }
    } catch (_) {}
  }
  if (!html || !basePage) throw new Error("MKissa app entry unavailable");

  let m = /import\("([^"]*\/entry\/app\.[^"]*\.js)"\)/.exec(html);
  if (!m) m = /src=["']([^"']*\/entry\/app\.[^"']*\.js)["']/.exec(html);
  if (!m) throw new Error("MKissa app entry not found");

  const appUrl = resolveRelative(m[1], basePage);
  const appJs = await fetchText(appUrl, { "Referer": SITE + "/", "Accept": "application/javascript,*/*" });

  const refs = [];
  const refRe = /["'](\.\.?\/[\w./-]+\.js)["']/g;
  while ((m = refRe.exec(appJs))) {
    if (refs.indexOf(m[1]) < 0) refs.push(m[1]);
  }
  refs.sort(function (a, b) { return Number(b.indexOf("/chunks/") >= 0) - Number(a.indexOf("/chunks/") >= 0); });

  const max = Math.min(refs.length, 48);
  for (let start = 0; start < max; start += 4) {
    const batch = refs.slice(start, Math.min(start + 4, max));
    const loaded = await Promise.all(batch.map(async function (ref) {
      const u = resolveRelative(ref, appUrl);
      try { return await fetchText(u, { "Referer": SITE + "/", "Accept": "application/javascript,*/*" }); }
      catch (_) { return null; }
    }));
    for (const body of loaded) {
      if (!body || body.indexOf("aaReq") < 0) continue;
      const parsed = parseBundle(body);
      if (parsed) return parsed;
    }
  }
  throw new Error("MKissa crypto bundle not found");
}

async function getMaterial(force) {
  if (force) materialPromise = null;
  if (!materialPromise) {
    materialPromise = (async function () {
      const build = await resolveBuild();
      const masks = maskCandidates(build.buildId, build.seeds);
      let material = await bootstrap(build, masks, epochCandidates());
      if (!material) material = await bootstrap(build, masks, skewedEpochCandidates());
      if (!material) throw new Error("MKissa bootstrap rejected current build");
      return material;
    })();
  }
  return materialPromise;
}

async function buildAaReq(material, qh) {
  const ts = Math.floor(Date.now() / AA_WINDOW_MS) * AA_WINDOW_MS;
  const payload = utf8(JSON.stringify({
    v: 1,
    ts: ts,
    epoch: material.epoch,
    buildId: material.buildId,
    qh: qh,
    k: LANE
  }));
  const iv = (await sha256Bytes(material.epoch + ":" + material.buildId + ":" + qh + ":" + ts + ":" + LANE)).slice(0, 12);
  const body = await aesGcmEncrypt(material.key, iv, payload);
  return bytesToBase64(concatBytes(new Uint8Array([1]), iv, body));
}

async function legacyKey(version) {
  return sha256Bytes(LEGACY_SECRET + ":v" + version);
}

async function decryptPayload(blob, material) {
  const raw = base64ToBytes(blob);
  if (raw.length < 29) throw new Error("MKissa encrypted payload too short");
  const version = raw[0];
  const iv = raw.slice(1, 13);
  const body = raw.slice(13);
  const keys = [material.key, await legacyKey(version)];
  for (const key of keys) {
    try {
      const plain = await aesGcmDecrypt(key, iv, body);
      return JSON.parse(fromUtf8(plain));
    } catch (_) {}
  }
  throw new Error("MKissa payload decrypt failed");
}

/* ---------------- GraphQL ---------------- */

async function graphQLPost(query, variables) {
  const r = await sessionFetch(API_URL, {
    method: "POST",
    headers: baseHeaders({
      "Content-Type": "application/json",
      "Origin": "https://youtu-chan.com",
      "Referer": "https://youtu-chan.com/"
    }),
    body: JSON.stringify({ query: query, variables: variables })
  });
  if (!r || !r.ok) throw new Error("MKissa GraphQL " + (r ? r.status : "?"));
  const d = await r.json();
  if (d && d.errors && d.errors.length) {
    throw new Error(d.errors.map(function (x) { return x.message || (x.extensions && x.extensions.code) || "GraphQL error"; }).join(" · "));
  }
  return d && d.data;
}

async function searchAnime(title, mode) {
  const data = await graphQLPost(SEARCH_QUERY, {
    search: { query: title, allowAdult: false, allowUnknown: false },
    limit: 26,
    page: 1,
    translationType: mode,
    countryOrigin: "ALL"
  });
  return data && data.shows && Array.isArray(data.shows.edges) ? data.shows.edges : [];
}

async function streamEpisode(showId, mode, episode, retry) {
  retry = retry || 0;
  const material = await getMaterial(retry > 0);
  const qh = await sha256Hex(STREAM_QUERY);
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: qh },
    k: LANE,
    aaReq: await buildAaReq(material, qh)
  };
  const params =
    "?query=" + encodeURIComponent(STREAM_QUERY) +
    "&variables=" + encodeURIComponent(JSON.stringify({
      showId: showId,
      translationType: mode,
      episodeString: String(episode)
    })) +
    "&extensions=" + encodeURIComponent(JSON.stringify(extensions));

  const r = await sessionFetch(API_URL + params, {
    headers: baseHeaders({
      "Origin": SITE,
      "Referer": SITE + "/",
      "x-build-id": material.buildId,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site"
    })
  });
  if (!r || !r.ok) throw new Error("MKissa stream API " + (r ? r.status : "?"));
  const rawText = await r.text();
  let d;
  try { d = JSON.parse(rawText); } catch (_) { throw new Error("MKissa stream response was not JSON"); }

  const errors = d && d.errors ? d.errors.map(function (x) {
    return x.message || (x.extensions && x.extensions.code) || "GraphQL error";
  }) : [];
  if (errors.length) {
    if (retry < 1 && errors.some(function (x) { return /^AA_CRYPTO/.test(x); })) {
      return streamEpisode(showId, mode, episode, retry + 1);
    }
    throw new Error(errors.join(" · "));
  }

  let data = d && d.data;
  if (data && data.tobeparsed) data = await decryptPayload(data.tobeparsed, material);
  if (data && data.data) data = data.data;
  return data && data.episode ? data.episode : null;
}

/* ---------------- mapping and matching ---------------- */

function clean(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, "");
}
function uniq(values) {
  const out = [], seen = new Set();
  for (const v of values || []) {
    if (!v) continue;
    const s = String(v).trim(), k = clean(s);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

async function tmdbId(inputId, type) {
  const id = String(inputId || "").trim();
  if (/^\d+$/.test(id)) return +id;
  if (!/^tt\d+$/i.test(id)) return null;
  const d = await fetchJson("https://api.themoviedb.org/3/find/" + encodeURIComponent(id) +
    "?api_key=" + TMDB_KEY + "&external_source=imdb_id");
  const list = type === "movie" ? d && d.movie_results : d && d.tv_results;
  return list && list[0] && list[0].id ? +list[0].id : null;
}

async function tmdbInfo(id, type) {
  const d = await fetchJson("https://api.themoviedb.org/3/" + type + "/" + id +
    "?api_key=" + TMDB_KEY + "&append_to_response=external_ids");
  if (!d) return null;
  return {
    title: type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name),
    original: type === "movie" ? d.original_title : d.original_name,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null
  };
}

async function malMap(imdb, season, episode) {
  if (!imdb) return null;
  return fetchJson(MAL_MAP + "?id=" + encodeURIComponent(imdb) +
    "&s=" + encodeURIComponent(season) + "&e=" + encodeURIComponent(episode));
}

async function anilistByMal(mal) {
  if (!mal) return null;
  const query = `query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native} synonyms}}`;
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: query, variables: { idMal: +mal } })
    });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d && d.data && d.data.Media;
  } catch (_) { return null; }
}

async function armAnilist(tmdb) {
  const d = await fetchJson("https://arm.haglund.dev/api/v2/themoviedb?id=" + encodeURIComponent(tmdb));
  return Array.isArray(d) && d[0] && d[0].anilist ? +d[0].anilist : null;
}

async function anilistById(id) {
  if (!id) return null;
  const query = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{english romaji native} synonyms}}`;
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: query, variables: { id: +id } })
    });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d && d.data && d.data.Media;
  } catch (_) { return null; }
}

function exactCandidate(results, targetAniList, aliases) {
  for (const r of results || []) {
    if (targetAniList && r.aniListId && String(r.aniListId) === String(targetAniList)) return r;
  }
  const keys = new Set(uniq(aliases).map(clean));
  for (const r of results || []) {
    if ([r.name, r.englishName, r.nativeName].some(function (x) { return keys.has(clean(x)); })) return r;
  }
  return null;
}

async function findShow(aliases, mode, targetAniList) {
  const tries = uniq(aliases).slice(0, 5);
  for (const alias of tries) {
    let results = [];
    try { results = await searchAnime(alias, mode); } catch (_) {}
    if (!results.length) continue;
    const exact = exactCandidate(results, targetAniList, aliases);
    if (exact) return exact;
  }
  return null;
}

/* ---------------- source extraction ---------------- */

async function warmWatchPage(show, ep, mode) {
  if (!show || !show._id) return;
  const slug = show.slugTime || clean(show.englishName || show.name || show.nativeName).replace(/\s+/g, "-");
  if (!slug) return;
  const url = SITE + "/anime/" + slug + "-" + show._id + "/" + mode + "/" + ep;
  try {
    await sessionFetch(url, {
      headers: baseHeaders({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Origin": SITE,
        "Referer": SITE + "/"
      })
    });
  } catch (_) {}
}

async function extractMp4Upload(url) {
  try {
    const r = await fetch(url, { headers: baseHeaders({ "Referer": "https://www.mp4upload.com/" }) });
    if (!r || !r.ok) return null;
    const h = await r.text();
    const m = /player\.src\s*\(\s*\{[^}]*\bsrc\s*:\s*"([^"]+)"/.exec(h) ||
              /"file"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/.exec(h) ||
              /\bsrc\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/.exec(h);
    return m && m[1] ? { url: m[1].replace(/\\/g, ""), headers: { "Referer": "https://www.mp4upload.com/", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractOk(url) {
  try {
    let id = null;
    const m = /\/(?:videoembed\/)?(\d+)(?:[/?#]|$)/.exec(url);
    if (m) id = m[1];
    if (!id) return null;
    const r = await fetch("https://ok.ru/videoembed/" + id, { headers: baseHeaders({ "Referer": "https://ok.ru/" }) });
    if (!r || !r.ok) return null;
    const h = await r.text();
    const x = /ondemandHls\\&quot;:\\&quot;(https?:\/\/.*?)\\&quot;/.exec(h);
    return x && x[1] ? { url: x[1].replace(/\\u0026/g, "&"), headers: { "Referer": "https://ok.ru/", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractClock(url) {
  try {
    let u = url;
    if (u.startsWith("/")) u = PLAYER + u;
    u = u.replace("/clock?", "/clock.json?").replace(/\/clock$/, "/clock.json");
    const r = await fetch(u, {
      headers: baseHeaders({ "Referer": PLAYER + "/player.html", "Origin": PLAYER })
    });
    if (!r || !r.ok) return [];
    const d = await r.json();
    const links = d && Array.isArray(d.links) ? d.links : [];
    return links.filter(function (x) { return x && x.link; }).map(function (x) {
      return {
        url: x.link,
        quality: x.resolutionStr || "1080p",
        subtitles: Array.isArray(x.subtitles) ? x.subtitles : [],
        headers: Object.assign({ "User-Agent": UA }, x.headers || { "Referer": PLAYER + "/player.html" })
      };
    });
  } catch (_) { return []; }
}

function normalizeSubs(list) {
  const out = [], seen = new Set();
  for (const s of list || []) {
    const url = s && (s.src || s.url);
    const lang = String(s && (s.lang || s.label || s.language) || "Unknown");
    if (!url) continue;
    const key = lang.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: url, language: lang, name: s.label || lang });
  }
  return out;
}

async function extractSource(src) {
  if (!src || !src.sourceUrl) return [];
  let url = xorHexSource(src.sourceUrl);
  if (url.startsWith("//")) url = "https:" + url;

  if (url.startsWith("/apivtwo/") || /allanime\.day\/apivtwo\/clock/.test(url)) {
    return extractClock(url);
  }

  if (src.type === "player" || /tools\.fast4speed\.rsvp/.test(url)) {
    return [{
      url: url,
      quality: "1080p",
      headers: { "Referer": PLAYER + "/", "User-Agent": UA },
      subtitles: []
    }];
  }

  if (/\.m3u8(?:$|[?#])|\.mp4(?:$|[?#])/.test(url)) {
    return [{
      url: url,
      quality: "1080p",
      headers: { "Referer": SITE + "/", "User-Agent": UA },
      subtitles: []
    }];
  }

  if (/mp4upload\.com/.test(url)) {
    const r = await extractMp4Upload(url);
    return r ? [Object.assign(r, { quality: "1080p", subtitles: [] })] : [];
  }
  if (/ok\.ru/.test(url)) {
    const r = await extractOk(url);
    return r ? [Object.assign(r, { quality: "1080p", subtitles: [] })] : [];
  }

  return [];
}

function qualityOf(v) {
  const m = String(v || "").match(/\b(2160|1440|1080|720|480|360|240)p\b/i);
  return m ? m[1] + "p" : "1080p";
}

async function resolveMode(show, mode, ep) {
  await warmWatchPage(show, ep, mode);
  const episode = await streamEpisode(show._id, mode, ep, 0);
  if (!episode || !Array.isArray(episode.sourceUrls)) return [];
  const groups = await Promise.all(episode.sourceUrls.map(extractSource));
  const out = [], seen = new Set();
  for (let i = 0; i < groups.length; i++) {
    const src = episode.sourceUrls[i] || {};
    for (const item of groups[i] || []) {
      if (!item || !item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      const q = qualityOf((item.quality || "") + " " + item.url);
      const subs = normalizeSubs(item.subtitles || []);
      out.push({
        name: NAME + " [" + mode.toUpperCase() + "] • " + (src.sourceName || "Source"),
        title: (mode === "dub" ? "English DUB" : "Japanese SUB") + " • " + q + (subs.length ? " • Soft Subs" : ""),
        url: item.url,
        quality: q,
        provider: NAME,
        type: /\.m3u8(?:$|[?#])/i.test(item.url) ? "m3u8" : "mp4",
        headers: item.headers || { "Referer": SITE + "/", "User-Agent": UA },
        language: mode === "dub" ? "English" : "Japanese",
        subtitles: subs
      });
    }
  }
  return out;
}

/* ---------------- entrypoint ---------------- */

async function getStreams(inputId, mediaType, season, episode) {
  try {
    const type = String(mediaType || "tv").toLowerCase() === "movie" ? "movie" : "tv";
    const s = type === "movie" ? 1 : (parseInt(season, 10) || 1);
    const e = type === "movie" ? 1 : (parseFloat(episode) || 1);
    const tid = await tmdbId(inputId, type);
    if (!tid) return [];
    const tmdb = await tmdbInfo(tid, type);
    if (!tmdb || !tmdb.title) return [];

    let mapping = null;
    let media = null;
    let targetEp = e;

    if (type === "tv") {
      mapping = await malMap(tmdb.imdb, s, e);
      if (mapping && mapping.mal_id) media = await anilistByMal(mapping.mal_id);
      if (mapping && mapping.mal_episode !== undefined && mapping.mal_episode !== null) targetEp = parseFloat(mapping.mal_episode);
    }
    if (!media) media = await anilistById(await armAnilist(tid));

    const targetAniList = media && media.id ? +media.id : null;
    const aliases = uniq([
      media && media.title && media.title.english,
      media && media.title && media.title.romaji,
      mapping && mapping.anime_title,
      tmdb.title,
      tmdb.original,
      media && media.title && media.title.native
    ].concat(media && Array.isArray(media.synonyms) ? media.synonyms : []));

    if (!aliases.length) return [];

    const matches = await Promise.all([
      findShow(aliases, "sub", targetAniList),
      findShow(aliases, "dub", targetAniList)
    ]);
    const jobs = [];
    if (matches[0]) jobs.push(resolveMode(matches[0], "sub", targetEp).catch(function () { return []; }));
    if (matches[1]) jobs.push(resolveMode(matches[1], "dub", targetEp).catch(function () { return []; }));
    if (!jobs.length) return [];

    const streams = (await Promise.all(jobs)).flat();
    streams.sort(function (a, b) {
      return Number(/\[DUB\]/.test(b.name)) - Number(/\[DUB\]/.test(a.name));
    });
    return streams;
  } catch (_) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { name: NAME, getStreams: getStreams };
} else {
  globalThis.getStreams = getStreams;
}
