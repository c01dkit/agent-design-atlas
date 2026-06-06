import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FW = path.join(ROOT, 'knowledge-base', 'frameworks');
const COMP = path.join(ROOT, 'knowledge-base', 'components');
const DATA = path.join(ROOT, 'site', 'src', 'data');
fs.mkdirSync(DATA, { recursive: true });

const COMPS = [
  ['reasoning-loop', '推理循环'], ['planning', '规划'], ['memory', '记忆'], ['tool-use', '工具调用'],
  ['model-abstraction', '模型抽象'], ['multi-agent-orchestration', '多智能体编排'], ['context-engineering', '上下文工程'],
  ['skills-plugins', '技能 / 插件'], ['observability-eval', '可观测 / 评估'], ['runtime-execution', '运行时'],
  ['human-in-the-loop-governance', '人在环 / 治理'], ['state-persistence', '状态 / 持久化'],
];
const clean = (s) => s.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a, b) => (b || a)).replace(/[`*]/g, '').replace(/\\\|/g, '|').trim();
const isNA = (s) => { const t = clean(String(s ?? '')); return !t || /^(n\/?a|none|无|暂无|没有|尚无|不适用|不涉及|—|-+|待确认|待补充)/i.test(t); };
const tableCell = (s) => clean(s).replace(/\|/g, '/').replace(/\s+/g, ' ');
const EXT = { py: 'python', pyi: 'python', ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', go: 'go', cs: 'csharp', rs: 'rust', java: 'java', rb: 'ruby', kt: 'kotlin', swift: 'swift', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash', sql: 'sql' };
const extLang = (p) => EXT[(p.split('.').pop() || '').toLowerCase()] || 'text';

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.turbo', 'coverage', '.astro', 'site-packages']);
const idxCache = {};
function buildIndex(id) {
  if (idxCache[id]) return idxCache[id];
  const base = path.join(ROOT, 'agents-example', id);
  const map = {}; const stack = [base]; let count = 0;
  while (stack.length && count < 80000) {
    const dir = stack.pop();
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === '.git' || IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else { count++; (map[e.name] ||= []).push(full); }
    }
  }
  idxCache[id] = map; return map;
}
function resolveFile(id, rel) {
  const direct = path.join(ROOT, 'agents-example', id, rel);
  if (fs.existsSync(direct)) return direct;
  const baseName = rel.split('/').pop();
  const idx = buildIndex(id);
  const cands = idx[baseName]; if (!cands || !cands.length) return null;
  const relN = rel.replace(/\\/g, '/');
  let best = cands.find((c) => c.replace(/\\/g, '/').endsWith('/' + relN));
  if (!best) { const last2 = relN.split('/').slice(-2).join('/'); best = cands.find((c) => c.replace(/\\/g, '/').endsWith('/' + last2)); }
  if (!best && cands.length === 1) best = cands[0];
  return best || null;
}
function extractCode(id, refsRaw) {
  const matches = [...refsRaw.matchAll(/([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+):(\d+)/g)];
  for (const mm of matches) {
    const rel = mm[1].replace(/^\.\//, ''); const ln = parseInt(mm[2], 10);
    const fp = resolveFile(id, rel); if (!fp) continue;
    let txt; try { txt = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    const lines = txt.split('\n'); if (ln < 1 || ln > lines.length) continue;
    const start = Math.max(0, ln - 4), end = Math.min(lines.length, ln + 9);
    let code = lines.slice(start, end).join('\n');
    if (code.length > 1500) code = code.slice(0, 1500) + '\n…';
    const shown = path.relative(path.join(ROOT, 'agents-example', id), fp).replace(/\\/g, '/');
    return { code, codeLang: extLang(rel), codeRef: shown + ':' + ln, codeStart: start + 1 };
  }
  return null;
}

const data = {}, gallery = {}, fws = [];
for (const f of fs.readdirSync(FW)) {
  if (!f.endsWith('.md') || f === '_index.md') continue;
  const id = f.replace(/\.md$/, '');
  const body = fs.readFileSync(path.join(FW, f), 'utf8');
  const fmEnd = body.indexOf('\n---', 3);
  const fm = fmEnd > 0 ? body.slice(0, fmEnd) : body.slice(0, 400);
  const title = ((fm.match(/title:\s*"?([^"\n]+?)"?\s*$/m) || [])[1] || id).trim();
  const langs = [...fm.matchAll(/lang\/([a-z0-9-]+)/g)].map((m) => m[1]);
  fws.push({ id, title });
  const sec = body.split(/^##\s+/m).find((s) => s.startsWith('组件实现'));
  if (!sec) continue;
  for (const line of sec.split('\n')) {
    const t = line.trim(); if (!t.startsWith('|') || t.includes('---')) continue;
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length < 3 || /组件/.test(cells[1])) continue;
    const m = cells[1].match(/\[\[([a-z0-9-]+)/i); if (!m || isNA(cells[2] || '')) continue;
    const slug = m[1], refsRaw = cells[3] || '';
    const refs = [...refsRaw.matchAll(/([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+:\d+)/g)].map((x) => x[1]).slice(0, 4);
    (data[slug] ||= []).push({ id, title, impl: tableCell(cells[2] || '') });
    (gallery[slug] ||= []).push({ id, title, lang: langs[0] || '', impl: clean(cells[2] || ''), refs, ...(extractCode(id, refsRaw) || {}) });
  }
}
for (const k of Object.keys(gallery)) gallery[k].sort((a, b) => a.title.localeCompare(b.title, 'en'));
fs.writeFileSync(path.join(DATA, 'impl.json'), JSON.stringify(gallery), 'utf8');

let report = [];
for (const [slug, label] of COMPS) {
  const list = (data[slug] || []).sort((a, b) => a.title.localeCompare(b.title, 'en'));
  const rows = list.map((x) => `| [[${x.id}\\|${x.title}]] | ${x.impl} |`).join('\n');
  const section = `## 各框架实现对比\n\n> 下表汇总 **${list.length}** 个实现了「${label}」的框架（源码级阅读结论）。网站上以可展开 + 源码节选呈现。\n\n| 框架 | 实现方式 |\n|------|----------|\n${rows}\n`;
  const p = path.join(COMP, slug + '.md');
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(/\n## 各框架实现对比[\s\S]*?(?=\n## |$)/, '\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n\n' + section;
  c = c.replace(/date_updated:\s*\S+/, 'date_updated: 2026-06-05');
  fs.writeFileSync(p, c, 'utf8');
  report.push(`${slug}:${list.length}(code ${(gallery[slug] || []).filter((x) => x.code).length})`);
}
console.log('components: ' + report.join(' | '));
