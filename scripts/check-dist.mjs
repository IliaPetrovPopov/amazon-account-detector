// Fails when the committed dist/ differs from a fresh build of the source.
// The repository ships dist/ so it loads as an unpacked extension without any tooling;
// `npm run verify` rebuilds it first, so any difference means the committed copy is stale.
import { execFileSync } from 'node:child_process';

const changes = execFileSync('git', ['status', '--porcelain', '--', 'dist'], { encoding: 'utf8' }).trim();
if (changes) {
  console.error(`dist/ does not match the source. Commit the fresh build:\n${changes}`);
  process.exit(1);
}
console.log('dist/ matches the source.');
