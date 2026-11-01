#!/usr/bin/env node
'use strict';
/*
 * Extracts the live data model out of the Kiwoom Equity Funding Monitor
 * dashboard (index.html) by actually running its embedded <script> blocks
 * in Node, with every browser-only API (document, window, d3, localStorage,
 * timers, ...) replaced by an auto-mocking stub that swallows calls instead
 * of throwing.
 *
 * This is the only extraction strategy that can't drift from the dashboard:
 * there is no second copy of GROUPS/FIX/MARGIN/etc. to keep in sync — the
 * MCP server always sees exactly what the browser would compute from the
 * same file.
 *
 * Usage: node extract_data.cjs [path/to/index.html]
 * Prints one JSON object on stdout.
 */

const fs = require('fs');
const path = require('path');

const DASHBOARD_PATH = process.argv[2] || path.join(__dirname, '..', 'index.html');

/* A Proxy that mocks any browser global: property access yields another
 * stub, calling it (function or constructor) yields another stub, and
 * assigning a property just stores the value. Never throws. */
function makeStub() {
  const target = function stub() {};
  const UNDEFINED_SYMBOLS = new Set([
    Symbol.match, Symbol.replace, Symbol.search, Symbol.split,
    Symbol.isConcatSpreadable, Symbol.hasInstance, Symbol.toStringTag,
    Symbol.unscopables, Symbol.species,
  ]);
  const handler = {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.iterator) return function* () {};
      if (UNDEFINED_SYMBOLS.has(prop)) return undefined;
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      if (prop === 'nodeType') return undefined;
      if (!(prop in t)) t[prop] = makeStub();
      return t[prop];
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
    apply() {
      return makeStub();
    },
    construct() {
      return makeStub();
    },
    has(t, prop) {
      if (typeof prop === 'symbol') return prop in t;
      return true;
    },
  };
  return new Proxy(target, handler);
}

const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) {
  console.error('No inline <script> blocks found in ' + DASHBOARD_PATH);
  process.exit(1);
}
const combined = scripts.join('\n');

/* Top-level data consts the dashboard defines before/alongside its render
 * calls. Keep this list in sync if index.html renames a top-level const —
 * check.py-style drift here would just mean a tool returns fewer fields,
 * not stale ones, since values always come from a live run. */
const EXPOSE = [
  'GROUPS', 'FIX', 'MARGIN', 'T', 'TX', 'TXM', 'FLAGGED', 'MKBD',
  'FIRM_M', 'BOOK_M', 'FIRM_H1', 'BOOK_H1',
  'MS_MONTHLY', 'MS_YEARS', 'MS_DAILY',
  'TOPBROKER_M', 'TOPSTK', 'SEG',
  'HEAVY_JUL', 'HEAVY_AUG', 'HEAVY_SEP', 'HEAVY_OCT', 'HEAVY_OFFICIAL_N', 'BIGTX',
  'CAT_LBL', 'ST_LBL',
];

const wrapped = `
'use strict';
const document = __makeStub();
const window = __makeStub();
window.document = document;
const localStorage = __makeStub();
const sessionStorage = __makeStub();
const navigator = __makeStub();
const performance = { now: () => Date.now() };
const d3 = __makeStub();
function MutationObserver() { return { observe(){}, disconnect(){} }; }
const requestAnimationFrame = () => 0;
const cancelAnimationFrame = () => {};
const setTimeout = () => 0;
const setInterval = () => 0;
const clearTimeout = () => {};
const clearInterval = () => {};
const fetch = () => Promise.resolve(__makeStub());
const alert = () => {};
const confirm = () => true;
const prompt = () => null;

${combined}

globalThis.__MCP_DATA__ = {};
${EXPOSE.map((name) => `try { globalThis.__MCP_DATA__[${JSON.stringify(name)}] = ${name}; } catch (e) {}`).join('\n')}
`;

global.__makeStub = makeStub;

try {
  // eslint-disable-next-line no-eval
  (0, eval)(wrapped);
} catch (e) {
  console.error('Extraction failed while running the dashboard script: ' + e.stack);
  process.exit(1);
}

process.stdout.write(JSON.stringify(globalThis.__MCP_DATA__));
