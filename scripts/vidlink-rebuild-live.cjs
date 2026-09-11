#!/usr/bin/env node
"use strict";

// Live parity check only. A passing result is not confirmation of Nuvio playback.
// API bodies and signed media URLs remain in memory; only the allowlisted summary
// is printed or written. Node 18+ is required. No third-party dependencies.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const CONTROL_FILE = "custom/providers/vidlink-eclipsia-nexus-v3.js";
const REBUILD_FILE = "custom/providers/vidlink-standalone-rebuild-v1.js";
const SOURCE_URL = "https://codeberg.org/api/v1/repos/eclipsia/nuvio-plugin/raw/providers/haylox.js";
const EXPECTED_CONTROL_SHA256 = "666d0b6160cc42e1f0cebef621dc47262ee8d8695b96351ce75abde3a43a480f";
const REQUEST_TIMEOUT_MS = 20000;
const PROVIDER_TIMEOUT_MS = 120000;
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function parseArguments(args) {
  const options = { probe: false, output: null, help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--probe") options.probe = true;
    else if (args[i] === "--help" || args[i] === "-h") options.help = true;
    else if (args[i] === "--output" && args[i + 1] && !args[i + 1].startsWith("--")) {
      options.output = path.resolve(args[++i]);
    } else throw new Error("invalid-arguments");
  }
  return options;
}

// Stable serialization preserves every row field except the explicitly removed
// display name. It also avoids cross-VM object-prototype comparison differences.
function stable(value) {
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value !== "object") return [typeof value, value];
  if (Array.isArray(value)) return ["array", value.map(stable)];
  return ["object", Object.keys(value).sort().map(key => [key, stable(value[key])])];
}

const serialize = value => JSON.stringify(stable(value));

function normalizedRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "name")));
}

function requestIdentity(url, options) {
  const { headers, method, signal, ...otherOptions } = options;
  // The harness owns timeout signals; all other options participate in parity.
  return {
    url,
    method: String(method || "GET").toUpperCase(),
    headers: Array.from(new Headers(headers || {}).entries()).sort(([a], [b]) => a.localeCompare(b)),
    options: otherOptions
  };
}

function requestStage(url) {
  const parsed = new URL(url);
  if (parsed.hostname === "api.themoviedb.org") return "tmdb";
  if (parsed.hostname === "enc-dec.app" && parsed.pathname === "/api/enc-vidlink") return "encrypt";
  return "later";
}

function normalizedTrace(calls) {
  const comparable = calls.filter(call => call.identity.url !== SOURCE_URL);
  // TMDB and encryption are concurrent independent prerequisites. Ignore only
  // their relative order, preserving the position/order of every later request.
  const result = [];
  let pending = [];
  const flush = () => {
    pending.sort((a, b) => serialize(a).localeCompare(serialize(b)));
    result.push(...pending);
    pending = [];
  };
  for (const call of comparable) {
    const item = { identity: call.identity, status: call.status };
    if (requestStage(call.identity.url) !== "later") pending.push(item);
    else { flush(); result.push(item); }
  }
  flush();
  return result;
}

function label(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_. -]{1,64}$/.test(value) ? value : "<redacted>";
}

