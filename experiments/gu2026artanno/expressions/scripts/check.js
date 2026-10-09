// Syntax-check every JS file (no build step in this project).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
});
['server', 'public', 'test', 'scripts'].forEach(walk);
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax ok: ${files.length} files`);
