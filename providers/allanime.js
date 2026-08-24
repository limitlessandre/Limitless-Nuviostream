"use strict";

const NAME = "AllAnime";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const REFERER = "https://mkissa.to";
const API = "https://api.mkissa.net";
const API_URL = API + "/api";
const BASE = "https://allanime.day";
const DISCOVERY_PATH = "/anime/attack-on-titan-Ycid9tDZd2FxGCJ8o/sub/1";
const CONTENT_LANE = "k7";
const REFERER_HOST = "mkissa.to";
const KEY_GROUP = "mkissa";
const BOOT_EPOCH_MS = 604800000;
const BOOT_GRACE_MS = 86400000;
const AA_REQ_MS = 300000;
const EPISODE_QUERY_HASH = "b0a4efecd8df8fce709468d54aaa716b712c93b5b7e351888ddc242898abc38e";
const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const MAL_MAP = "https://id-mapping-api-malid.hf.space/api/resolve";

const HEX_TABLE = {
  "79":"A","7a":"B","7b":"C","7c":"D","7d":"E","7e":"F","7f":"G","70":"H","71":"I","72":"J","73":"K","74":"L","75":"M","76":"N","77":"O","68":"P","69":"Q","6a":"R","6b":"S","6c":"T","6d":"U","6e":"V","6f":"W","60":"X","61":"Y","62":"Z",
  "59":"a","5a":"b","5b":"c","5c":"d","5d":"e","5e":"f","5f":"g","50":"h","51":"i","52":"j","53":"k","54":"l","55":"m","56":"n","57":"o","48":"p","49":"q","4a":"r","4b":"s","4c":"t","4d":"u","4e":"v","4f":"w","40":"x","41":"y","42":"z",
  "08":"0","09":"1","0a":"2","0b":"3","0c":"4","0d":"5","0e":"6","0f":"7","00":"8","01":"9","15":"-","16":".","67":"_","46":"~","02":":","17":"/","07":"?","1b":"#","63":"[","65":"]","78":"@","19":"!","1c":"$","1e":"&","10":"(","11":")","12":"*","13":"+","14":",","03":";","05":"=","1d":"%"
};

let cryptoConfigCache = null;
let bootstrapCache = null;
const sessionCookies = new Map();

function headers(extra) {
  return Object.assign({
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9"
  }, extra || {});
}

