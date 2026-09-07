function normalize(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\b(the|animation|ova)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function rank(media, candidates) {
  const names = [media.title, ...media.aliases].map(normalize).filter(Boolean);
  return candidates.map((candidate) => ({ ...candidate, score: Math.max(...names.map((name) => similarity(name, normalize(candidate.title)))) })).filter((candidate) => candidate.score >= 0.55).sort((a, b) => b.score - a.score);
}
function similarity(a, b) { if (a === b) return 1; const left = new Set(a.split(' ')); const right = new Set(b.split(' ')); const shared = [...left].filter((word) => right.has(word)).length; return shared / Math.max(left.size, right.size, 1); }
module.exports = { normalize, rank };