function apiSummary(url, body) {
  const parsed = new URL(url);
  if (parsed.hostname !== "vidlink.pro" || !/^\/api\/b\/(tv|movie)\//.test(parsed.pathname)) return null;
  const isTv = parsed.pathname.startsWith("/api/b/tv/");
  const summary = {
    pathTemplate: isTv ? "/api/b/tv/<encrypted-id>/<season>/<episode>" : "/api/b/movie/<encrypted-id>",
    qualityKeys: [], type: null, deliveryType: null, sourceId: null, playlistPresent: false
  };
  try {
    const data = JSON.parse(body.toString("utf8"));
    const stream = data && data.stream;
    summary.qualityKeys = stream && stream.qualities ? Object.keys(stream.qualities).map(label) : [];
    summary.type = label(stream && stream.type);
    summary.deliveryType = label(stream && stream.deliveryType);
    summary.sourceId = label(data && data.sourceId);
    summary.playlistPresent = Boolean(stream && stream.playlist);
  } catch { /* A non-JSON response is reflected by absent metadata and parity failures. */ }
  return summary;
}

function selectedSummary(row) {
  if (!row || typeof row.url !== "string") return null;
  try {
    const parsed = new URL(row.url);
    const match = parsed.pathname.match(/\.(mp4|m3u8|mpd|webm|mkv|ts)$/i);
    return {
      host: parsed.hostname,
      extension: match ? "." + match[1].toLowerCase() : null,
      urlSha256: sha256(row.url),
      quality: label(row.quality),
      type: label(row.type),
      classification: /\[UNK\]/.test(String(row.name || "")) ? "UNK" : "other"
    };
  } catch { return null; }
}

function validBaseline(rows) {
  return Array.isArray(rows) && rows.length === 1 && rows[0] &&
    rows[0].quality === "720p" && rows[0].type === "video" &&
    typeof rows[0].url === "string" && rows[0].url.startsWith("https://") &&
    /\[UNK\]/.test(String(rows[0].name || ""));
}

async function probeMedia(url) {
  const result = { status: null, contentType: null, contentRange: null, bytesRead: 0, mp4Ftyp: false };
  let reader;
  try {
    // Intentionally use only Range, with no API/provider playback headers.
    const response = await fetch(url, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    result.status = response.status;
    const type = response.headers.get("content-type");
    result.contentType = type && /^[a-zA-Z0-9.+/-]+(?:;\s*charset=[a-zA-Z0-9-]+)?$/.test(type) ? type : null;
    const range = response.headers.get("content-range");
    result.contentRange = range && /^bytes (?:(?:\d+-\d+)|\*)\/(?:\d+|\*)$/.test(range) ? range : null;
    if (response.body) {
      reader = response.body.getReader();
      const chunks = [];
      while (result.bytesRead < 1024) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const bytes = Buffer.from(chunk.value).subarray(0, 1024 - result.bytesRead);
        chunks.push(bytes);
        result.bytesRead += bytes.length;
      }
      const prefix = Buffer.concat(chunks);
      result.mp4Ftyp = prefix.length >= 8 && prefix.toString("ascii", 4, 8) === "ftyp";
    }
  } catch { result.error = "probe-failed-or-timed-out"; }
  finally {
    if (reader) {
      try { await reader.cancel(); } catch { /* The timeout may already have cancelled it. */ }
    }
  }
  result.interpretation = "HTTP byte probe only; Nuvio playback is not verified.";
  return result;
}

async function main(options) {
  const cache = new Map();
  let controlRuntimeSha256 = null;
  const summary = {
    timestamp: new Date().toISOString(),
    test: { title: "Kamen Rider Den-O", tmdbId: 259906, mediaType: "tv", season: 1, episode: 1 },
    fingerprint: { expectedControlSha256: EXPECTED_CONTROL_SHA256, controlRuntimeSha256: null, matchesExpected: false },
    control: null, rebuild: null, exactRowsExceptName: false, exactRequests: false,
    passed: false, failures: [],
    nuvioPlaybackVerified: false,
    interpretation: "Live provider/API parity only. Actual Nuvio Desktop playback still requires user confirmation."
  };

  async function runProvider(file, isControl) {
    const calls = [];
    const api = [];
    const context = vm.createContext({
      module: { exports: {} }, URL, URLSearchParams, Headers, Response,
      setTimeout, clearTimeout, AbortController, AbortSignal,
      console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
      fetch: async (input, options = {}) => {
        const url = String(input);
        const identity = requestIdentity(url, options);
        const record = { identity, status: "failed" };
        calls.push(record);
        const key = serialize(identity);
        if (!cache.has(key)) {
          // Memoize the promise before awaiting, so concurrent identical requests
          // also share the same expiring URL and API payload.
          cache.set(key, (async () => {
            const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            const body = Buffer.from(await response.arrayBuffer());
            return { status: response.status, headers: Array.from(response.headers.entries()), body };
          })());
        }
        const response = await cache.get(key);
        record.status = response.status;
        if (isControl && url === SOURCE_URL) controlRuntimeSha256 = sha256(response.body);
        const metadata = apiSummary(url, response.body);
        if (metadata) api.push(metadata);
        const body = [204, 205, 304].includes(response.status) ? null : response.body;
        return new Response(body, { status: response.status, headers: response.headers });
      }
    });
    let rows = [];
    let error = false;
    let timer;
    try {
      vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { timeout: 2000, filename: path.basename(file) });
      const result = await Promise.race([
        vm.runInContext("module.exports.getStreams(259906, 'tv', 1, 1)", context, { timeout: 2000 }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("provider-timeout")), PROVIDER_TIMEOUT_MS); })
      ]);
      if (Array.isArray(result)) rows = result;
      else error = true;
    } catch { error = true; }
    finally { clearTimeout(timer); }
    return { rows, calls, api, error };
  }

  const control = await runProvider(CONTROL_FILE, true);
  const rebuild = await runProvider(REBUILD_FILE, false);
  summary.fingerprint.controlRuntimeSha256 = controlRuntimeSha256;
  summary.fingerprint.matchesExpected = controlRuntimeSha256 === EXPECTED_CONTROL_SHA256;
  for (const [name, result] of [["control", control], ["rebuild", rebuild]]) {
    summary[name] = {
      rowCount: result.rows.length,
      requestCount: result.calls.filter(call => call.identity.url !== SOURCE_URL).length,
      api: result.api,
      selected: result.rows.length === 1 ? selectedSummary(result.rows[0]) : null,
      baselineMatches: validBaseline(result.rows)
    };
    if (result.error) summary.failures.push(name + "-execution-failed");
    if (result.calls.some(call => call.status === "failed")) summary.failures.push(name + "-network-request-failed");
    if (!validBaseline(result.rows)) summary.failures.push(name + "-expected-one-720p-video-UNK-row");
  }
  summary.exactRowsExceptName = serialize(normalizedRows(control.rows)) === serialize(normalizedRows(rebuild.rows));
  summary.exactRequests = serialize(normalizedTrace(control.calls)) === serialize(normalizedTrace(rebuild.calls));
  if (!summary.fingerprint.matchesExpected) summary.failures.push("control-source-unavailable-or-changed");
  if (!summary.exactRowsExceptName) summary.failures.push("row-parity-mismatch");
  if (!summary.exactRequests) summary.failures.push("request-parity-mismatch");
  if (rebuild.calls.some(call => /(^|\.)(codeberg\.org|eclipsia\.[a-z]+)$/.test(new URL(call.identity.url).hostname))) {
    summary.failures.push("rebuild-runtime-external-provider-dependency");
  }
  if (options.probe) {
    summary.probe = validBaseline(control.rows)
      ? await probeMedia(control.rows[0].url)
      : { skipped: "Control did not produce the expected baseline row.", interpretation: "Nuvio playback is not verified." };
  }
  summary.passed = summary.failures.length === 0;
  const output = JSON.stringify(summary, null, 2) + "\n";
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, output, "utf8");
  }
  process.stdout.write(output);
  if (!summary.passed) process.exitCode = 1;
}

(async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node scripts/vidlink-rebuild-live.cjs [--probe] [--output summary.json]\nChecks live Den-O S1E1 control/rebuild parity using shared in-memory responses.\n--probe reads at most the first 1024 media bytes with Range only.\nOnly a sanitized summary is printed/saved. Nuvio playback remains unverified.\n");
    return;
  }
  await main(options);
})().catch(() => {
  // Never expose network exception messages: they may contain signed URLs.
  process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), passed: false, failures: ["harness-failed-check-arguments-files-and-runtime"], nuvioPlaybackVerified: false }) + "\n");
  process.exitCode = 1;
});
