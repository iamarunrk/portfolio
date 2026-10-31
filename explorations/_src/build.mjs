// Assembles explorations/works.html from the shell + one fragment per concept.
// Usage: node explorations/_src/build.mjs [outFile]
//   A fragment is explorations/_src/concept-<id>.html containing its own <style>, <section class="concept"> and <script>.
//   Missing fragments are skipped. Open the result with ?only=<id> to see a single concept.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, '..', 'works.html');
const ORDER = ['board', 'stickers', 'tv', 'aisle'];

let html = readFileSync(join(here, 'shell.html'), 'utf8');
for (const id of ORDER) {
  const file = join(here, `concept-${id}.html`);
  const frag = existsSync(file) ? readFileSync(file, 'utf8') : `<!-- concept "${id}" not built yet -->`;
  html = html.replace(`<!--CONCEPT:${id}-->`, () => frag);
}
const outroFile = join(here, 'outro.html');
html = html.replace('<!--OUTRO-->', () => (existsSync(outroFile) ? readFileSync(outroFile, 'utf8') : ''));
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KiB)`);
