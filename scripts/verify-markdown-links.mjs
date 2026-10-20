import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'dist', 'sources', '.tools']);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.name.toLowerCase().endsWith('.md')) files.push(full);
  }
  return files;
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

const failures = [];
const files = await markdownFiles(root);
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const links = source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g);
  for (const match of links) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|data:|#)/i.test(target)) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { decoded = target; }
    const resolved = path.resolve(path.dirname(file), decoded);
    if (!await exists(resolved)) failures.push(`${path.relative(root, file)} -> ${target}`);
  }
}

if (failures.length) {
  console.error(`Broken Markdown targets (${failures.length}):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} Markdown files: no broken local link or image targets.`);
}
