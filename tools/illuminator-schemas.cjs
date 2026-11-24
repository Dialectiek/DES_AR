/**
 * illuminator-schemas.cjs — plain JavaScript, runs in a browser or in Node 18+. No dependencies.
 * (.cjs because package.json sets "type": "module" and the Node entry point uses require.)
 *
 * Pulls the latest Illuminator model documentation straight from the built docs on the
 * `gh-pages` branch of github.com/illuminator-team/website (read-only HTTP, nothing is cloned)
 * and extracts, for every documented model (agents, components, controllers, data, ...):
 *   parameters, inputs, outputs, states  -> default values, types, descriptions
 * Navigation mirrors the docs site: references/models.html -> each category page -> each class.
 *
 * In this repo the output is kept as assets/illuminator-schemas.json (the app reads it, see
 * schema.js). Refresh it with:
 *   node tools/illuminator-schemas.cjs --fill-from-source --out assets/illuminator-schemas.json
 *
 * BROWSER: paste this whole file into the DevTools console on any page (or load it with a <script> tag).
 *   It runs immediately with the defaults, downloads illuminator-schemas.json and keeps the result in
 *   window.illuminatorSchemas.result. To run again with options:
 *     await illuminatorSchemas.runAndDownload({ fillFromSource: true, markdown: true })
 *     const data = await illuminatorSchemas.run({ ref: 'gh-pages' })   // just returns the object
 *   Set window.ILLUMINATOR_SCHEMAS_NO_AUTORUN = true before loading it to skip the automatic run.
 *
 * NODE:
 *   node tools/illuminator-schemas.cjs                       # JSON to stdout
 *   node tools/illuminator-schemas.cjs --out schemas.json    # JSON to a file
 *   node tools/illuminator-schemas.cjs --md schemas.md       # also a readable Markdown summary
 *   node tools/illuminator-schemas.cjs --ref <branch|sha>    # another branch or commit (default gh-pages)
 *   node tools/illuminator-schemas.cjs --fill-from-source [branch]
 *
 * Options: ref, fillFromSource, sourceRef, markdown
 *   fillFromSource: for the few models whose docs page omits the dict keys, read just those keys from the
 *   model's Python file in github.com/illuminator-team/Illuminator (raw HTTP, default branch main, no clone).
 * Optional (Node): set GITHUB_TOKEN to avoid the GitHub API's anonymous rate limit (used only to pin the commit).
 */
