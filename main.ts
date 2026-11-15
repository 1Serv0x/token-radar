// token-radar-01: one snapshot in, one ranked radar out.
//
// The program reads the sealed protocol snapshot, scores every pre-token protocol with the model in
// lib/model.ts, and writes four things to the output directory:
//
//   board.json     the ranked board the gate checks: ranks 1..n by implied value, every watchlist slug
//                  covered, and each row carrying the farm plan the judge reads
//   data.js        the same board and model, in the shape dashboard/app.js renders
//   dashboard/     the static page: the board, a filter, and a detail view per protocol
//   screenshots/   three views of that page, handed through unchanged
//   dossier.json   what the judge reads, built last from the four things above
//
// The page never reaches the network and the program never reads the clock, so two runs over the same
// snapshot write the same bytes and the gate's determinism check holds.
//
// Outside the grader's container, point it at a local copy:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** Where this program lives, so dashboard/ and screenshots/ are found beside it, not in the output. */
const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The gate's limits. The text cap shapes the dossier's bytes; the rest refuse a bad input outright. */
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
/** The gate's file-name rule for a screenshot or a dashboard file. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** The gate requires three views and accepts a fourth. */
const MIN_SCREENSHOTS = 3;

/** Read `--name value` or `--name=value` from the command line, else a fallback. */
function option(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

/** Stop with a message the operator can act on. */
function stop(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputPath = option('input', '/input');
const snapshotPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  stop(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>, or mount the sealed /input`, 2);
}
const outputDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);

// Refuse to write a board the gate would reject: a wrong board costs the whole entry, and the model's
// own validator runs the same rules the scorer does, so a failure here is a bug worth stopping for.
const problem = boardIssue(board, snapshot);
if (problem !== null) stop(`the model produced a board the gate refuses: ${problem}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copy the regular, non-hidden files of `from` into `to`, returning the names copied. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyFlat(join(REPO_ROOT, 'dashboard'), join(outputDir, 'dashboard'));
const shotNames = copyFlat(join(REPO_ROOT, 'screenshots'), join(outputDir, 'screenshots'));

if (shotNames.length < MIN_SCREENSHOTS) {
  stop(`screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in ${MIN_SCREENSHOTS}, the board, a detail view and a filtered view`);
}
for (const name of shotNames) {
  if (!SAFE_NAME.test(name)) stop(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}
for (const name of dashboardFiles) {
  if (!SAFE_NAME.test(name)) stop(`dashboard/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}
if (!dashboardFiles.includes('index.html')) stop('dashboard/ has no index.html');

// The dossier goes last and is built from what was just written, so the scorer's rebuild matches it.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_LIMITS,
    dashboard: DASHBOARD_LIMITS,
  }),
);

process.stdout.write(
  `token radar: scored ${board.length} pre-token protocols from ${snapshot.protocols.length} in the snapshot, ` +
    `covering all ${snapshot.watchlist.length} on the watchlist (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote board.json, data.js, ${dashboardFiles.length} dashboard files, ${shotNames.length} screenshots and dossier.json to ${outputDir}\n`,
);
