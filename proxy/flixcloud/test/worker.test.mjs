import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePathPayload,
  detectHeader,
  ensureToken,
  isAllowedFlixUrl,
  makeManifestPath,
  makeProxyUrl,
  manifestStats,
  parseMaskHex,
  rewriteManifest,
  xorPayload,
} from '../src/worker.js';

test('host allowlist only accepts flixcloud https', () => {
  assert.equal(isAllowedFlixUrl('https://flixcloud.cc/e/test?v=2'), true);
  assert.equal(isAllowedFlixUrl('https://fetch2.flixcloud.cc/a.ts?token=x'), true);
  assert.equal(isAllowedFlixUrl('http://flixcloud.cc/x'), false);
  assert.equal(isAllowedFlixUrl('https://evil.example/?u=flixcloud.cc'), false);
});

test('parses 16 byte mask', () => {
  const mask = parseMaskHex('9d2af147b38e5c70a619e43bd8620fc5');
  assert.equal(mask.length, 16);
  assert.deepEqual([...mask.slice(0, 4)], [157, 42, 241, 71]);
});

test('detects fake WebP and PNG headers', () => {
  const webp = new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50,0x47]);
  const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x47]);
  assert.equal(detectHeader(webp), 12);
  assert.equal(detectHeader(png), 8);
  assert.equal(detectHeader(new Uint8Array([0x47,0,0])), 0);
});

test('xor restores MPEG TS sync byte and payload', () => {
  const mask = parseMaskHex('9d2af147b38e5c70a619e43bd8620fc5');
  const plain = new Uint8Array(64);
  plain[0] = 0x47;
  for (let i = 1; i < plain.length; i++) plain[i] = i & 255;
  const encrypted = plain.slice();
  xorPayload(encrypted, mask);
  assert.notEqual(encrypted[0], 0x47);
  xorPayload(encrypted, mask);
  assert.deepEqual(encrypted, plain);
});

test('carries token from parent into child URL', () => {
  const child = ensureToken('https://fetch1.flixcloud.cc/video/0001.ts', 'https://fetch1.flixcloud.cc/master.m3u8?token=abc123');
  assert.equal(new URL(child).searchParams.get('token'), 'abc123');
});

test('rewrites child manifests with typed path proxy urls', () => {
  const src = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2500\nvideo.m3u8\n';
  const out = rewriteManifest(src, 'https://fetch1.flixcloud.cc/master.m3u8?token=tok', 'https://proxy.example', '9d2af147b38e5c70a619e43bd8620fc5');
  assert.match(out, /https:\/\/proxy\.example\/proxy\//);
  assert.match(out, /\/playlist\.m3u8/);
  assert.match(out, /token%3Dtok/);
  assert.match(out, /BANDWIDTH=2500000/);
});

test('manifest path remains decodable when a filename suffix follows payload', () => {
  const payload = { u: 'https://fetch1.flixcloud.cc/master.m3u8?token=t', w: 'abc+/=', m: '9d2af147b38e5c70a619e43bd8620fc5' };
  const url = makeManifestPath('https://proxy.example', payload);
  const pathname = new URL(url).pathname;
  assert.match(pathname, /\/master\.m3u8$/);
  assert.deepEqual(decodePathPayload(pathname, '/manifest/'), payload);
});

test('proxy resource suffix identifies manifest and segment resources', () => {
  const manifest = makeProxyUrl('https://proxy.example', 'https://fetch1.flixcloud.cc/video.m3u8?token=t', '9d2af147b38e5c70a619e43bd8620fc5');
  const segment = makeProxyUrl('https://proxy.example', 'https://fetch1.flixcloud.cc/chunk.webp?token=t', '9d2af147b38e5c70a619e43bd8620fc5');
  assert.match(manifest, /\/playlist\.m3u8$/);
  assert.match(segment, /\/segment\.ts$/);
});

test('manifest diagnostics identify a valid master playlist without leaking urls', () => {
  const src = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nvideo.m3u8\n';
  const out = rewriteManifest(src, 'https://fetch1.flixcloud.cc/master.m3u8?token=tok', 'https://proxy.example', '9d2af147b38e5c70a619e43bd8620fc5');
  const stats = manifestStats(src, out);
  assert.equal(stats.startsExtm3u, true);
  assert.equal(stats.variants, 1);
  assert.equal(stats.mediaTags, 1);
  assert.equal(stats.rewrittenProxyRefs, 2);
  assert.equal(JSON.stringify(stats).includes('tok'), false);
});
