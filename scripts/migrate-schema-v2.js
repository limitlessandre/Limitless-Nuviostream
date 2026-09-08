const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

async function main() {
  const { normalizeSnapshot, validateSnapshot } = await import(pathToFileURL(path.join(root, 'src', 'schema.mjs')).href);
  const target = path.join(root, 'data', 'seed.json');
  const source = JSON.parse(fs.readFileSync(target, 'utf8'));
  const migrated = normalizeSnapshot({ ...source, generatedAt: new Date().toISOString() });
  const validation = validateSnapshot(migrated);
  if (!validation.ok) throw new Error(`Schema v2 migration failed:\n- ${validation.errors.join('\n- ')}`);
  const staged = path.join(root, 'data', 'seed.v2.candidate.json');
  fs.writeFileSync(staged, JSON.stringify(migrated, null, 2) + '\n');
  fs.renameSync(staged, target);
  console.log(`Migrated ${migrated.titles.length} records to schema v${migrated.schemaVersion}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
