// Syntax-checks every JS file (the project has no build step).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); });
['server', 'public', 'test', 'scripts'].forEach(walk);
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax ok: ${files.length} files`);
