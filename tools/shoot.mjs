// Render the dashboard in headless Chrome and write the three screenshots the gate wants:
// the board, a protocol's detail view, and a filtered view. Each is 1440x900, the shape every
// make.fun entry ships, and each stays inside the gate's 512 KiB per-image cap.
//
// Usage, from the repository root:  node tools/shoot.mjs <output-dir>
// <output-dir> is the run's output directory (the one holding dashboard/ and data.js).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1440;
const HEIGHT = 900;

const outDir = resolve(process.argv[2] ?? 'out');
const dashboard = join(outDir, 'dashboard');
const shots = join(outDir, 'screenshots');
if (!existsSync(join(dashboard, 'index.html'))) {
  process.stderr.write(`shoot: no dashboard/index.html under ${outDir}\n`);
  process.exit(2);
}
mkdirSync(shots, { recursive: true });

// Chrome needs the page and its data beside each other; the dashboard already reaches data.js as
// ../data.js, so the served root is the output directory itself.
const page = `file://${join(dashboard, 'index.html')}`;
const profile = join(outDir, '.chrome-profile');

/** One screenshot of `page` with `hash` applied, at the gate's 1440x900. */
function shoot(name, hash) {
  const target = `${page}${hash}`;
  const file = join(shots, name);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--virtual-time-budget=4000',
    `--screenshot=${file}`,
    target,
  ], { stdio: 'ignore' });
  const bytes = statSync(file).size;
  if (bytes > 524_288) process.stderr.write(`shoot: warning: ${name} is ${bytes} bytes, past the 512 KiB gate cap\n`);
  return { name, bytes };
}

const made = [];
// 1. The board, as it opens.
made.push(shoot('1-board.png', ''));
// 2. A protocol's detail view: the top row, opened.
const data = readFileSync(join(outDir, 'data.js'), 'utf8');
const rows = JSON.parse(data.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, '')).rows;
const top = rows[0];
made.push(shoot('2-detail.png', `#p=${encodeURIComponent(top.slug)}`));
// 3. A filtered view: one category, so the filter is visibly doing work.
const category = top.category ?? 'Other';
made.push(shoot('3-filtered.png', `#category=${encodeURIComponent(category)}`));

rmSync(profile, { recursive: true, force: true });
for (const m of made) process.stdout.write(`shoot: ${m.name} ${m.bytes} bytes\n`);
