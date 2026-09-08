const { resolve } = require('../hentaitv/resolver');

async function main() {
  const title = process.argv[2] || 'Bible Black';
  const episode = Number(process.argv[3] || 1);
  const id = process.argv[4] || 'mal:368';
  const aliases = process.argv.slice(5);
  const started = Date.now();
  const result = await resolve({ id, type: 'series', title, aliases, episode });
  console.log(JSON.stringify({ elapsedMs: Date.now() - started, input: { id, title, episode, aliases }, result }, null, 2));
  if (!result.streams?.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
