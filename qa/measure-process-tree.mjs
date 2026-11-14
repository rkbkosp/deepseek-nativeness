import { execFileSync } from 'node:child_process';

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) argumentsByName.set(process.argv[index], process.argv[index + 1]);
const roots = (argumentsByName.get('--pids') ?? '').split(',').filter(Boolean).map(Number);
const samples = Number(argumentsByName.get('--samples') ?? 10);
const intervalMs = Number(argumentsByName.get('--interval-ms') ?? 1000);
if (!roots.length || roots.some(pid => !Number.isInteger(pid) || pid < 1) || !Number.isInteger(samples) || samples < 1 || samples > 120 || !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
  throw new Error('Usage: node qa/measure-process-tree.mjs --pids PID[,PID] [--samples 10] [--interval-ms 1000]');
}
console.log(JSON.stringify({ type: 'method', roots, samples, intervalMs, memory: 'RSS KiB summed across selected processes; shared pages may be counted multiple times. This is not physical footprint.', cpu: 'ps %CPU, a system-reported averaged observation, not a frame-time measurement.', webkit: 'WebKit processes may be reparented. Unattributed WebKit is listed separately and excluded; include verified responsible PIDs explicitly to obtain a complete application inventory.' }));
for (let sample = 0; sample < samples; sample++) {
  const raw = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,comm='], { encoding: 'utf8' });
  const processes = raw.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), cpuPercent: Number(match[3]), rssKiB: Number(match[4]), executable: match[5] }] : [];
  });
  const selected = new Set(roots);
  let previous;
  do {
    previous = selected.size;
    for (const entry of processes) if (selected.has(entry.parent)) selected.add(entry.pid);
  } while (selected.size !== previous);
  const owned = processes.filter(entry => selected.has(entry.pid));
  const unattributedWebKit = processes.filter(entry => !selected.has(entry.pid) && /WebKit\.(WebContent|Networking|GPU)/.test(entry.executable));
  console.log(JSON.stringify({ type: 'sample', at: new Date().toISOString(), processes: owned, aggregate: { cpuPercent: owned.reduce((sum, entry) => sum + entry.cpuPercent, 0), rssKiB: owned.reduce((sum, entry) => sum + entry.rssKiB, 0) }, unattributedWebKit }));
  if (sample + 1 < samples) await new Promise(resolve => setTimeout(resolve, intervalMs));
}
