"use strict";
const https = require("node:https"), dns = require("node:dns"), net = require("node:net");
const {Readable} = require("node:stream");
const MEDIA = ["akirax.buzz", "anizara.store", "imgnex.top", "kryntal.top", "lostproject.club", "megaplay.buzz", "mikora.top", "norami.top", "shiora.site", "shiora.top", "tiktokcdn.com", "trycloud.pro", "watching.onl", "mewstream.buzz", "voltara.click", "kotocdn.site", "mewcdn.online"];
const EMBED = ["megaplay.buzz", "vidtube.site", "vidplay.site", "mewcdn.online", "vibeplayer.site", "mewstream.buzz", "voltara.click", "zaptrix.buzz"];
function allowed(value, embed = false) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      (embed ? EMBED : MEDIA).some(h => u.hostname === h || u.hostname.endsWith("." + h)) ? u : null;
  } catch (_) { return null; }
}
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0,168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18,19,51].includes(b) || a === 203 && b === 0 || a >= 224);
  }
  // Public IPv6 global unicast only; mapped/private/link-local addresses excluded.
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:db8|0:)/i.test(address);
}
function lookup(host, options, callback) {
  dns.lookup(host, {all: true}, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(x => !publicAddress(x.address))) return callback(new Error("private-address-denied"));
    const preferred = addresses.find(x => x.family === 4) || addresses[0];
    // Pin the socket to these validated DNS results, avoiding a second lookup.
    callback(null, options && options.all ? [preferred] : preferred.address, preferred.family);
  });
}
function candidates(value) {
  const u = allowed(value); if (!u) return [];
  if (/^s\d+\.shiora\.(site|top)$/.test(u.hostname)) u.hostname = u.hostname.replace(/shiora\.(site|top)$/, "akirax.buzz");
  const out = [u.href];
  if (u.hostname.endsWith(".imgnex.top") && u.pathname.startsWith("/anime/")) {
    for (const suffix of ["akirax.buzz", "mikora.top", "norami.top", "shiora.site", "shiora.top"]) {
      const alt = new URL(u); alt.hostname = "megap." + suffix; alt.pathname = alt.pathname.slice(6); out.push(alt.href);
    }
  }
  if (u.hostname.endsWith(".mikora.top")) for (const suffix of ["shiora.site", "akirax.buzz"]) { const alt = new URL(u); alt.hostname = alt.hostname.replace(/mikora.top$/, suffix); out.push(alt.href); }
  if (u.hostname.endsWith(".shiora.top")) { const alt = new URL(u); alt.hostname = alt.hostname.replace(/shiora.top$/, "shiora.site"); out.push(alt.href); }
  if (/^(cdn|ncdn)\.kryntal\.top$/.test(u.hostname)) for (const prefix of ["cdn", "ncdn"]) { const alt = new URL(u); alt.hostname = prefix + ".watching.onl"; out.push(alt.href); }
  return [...new Set(out)];
}
function createTransport() {
  const agent = new https.Agent({keepAlive: true, maxSockets: 8, maxFreeSockets: 4, lookup});
  const request = (url, {headers, signal}) => new Promise((resolve, reject) => {
    const req = https.get(url, {agent, headers, signal}, res => {
      const response = new Response(Readable.toWeb(res), {status: res.statusCode, headers: res.headers});
      resolve(response);
    });
    req.on("error", reject);
  });
  return {request, close: () => agent.destroy()};
}
function isTs(bytes, offset = 0) { return bytes.length >= offset + 377 && bytes[offset] === 71 && bytes[offset + 188] === 71 && bytes[offset + 376] === 71; }
function unwrap(bytes) {
  if (isTs(bytes)) return bytes;
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpeg) throw new Error("invalid-segment");
  const end = png ? [73,69,78,68,174,66,96,130] : [255,217];
  for (let i = png ? 8 : 2; i < Math.min(bytes.length - end.length, 1024 * 1024); i++) {
    if (!end.every((n,j) => bytes[i+j] === n)) continue;
    for (let offset = i + end.length; offset < Math.min(bytes.length - 376, i + end.length + 400); offset++) if (isTs(bytes, offset)) return bytes.subarray(offset);
  }
  throw new Error("invalid-image-wrapped-segment");
}
async function bytes(response, maximum) {
  if (Number(response.headers.get("content-length")) > maximum) { await response.body.cancel(); throw new Error("body-too-large"); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maximum) throw new Error("body-too-large"); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const result = new Uint8Array(size); let offset = 0; for (const part of chunks) {result.set(part, offset); offset += part.length;} return result;
}
async function peek(response) {
  const reader = response.body.getReader(), chunks = []; let length = 0;
  while (length < 512) {const p = await reader.read(); if (p.done) break; chunks.push(p.value); length += p.value.length;}
  const prefix = new Uint8Array(Math.min(length,512)); let at = 0;
  for (const chunk of chunks) {const part = chunk.subarray(0,prefix.length-at); prefix.set(part,at);at+=part.length;}
  const stream = new ReadableStream({
    async pull(c) {try {if(chunks.length) {c.enqueue(chunks.shift());return;}const p=await reader.read();if(p.done)c.close();else c.enqueue(p.value);}catch(e){c.error(e);}},
    cancel: () => reader.cancel()
  });
  return {prefix,response:new Response(stream,{status:response.status,headers:response.headers})};
}
module.exports = {allowed, publicAddress, candidates, createTransport, isTs, unwrap, bytes, peek};