function storeCookies(response) {
  try {
    const raw = response && response.headers && response.headers.get ? response.headers.get("set-cookie") : null;
    if (!raw) return;
    for (const part of String(raw).split(/,(?=[^;,]+=)/)) {
      const pair = part.split(";")[0].trim();
      const i = pair.indexOf("=");
      if (i > 0) sessionCookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  } catch (_) {}
}

function cookieHeader() {
  return Array.from(sessionCookies.entries()).map(function (x) { return x[0] + "=" + x[1]; }).join("; ");
}

async function sessionFetch(url, options) {
  options = options || {};
  const h = Object.assign({}, options.headers || {});
  const cookie = cookieHeader();
  if (cookie && !h.Cookie) h.Cookie = cookie;
  const r = await fetch(url, Object.assign({}, options, { headers: h }));
  storeCookies(r);
  return r;
}

async function fetchText(url, extraHeaders) {
  const r = await sessionFetch(url, {
    headers: headers(Object.assign({ "Referer": REFERER + "/" }, extraHeaders || {}))
  });
  if (!r || !r.ok) throw new Error("Fetch " + (r ? r.status : "?") + ": " + url);
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

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function utf8(value) { return new TextEncoder().encode(String(value)); }
function fromUtf8(bytes) { return new TextDecoder("utf-8").decode(bytes); }

function concatBytes() {
  let total = 0;
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    const p = arguments[i] instanceof Uint8Array ? arguments[i] : new Uint8Array(arguments[i]);
    parts.push(p);
    total += p.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function bytesToBase64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(value) {
  const s = atob(String(value || ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function hexToBytes(hex) {
  const cleanHex = String(hex || "").replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(Math.floor(cleanHex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Bytes(value) {
  const data = value instanceof Uint8Array ? value : utf8(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function sha256Hex(value) { return bytesToHex(await sha256Bytes(value)); }

async function hmacBytes(keyBytes, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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

async function aesCbcDecryptHex(hex) {
  const keyBytes = utf8("kiemtienmua911ca");
  const iv = utf8("1234567890oiuytr");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, hexToBytes(hex));
  return fromUtf8(new Uint8Array(plain));
}

function resolveUrl(value, base) {
  value = String(value || "");
  base = String(base || REFERER + "/");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;
  const root = base.match(/^(https?:\/\/[^/]+)/i);
  if (value.startsWith("/")) return (root ? root[1] : REFERER) + value;
  const baseNoQuery = base.split(/[?#]/)[0];
  const dir = baseNoQuery.replace(/\/[^/]*$/, "/");
  const combined = dir + value;
  const m = combined.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!m) return combined;
  const stack = [];
  for (const part of (m[2] || "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop(); else stack.push(part);
  }
  return m[1] + "/" + stack.join("/");
}

function normalizeCryptoConfig(out) {
  if (!out || !out.buildId || !Array.isArray(out.maskParts) || out.maskParts.length < 4) return null;
  return { buildId: String(out.buildId), maskParts: out.maskParts.slice(0, 4).map(String) };
}

function evalOldCryptoChunk(chunk) {
  const cryptoStart = chunk.search(/const\s+[A-Za-z_$][\w$]*\s*=[^;]{0,180}\?"\d+":"",\s*[A-Za-z_$][\w$]*=\[/);
  if (cryptoStart < 0) return null;
  const tableMatches = Array.from(chunk.slice(0, cryptoStart).matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(\)\{const e=\[/g));
  const tableStart = tableMatches.length ? tableMatches[tableMatches.length - 1].index : -1;
  const asyncStart = chunk.indexOf("async function", cryptoStart);
  if (tableStart < 0 || asyncStart < 0) return null;
  let code = chunk.slice(tableStart, asyncStart);
  const buildMatch = code.match(/const\s+([A-Za-z_$][\w$]*)\s*=([^;]+?\?"(\d+)":"")\s*,\s*([A-Za-z_$][\w$]*)=\[/);
  if (!buildMatch) return null;
  const buildName = buildMatch[1];
  const maskName = buildMatch[4];
  code = code.replace(new RegExp("\\b[A-Za-z_$][\\w$]*\\(\\);\\s*const\\s+" + buildName + "="), "const " + buildName + "=");
  code = code.replace(new RegExp("const\\s+" + buildName + "="), "var " + buildName + "=");
  code = code.replace(new RegExp(",\\s*" + maskName + "=\\["), ";var " + maskName + "=[");
  code += "\nreturn { buildId: " + buildName + ", maskParts: " + maskName + " };";
  return normalizeCryptoConfig(Function(code)());
}

function evalModernCryptoChunk(chunk) {
  const cryptoStart = chunk.search(/const\s+[A-Za-z_$][\w$]*\s*=[^;]{0,220}\?"\d+":"",\s*[A-Za-z_$][\w$]*=\[/);
  if (cryptoStart < 0) return null;
  const wrappers = Array.from(chunk.slice(0, cryptoStart).matchAll(/const\s+[A-Za-z_$][\w$]*=\(function\(\)\{/g));
  const wrapperStart = wrappers.length ? wrappers[wrappers.length - 1].index : -1;
  const tables = wrapperStart >= 0 ? Array.from(chunk.slice(0, wrapperStart).matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(\)\{const\s+[A-Za-z_$][\w$]*=\[/g)) : [];
  const tableStart = tables.length ? tables[tables.length - 1].index : -1;
  const decoders = tableStart >= 0 ? Array.from(chunk.slice(0, tableStart).matchAll(/function\s+[A-Za-z_$][\w$]*\s*\([A-Za-z_$][\w$]*(?:,[A-Za-z_$][\w$]*)?\)\{return\s+[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*-\d+,[A-Za-z_$][\w$]*\(\)\[[A-Za-z_$][\w$]*\]\}/g)) : [];
  const decoderStart = decoders.length ? decoders[decoders.length - 1].index : -1;
  const asyncStart = chunk.indexOf("async function", cryptoStart);
  if (decoderStart < 0 || wrapperStart < 0 || asyncStart < 0) return null;
  const head = chunk.slice(decoderStart, wrapperStart);
  let body = chunk.slice(cryptoStart, asyncStart);
  const buildMatch = body.match(/const\s+([A-Za-z_$][\w$]*)=/);
  const maskMatch = body.match(/,([A-Za-z_$][\w$]*)=\[/);
  const maskFunction = body.match(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*=\s*([A-Za-z_$][\w$]*)\)/);
  if (!buildMatch || !maskMatch || !maskFunction) return null;
  const buildName = buildMatch[1];
  const maskName = maskMatch[1];
  const maskFunctionName = maskFunction[1];
  body = body.replace(new RegExp("const\\s+" + buildName + "="), "var " + buildName + "=");
  body = body.replace(new RegExp("," + maskName + "=\\["), ";var " + maskName + "=[");
  body += "\nreturn { buildId: " + buildName + ", maskParts: " + maskName + ", mask: Array.from(" + maskFunctionName + "(" + buildName + ") || []) };";
  return normalizeCryptoConfig(Function(head + body)());
}

function evalCryptoChunk(chunk) {
  try { const x = evalModernCryptoChunk(chunk); if (x) return x; } catch (_) {}
  try { return evalOldCryptoChunk(chunk); } catch (_) { return null; }
}

function buildMaskSeed(buildId) {
  const n = String(buildId || "");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (n.charCodeAt(i % n.length) || 0) ^ ((i * 17 + 31) & 255);
  return out;
}

function buildMask(buildId, maskParts) {
  const seed = buildMaskSeed(buildId);
  const out = new Uint8Array(32);
  for (let i = 0; i < maskParts.length; i++) {
    const part = base64ToBytes(maskParts[i]);
    const offset = i * 8;
    for (let j = 0; j < 8; j++) out[offset + j] = (part[j] ^ seed[offset + j]) ^ ((i * 41 + j * 7) & 255);
  }
  return out;
}

function currentEpochs(now) {
  now = now || Date.now();
  const epoch = Math.floor(now / BOOT_EPOCH_MS);
  const previousGrace = now - epoch * BOOT_EPOCH_MS < BOOT_GRACE_MS && epoch > 0 ? epoch - 1 : epoch;
  return previousGrace === epoch ? [epoch] : [previousGrace, epoch];
}

async function makeBootToken(config, epoch, lane) {
  lane = lane || CONTENT_LANE;
  const mask = buildMask(config.buildId, config.maskParts);
  const bootKey = await hmacBytes(mask, "aa-boot:" + config.buildId);
  const token = await hmacBytes(bootKey, config.buildId + ":" + KEY_GROUP + ":" + REFERER_HOST + ":" + epoch + ":" + lane);
  return bytesToHex(token);
}

async function validateCryptoConfig(config) {
  for (const epoch of currentEpochs()) {
    try {
      const token = await makeBootToken(config, epoch, CONTENT_LANE);
      const r = await sessionFetch(API + "/client-crypto/v1/bootstrap?buildId=" + encodeURIComponent(config.buildId) + "&k=" + encodeURIComponent(CONTENT_LANE), {
        headers: headers({
          "Referer": REFERER + "/",
          "Origin": REFERER,
          "x-build-id": config.buildId,
          "x-aa-boot": token
        })
      });
      if (r && r.ok) return true;
    } catch (_) {}
  }
  return false;
}

async function discoverCryptoConfig(force) {
  if (!force && cryptoConfigCache && Date.now() < cryptoConfigCache.expiresAt) return cryptoConfigCache;
  cryptoConfigCache = null;
  const html = await fetchText(REFERER + DISCOVERY_PATH, { "Accept": "text/html,*/*" });
  let appPath = (html.match(/import\("([^"]+\/_app\/immutable\/entry\/app\.[^"]+\.js)"\)/) || [])[1];
  if (!appPath) appPath = (html.match(/src="([^"]+\/_app\/immutable\/entry\/app\.[^"]+\.js)"/) || [])[1];
  if (!appPath) throw new Error("MKissa app entry not found");
  const appUrl = resolveUrl(appPath, REFERER + DISCOVERY_PATH);
  const queue = [appUrl];
  const seen = new Set();
  let scanned = 0;

  while (queue.length && scanned < 180) {
    const batch = [];
    while (queue.length && batch.length < 12) {
      const u = queue.shift();
      if (!seen.has(u)) { seen.add(u); batch.push(u); }
    }
    if (!batch.length) continue;
    const loaded = await Promise.all(batch.map(async function (u) {
      try { return { url: u, text: await fetchText(u, { "Accept": "application/javascript,*/*" }) }; }
      catch (_) { return null; }
    }));
    scanned += batch.length;
    for (const item of loaded.filter(Boolean)) {
      const imports = [];
      for (const m of item.text.matchAll(/(?:import\(|from\s*)["']([^"']+\.js)["']/g)) imports.push(m[1]);
      for (const m of item.text.matchAll(/"(\.\.\/(?:chunks|nodes)\/[^"\n]+\.js)"/g)) imports.push(m[1]);
      for (const value of imports) {
        if (!value || (!value.startsWith(".") && !value.startsWith("/"))) continue;
        const next = resolveUrl(value, item.url);
        if (!seen.has(next)) queue.push(next);
      }
      if (!/client-crypto|x-aa-boot|aaReq|partB/.test(item.text)) continue;
      const config = evalCryptoChunk(item.text);
      if (config && await validateCryptoConfig(config)) {
        cryptoConfigCache = Object.assign(config, { expiresAt: Date.now() + 30 * 60 * 1000 });
        console.log("[AllAnime] crypto config found after " + scanned + " assets");
        return cryptoConfigCache;
      }
    }
  }
  throw new Error("MKissa crypto config not found after " + scanned + " assets");
}

async function fetchBootstrap(force) {
  const config = await discoverCryptoConfig(force);
  if (!force && bootstrapCache && bootstrapCache.buildId === config.buildId && Date.now() < bootstrapCache.expiresAt) return bootstrapCache;
  for (const epoch of currentEpochs()) {
    const token = await makeBootToken(config, epoch, CONTENT_LANE);
    const r = await sessionFetch(API + "/client-crypto/v1/bootstrap?buildId=" + encodeURIComponent(config.buildId) + "&k=" + encodeURIComponent(CONTENT_LANE), {
      headers: headers({
        "Referer": REFERER + "/",
        "Origin": REFERER,
        "x-build-id": config.buildId,
        "x-aa-boot": token
      })
    });
    if (!r || !r.ok) continue;
    const d = await r.json();
    if (!d || !d.partB) continue;
    bootstrapCache = Object.assign({}, d, config, { expiresAt: Date.now() + 10 * 60 * 1000 });
    return bootstrapCache;
  }
  throw new Error("MKissa bootstrap failed");
}

function deriveLaneKey(partB, config) {
  const encrypted = base64ToBytes(partB);
  const mask = buildMask(config.buildId, config.maskParts);
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = encrypted[i] ^ mask[i % mask.length];
  return key;
}

async function getLaneKey(force) {
  const boot = await fetchBootstrap(force);
  return { key: deriveLaneKey(boot.partB, boot), epoch: boot.epoch, buildId: boot.buildId };
}

async function makeAaReq(key, epoch, buildId, queryHash) {
  const ts = Math.floor(Date.now() / AA_REQ_MS) * AA_REQ_MS;
  const payload = utf8(JSON.stringify({ v: 1, ts: ts, epoch: epoch, buildId: buildId, qh: queryHash, k: CONTENT_LANE }));
  const iv = (await sha256Bytes(epoch + ":" + buildId + ":" + queryHash + ":" + ts + ":" + CONTENT_LANE)).slice(0, 12);
  const body = await aesGcmEncrypt(key, iv, payload);
  return bytesToBase64(concatBytes(new Uint8Array([1]), iv, body));
}

async function decryptTobeparsed(b64, key) {
  const buf = base64ToBytes(b64);
  if (buf[0] !== 1) throw new Error("Unsupported MKissa crypto version " + buf[0]);
  const iv = buf.slice(1, 13);
  const body = buf.slice(13);
  const plain = await aesGcmDecrypt(key, iv, body);
  return JSON.parse(fromUtf8(plain));
}

async function apiPost(query, variables, options) {
  options = options || {};
  const config = options.buildId ? options : await discoverCryptoConfig(!!options.force);
  const body = { query: query, variables: variables };
  if (options.extensions) body.extensions = options.extensions;
  const r = await sessionFetch(API_URL, {
    method: "POST",
    headers: headers({
      "Referer": REFERER + "/",
      "Origin": REFERER,
      "Content-Type": "application/json",
      "x-build-id": config.buildId,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site"
    }),
    body: JSON.stringify(body)
  });
  const raw = await r.text();
  if (!r || !r.ok) {
    const err = new Error("AllAnime API POST " + (r ? r.status : "?"));
    err.rawBody = raw;
    throw err;
  }
  const d = JSON.parse(raw);
  const messages = d && d.errors ? d.errors.map(function (x) { return x.message || (x.extensions && x.extensions.code) || "GraphQL error"; }) : [];
  if (messages.length) {
    const err = new Error(messages.join(" · "));
    if (messages.indexOf("NEED_CAPTCHA") >= 0) err.code = "NEED_CAPTCHA";
    err.rawBody = raw;
    throw err;
  }
  return d && d.data;
}

const SEARCH_QUERY = "query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){edges{_id name englishName nativeName slugTime availableEpisodes availableEpisodesDetail aniListId __typename}}}";
const EPISODE_QUERY = "query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){episode(showId:$showId translationType:$translationType episodeString:$episodeString){episodeString sourceUrls}}";

async function apiEpisode(query, variables, options) {
  options = options || {};
  const force = !!options.force;
  const hashIndex = options.hashIndex || 0;
  const captchaRetry = options.captchaRetry || 0;
  const postFallback = !!options.postFallback;
  const dynamicHash = await sha256Hex(query);
  const hashes = EPISODE_QUERY_HASH === dynamicHash ? [EPISODE_QUERY_HASH] : [EPISODE_QUERY_HASH, dynamicHash];
  const hash = hashes[Math.min(hashIndex, hashes.length - 1)];
  const lane = await getLaneKey(force);
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: hash },
    k: CONTENT_LANE,
    aaReq: await makeAaReq(lane.key, lane.epoch, lane.buildId, hash)
  };
  const url = API_URL + "?variables=" + encodeURIComponent(JSON.stringify(variables)) + "&extensions=" + encodeURIComponent(JSON.stringify(extensions));
  const r = await sessionFetch(url, {
    headers: headers({
      "Referer": REFERER + "/",
      "Origin": REFERER,
      "x-build-id": lane.buildId,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site"
    })
  });
  const raw = await r.text();
  if (!r || !r.ok) {
    const err = new Error("AllAnime episode API " + (r ? r.status : "?"));
    err.rawBody = raw;
    throw err;
  }
  const d = JSON.parse(raw);
  const messages = d && d.errors ? d.errors.map(function (x) { return x.message || (x.extensions && x.extensions.code); }).filter(Boolean) : [];

  if (messages.indexOf("PersistedQueryNotFound") >= 0 || messages.some(function (m) { return /Context creation failed/i.test(m); })) {
    if (hashIndex + 1 < hashes.length) {
      return apiEpisode(query, variables, { force: false, hashIndex: hashIndex + 1, captchaRetry: captchaRetry, postFallback: postFallback });
    }
    const posted = await apiPost(query, variables, { buildId: lane.buildId, extensions: extensions });
    return posted && posted.tobeparsed ? decryptTobeparsed(posted.tobeparsed, lane.key) : posted;
  }

  if (messages.indexOf("NEED_CAPTCHA") >= 0) {
    if (!postFallback) {
      try {
        const postExtensions = {
          persistedQuery: { version: 1, sha256Hash: dynamicHash },
          k: CONTENT_LANE,
          aaReq: await makeAaReq(lane.key, lane.epoch, lane.buildId, dynamicHash)
        };
        const posted = await apiPost(query, variables, { buildId: lane.buildId, extensions: postExtensions });
        return posted && posted.tobeparsed ? decryptTobeparsed(posted.tobeparsed, lane.key) : posted;
      } catch (err) {
        if (err.code !== "NEED_CAPTCHA") throw err;
      }
    }
    if (captchaRetry < 2) {
      await sleep(1200 + captchaRetry * 1000);
      return apiEpisode(query, variables, { force: false, hashIndex: hashIndex, captchaRetry: captchaRetry + 1, postFallback: true });
    }
    const err = new Error("MKissa requested captcha");
    err.code = "NEED_CAPTCHA";
    err.rawBody = raw;
    throw err;
  }

  if (messages.some(function (m) { return /^AA_CRYPTO_/.test(m); })) {
    if (!force) {
      cryptoConfigCache = null;
      bootstrapCache = null;
      return apiEpisode(query, variables, { force: true, hashIndex: hashIndex, captchaRetry: captchaRetry, postFallback: postFallback });
    }
    throw new Error(messages.join(" · "));
  }

  if (d && d.data && d.data.tobeparsed) return decryptTobeparsed(d.data.tobeparsed, lane.key);
  if (messages.length) throw new Error(messages.join(" · "));
  return d && d.data;
}

async function searchAnime(query, mode) {
  const data = await apiPost(SEARCH_QUERY, {
    search: { allowAdult: false, allowUnknown: false, query: query },
    limit: 40,
    page: 1,
    translationType: mode,
    countryOrigin: "ALL"
  });
  return data && data.shows && Array.isArray(data.shows.edges) ? data.shows.edges : [];
}

async function getEpisode(showId, episode, mode) {
  const data = await apiEpisode(EPISODE_QUERY, { showId: showId, translationType: mode, episodeString: String(episode) }, {});
  return data && data.episode ? data.episode : null;
}

function clean(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, "").trim();
}

function uniq(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    if (!value) continue;
    const s = String(value).trim();
    const k = clean(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

async function tmdbId(id, type) {
  id = String(id || "").trim();
  if (/^\d+$/.test(id)) return +id;
  if (!/^tt\d+$/i.test(id)) return null;
  const d = await fetchJson("https://api.themoviedb.org/3/find/" + encodeURIComponent(id) + "?api_key=" + TMDB_KEY + "&external_source=imdb_id");
  const list = type === "movie" ? d && d.movie_results : d && d.tv_results;
  return list && list[0] && list[0].id ? +list[0].id : null;
}

async function tmdbInfo(id, type) {
  const d = await fetchJson("https://api.themoviedb.org/3/" + type + "/" + id + "?api_key=" + TMDB_KEY + "&append_to_response=external_ids");
  if (!d) return null;
  return {
    title: type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name),
    original: type === "movie" ? d.original_title : d.original_name,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null
  };
}

async function malMap(imdb, season, episode) {
  if (!imdb) return null;
  return fetchJson(MAL_MAP + "?id=" + encodeURIComponent(imdb) + "&s=" + encodeURIComponent(season) + "&e=" + encodeURIComponent(episode));
}

async function anilistByMal(mal) {
  if (!mal) return null;
  const query = "query($idMal:Int){Media(idMal:$idMal,type:ANIME){id idMal title{english romaji native} synonyms}}";
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
  const query = "query($id:Int){Media(id:$id,type:ANIME){id idMal title{english romaji native} synonyms}}";
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
    const names = [r.name, r.englishName, r.nativeName];
    if (names.some(function (x) { return keys.has(clean(x)); })) return r;
  }
  return null;
}

async function findShow(aliases, mode, targetAniList) {
  for (const alias of uniq(aliases).slice(0, 4)) {
    let results = [];
    try { results = await searchAnime(alias, mode); } catch (_) { results = []; }
    if (!results.length) continue;
    const exact = exactCandidate(results, targetAniList, aliases);
    if (exact) return exact;
  }
  return null;
}

function slugifyTitle(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function warmWatchPage(show, epNum, mode) {
  if (!show || !show._id) return;
  const slug = show.slugTime || slugifyTitle(show.englishName || show.name || show.nativeName);
  if (!slug) return;
  const page = REFERER + "/anime/" + slug + "-" + show._id + "/" + mode + "/" + epNum;
  try {
    await sessionFetch(page, {
      headers: headers({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": REFERER + "/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
      })
    });
  } catch (_) {}
}

function decodeHexUrl(hex) {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.substring(i, i + 2).toLowerCase();
    out += HEX_TABLE[pair] || pair;
  }
  return out.replace(/([^:])\/\//g, "$1/").replace("/clock", "/clock.json");
}

async function extractClock(url) {
  try {
    const clockUrl = url.replace("/clock?", "/clock.json?").replace(/\/clock$/, "/clock.json");
    const r = await fetch(clockUrl, {
      headers: headers({
        "Referer": BASE + "/player.html",
        "Accept": "*/*",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
      })
    });
    if (!r || !r.ok) return null;
    const d = await r.json();
    const links = d && Array.isArray(d.links) ? d.links : [];
    const best = links.find(function (x) { return x && x.hls && x.link; }) || links.find(function (x) { return x && x.link; });
    return best && best.link ? { url: best.link, headers: { "Referer": BASE + "/player.html", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractMp4Upload(id) {
  try {
    const r = await fetch("https://www.mp4upload.com/embed-" + id + ".html", { headers: headers({ "Referer": "https://mp4upload.com/" }) });
    if (!r || !r.ok) return null;
    const h = await r.text();
    const m = h.match(/player\.src\s*\(\s*\{[^}]*\bsrc\s*:\s*"([^"]+)"/) || h.match(/"file"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/) || h.match(/\bsrc\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/);
    return m && m[1] ? { url: m[1].replace(/\\/g, ""), headers: { "Referer": "https://mp4upload.com/", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractUns(url) {
  try {
    const p = new URL(url);
    const id = String(p.hash || "").replace(/^#/, "").split("&")[0];
    if (!id) return null;
    const base = p.protocol + "//" + p.host;
    const r = await fetch(base + "/api/v1/video?id=" + encodeURIComponent(id) + "&w=1280&h=720&r=", {
      headers: headers({ "Referer": base + "/#" + id, "Origin": base })
    });
    if (!r || !r.ok) return null;
    const hex = (await r.text()).trim();
    if (!hex || !/^[0-9a-f]+$/i.test(hex)) return null;
    const data = JSON.parse(await aesCbcDecryptHex(hex));
    const out = data && (data.source || data.cf);
    return out ? { url: out, headers: { "Referer": base + "/#" + id, "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractOk(id) {
  try {
    const r = await fetch("https://ok.ru/videoembed/" + id, { headers: headers({ "Referer": "https://ok.ru/" }) });
    if (!r || !r.ok) return null;
    const h = await r.text();
    const m = h.match(/ondemandHls\\&quot;:\\&quot;(https?:\/\/.*?)\\&quot;/);
    return m && m[1] ? { url: m[1].replace(/\\u0026/g, "&"), headers: { "Referer": "https://ok.ru/", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractStreamSB(id) {
  try {
    const baseHeaders = headers({ "Referer": REFERER + "/", "watchsb": "streamsb", "Accept": "application/json, text/plain, */*" });
    const r1 = await fetch("https://streamsb.net/api/v1/video?id=" + id, { headers: baseHeaders });
    if (!r1 || !r1.ok) return null;
    const sid = ((r1.headers.get("set-cookie") || "").match(/sid=([^;]+)/) || [])[1] || "";
    const h = await r1.text();
    const m = h.match(/window\.location\.replace\('([^']+)'\)/);
    if (!m) return null;
    const r2 = await fetch(m[1], { headers: Object.assign({}, baseHeaders, { "Cookie": "sid=" + sid, "Referer": "https://streamsb.net/e/" + id + ".html" }) });
    if (!r2 || !r2.ok) return null;
    const data = await r2.json();
    const out = data && ((data.stream_data && data.stream_data.file) || (data.data && data.data.file));
    return out ? { url: out, headers: { "Referer": "https://streamsb.net/", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractStreamlare(id) {
  try {
    const r = await fetch("https://streamlare.com/api/video/stream/get", {
      method: "POST",
      headers: headers({ "Content-Type": "application/json", "Referer": "https://streamlare.com/", "Origin": "https://streamlare.com", "Accept": "application/json, */*" }),
      body: JSON.stringify({ id: id })
    });
    if (!r || !r.ok) return null;
    const data = await r.json();
    const out = data && data.data && data.data.file;
    return out ? { url: out, headers: { "Referer": "https://streamlare.com/", "User-Agent": UA } } : null;
  } catch (_) { return null; }
}

async function extractSource(src) {
  if (!src || !src.sourceUrl) return null;
  let url = src.sourceUrl;
  if (url.startsWith("--")) url = decodeHexUrl(url.slice(2));
  if (url.startsWith("/apivtwo/clock")) url = BASE + url.replace("/clock", "/clock.json");
  if (url.startsWith("/")) url = BASE + url;
  if (/^https?:\/\/allanime\.day\/apivtwo\/clock(?:\.json)?/i.test(url)) url = url.replace("/clock?", "/clock.json?");

  if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url) || /fast4speed/i.test(url)) {
    return { url: url, headers: { "Referer": REFERER + "/", "User-Agent": UA }, sourceName: src.sourceName || "Direct" };
  }

  try {
    const p = new URL(url);
    const host = String(p.hostname || "").replace(/^www\./, "");
    let result = null;
    if (host === "allanime.day" && /\/apivtwo\/clock(?:\.json)?/i.test(p.pathname)) {
      result = await extractClock(url);
    } else if (src.type === "player") {
      result = { url: url, headers: { "Referer": REFERER + "/", "User-Agent": UA } };
    } else if (host === "mp4upload.com") {
      const m = url.match(/embed-([a-zA-Z0-9]+)\.html/i);
      if (m && m[1]) result = await extractMp4Upload(m[1]);
    } else if (/uns\.bio$/i.test(host)) {
      result = await extractUns(url);
    } else if (host === "ok.ru") {
      const m = url.match(/\/(?:videoembed\/)?(\d+)(?:[/?#]|$)/i);
      if (m && m[1]) result = await extractOk(m[1]);
    } else if (/streamsb\./i.test(host)) {
      const m = url.match(/\/(?:e\/|embed-)([a-zA-Z0-9]+)(?:\.html)?/i);
      if (m && m[1]) result = await extractStreamSB(m[1]);
    } else if (/streamlare\./i.test(host)) {
      const m = url.match(/\/e\/([a-zA-Z0-9]+)/i);
      if (m && m[1]) result = await extractStreamlare(m[1]);
    }
    if (result && result.url) {
      result.sourceName = src.sourceName || host || "Source";
      return result;
    }
  } catch (_) {}
  return null;
}

function qualityFrom(value) {
  const m = String(value || "").match(/\b(2160|1440|1080|720|480|360)p\b/i);
  return m ? m[1] + "p" : "1080p";
}

async function resolveEpisodeStreams(show, epNum, mode) {
  await warmWatchPage(show, epNum, mode);
  const episode = await getEpisode(show._id, epNum, mode);
  if (!episode || !Array.isArray(episode.sourceUrls)) return [];
  console.log("[AllAnime] " + mode.toUpperCase() + " raw sources=" + episode.sourceUrls.length);
  const extracted = await Promise.all(episode.sourceUrls.map(extractSource));
  const out = [];
  const seen = new Set();
  for (const item of extracted.filter(Boolean)) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    const q = qualityFrom(item.url + " " + item.sourceName);
    out.push({
      name: NAME + " [" + mode.toUpperCase() + "] • " + item.sourceName,
      title: (mode === "dub" ? "English DUB" : "Japanese SUB") + " • " + q,
      url: item.url,
      quality: q,
      provider: NAME,
      type: /\.m3u8(?:$|[?#])/i.test(item.url) ? "m3u8" : "mp4",
      headers: item.headers || { "Referer": REFERER + "/", "User-Agent": UA },
      language: mode === "dub" ? "English" : "Japanese"
    });
  }
  return out;
}

async function getStreams(inputId, type, season, episode) {
  try {
    type = String(type || "tv").toLowerCase() === "movie" ? "movie" : "tv";
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
      if (mapping && mapping.mal_episode != null) targetEp = parseFloat(mapping.mal_episode);
    }
    if (!media) media = await anilistById(await armAnilist(tid));

    const targetAniList = media && media.id ? +media.id : null;
    const aliases = uniq([
      media && media.title && media.title.english,
      media && media.title && media.title.romaji,
      mapping && mapping.anime_title,
      tmdb.title,
      tmdb.original,
      media && media.title && media.title.native,
      ...(media && Array.isArray(media.synonyms) ? media.synonyms : [])
    ]);
    if (!aliases.length) return [];

    console.log("[AllAnime] TMDB=" + tid + " AniList=" + (targetAniList || "none") + " episode=" + targetEp + " aliases=" + aliases.slice(0, 4).join(" | "));

    const matches = await Promise.all([
      findShow(aliases, "sub", targetAniList),
      findShow(aliases, "dub", targetAniList)
    ]);
    const subShow = matches[0];
    const dubShow = matches[1];
    console.log("[AllAnime] matches sub=" + (subShow ? subShow._id : "none") + " dub=" + (dubShow ? dubShow._id : "none"));

    const jobs = [];
    if (subShow) jobs.push(resolveEpisodeStreams(subShow, targetEp, "sub").catch(function (err) { console.log("[AllAnime] SUB " + err.message); return []; }));
    if (dubShow) jobs.push(resolveEpisodeStreams(dubShow, targetEp, "dub").catch(function (err) { console.log("[AllAnime] DUB " + err.message); return []; }));
    if (!jobs.length) return [];

    const groups = await Promise.all(jobs);
    const streams = groups.flat();
    streams.sort(function (a, b) { return Number(/\[DUB\]/.test(b.name)) - Number(/\[DUB\]/.test(a.name)); });
    console.log("[AllAnime] playable streams=" + streams.length);
    return streams;
  } catch (err) {
    console.log("[AllAnime] " + (err && err.message ? err.message : err));
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { name: NAME, getStreams: getStreams };
else globalThis.getStreams = getStreams;