(function () {
'use strict';
const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
const OWNER = 'illuminator-team';
const REPO = 'website';
const FIELDS = ['parameters', 'inputs', 'outputs', 'states'];
const ENTRY = 'references/models.html';

let REF = 'gh-pages', SRC_REF = 'main';
const log = (...m) => console.error('[illuminator-schemas]', ...m);

/* ---------------- fetching ---------------- */
async function get(url, { json = false } = {}) {
  const headers = {};
  if (IS_NODE) headers['User-Agent'] = 'illuminator-schemas';
  if (json && IS_NODE && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return json ? res.json() : res.text();
    } catch (e) {
      if (attempt >= 3 || /HTTP 4\d\d/.test(e.message)) throw e;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

// Pin the branch to a commit so every page comes from the same build and the raw CDN cache can't serve stale files.
async function resolveCommit(ref) {
  if (/^[0-9a-f]{40}$/i.test(ref)) return { sha: ref, date: null, message: null };
  try {
    const c = await get(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${encodeURIComponent(ref)}`, { json: true });
    return { sha: c.sha, date: c.commit?.committer?.date ?? null, message: c.commit?.message ?? null };
  } catch (e) {
    log(`could not resolve ${ref} to a commit (${e.message}); reading the branch head directly`);
    return { sha: null, date: null, message: null };
  }
}

/* ---------------- tiny HTML helpers (Sphinx output is regular enough) ---------------- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});
// drop Sphinx's permalink anchors (they hold an icon glyph), then tags
const text = html => decode(html.replace(/<a class="headerlink"[\s\S]*?<\/a>/gi, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// Sphinx "smart quotes" turn ' into ‘ ’ in prose; undo that for code-like text
const plainQuotes = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

// return the html of the balanced <tag ...>...</tag> element starting at index `start`
function balanced(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}
// direct children <dl ...> blocks of an element's html (skips nested ones)
function childBlocks(html, tag) {
  const out = [], re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const blk = balanced(html, m.index, tag);
    out.push(blk);
    re.lastIndex = m.index + blk.length;
  }
  return out;
}

/* ---------------- Python literal parser (for the attribute values Sphinx prints) ---------------- */
function parsePy(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const fail = msg => { throw new Error(`${msg} at ${i} in ${src.slice(0, 120)}`); };
  function value() {
    ws();
    const c = src[i];
    if (c === '{') return seq('{', '}', true);
    if (c === '[') return seq('[', ']', false);
    if (c === '(') { const t = seq('(', ')', false); return t; }
    if (c === "'" || c === '"') return str();
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|True|False|None|-?inf|nan)/i.exec(src.slice(i));
    if (!m) fail('unexpected token');
    i += m[0].length;
    const t = m[0];
    if (t === 'True') return true;
    if (t === 'False') return false;
    if (t === 'None') return null;
    if (/inf|nan/i.test(t)) return t;     // JSON has no Infinity/NaN; keep as string
    return Number(t);
  }
  function str() {
    const q = src[i++]; let s = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { const n = src[i + 1]; s += { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' }[n] ?? n; i += 2; }
      else s += src[i++];
    }
    i++;
    return s;
  }
  function seq(open, close, isDict) {
    i++;
    const out = isDict ? {} : [];
    for (;;) {
      ws();
      if (src[i] === close) { i++; break; }
      if (isDict) {
        const k = value(); ws();
        if (src[i] !== ':') fail('expected :');
        i++;
        out[String(k)] = value();
      } else out.push(value());
      ws();
      if (src[i] === ',') i++;
      else if (src[i] !== close) fail(`expected , or ${close}`);
    }
    if (open === '(') out.__tuple = true;
    return out;
  }
  const v = value(); ws();
  if (i < src.length) fail('trailing characters');
  return v;
}

/* ---------------- parsing a class block ---------------- */
// Field list items look like: <strong>name</strong> (<em>type</em>) – description
function parseFieldItems(ddHtml) {
  const items = [];
  const lis = [...ddHtml.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(m => m[1]);
  const chunks = lis.length ? lis : [ddHtml];
  for (const chunk of chunks) {
    const nm = /<strong>([\s\S]*?)<\/strong>/i.exec(chunk);
    if (!nm) continue;
    const name = plainQuotes(text(nm[1]));
    if (!name || /^\(?none\)?$/i.test(name)) continue;
    const rest = chunk.slice(nm.index + nm[0].length);
    const ty = /^\s*\(([\s\S]*?)\)\s*(?:–|&#8211;|-)/.exec(rest);
    const type = ty ? plainQuotes(text(ty[1])) : '';
    const dsc = rest.split(/–|&#8211;/).slice(1).join('–');
    items.push({ name, type, description: plainQuotes(text(dsc)) });
  }
  return items;
}

function parseClass(blockHtml, id) {
  const dt = /<dt\b[^>]*>[\s\S]*?<\/dt>/i.exec(blockHtml);
  const ddStart = blockHtml.indexOf('<dd', dt.index + dt[0].length);
  const dd = balanced(blockHtml, ddStart, 'dd');
  const inner = dd.replace(/^<dd[^>]*>/i, '').replace(/<\/dd>$/i, '');

  // docstring = everything in the class body before the first member <dl class="py ...">
  const firstMember = inner.search(/<dl class="py /i);
  const doc = firstMember >= 0 ? inner.slice(0, firstMember) : inner;
  const summary = [...doc.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map(m => text(m[1]))
    .filter(Boolean)[0] ?? '';

  // docstring field lists: Parameters / Inputs / Outputs / States
  const docFields = {};
  for (const fl of [...doc.matchAll(/<dl class="field-list[^"]*">/gi)].map(m => balanced(doc, m.index, 'dl'))) {
    const parts = [...fl.matchAll(/<dt class="field-[^"]*">([\s\S]*?)<\/dt>\s*(<dd[\s\S]*?)(?=<dt class="field-|<\/dl>\s*$)/gi)];
    for (const [, head, body] of parts) {
      const key = text(head).replace(/:$/, '').trim().toLowerCase();
      if (FIELDS.includes(key)) docFields[key] = parseFieldItems(body);
    }
  }

  // members: attributes rendered as "name: Dict = {...}" (Sphinx prints the class-level value)
  const members = {};
  const memberRe = new RegExp(`<dt class="sig sig-object py" id="${id.replace(/\./g, '\\.')}\\.([A-Za-z_]\\w*)">([\\s\\S]*?)<\\/dt>`, 'g');
  const memberDesc = {};
  for (const m of inner.matchAll(memberRe)) {
    members[m[1]] = m[2];
    const after = inner.slice(m.index + m[0].length, m.index + m[0].length + 2000);
    const p = /^\s*<dd>\s*<p>([\s\S]*?)<\/p>/i.exec(after);
    if (p) memberDesc[m[1]] = plainQuotes(text(p[1]));
  }

  const notes = [];
  const out = { summary, keysFrom: 'docs' };
  const missingKeys = [];
  for (const f of FIELDS) {
    const docItems = docFields[f] ?? [];
    let values = null;
    if (members[f] != null) {
      const sig = plainQuotes(text(members[f]));
      const eq = sig.indexOf('=');
      if (eq < 0) { missingKeys.push(f); if (memberDesc[f]) out[f + 'Description'] = memberDesc[f]; }
      if (eq >= 0) {
        const raw = sig.slice(eq + 1).trim();
        try {
          values = parsePy(raw);
          if (Array.isArray(values) && values.__tuple && values.length === 1 && values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])) {
            notes.push(`${f}: defined as a 1-element tuple in code (trailing comma), unwrapped`);
            values = values[0];
          }
        } catch (e) {
          notes.push(`${f}: could not parse value ${raw.slice(0, 80)}`);
          values = { __raw: raw };
        }
      }
    }
    const entries = {};
    if (values && typeof values === 'object' && !Array.isArray(values) && !values.__raw) {
      for (const [k, v] of Object.entries(values)) {
        const d = docItems.find(x => x.name === k);
        entries[k] = { default: v, type: d?.type ?? '', description: d?.description ?? '' };
      }
    }
    for (const d of docItems) {
      if (!(d.name in entries)) {
        entries[d.name] = { default: null, type: d.type, description: d.description, documentedOnly: true };
        if (values) notes.push(`${f}: '${d.name}' is in the docstring but not in the code's ${f}`);
      }
    }
    out[f] = entries;
    if (values?.__raw) out[f + 'Raw'] = values.__raw;
  }
  if (missingKeys.length) {
    out.keysFrom = null;
    notes.push(`the docs page does not list the keys or defaults of ${missingKeys.join(', ')} (the docstring's Attributes section replaces them); run with --fill-from-source to read them from the code`);
  }
  if (!FIELDS.some(f => members[f] != null)) notes.push('no class-level parameters/inputs/outputs/states (built dynamically); schema taken from the docstring only');
  if (members.time_step_size != null) {
    const s = text(members.time_step_size); const eq = s.indexOf('=');
    if (eq >= 0) { try { out.time_step_size = parsePy(s.slice(eq + 1).trim()); } catch { /* ignore */ } }
  }
  out.notes = notes;
  return out;
}

/* ---------------- optional: fill missing keys from the model's Python source ---------------- */
// Reads `parameters = {...}` style class attributes (and their # comments) from a raw .py file.
function classDictsFromPython(py, className) {
  const start = py.search(new RegExp(`^class\\s+${className}\\b`, 'm'));
  if (start < 0) return null;
  const bodyStart = py.indexOf('\n', start) + 1;                 // class body ends at the next top-level line
  const next = py.slice(bodyStart).search(/^[^\s#]/m);
  const body = next < 0 ? py.slice(bodyStart) : py.slice(bodyStart, bodyStart + next);
  const found = {};
  for (const f of FIELDS) {
    const m = new RegExp(`^[ \\t]{4}${f}[ \\t]*(?::[^=\\n]+)?=[ \\t]*\\(?[ \\t]*([{])`, 'm').exec(body);   // one line, so docstring text can't match
    if (!m) continue;
    let i = m.index + m[0].length - 1, depth = 0, inStr = null, j = i;
    for (; j < body.length; j++) {
      const c = body[j];
      if (inStr) { if (c === '\\') j++; else if (c === inStr) inStr = null; continue; }
      if (c === '#') { while (j < body.length && body[j] !== '\n') j++; continue; }
      if (c === "'" || c === '"') inStr = c;
      else if ('({['.includes(c)) depth++;
      else if (')}]'.includes(c) && --depth === 0) break;
    }
    const literal = body.slice(i, j + 1);
    const comments = {};
    for (const line of literal.split('\n')) {
      const km = /['"]([^'"]+)['"]\s*:[^#\n]*#\s*(.*)$/.exec(line);
      if (km) comments[km[1]] = km[2].trim();
    }
    const stripped = literal.split('\n').map(l => l.replace(/#.*$/, '')).join('\n');
    try {
      let v = parsePy(stripped);
      if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === 'object') v = v[0];
      found[f] = { values: v, comments };
    } catch { /* leave it out */ }
  }
  return found;
}
async function fillFromSource(models) {
  for (const m of Object.values(models)) {
    if (m.keysFrom) continue;
    const modPath = m.path.split('.').slice(0, -1).join('/');
    const url = `https://raw.githubusercontent.com/${OWNER}/Illuminator/${SRC_REF}/src/${modPath}.py`;
    let py;
    try { py = await get(url); } catch (e) { m.notes.push(`--fill-from-source: could not read ${url} (${e.message})`); continue; }
    const dicts = classDictsFromPython(py, m.name);
    if (!dicts || !Object.keys(dicts).length) { m.notes.push(`--fill-from-source: no class dicts found in ${url}`); continue; }
    for (const [f, { values, comments }] of Object.entries(dicts)) {
      if (Object.keys(m[f]).length) continue;
      m[f] = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { default: v, type: '', description: comments[k] ?? '' }]));
    }
    m.keysFrom = `source:${SRC_REF}`;
    m.sourceUrl = url;
    m.notes = m.notes.filter(n => !n.startsWith('the docs page does not list'));
    m.notes.push(`keys and defaults read from the code (${OWNER}/Illuminator@${SRC_REF}) because the docs page omits them`);
  }
}

/* ---------------- crawl ---------------- */
async function run(options = {}) {
  REF = options.ref || 'gh-pages';
  SRC_REF = options.sourceRef || 'main';
  const commit = await resolveCommit(REF);
  const at = commit.sha ?? REF;
  const raw = p => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${at}/${p}`;
  log(`reading ${OWNER}/${REPO}@${at}`);

  // 1) entry page -> category pages (links in the toctree)
  const entryHtml = await get(raw(ENTRY));
  const base = ENTRY.replace(/[^/]+$/, '');
  const cats = [];
  const tocMatch = /<div class="toctree-wrapper[\s\S]*?<\/div>/i.exec(entryHtml);
  const toc = tocMatch ? tocMatch[0] : entryHtml;
  for (const m of toc.matchAll(/<li class="toctree-l1"><a class="reference internal" href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = new URL(m[1], `https://x/${base}`).pathname.slice(1);
    if (!cats.some(c => c.path === path)) cats.push({ path, title: text(m[2]) });
  }
  if (!cats.length) throw new Error(`no category links found in ${ENTRY}; has the docs layout changed?`);

  // 2) each category page -> classes
  const models = {};
  for (const cat of cats) {
    const html = await get(raw(cat.path));
    const category = cat.title.replace(/^Illuminator\s+/i, '').replace(/\s+Models?$/i, '') || cat.title;
    let n = 0;
    for (const m of html.matchAll(/<dl class="py class">\s*<dt class="sig sig-object py" id="([^"]+)"/gi)) {
      const id = m[1];
      const block = balanced(html, m.index, 'dl');
      const parsed = parseClass(block, id);
      const url = `https://${OWNER}.github.io/${REPO}/${cat.path}#${id}`;
      n++;
      if (models[id]) { models[id].categories.push(category); models[id].docs.push(url); continue; }
      models[id] = { name: id.split('.').pop(), path: id, categories: [category], docs: [url], ...parsed };
    }
    log(`${category}: ${n} model(s) from ${cat.path}`);
  }

  if (options.fillFromSource) await fillFromSource(models);

  const result = {
    source: { repo: `${OWNER}/${REPO}`, ref: REF, commit: commit.sha, committedAt: commit.date, deployMessage: commit.message?.trim() ?? null, entry: ENTRY },
    fetchedAt: new Date().toISOString(),
    count: Object.keys(models).length,
    models,
  };
  if (options.markdown) result.markdown = toMarkdown(result);
  log(`done: ${result.count} models`);
  return result;
}

/* ---------------- optional Markdown ---------------- */
function toMarkdown(r) {
  const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const fmt = v => v === null ? '`None`' : '`' + cell(JSON.stringify(v)) + '`';
  const L = [`# Illuminator model schemas`, '',
    `Source: \`${r.source.repo}@${r.source.commit ?? r.source.ref}\`${r.source.committedAt ? ` (built ${r.source.committedAt})` : ''}, fetched ${r.fetchedAt}. ${r.count} models.`, ''];
  const byCat = {};
  for (const m of Object.values(r.models)) for (const c of m.categories) (byCat[c] ??= []).push(m);
  for (const [cat, ms] of Object.entries(byCat)) {
    L.push(`## ${cat}`, '');
    for (const m of ms) {
      L.push(`### ${m.name}`, '', `\`${m.path}\` · [docs](${m.docs[0]})`, '');
      if (m.summary) L.push(m.summary, '');
      for (const f of FIELDS) {
        const e = Object.entries(m[f] ?? {});
        if (!e.length) { L.push(`**${f[0].toUpperCase() + f.slice(1)}:** none`, ''); continue; }
        L.push(`**${f[0].toUpperCase() + f.slice(1)}**`, '', '| Name | Default | Type | Description |', '|---|---|---|---|');
        for (const [k, v] of e) L.push(`| \`${cell(k)}\` | ${v.documentedOnly ? '—' : fmt(v.default)} | ${cell(v.type)} | ${cell(v.description)} |`);
        L.push('');
      }
      for (const n of m.notes) L.push(`> ⚠️ ${n}`);
      if (m.notes.length) L.push('');
    }
  }
  return L.join('\n');
}

/* ---------------- entry points ---------------- */
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

if (IS_NODE) {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
  if (args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node tools/illuminator-schemas.cjs [--out file.json] [--md file.md] [--ref gh-pages|<sha>] [--fill-from-source [branch]]');
  } else {
    const fs = require('fs');
    const out = opt('--out'), md = opt('--md');
    run({ ref: opt('--ref'), fillFromSource: args.includes('--fill-from-source'), sourceRef: opt('--fill-from-source'), markdown: !!md })
      .then(result => {
        const markdown = result.markdown; delete result.markdown;
        const json = JSON.stringify(result, null, 2);
        if (out) { fs.writeFileSync(out, json); log(`wrote ${out}`); } else process.stdout.write(json + '\n');
        if (md) { fs.writeFileSync(md, markdown); log(`wrote ${md}`); }
      })
      .catch(e => { log('failed:', e.message); process.exit(1); });
  }
} else {
  const api = {
    run,
    async runAndDownload(options = {}) {
      const result = await run(options);
      const markdown = result.markdown; delete result.markdown;
      api.result = result;
      download('illuminator-schemas.json', JSON.stringify(result, null, 2), 'application/json');
      if (markdown) download('illuminator-schemas.md', markdown, 'text/markdown');
      return result;
    },
    result: null,
  };
  window.illuminatorSchemas = api;
  if (!window.ILLUMINATOR_SCHEMAS_NO_AUTORUN) {
    api.runAndDownload().then(r => console.log('[illuminator-schemas] result in window.illuminatorSchemas.result', r))
      .catch(e => console.error('[illuminator-schemas] failed:', e));
  }
}
})();
