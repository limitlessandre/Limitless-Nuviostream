const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clean = (value) => String(value == null ? '' : value).trim();

function safeName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function main() {
  const importPath = process.argv[2];
  if (!importPath) throw new Error('Usage: node scripts/merge-provider-import.js <provider-import.json>');
  const resolvedImport = path.resolve(process.cwd(), importPath);
  const payload = JSON.parse(fs.readFileSync(resolvedImport, 'utf8'));
  const provider = safeName(payload.provider);
  if (!provider) throw new Error('Provider import is missing provider');
  if (!Array.isArray(payload.records)) throw new Error('Provider import records must be an array');

  const providerDir = path.join(root, 'data', 'imports', 'providers');
  fs.mkdirSync(providerDir, { recursive: true });
  const staged = path.join(providerDir, `${provider}.candidate.json`);
  const target = path.join(providerDir, `${provider}.json`);
  fs.writeFileSync(staged, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(staged, target);
  console.log(`Staged ${payload.records.length} ${provider} provider records at ${target}. Run npm run build:snapshot to merge them.`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
