import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(directory, '../..');
const baseline = JSON.parse(readFileSync(resolve(directory, 'freeze-baseline.json'), 'utf8'));
const checks = [];
for (const repository of baseline.repositories) {
  const path = resolve(workspace, repository.path);
  const head = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['-C', path, 'status', '--porcelain=v1', '--untracked-files=normal'], { encoding: 'utf8' }).trim();
  checks.push({ kind: 'repository', path, pass: head === repository.head && status === '', headMatches: head === repository.head, clean: status === '' });
}
for (const file of baseline.files) {
  const hash = createHash('sha256').update(readFileSync(file.path)).digest('hex');
  checks.push({ kind: 'profile-file', path: file.path, pass: hash === file.sha256 });
}
const pass = checks.every(check => check.pass);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), pass, checks }, null, 2));
process.exitCode = pass ? 0 : 1;
