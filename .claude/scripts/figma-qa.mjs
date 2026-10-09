#!/usr/bin/env node

/**
 * figma-qa.mjs
 *
 * Site-wide Figma↔rendered QA orchestrator. Pairs with `inspect.mjs`.
 *
 * Reads a mapping JSON (schema below) that lists targets, each with:
 *   • figmaNode id (for cross-referencing back to the source design)
 *   • live URL + CSS selector
 *   • pre-extracted design intent (typography / box / layout / colour)
 *
 * For each target it shells out to `inspect.mjs` with the right subcommand
 * and viewports, parses the JSON output, diffs the rendered computed styles
 * against the design intent, and emits a markdown drift report.
 *
 * The Figma extraction itself is NOT done here — only Claude (via the
 * `mcp__claude_ai_Figma__*` tools) can talk to the Figma MCP. The slash
 * command `/figma-qa` does the extraction phase and produces the JSON this
 * script consumes.
 *
 * Lives in dotfiles as ~/.claude/scripts/figma-qa.mjs.
 * No npm deps. Requires Node 20+, Chrome/Chromium, and `inspect.mjs` in
 * the same directory.
 *
 * Usage
 *
 *   figma-qa.mjs --input <PATH> [options]
 *
 *   --input <PATH>            mapping JSON (required; see schema below)
 *   --base-url <URL>          override mapping.baseUrl
 *   --viewports m,t,d         override mapping.viewports (default: all three)
 *   --report <PATH>           write markdown report here (default: stdout)
 *   --json-report <PATH>      write the raw machine-readable report here
 *   --filter <substring>      only run targets whose id includes this substring
 *   --storefront-password <S> Shopify storefront password if site is gated
 *   --concurrency N           targets in parallel (default: 1 — sequential is safest)
 *   --visual-diff-out <DIR>   write Figma/reference-vs-theme pixelmatch PNGs under this directory
 *   --visual-threshold <N>    default pixelmatch threshold for visualChecks (default: 0.1)
 *   --visual-max-diff-pct <N> default pass/fail gate for visualChecks
 *
 * Mapping JSON schema
 *
 *   {
 *     "site": "Project name",
 *     "baseUrl": "https://au.k9felinenatural.com",
 *     "viewports": ["mobile", "tablet", "desktop"],
 *     "figmaFileKey": "1LYuTXPM9PYp197Yl1p9Ad",
 *     "foundations": {
 *       "boards": { "foundations": "1479:11316", "sections": "...", "components": "..." },
 *       "colors":     { "natural-white": "#FFFFFF", "olive-black": "#3D3939", ... },
 *       "typography": { "h2-desktop": { "fontFamily": "Noto Serif", "fontSize": 48, ... }, ... },
 *       "spacing":    { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32, ... },
 *       "breakpoints": { "mobile": 390, "tablet": 768, "desktop": 1280 }
 *     },
 *     "targets": [
 *       {
 *         "id": "hero-desktop-video",
 *         "label": "Homepage hero — desktop, video background",
 *         "figmaNode": "3707:18089",
 *         "url": "/",
 *         "viewports": ["desktop"],
 *         "checks": [
 *           {
 *             "id": "hero-heading",
 *             "selector": "h2.hero__title.rte",
 *             "subcommand": "typography",
 *             "intent": {
 *               "fontFamily": "Noto Serif",
 *               "fontSize": "48px",
 *               "fontWeight": "400",
 *               "lineHeight": 1.1,
 *               "letterSpacing": "0",
 *               "color": "#FFFFFF",
 *               "textAlign": "center"
 *             }
 *           }
 *         ]
 *       }
 *     ]
 *   }
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSPECT_PATH = path.join(__dirname, 'inspect.mjs');

function parseArgs(argv) {
  const a = {
    input: '',
    baseUrl: '',
    referenceBaseUrl: '',
    viewports: null,
    viewportSize: '',
    reportPath: '',
    jsonReportPath: '',
    filter: '',
    storefrontPassword: process.env.STOREFRONT_PASSWORD || '',
    concurrency: 1,
    stabilityPasses: 1,
    nearMatchThreshold: 15,
    skipConformance: false,
    validateOnly: false,
    baselinePath: '',
    junitPath: '',
    sarifPath: '',
    defaultTolerance: 0,
    failOn: '',
    printSchema: false,
    strictMapping: false,
    visualDiffOutDir: '',
    visualThreshold: 0.1,
    visualMaxDiffPct: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--input') a.input = value();
    else if (arg === '--base-url') a.baseUrl = value();
    else if (arg === '--reference-base-url') a.referenceBaseUrl = value();
    else if (arg === '--viewports') a.viewports = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--viewport-size') a.viewportSize = value();
    else if (arg === '--report') a.reportPath = value();
    else if (arg === '--json-report') a.jsonReportPath = value();
    else if (arg === '--filter') a.filter = value();
    else if (arg === '--storefront-password') a.storefrontPassword = value();
    else if (arg === '--concurrency') a.concurrency = Math.max(1, Number(value()));
    else if (arg === '--stability-passes') a.stabilityPasses = Math.max(1, Number(value()));
    else if (arg === '--near-match-threshold') a.nearMatchThreshold = Math.max(0, Number(value()));
    else if (arg === '--skip-conformance') a.skipConformance = true;
    else if (arg === '--validate') a.validateOnly = true;
    else if (arg === '--baseline') a.baselinePath = value();
    else if (arg === '--junit') a.junitPath = value();
    else if (arg === '--sarif') a.sarifPath = value();
    else if (arg === '--default-tolerance') a.defaultTolerance = Number(value());
    else if (arg === '--fail-on') a.failOn = value();
    else if (arg === '--print-schema') a.printSchema = true;
    else if (arg === '--strict-mapping') a.strictMapping = true;
    else if (arg === '--visual-diff-out') a.visualDiffOutDir = value();
    else if (arg === '--visual-threshold') a.visualThreshold = Number(value());
    else if (arg === '--visual-max-diff-pct') a.visualMaxDiffPct = Number(value());
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!a.input && !a.printSchema) throw new Error('--input <PATH> is required (or --print-schema)');
  if (a.viewportSize) {
    const size = /^([1-9]\d*)x([1-9]\d*)$/.exec(a.viewportSize);
    if (!size || size.slice(1).some((v) => !Number.isSafeInteger(Number(v)) || Number(v) > 16384)) {
      throw new Error('--viewport-size must be WIDTHxHEIGHT with dimensions from 1 to 16384');
    }
    if (a.viewports?.length !== 1 || !['mobile', 'tablet', 'desktop'].includes(a.viewports[0])) {
      throw new Error('--viewport-size requires exactly one explicit --viewports preset');
    }
  }
  if (a.failOn && !['drift', 'partial', 'any', 'none', ''].includes(a.failOn)) throw new Error('--fail-on must be drift|partial|any|none');
  if (!Number.isFinite(a.visualThreshold) || a.visualThreshold < 0 || a.visualThreshold > 1) throw new Error('--visual-threshold must be between 0 and 1');
  if (a.visualMaxDiffPct !== null && (!Number.isFinite(a.visualMaxDiffPct) || a.visualMaxDiffPct < 0)) throw new Error('--visual-max-diff-pct must be a non-negative number');
  return a;
}

function printHelp() {
  process.stdout.write(`figma-qa.mjs — site-wide Figma↔rendered QA orchestrator

Usage:
  figma-qa.mjs --input <PATH> [options]

Required:
  --input <PATH>                  mapping JSON (see file header for schema)

Output:
  --report <PATH>                 write markdown report
  --json-report <PATH>            write machine-readable JSON report

Run scoping:
  --base-url <URL>                override mapping.baseUrl
  --reference-base-url <URL>      compare a reference site against mapping.baseUrl
  --viewports m,t,d               override mapping.viewports
  --viewport-size WIDTHxHEIGHT    exact geometry; requires one explicit preset
                                  (e.g. --viewports desktop); retains preset DPR
  --filter <substring>            only run targets whose id includes this
  --concurrency N                 targets in parallel (default 1; max ~4)
  --stability-passes N            inspect.mjs --stability-passes per check
  --storefront-password STR       Shopify password gate
  --visual-diff-out <DIR>         write Figma/reference-vs-theme pixelmatch
                                  PNGs under this directory
  --visual-threshold <0..1>       pixelmatch threshold for visualChecks
                                  (default 0.1)
  --visual-max-diff-pct <N>       default pass/fail gate for visualChecks

Foundations:
  --near-match-threshold N        sRGB distance for near-match colour token
                                  annotation (default 15; lower = stricter)
  --skip-conformance              skip the site-level foundations conformance scan

CI / output formats:
  --junit <PATH>                  write JUnit XML report (one testcase per check)
  --sarif <PATH>                  write SARIF JSON for GitHub Code Scanning
  --baseline <PATH>               compare against a previous --json-report and
                                  surface new / fixed / persistent drift
  --default-tolerance <N>         absolute px tolerance for numeric drift
                                  (overridden by per-check "tolerance" map)

CI policies:
  --fail-on drift|partial|any|none  exit non-zero if any check matches the
                                    threshold (default: never fail). Useful for
                                    GitHub Actions / Buildkite.
  --strict-mapping                  fail validation when the mapping relies on
                                    inferred subcommands, inferred reference
                                    locators, inferred properties, or implicit
                                    target URLs/viewports.

Other:
  --validate                      validate the mapping JSON shape and exit
  --print-schema                  emit the mapping JSON schema to stdout
  --help, -h                      this help

Run /figma-qa from Claude Code for the assisted (Figma MCP extraction)
workflow. Invoke this script directly for re-runs against an existing
mapping.
`);
}

function loadMapping(filePath) {
  if (!existsSync(filePath)) throw new Error(`Mapping file not found: ${filePath}`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function runInspect(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INSPECT_PATH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      // Exit 1 with a report is a failed QA check; preserve its evidence and artifacts.
      if (code !== 0 && code !== 1) return reject(new Error(`inspect.mjs exited ${code}: ${stderr.split('\n').slice(0, 3).join(' | ')}`));
      try {
        const report = JSON.parse(stdout);
        if (!report || (!Array.isArray(report.targets) && !report.viewports)) throw new Error('missing inspector results');
        resolve(report);
      }
      catch (e) { reject(new Error(`inspect.mjs JSON parse failed: ${e.message}\n${stdout.slice(0, 200)}`)); }
    });
  });
}

function absoluteUrl(baseUrl, target) {
  if (!target.url) return baseUrl;
  if (target.url.startsWith('http')) return target.url;
  return new URL(target.url, baseUrl).toString();
}

function referenceUrl(baseUrl, target) {
  const raw = target.referenceUrl ?? target.url;
  const url = raw && typeof raw === 'object'
    ? (raw.default || raw.desktop || raw.tablet || raw.mobile || target.url)
    : raw;
  if (!url) return baseUrl;
  if (url.startsWith('http')) return url;
  return new URL(url, baseUrl).toString();
}

function inspectionError(result) {
  return result?.error || result?.initError || result?.initErrorA || result?.initErrorB;
}

function slugPart(value) {
  return String(value || 'item').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

function viewportValue(value, viewport) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[viewport] || value.default || '';
  return value || '';
}

function visualReferenceUrl(referenceBase, target, check, viewport) {
  const raw = viewportValue(check.referenceUrl, viewport)
    || viewportValue(target.referenceUrl, viewport)
    || target.url
    || '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!referenceBase) return '';
  return new URL(raw, referenceBase).toString();
}

function pushLocatorArgs(inspectArgs, prefix, selector, text) {
  if (selector) inspectArgs.push(prefix === 'a' ? '--a' : '--b', selector);
  else if (text) inspectArgs.push(prefix === 'a' ? '--a-text' : '--b-text', text);
}

async function runVisualCheck(target, check, args, viewports) {
  const targetUrl = absoluteUrl(args.baseUrl, target);
  const out = {
    id: check.id,
    selector: check.selector,
    aText: check.aText,
    referenceSelector: check.referenceSelector,
    referenceAText: check.referenceAText,
    viewports: {},
    summary: 'pass',
  };
  const threshold = check.threshold ?? args.visualThreshold;
  const maxDiffPct = check.maxDiffPct ?? args.visualMaxDiffPct;
  const referenceBase = args.referenceBaseUrl || '';
  for (const viewport of viewports) {
    const image = viewportValue(check.figmaScreenshot || target.figmaScreenshot, viewport);
    const referenceSiteUrl = image ? '' : visualReferenceUrl(referenceBase, target, check, viewport);
    if (!image && !referenceSiteUrl) {
      out.viewports[viewport] = { error: 'missing figmaScreenshot or referenceBaseUrl/referenceUrl for visual check' };
      out.summary = 'fail';
      continue;
    }
    const inspectArgs = [
      'diff',
      image ? '--image-a' : '--url-a', image || referenceSiteUrl,
      '--url-b', targetUrl,
      '--viewports', viewport,
      '--format', 'json',
      '--threshold', String(threshold),
      '--label', `${target.id || target.label || 'target'}:${check.id || check.selector || check.aText || 'visual'}:${viewport}`,
    ];
    if (args.viewportSize) inspectArgs.push('--viewport-size', args.viewportSize);
    if (maxDiffPct !== null && maxDiffPct !== undefined) inspectArgs.push('--max-diff-pct', String(maxDiffPct));
    if (image) {
      pushLocatorArgs(inspectArgs, 'a', check.selector, check.aText);
      if (check.scope) inspectArgs.push('--scope', check.scope);
      if (check.aIndex !== undefined) inspectArgs.push('--a-index', String(check.aIndex));
    } else {
      const referenceSelector = check.referenceSelector || check.selector;
      const referenceAText = check.referenceAText || check.aText;
      const referenceScope = check.referenceScope || check.scope || '';
      const referenceAIndex = check.referenceAIndex ?? check.aIndex;
      const targetScope = check.scope || '';
      const targetAIndex = check.aIndex;
      pushLocatorArgs(inspectArgs, 'a', referenceSelector, referenceAText);
      if (referenceScope) inspectArgs.push('--scope', referenceScope);
      if (referenceAIndex !== undefined) inspectArgs.push('--a-index', String(referenceAIndex));
      const differentTargetLocator =
        Boolean(check.referenceSelector || check.referenceAText || check.referenceScope || check.referenceAIndex !== undefined)
        && Boolean(check.selector || check.aText);
      if (differentTargetLocator) {
        pushLocatorArgs(inspectArgs, 'b', check.selector, check.aText);
        if (targetScope) inspectArgs.push('--scope-b', targetScope);
        if (targetAIndex !== undefined) inspectArgs.push('--b-index', String(targetAIndex));
      }
    }
    if (check.initScript) inspectArgs.push('--init-script', check.initScript);
    if (args.storefrontPassword) inspectArgs.push('--storefront-password', args.storefrontPassword);
    if (check.waitMs) inspectArgs.push('--wait-ms', String(check.waitMs));
    if (check.timeoutMs) inspectArgs.push('--timeout-ms', String(check.timeoutMs));
    if (check.fullPage) inspectArgs.push('--full-page');
    if (args.visualDiffOutDir) {
      const dir = path.join(
        args.visualDiffOutDir,
        slugPart(target.id || target.label || 'target'),
        slugPart(check.id || check.selector || check.aText || 'visual'),
      );
      inspectArgs.push('--out', dir);
    }
    try {
      const report = await runInspect(inspectArgs);
      const result = report.viewports?.[viewport] || { error: 'missing visual diff viewport result' };
      out.viewports[viewport] = {
        ...result,
        ...(inspectionError(result) ? { error: inspectionError(result) } : {}),
        sourceMode: image ? 'figma-screenshot' : 'reference-site',
        referenceUrl: image ? image : referenceSiteUrl,
        targetUrl,
      };
      if (inspectionError(result)) out.summary = 'fail';
      else if (result.pass === false) out.summary = 'fail';
      else if (result.pass === undefined && (result.mismatchPercent > 0 || result.dimensionMismatch) && out.summary === 'pass') out.summary = 'partial';
    } catch (e) {
      out.viewports[viewport] = {
        error: e.message,
        sourceMode: image ? 'figma-screenshot' : 'reference-site',
        referenceUrl: image ? image : referenceSiteUrl,
        targetUrl,
      };
      out.summary = 'fail';
    }
  }
  return out;
}

function batchCheckPayload(check, override = {}) {
  const source = { ...check, ...override };
  return {
    id: check.id,
    label: check.label,
    subcommand: source.subcommand || guessSubcommand(source),
    selector: source.selector,
    aText: source.aText,
    scope: source.scope,
    properties: source.properties,
    initScript: source.initScript,
    aIndex: source.aIndex,
    selectorB: source.selectorB,
    bText: source.bText,
    bIndex: source.bIndex,
    svgCanvasBounds: source.svgCanvasBounds,
    stabilityPasses: source.stabilityPasses,
  };
}

function referenceBatchCheckPayload(check) {
  return batchCheckPayload(check, {
    selector: check.referenceSelector || check.selector,
    aText: check.referenceAText || check.aText,
    scope: check.referenceScope || check.scope,
    selectorB: check.referenceSelectorB || check.selectorB,
    bText: check.referenceBText || check.bText,
  });
}

async function runChecksBatch(url, checks, args, viewports, mode = 'target') {
  const batchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'figma-qa-batch-'));
  const batchPath = path.join(batchDir, `${mode}-checks.json`);
  const payload = mode === 'reference'
    ? checks.map((check) => referenceBatchCheckPayload(check))
    : checks.map((check) => batchCheckPayload(check));
  await fs.writeFile(batchPath, JSON.stringify({ checks: payload }, null, 2));
  const inspectArgs = [
    'batch',
    '--url', url,
    '--viewports', viewports.join(','),
    '--format', 'json',
    '--batch-file', batchPath,
  ];
  if (args.viewportSize) inspectArgs.push('--viewport-size', args.viewportSize);
  if (args.storefrontPassword) inspectArgs.push('--storefront-password', args.storefrontPassword);
  if (args.stabilityPasses && args.stabilityPasses > 1) inspectArgs.push('--stability-passes', String(args.stabilityPasses));
  try {
    return await runInspect(inspectArgs);
  } finally {
    await fs.rm(batchDir, { recursive: true, force: true });
  }
}

function guessSubcommand(check) {
  // Pick a subcommand based on which intent fields are present.
  const intent = check.intent || {};
  const keys = new Set(Object.keys(intent));
  if (keys.has('display') || keys.has('flexDirection') || keys.has('gridTemplateColumns')) return 'layout';
  if (keys.has('marginTop') || keys.has('padding') || keys.has('borderTopWidth') || keys.has('boxSizing')) return 'box';
  if (keys.has('fontFamily') || keys.has('fontSize') || keys.has('fontWeight') || keys.has('lineHeight') || keys.has('color') || keys.has('textAlign')) return 'typography';
  return 'styles';
}

// ---------- Diff logic ----------

function normaliseColor(value) {
  if (!value || typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  // Convert "rgb(255, 255, 255)" → "#ffffff" for diffability vs design hex tokens.
  const rgb = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0'));
    const alpha = rgb[4] !== undefined ? Number(rgb[4]) : 1;
    return alpha < 1 ? `#${r}${g}${b}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : `#${r}${g}${b}`;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
  return v;
}

function normalisePx(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return `${value}px`;
  if (typeof value === 'string') {
    if (/^\d+(\.\d+)?$/.test(value)) return `${value}px`;
    return value.trim();
  }
  return String(value);
}

function normaliseFontFamily(value) {
  if (!value) return '';
  // Take the first family in the stack and strip quotes.
  return String(value).split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
}

function normaliseLineHeight(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toFixed(2);
  // Computed style returns line-height in px (e.g. "52.8px"). Convert to
  // unitless ratio when fontSize is known; otherwise leave as px.
  const v = String(value).trim();
  if (/px$/.test(v)) return v;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v).toFixed(2);
  return v;
}

function compareProperty(name, intent, rendered, tolerance = 0) {
  const N = {
    color: (v) => normaliseColor(v),
    fontFamily: (v) => normaliseFontFamily(v),
    fontSize: (v) => normalisePx(v),
    fontWeight: (v) => String(v).trim(),
    lineHeight: (v) => normaliseLineHeight(v),
    letterSpacing: (v) => normalisePx(v),
    textAlign: (v) => String(v).trim().toLowerCase(),
    textTransform: (v) => String(v).trim().toLowerCase(),
    textDecorationLine: (v) => String(v).trim().toLowerCase(),
    display: (v) => String(v).trim().toLowerCase(),
    backgroundColor: (v) => normaliseColor(v),
    vertical: normalisePx,
    horizontal: normalisePx,
    centreToCentreVertical: normalisePx,
    centreToCentreHorizontal: normalisePx,
  };
  const fn = COLOR_PROPERTIES.has(name) ? normaliseColor : N[name] || ((v) => String(v == null ? '' : v).trim());
  const a = fn(intent);
  const b = fn(rendered);
  if (a === b) return { equal: true, normalised: { intent: a, rendered: b } };
  // Numeric tolerance — if both values parse to numbers and the absolute
  // difference is within tolerance, accept as equal. Useful for line-height
  // and letter-spacing where 0.x px drift is rendering noise, not a bug.
  if (tolerance > 0) {
    const an = parseFloat(a);
    const bn = parseFloat(b);
    if (Number.isFinite(an) && Number.isFinite(bn) && Math.abs(an - bn) <= tolerance) {
      return { equal: true, normalised: { intent: a, rendered: b }, withinTolerance: Math.abs(an - bn) };
    }
  }
  return { equal: false, normalised: { intent: a, rendered: b } };
}

// Per-viewport intent picker. Allows the mapping to specify a single shared
// intent OR per-viewport overrides OR a mix. When per-viewport keys
// (mobile/tablet/desktop) are present, their fields override the shared
// fields for that viewport.
function pickIntentForViewport(intent, viewport) {
  const VIEWPORT_KEYS = new Set(['mobile', 'tablet', 'desktop']);
  const shared = {};
  for (const [k, v] of Object.entries(intent)) {
    if (!VIEWPORT_KEYS.has(k)) shared[k] = v;
  }
  const override = intent[viewport];
  if (override && typeof override === 'object') return { ...shared, ...override };
  return shared;
}

const REFERENCE_STYLE_PROPERTIES = {
  typography: [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
    'lineHeight', 'letterSpacing', 'wordSpacing',
    'textAlign', 'textTransform', 'textDecorationLine', 'textDecorationColor', 'textDecorationStyle',
    'textIndent', 'textOverflow', 'textShadow',
    'whiteSpace', 'overflowWrap', 'wordBreak',
    'color', 'verticalAlign',
    'fontFeatureSettings', 'fontVariationSettings', 'fontKerning', 'fontOpticalSizing',
  ],
  box: [
    'boxSizing',
    'width', 'height',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  ],
  layout: [
    'display', 'position',
    'width', 'height',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
    'gap', 'rowGap', 'columnGap',
    'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gridAutoFlow',
    'gridAutoColumns', 'gridAutoRows',
  ],
};

function propertiesForReference(check) {
  if (check.properties) {
    return String(check.properties).split(',').map((p) => p.trim()).filter(Boolean);
  }
  const subcommand = check.subcommand || guessSubcommand(check);
  if (subcommand === 'distance') return ['vertical', 'horizontal', 'centreToCentreVertical', 'centreToCentreHorizontal'];
  if (REFERENCE_STYLE_PROPERTIES[subcommand]) return REFERENCE_STYLE_PROPERTIES[subcommand];
  if (check.intent && Object.keys(check.intent).length) {
    return Object.keys(check.intent).filter((k) => !['text', 'tolerance', 'mobile', 'tablet', 'desktop'].includes(k));
  }
  return [
    'display', 'position', 'width', 'height',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'gap', 'rowGap', 'columnGap',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'color', 'backgroundColor',
  ];
}

function intentFromReference(check, referenceMeasurement) {
  const styles = (check.subcommand === 'distance' ? referenceMeasurement?.distance : referenceMeasurement?.styles) || {};
  const intent = {};
  for (const prop of propertiesForReference(check)) {
    if (styles[prop] !== undefined && styles[prop] !== '') intent[prop] = styles[prop];
  }
  if (check.subcommand !== 'distance' && referenceMeasurement?.text !== undefined) intent.text = referenceMeasurement.text;
  return intent;
}

function diffIntentAgainstRendered(intent, rendered, opts = {}) {
  const drift = [];
  const tolerances = opts.tolerances || {};
  const defaultTolerance = opts.defaultTolerance || 0;
  // Reserved keys in intent that aren't property comparisons:
  //   - text: content drift (compared separately)
  //   - tolerance: per-property tolerance map
  //   - mobile/tablet/desktop: handled by pickIntentForViewport
  const RESERVED = new Set(['text', 'tolerance', 'mobile', 'tablet', 'desktop']);
  for (const key of Object.keys(intent)) {
    if (RESERVED.has(key)) continue;
    const designed = intent[key];
    const renderedValue = (rendered?.distance || rendered?.styles)?.[key];
    if (renderedValue === undefined) {
      drift.push({ property: key, status: 'missing', design: designed, rendered: null });
      continue;
    }
    const tol = tolerances[key] !== undefined ? Number(tolerances[key]) : defaultTolerance;
    const cmp = compareProperty(key, designed, renderedValue, tol);
    if (!cmp.equal) {
      drift.push({ property: key, status: 'drift', design: cmp.normalised.intent, rendered: cmp.normalised.rendered });
    }
  }
  // Content drift — when the intent specifies what the text *should* say
  // (extracted from the Figma sample copy), compare to the rendered text.
  // Differences are often legitimate copy edits, but worth flagging.
  if (Object.hasOwn(intent, 'text')) {
    const want = String(intent.text).trim().replace(/\s+/g, ' ');
    const got = String(rendered?.text ?? '').trim().replace(/\s+/g, ' ');
    if (want !== got) {
      drift.push({ property: 'text', status: 'content', design: want, rendered: got });
    }
  }
  return drift;
}

function hexToRgb(value) {
  const v = normaliseColor(value);
  if (!v || typeof v !== 'string') return null;
  const hex = v.replace('#', '');
  if (hex.length === 3) {
    return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) };
  }
  if (hex.length === 6 || hex.length === 8) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  return null;
}

function colorDistance(a, b) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return Infinity;
  return Math.round(Math.sqrt((A.r - B.r) ** 2 + (A.g - B.g) ** 2 + (A.b - B.b) ** 2) * 10) / 10;
}

const SPACING_PROPERTIES = new Set([
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'gap', 'rowGap', 'columnGap',
  'top', 'right', 'bottom', 'left',
]);
const TYPOGRAPHY_FONT_SIZE_PROPERTIES = new Set(['fontSize']);
const COLOR_PROPERTIES = new Set(['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'textDecorationColor']);

function findFoundationToken(value, kind, foundations) {
  if (!foundations) return null;
  if (kind === 'color') {
    const norm = normaliseColor(value);
    for (const [name, hex] of Object.entries(foundations.colors || {})) {
      if (normaliseColor(hex) === norm) return name;
    }
  }
  if (kind === 'fontSize') {
    const norm = normalisePx(value);
    for (const [name, def] of Object.entries(foundations.typography || {})) {
      if (def && normalisePx(def.fontSize) === norm) return name;
    }
  }
  if (kind === 'spacing') {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return null;
    for (const [name, def] of Object.entries(foundations.spacing || {})) {
      if (typeof def === 'number' && def === num) return name;
      if (typeof def === 'string' && parseFloat(def) === num) return name;
    }
  }
  return null;
}

function findNearestColorToken(value, foundations, threshold) {
  if (!foundations?.colors) return null;
  let best = null;
  for (const [name, hex] of Object.entries(foundations.colors)) {
    const d = colorDistance(value, hex);
    if (d === 0) continue; // exact match; let findFoundationToken handle that
    if (best === null || d < best.distance) best = { token: name, hex, distance: d };
  }
  if (best && best.distance <= threshold) return best;
  return null;
}

function tokenAnnotate(drift, foundations, nearMatchThreshold = 15) {
  for (const d of drift) {
    if (COLOR_PROPERTIES.has(d.property)) {
      const renderedToken = findFoundationToken(d.rendered, 'color', foundations);
      const designToken = findFoundationToken(d.design, 'color', foundations);
      if (renderedToken) d.renderedToken = renderedToken;
      if (designToken) d.designToken = designToken;
      if (!renderedToken) {
        const near = findNearestColorToken(d.rendered, foundations, nearMatchThreshold);
        if (near) d.renderedNearToken = `${near.token} (Δ${near.distance})`;
      }
      if (!designToken) {
        const near = findNearestColorToken(d.design, foundations, nearMatchThreshold);
        if (near) d.designNearToken = `${near.token} (Δ${near.distance})`;
      }
    }
    if (SPACING_PROPERTIES.has(d.property)) {
      const renderedToken = findFoundationToken(d.rendered, 'spacing', foundations);
      const designToken = findFoundationToken(d.design, 'spacing', foundations);
      if (renderedToken) d.renderedToken = renderedToken;
      if (designToken) d.designToken = designToken;
    }
    if (TYPOGRAPHY_FONT_SIZE_PROPERTIES.has(d.property)) {
      const renderedToken = findFoundationToken(d.rendered, 'fontSize', foundations);
      const designToken = findFoundationToken(d.design, 'fontSize', foundations);
      if (renderedToken) d.renderedToken = renderedToken;
      if (designToken) d.designToken = designToken;
    }
  }
  return drift;
}

// Convert camelCase computed-style name to kebab-case CSS property.
function toCssPropertyName(name) {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// Suggest a one-line CSS patch for clean token-swap drift. Most useful for
// colours where the rendered value maps to one token and the design to
// another — the suggestion is the kebab-case property + the *design* value
// or, when the foundation defines CSS custom property names, the var() ref.
function attachFixSuggestions(drift, foundations) {
  for (const d of drift) {
    if (d.status !== 'drift') continue;
    if (!d.designToken) continue;
    const cssProp = toCssPropertyName(d.property);
    // Prefer var(--name) form when the foundations also expose a varName
    // override; fall back to literal value.
    const varName = foundations?.cssVars?.[d.designToken];
    if (varName) {
      d.suggestion = `${cssProp}: var(${varName});`;
    } else {
      // For colours, surface the hex; for spacing/sizes, the px value.
      d.suggestion = `${cssProp}: ${d.design};`;
    }
  }
  return drift;
}

// Foundations conformance — site-level pass that walks every rendered style
// captured across the run and asks: is this value declared in the token set?
// If a rendered colour / font-size / spacing isn't a known token, it's a
// "rogue" value — a hardcoded one-off that breaks the design-system contract,
// even when the design itself was followed correctly for individual props.
function computeFoundationsConformance(results, foundations) {
  if (!foundations) return null;
  const colorUses = new Map();
  const fontSizeUses = new Map();
  const spacingUses = new Map();
  const bump = (map, key, ctx) => {
    if (!map.has(key)) map.set(key, { count: 0, contexts: new Set() });
    const entry = map.get(key);
    entry.count += 1;
    if (entry.contexts.size < 5) entry.contexts.add(ctx);
  };
  for (const target of results) {
    for (const check of target.checks || []) {
      for (const [viewport, vp] of Object.entries(check.viewports || {})) {
        const styles = vp.rendered || {};
        const ctx = `${target.id || 'target'} · ${check.id || check.selector} (${viewport})`;
        for (const prop of COLOR_PROPERTIES) {
          const v = styles[prop];
          if (!v) continue;
          const norm = normaliseColor(v);
          // Skip transparents — they're never "tokenised" anyway.
          if (!norm || norm === 'rgba(0, 0, 0, 0)' || norm === 'transparent' || /^#\w{6}00$/.test(norm)) continue;
          bump(colorUses, norm, ctx);
        }
        for (const prop of TYPOGRAPHY_FONT_SIZE_PROPERTIES) {
          const v = styles[prop];
          if (!v) continue;
          bump(fontSizeUses, normalisePx(v), ctx);
        }
        for (const prop of SPACING_PROPERTIES) {
          const v = styles[prop];
          if (!v) continue;
          const num = parseFloat(v);
          if (!Number.isFinite(num) || num === 0) continue;
          bump(spacingUses, normalisePx(v), ctx);
        }
      }
    }
  }
  const inColors = new Set(Object.values(foundations.colors || {}).map((h) => normaliseColor(h)));
  const inFontSizes = new Set(Object.values(foundations.typography || {})
    .map((def) => def?.fontSize ? normalisePx(def.fontSize) : null)
    .filter(Boolean));
  const inSpacings = new Set(Object.values(foundations.spacing || {})
    .map((v) => typeof v === 'number' ? `${v}px` : normalisePx(v))
    .filter(Boolean));

  const rogueColors = [...colorUses.entries()]
    .filter(([hex]) => !inColors.has(hex))
    .map(([hex, info]) => ({
      value: hex,
      count: info.count,
      contexts: [...info.contexts],
      nearest: findNearestColorToken(hex, foundations, Infinity),
    }))
    .sort((a, b) => b.count - a.count);
  const rogueFontSizes = [...fontSizeUses.entries()]
    .filter(([px]) => !inFontSizes.has(px))
    .map(([px, info]) => ({ value: px, count: info.count, contexts: [...info.contexts] }))
    .sort((a, b) => b.count - a.count);
  const rogueSpacings = [...spacingUses.entries()]
    .filter(([px]) => !inSpacings.has(px))
    .map(([px, info]) => ({ value: px, count: info.count, contexts: [...info.contexts] }))
    .sort((a, b) => b.count - a.count);

  const totalUnique = colorUses.size + fontSizeUses.size + spacingUses.size;
  const totalRogue = rogueColors.length + rogueFontSizes.length + rogueSpacings.length;
  const score = totalUnique > 0 ? Math.round(((totalUnique - totalRogue) / totalUnique) * 100) : 100;

  // CSS custom property scan — :root variables collected by inspect.mjs.
  // Token drift at the variable layer is more diagnostic than at the value
  // layer: when `--color-brand: #f8f6f2` is declared but foundations say
  // brand should be #FFFFFF, that's ONE root-level token bug producing
  // potentially hundreds of downstream colour drifts.
  const rootVars = {};
  for (const target of results) {
    for (const check of target.checks || []) {
      for (const vp of Object.values(check.viewports || {})) {
        Object.assign(rootVars, vp.rootCustomProperties || {});
      }
    }
  }
  const rootColorVars = [];
  for (const [name, value] of Object.entries(rootVars)) {
    const v = (value || '').trim();
    if (!/^#|rgb|hsl/.test(v)) continue;
    const norm = normaliseColor(v);
    const token = findFoundationToken(norm, 'color', foundations);
    const nearest = token ? null : findNearestColorToken(norm, foundations, Infinity);
    rootColorVars.push({ name, value: norm, token, nearest });
  }
  const rootColorDrift = rootColorVars.filter((v) => !v.token);

  return {
    score,
    totals: {
      uniqueValues: totalUnique,
      rogueValues: totalRogue,
      uniqueColors: colorUses.size,
      uniqueFontSizes: fontSizeUses.size,
      uniqueSpacings: spacingUses.size,
    },
    rogueColors,
    rogueFontSizes,
    rogueSpacings,
    rootColorVars,
    rootColorDrift,
  };
}

// ---------- Report ----------

function statusEmoji(s) {
  if (s === 'drift') return '✗';
  if (s === 'missing') return '?';
  if (s === 'content') return '✎';
  return '✓';
}

function renderReport(mapping, results, conformance, baselineDelta, viewportSize = '') {
  const lines = [];
  const expectedLabel = mapping.referenceBaseUrl ? 'Reference' : 'Design';
  lines.push(`# figma-qa report`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Site: ${mapping.baseUrl}`);
  if (viewportSize) lines.push(`Viewport override: ${viewportSize} CSS px (preset DPR/input mode unchanged)`);
  if (mapping.referenceBaseUrl) lines.push(`Reference: ${mapping.referenceBaseUrl}`);
  if (mapping.figmaFileKey) lines.push(`Figma file: ${mapping.figmaFileKey}`);
  lines.push('');
  const totalChecks = results.reduce((n, t) => n + t.checks.length, 0);
  const passed = results.reduce((n, t) => n + t.checks.filter((c) => c.summary === 'pass').length, 0);
  const partial = results.reduce((n, t) => n + t.checks.filter((c) => c.summary === 'partial').length, 0);
  const failed = results.reduce((n, t) => n + t.checks.filter((c) => c.summary === 'fail').length, 0);
  const totalVisual = results.reduce((n, t) => n + (t.visualChecks || []).length, 0);
  const visualPassed = results.reduce((n, t) => n + (t.visualChecks || []).filter((c) => c.summary === 'pass').length, 0);
  const visualPartial = results.reduce((n, t) => n + (t.visualChecks || []).filter((c) => c.summary === 'partial').length, 0);
  const visualFailed = results.reduce((n, t) => n + (t.visualChecks || []).filter((c) => c.summary === 'fail').length, 0);
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Property checks | ✓ Pass | ~ Partial | ✗ Drift |`);
  lines.push(`| ---: | ---: | ---: | ---: |`);
  lines.push(`| ${totalChecks} | ${passed} | ${partial} | ${failed} |`);
  lines.push('');
  if (totalVisual) {
    lines.push(`| Visual pixel checks | ✓ Pass | ~ Measured drift | ✗ Fail |`);
    lines.push(`| ---: | ---: | ---: | ---: |`);
    lines.push(`| ${totalVisual} | ${visualPassed} | ${visualPartial} | ${visualFailed} |`);
    lines.push('');
  }

  if (baselineDelta) {
    lines.push(`## Vs baseline (${baselineDelta.baselineGeneratedAt || 'unknown date'})`);
    lines.push('');
    lines.push(`| New drift | Fixed | Persistent |`);
    lines.push(`| ---: | ---: | ---: |`);
    lines.push(`| ${baselineDelta.counts.fresh} | ${baselineDelta.counts.fixed} | ${baselineDelta.counts.persistent} |`);
    lines.push('');
    if (baselineDelta.fresh.length) {
      lines.push(`### New drift (${baselineDelta.fresh.length})`);
      lines.push('');
      lines.push(`| Target | Check | Viewport | Property | ${expectedLabel} | Rendered |`);
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const d of baselineDelta.fresh.slice(0, 60)) {
        lines.push(`| ${d.target} | ${d.check} | ${d.viewport} | ${d.property} | \`${d.design}\` | \`${d.rendered}\` |`);
      }
      lines.push('');
    }
    if (baselineDelta.fixed.length) {
      lines.push(`### Fixed since baseline (${baselineDelta.fixed.length})`);
      lines.push('');
      lines.push('| Target | Check | Viewport | Property |');
      lines.push('| --- | --- | --- | --- |');
      for (const d of baselineDelta.fixed.slice(0, 60)) {
        lines.push(`| ${d.target} | ${d.check} | ${d.viewport} | ${d.property} |`);
      }
      lines.push('');
    }
  }

  if (conformance) {
    lines.push(`## Foundations conformance: ${conformance.score}%`);
    lines.push('');
    lines.push(`Across all rendered styles in this run: ${conformance.totals.uniqueValues - conformance.totals.rogueValues}/${conformance.totals.uniqueValues} unique values are declared in the foundations token set.`);
    lines.push('');
    if (conformance.rogueColors.length) {
      lines.push(`### Rogue colours (${conformance.rogueColors.length})`);
      lines.push('');
      lines.push('Hex values used on the live site that don\'t match any token in `foundations.colors`. Each row shows the closest token by sRGB distance — useful for suggesting "should this be `<token>`?"');
      lines.push('');
      lines.push('| Value | Used | Closest token | First context |');
      lines.push('| --- | ---: | --- | --- |');
      for (const r of conformance.rogueColors.slice(0, 30)) {
        const near = r.nearest ? `${r.nearest.token} (${r.nearest.hex}, Δ${r.nearest.distance})` : '—';
        lines.push(`| \`${r.value}\` | ${r.count}× | ${near} | ${r.contexts[0] || ''} |`);
      }
      lines.push('');
    }
    if (conformance.rogueFontSizes.length) {
      lines.push(`### Rogue font-sizes (${conformance.rogueFontSizes.length})`);
      lines.push('');
      lines.push('Font sizes on the live site that don\'t appear in any `foundations.typography` token.');
      lines.push('');
      lines.push('| Value | Used | First context |');
      lines.push('| --- | ---: | --- |');
      for (const r of conformance.rogueFontSizes.slice(0, 30)) {
        lines.push(`| \`${r.value}\` | ${r.count}× | ${r.contexts[0] || ''} |`);
      }
      lines.push('');
    }
    if (conformance.rogueSpacings.length) {
      lines.push(`### Rogue spacings (${conformance.rogueSpacings.length})`);
      lines.push('');
      lines.push('Spacing values (margin/padding/gap) on the live site that don\'t match any value in `foundations.spacing`. These are hardcoded one-offs outside the spacing scale.');
      lines.push('');
      lines.push('| Value | Used | First context |');
      lines.push('| --- | ---: | --- |');
      for (const r of conformance.rogueSpacings.slice(0, 30)) {
        lines.push(`| \`${r.value}\` | ${r.count}× | ${r.contexts[0] || ''} |`);
      }
      lines.push('');
    }
    if (conformance.rootColorDrift?.length) {
      lines.push(`### Root CSS colour variables not in foundations (${conformance.rootColorDrift.length})`);
      lines.push('');
      lines.push('CSS custom properties declared on `:root` whose colour value doesn\'t match a foundations token. A token-layer mismatch here cascades into every component that consumes the variable.');
      lines.push('');
      lines.push('| Variable | Value | Closest token |');
      lines.push('| --- | --- | --- |');
      for (const v of conformance.rootColorDrift.slice(0, 40)) {
        const near = v.nearest ? `${v.nearest.token} (${v.nearest.hex}, Δ${v.nearest.distance})` : '—';
        lines.push(`| \`${v.name}\` | \`${v.value}\` | ${near} |`);
      }
      lines.push('');
    }
    if (!conformance.rogueColors.length && !conformance.rogueFontSizes.length && !conformance.rogueSpacings.length && !conformance.rootColorDrift?.length) {
      lines.push('✓ Every rendered value matches a foundations token. Clean run.');
      lines.push('');
    }
  }

  // Page health — JS errors, exceptions, and broken subresource loads
  // collected by inspect.mjs across the audit. Surfacing these next to the
  // CSS drift helps when "the icon looks wrong" turns out to be "the script
  // that fetched the icon threw".
  const pageHealth = [];
  for (const target of results) {
    for (const check of target.checks || []) {
      for (const [vp, m] of Object.entries(check.viewports || {})) {
        const errs = (m.consoleErrors || []).length + (m.pageExceptions || []).length;
        const fails = (m.networkFailures || []).length;
        if (errs > 0 || fails > 0) {
          pageHealth.push({
            target: target.id, check: check.id || check.selector, viewport: vp,
            errs, fails,
            firstError: (m.consoleErrors?.[0]?.text || m.pageExceptions?.[0]?.text || '').slice(0, 200),
            firstFailure: m.networkFailures?.[0] ? `${m.networkFailures[0].type}: ${m.networkFailures[0].errorText}` : '',
          });
        }
      }
    }
  }
  if (pageHealth.length) {
    lines.push(`## Page health`);
    lines.push('');
    lines.push('JS errors / exceptions / subresource failures observed while rendering the audited pages. Often correlated with visual bugs even when they\'re not the direct cause.');
    lines.push('');
    lines.push('| Target | Check | Viewport | Errors | Failures | First error | First failure |');
    lines.push('| --- | --- | --- | ---: | ---: | --- | --- |');
    for (const r of pageHealth.slice(0, 30)) {
      lines.push(`| ${r.target} | ${r.check} | ${r.viewport} | ${r.errs} | ${r.fails} | ${r.firstError || ''} | ${r.firstFailure || ''} |`);
    }
    lines.push('');
  }

  // Drift heat-map. Sort properties by how often they drifted across the
  // whole audit. A property at the top of this list is usually a single
  // systemic bug worth fixing once.
  const heatmap = computeDriftHeatmap(results);
  if (heatmap.length) {
    lines.push(`## Drift heat-map`);
    lines.push('');
    lines.push('How often each property drifted across every target/check/viewport. The property with the highest count is usually a single theme-wide fix — change once and many rows resolve.');
    lines.push('');
    lines.push('| Property | Drift count | Example |');
    lines.push('| --- | ---: | --- |');
    for (const h of heatmap.slice(0, 20)) {
      const ex = h.examples[0];
      const exStr = ex ? `${ex.target} · ${ex.check} (${ex.viewport}): \`${ex.design}\` → \`${ex.rendered}\`` : '';
      lines.push(`| ${h.property} | ${h.count}× | ${exStr} |`);
    }
    lines.push('');
  }

  for (const target of results) {
    lines.push(`## ${target.id}${target.label ? ' — ' + target.label : ''}`);
    if (target.figmaNode) {
      if (typeof target.figmaNode === 'object') {
        const parts = Object.entries(target.figmaNode).map(([vp, id]) => `${vp}: \`${id}\``).join(' · ');
        lines.push(`Figma nodes: ${parts}`);
      } else {
        lines.push(`Figma node: \`${target.figmaNode}\``);
      }
    }
    if (target.url) lines.push(`URL: ${target.url}`);
    if (target.referenceUrl) lines.push(`Reference URL: ${target.referenceUrl}`);
    if (target.figmaScreenshot) {
      lines.push('');
      for (const shot of figmaScreenshotEntries(target.figmaScreenshot)) {
        lines.push(`![Figma reference${shot.viewport ? ` ${shot.viewport}` : ''}](${shot.src})`);
      }
    }
    lines.push('');
    if (target.visualChecks?.length) {
      lines.push(`### Visual pixel checks`);
      lines.push('');
      lines.push('| Check | Viewport | Source | Result | Mismatch | Compared | Diff image |');
      lines.push('| --- | --- | --- | --- | ---: | --- | --- |');
      for (const visual of target.visualChecks) {
        for (const [viewport, vp] of Object.entries(visual.viewports || {})) {
          if (vp.error) {
            lines.push(`| ${visual.id || visual.selector || visual.aText || 'visual'} | ${viewport} | ${vp.sourceMode || ''} | error: ${vp.error} |  |  |  |`);
            continue;
          }
          const source = vp.sourceMode === 'reference-site' ? 'reference site' : 'Figma screenshot';
          const result = vp.pass === undefined ? (vp.mismatchPercent > 0 || vp.dimensionMismatch ? 'measured drift' : 'pass') : (vp.pass ? 'pass' : 'fail');
          const compared = `${vp.compared?.width || '?'}x${vp.compared?.height || '?'}`
            + (vp.dimensionMismatch ? ` (cropped from ${vp.dimensionsA?.width}x${vp.dimensionsA?.height} vs ${vp.dimensionsB?.width}x${vp.dimensionsB?.height})` : '');
          const diff = vp.files?.diff ? `[diff](${vp.files.diff})` : '';
          lines.push(`| ${visual.id || visual.selector || visual.aText || 'visual'} | ${viewport} | ${source} | ${result} | ${vp.mismatchPercent}% | ${compared} | ${diff} |`);
        }
      }
      lines.push('');
    }
    for (const check of target.checks) {
      lines.push(`### ${check.id || check.selector}`);
      lines.push('');
      lines.push(`Selector: \`${check.selector}\` · subcommand: \`${check.subcommand}\``);
      lines.push('');
      for (const [viewport, vp] of Object.entries(check.viewports || {})) {
        if (vp.error) { lines.push(`**${viewport}** — error: ${vp.error}`); lines.push(''); continue; }
        lines.push(`**${viewport}**`);
        lines.push('');
        if (vp.drift.length === 0) {
          lines.push(`✓ all measured properties match design intent`);
          lines.push('');
          continue;
        }
        lines.push(`| Status | Property | ${expectedLabel} | Rendered | Notes | Suggestion |`);
        lines.push('| --- | --- | --- | --- | --- | --- |');
        for (const d of vp.drift) {
          const designLabel = formatTokenisedValue(d.design, d.designToken, d.designNearToken);
          const renderedLabel = formatTokenisedValue(d.rendered, d.renderedToken, d.renderedNearToken);
          const note = buildDriftNote(d);
          const suggestion = d.suggestion ? `\`${d.suggestion}\`` : '';
          lines.push(`| ${statusEmoji(d.status)} | ${d.property} | ${designLabel} | ${renderedLabel} | ${note} | ${suggestion} |`);
        }
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

function figmaScreenshotEntries(value) {
  if (typeof value === 'string') return [{ src: value, viewport: '' }];
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, src]) => typeof src === 'string' && src)
      .map(([viewport, src]) => ({ viewport, src }));
  }
  return [];
}

function formatTokenisedValue(value, token, nearToken) {
  if (token) return `\`${value}\` (**${token}**)`;
  if (nearToken) return `\`${value}\` (≈ ${nearToken})`;
  return `\`${value}\``;
}

function buildDriftNote(d) {
  if (d.renderedToken && d.designToken && d.renderedToken !== d.designToken) {
    return `Rendered uses **${d.renderedToken}** token; design specifies **${d.designToken}**`;
  }
  if (d.renderedToken && !d.designToken) {
    return `Rendered matches **${d.renderedToken}** token; design value is not a known token`;
  }
  if (!d.renderedToken && d.designToken) {
    return `Design specifies **${d.designToken}** token; rendered value is not a known token`;
  }
  if (d.renderedNearToken && d.designNearToken) {
    return `Both values are near-matches but neither is exact — check token usage`;
  }
  return '';
}

// ---------- Main ----------

async function processTarget(mapping, target, args) {
  const foundations = mapping.foundations;
  const viewports = args.viewports || target.viewports || mapping.viewports || ['mobile', 'tablet', 'desktop'];
  const checks = (target.checks || []).map((check) => ({ ...check, subcommand: check.subcommand || guessSubcommand(check) }));
  const visualChecks = target.visualChecks || [];
  const targetUrl = absoluteUrl(args.baseUrl, target);
  const referenceBase = args.referenceBaseUrl || mapping.referenceBaseUrl || '';
  const visualArgs = { ...args, referenceBaseUrl: referenceBase };
  const result = {
    id: target.id,
    label: target.label,
    figmaNode: target.figmaNode,
    figmaScreenshot: target.figmaScreenshot,
    url: targetUrl,
    referenceUrl: referenceBase ? referenceUrl(referenceBase, target) : '',
    checks: [],
    visualChecks: [],
  };
  let targetReport;
  let sourceReport = null;
  if (checks.length) {
    try {
      targetReport = await runChecksBatch(targetUrl, checks, args, viewports, 'target');
      if (referenceBase) {
        sourceReport = await runChecksBatch(result.referenceUrl, checks, args, viewports, 'reference');
      }
    } catch (e) {
      for (const check of checks) {
        const checkOut = {
          id: check.id,
          selector: check.selector,
          subcommand: check.subcommand,
          viewports: {},
          summary: 'fail',
        };
        for (const v of viewports) checkOut.viewports[v] = { error: e.message, drift: [] };
        result.checks.push(checkOut);
      }
      for (const visual of visualChecks) result.visualChecks.push(await runVisualCheck(target, visual, visualArgs, args.viewports || visual.viewports || viewports));
      return result;
    }
  }
  const targetFirst = targetReport?.targets?.[0] || null;
  const sourceFirst = sourceReport?.targets?.[0] || null;
  const findMeasuredCheck = (reportTarget, viewport, check) => {
    const vp = reportTarget?.viewports?.[viewport];
    const measured = (vp?.checks || []).find((c) => c.id === check.id);
    return { page: vp, measured };
  };
  for (const check of checks) {
    const checkOut = {
      id: check.id,
      selector: check.selector,
      subcommand: check.subcommand,
      viewports: {},
      summary: 'pass',
    };
    for (const v of viewports) {
      const { page, measured: m } = findMeasuredCheck(targetFirst, v, check);
      if (!m || inspectionError(m) || inspectionError(page)) {
        checkOut.viewports[v] = { error: inspectionError(m) || inspectionError(page) || 'missing viewport result', drift: [] };
        checkOut.summary = 'fail';
        continue;
      }
      let intentForViewport;
      let referenceMeasurement = null;
      if (sourceFirst) {
        const source = findMeasuredCheck(sourceFirst, v, check);
        referenceMeasurement = source.measured;
        if (!referenceMeasurement || inspectionError(referenceMeasurement) || inspectionError(source.page)) {
          checkOut.viewports[v] = { error: inspectionError(referenceMeasurement) || inspectionError(source.page) || 'missing reference viewport result', drift: [] };
          checkOut.summary = 'fail';
          continue;
        }
        intentForViewport = intentFromReference(check, referenceMeasurement);
      } else {
        // Pick intent for this viewport. Supports three shapes:
        //   1. check.intent = { fontSize: "48px", ... }                         single intent for all viewports
        //   2. check.intent = { mobile: {...}, desktop: {...} }                 per-viewport
        //   3. check.intent = { fontSize: "48px", desktop: { fontSize: "72px" }} shared fields + per-viewport override
        intentForViewport = pickIntentForViewport(check.intent || {}, v);
      }
      if (!Object.keys(intentForViewport).some((key) => !['tolerance', 'mobile', 'tablet', 'desktop'].includes(key))) {
        checkOut.viewports[v] = { error: 'no comparable properties or text in intent', drift: [] };
        checkOut.summary = 'fail';
        continue;
      }
      const diffOpts = {
        tolerances: intentForViewport.tolerance || check.tolerance || {},
        defaultTolerance: args.defaultTolerance,
      };
      const drift = tokenAnnotate(
        diffIntentAgainstRendered(intentForViewport, m, diffOpts),
        foundations,
        args.nearMatchThreshold,
      );
      // Attach fix suggestions where a drifted property maps cleanly to a
      // design token — generates a one-line CSS patch the developer can copy.
      attachFixSuggestions(drift, foundations);
      checkOut.viewports[v] = {
        drift,
        rendered: m.distance || m.styles,
        rect: m.a?.rect,
        intentUsed: intentForViewport,
        referenceRendered: referenceMeasurement?.distance || referenceMeasurement?.styles || null,
        referenceRect: referenceMeasurement?.a?.rect || null,
        renderedText: m.text,
        // Page-level diagnostics surfaced by inspect.mjs. We collect them on
        // the first check per target/viewport so the report can flag broken
        // pages (JS errors / network failures) alongside the CSS drift.
        consoleErrors: page?.consoleErrors || [],
        consoleWarnings: page?.consoleWarnings || [],
        pageExceptions: page?.pageExceptions || [],
        networkFailures: page?.networkFailures || [],
        rootCustomProperties: page?.rootCustomProperties || {},
      };
      if (drift.length > 0) checkOut.summary = checkOut.summary === 'fail' ? 'fail' : 'partial';
    }
    if (Object.values(checkOut.viewports).every((v) => v.drift?.length > 0)) checkOut.summary = 'fail';
    result.checks.push(checkOut);
  }
  for (const visual of visualChecks) {
    result.visualChecks.push(await runVisualCheck(target, visual, visualArgs, args.viewports || visual.viewports || viewports));
  }
  return result;
}

function validateMapping(mapping, opts = {}) {
  const errors = [];
  const warnings = [];
  if (typeof mapping !== 'object' || !mapping) errors.push('mapping must be an object');
  if (!mapping.baseUrl) errors.push('mapping.baseUrl is required');
  if (!Array.isArray(mapping.targets)) errors.push('mapping.targets must be an array');
  if (mapping.viewports && !Array.isArray(mapping.viewports)) errors.push('mapping.viewports must be an array');
  if (mapping.foundations) {
    if (mapping.foundations.colors && typeof mapping.foundations.colors !== 'object') errors.push('foundations.colors must be an object');
    if (mapping.foundations.typography && typeof mapping.foundations.typography !== 'object') errors.push('foundations.typography must be an object');
    if (mapping.foundations.spacing && typeof mapping.foundations.spacing !== 'object') errors.push('foundations.spacing must be an object');
  } else {
    warnings.push('no foundations block — token annotation + conformance score will be unavailable');
  }
  (mapping.targets || []).forEach((t, i) => {
    const where = `targets[${i}]`;
    if (!t.id) warnings.push(`${where} missing id`);
    if (!t.url && t.url !== '') {
      const msg = `${where} (${t.id || '?'}) missing url`;
      if (opts.strictMapping) errors.push(msg);
      else warnings.push(msg);
    }
    if (opts.strictMapping && !mapping.viewports && !t.viewports) {
      errors.push(`${where} (${t.id || '?'}) needs explicit viewports in strict mapping mode`);
    }
    const hasChecks = Array.isArray(t.checks) && t.checks.length > 0;
    const hasVisualChecks = Array.isArray(t.visualChecks) && t.visualChecks.length > 0;
    if (!hasChecks && !hasVisualChecks) errors.push(`${where} (${t.id || '?'}) needs at least one check or visualCheck`);
    (t.checks || []).forEach((c, j) => {
      const cw = `${where}.checks[${j}]`;
      if (!c.selector && !c.aText) errors.push(`${cw} requires selector or aText`);
      if (opts.strictMapping && !c.subcommand) errors.push(`${cw} requires subcommand in strict mapping mode`);
      if (c.subcommand === 'distance' && !c.selectorB && !c.bText) errors.push(`${cw} distance check requires selectorB or bText`);
      if (!c.intent && !c.properties && !mapping.referenceBaseUrl) {
        const msg = `${cw} has no intent — will measure but not flag drift`;
        if (opts.strictMapping) errors.push(msg);
        else warnings.push(msg);
      }
      if (opts.strictMapping && mapping.referenceBaseUrl) {
        if (!c.properties) errors.push(`${cw} requires properties in strict reference mode`);
        const hasReferenceLocator = c.referenceSelector || c.referenceAText || c.referenceSameLocator === true;
        if (!hasReferenceLocator) {
          errors.push(`${cw} requires referenceSelector/referenceAText, or referenceSameLocator: true, in strict reference mode`);
        }
      }
    });
    (t.visualChecks || []).forEach((c, j) => {
      const cw = `${where}.visualChecks[${j}]`;
      if (!c.selector && !c.aText && !c.fullPage) errors.push(`${cw} requires selector, aText, or fullPage`);
      const hasVisualReference = Boolean(c.figmaScreenshot || t.figmaScreenshot || mapping.referenceBaseUrl || c.referenceUrl || t.referenceUrl);
      if (!hasVisualReference) errors.push(`${cw} requires figmaScreenshot/target.figmaScreenshot or referenceBaseUrl/referenceUrl`);
      if (c.threshold !== undefined && (!Number.isFinite(Number(c.threshold)) || Number(c.threshold) < 0 || Number(c.threshold) > 1)) {
        errors.push(`${cw} threshold must be between 0 and 1`);
      }
      if (c.maxDiffPct !== undefined && (!Number.isFinite(Number(c.maxDiffPct)) || Number(c.maxDiffPct) < 0)) {
        errors.push(`${cw} maxDiffPct must be a non-negative number`);
      }
    });
  });
  return { errors, warnings };
}

const MAPPING_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'figma-qa mapping',
  type: 'object',
  required: ['baseUrl', 'targets'],
  properties: {
    site: { type: 'string' },
    baseUrl: { type: 'string', format: 'uri' },
    referenceBaseUrl: { type: 'string', format: 'uri' },
    viewports: { type: 'array', items: { enum: ['mobile', 'tablet', 'desktop'] } },
    figmaFileKey: { type: 'string' },
    foundations: {
      type: 'object',
      properties: {
        boards: { type: 'object', additionalProperties: { type: 'string' } },
        colors: { type: 'object', additionalProperties: { type: 'string' } },
        typography: { type: 'object', additionalProperties: { type: 'object' } },
        spacing: { type: 'object', additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] } },
        breakpoints: { type: 'object', additionalProperties: { type: 'number' } },
        cssVars: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          figmaNode: { oneOf: [
            { type: 'string' },
            { type: 'object', properties: { mobile: { type: 'string' }, tablet: { type: 'string' }, desktop: { type: 'string' } } },
          ] },
          figmaScreenshot: { oneOf: [
            { type: 'string' },
            { type: 'object', properties: { mobile: { type: 'string' }, tablet: { type: 'string' }, desktop: { type: 'string' }, default: { type: 'string' } } },
          ] },
          url: { type: 'string' },
          referenceUrl: { oneOf: [
            { type: 'string' },
            { type: 'object', properties: { mobile: { type: 'string' }, tablet: { type: 'string' }, desktop: { type: 'string' }, default: { type: 'string' } } },
          ] },
          viewports: { type: 'array', items: { enum: ['mobile', 'tablet', 'desktop'] } },
          checks: { type: 'array', items: {
            type: 'object',
            anyOf: [
              { required: ['selector'] },
              { required: ['aText'] },
            ],
            properties: {
              id: { type: 'string' },
              selector: { type: 'string' },
              referenceSelector: { type: 'string' },
              referenceSameLocator: { type: 'boolean' },
              scope: { type: 'string' },
              referenceScope: { type: 'string' },
              subcommand: { enum: ['typography', 'box', 'layout', 'styles', 'distance'] },
              intent: { type: 'object' },
              tolerance: { type: 'object', additionalProperties: { type: 'number' } },
              properties: { type: 'string' },
              initScript: { type: 'string' },
              aText: { type: 'string' },
              referenceAText: { type: 'string' },
              aIndex: { type: 'number' },
              stabilityPasses: { type: 'number' },
            },
          } },
          visualChecks: { type: 'array', items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              selector: { type: 'string' },
              referenceSelector: { type: 'string' },
              referenceSameLocator: { type: 'boolean' },
              scope: { type: 'string' },
              referenceScope: { type: 'string' },
              aText: { type: 'string' },
              referenceAText: { type: 'string' },
              aIndex: { type: 'number' },
              referenceAIndex: { type: 'number' },
              referenceUrl: { oneOf: [
                { type: 'string' },
                { type: 'object', properties: { mobile: { type: 'string' }, tablet: { type: 'string' }, desktop: { type: 'string' }, default: { type: 'string' } } },
              ] },
              figmaScreenshot: { oneOf: [
                { type: 'string' },
                { type: 'object', properties: { mobile: { type: 'string' }, tablet: { type: 'string' }, desktop: { type: 'string' }, default: { type: 'string' } } },
              ] },
              threshold: { type: 'number', minimum: 0, maximum: 1 },
              maxDiffPct: { type: 'number', minimum: 0 },
              viewports: { type: 'array', items: { enum: ['mobile', 'tablet', 'desktop'] } },
              initScript: { type: 'string' },
              waitMs: { type: 'number' },
              timeoutMs: { type: 'number' },
              fullPage: { type: 'boolean' },
            },
          } },
        },
      },
    },
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.printSchema) {
    process.stdout.write(JSON.stringify(MAPPING_JSON_SCHEMA, null, 2) + '\n');
    process.exit(0);
  }
  const mapping = loadMapping(args.input);
  if (args.baseUrl) mapping.baseUrl = args.baseUrl;
  if (args.referenceBaseUrl) mapping.referenceBaseUrl = args.referenceBaseUrl;
  if (args.viewports) mapping.viewports = args.viewports;
  const validation = validateMapping(mapping, { strictMapping: args.strictMapping });
  if (validation.errors.length || args.validateOnly) {
    for (const w of validation.warnings) process.stderr.write(`warning: ${w}\n`);
    for (const e of validation.errors) process.stderr.write(`error:   ${e}\n`);
    if (args.validateOnly) {
      process.stderr.write(validation.errors.length ? `\nFAIL — ${validation.errors.length} error(s)\n` : `\nOK — mapping is valid\n`);
      process.exit(validation.errors.length ? 1 : 0);
    }
    if (validation.errors.length) process.exit(1);
  } else {
    for (const w of validation.warnings) process.stderr.write(`warning: ${w}\n`);
  }
  if (!mapping.baseUrl) throw new Error('mapping.baseUrl missing and --base-url not provided');

  let targets = mapping.targets || [];
  if (args.filter) targets = targets.filter((t) => (t.id || '').includes(args.filter) || (t.label || '').includes(args.filter));
  if (!targets.length) {
    process.stderr.write(`No targets to process (filter=${args.filter || 'none'}).\n`);
    process.exit(0);
  }

  process.stderr.write(`Running ${targets.length} target(s) against ${mapping.baseUrl}${mapping.referenceBaseUrl ? ` using reference ${mapping.referenceBaseUrl}` : ''}\n`);
  const results = [];
  // Concurrency: simple worker pool.
  const queue = [...targets];
  const workers = Array(Math.min(args.concurrency, queue.length)).fill(0).map(async () => {
    while (queue.length) {
      const target = queue.shift();
      if (!target) return;
      process.stderr.write(`  · ${target.id || target.label || target.figmaNode}\n`);
      try {
        const out = await processTarget(mapping, target, { ...args, baseUrl: mapping.baseUrl });
        results.push(out);
      } catch (e) {
        results.push({
          id: target.id || target.figmaNode,
          label: target.label,
          figmaNode: target.figmaNode,
          url: absoluteUrl(mapping.baseUrl, target),
          checks: [],
          error: e.message,
        });
      }
    }
  });
  await Promise.all(workers);
  // Preserve original target ordering.
  results.sort((a, b) => (targets.findIndex((t) => t.id === a.id) - targets.findIndex((t) => t.id === b.id)));

  const conformance = args.skipConformance ? null : computeFoundationsConformance(results, mapping.foundations);

  // Baseline comparison — diff current results against a previous JSON report.
  let baselineDelta = null;
  if (args.baselinePath) {
    try {
      const raw = await fs.readFile(args.baselinePath, 'utf-8');
      const baseline = JSON.parse(raw);
      baselineDelta = compareToBaseline(baseline, { results, conformance });
    } catch (e) {
      process.stderr.write(`Warning: could not load baseline ${args.baselinePath}: ${e.message}\n`);
    }
  }

  const md = renderReport(mapping, results, conformance, baselineDelta, args.viewportSize);
  if (args.reportPath) {
    await fs.writeFile(args.reportPath, md);
    process.stderr.write(`Report: ${args.reportPath}\n`);
  } else {
    process.stdout.write(md + '\n');
  }
  if (args.jsonReportPath) {
    const json = {
      generatedAt: new Date().toISOString(),
      mapping: { baseUrl: mapping.baseUrl, referenceBaseUrl: mapping.referenceBaseUrl, figmaFileKey: mapping.figmaFileKey,
        viewports: args.viewports || mapping.viewports, viewportSize: args.viewportSize || null },
      conformance,
      baselineDelta,
      results,
    };
    await fs.writeFile(args.jsonReportPath, JSON.stringify(json, null, 2));
    process.stderr.write(`JSON report: ${args.jsonReportPath}\n`);
  }
  if (args.junitPath) {
    await fs.writeFile(args.junitPath, renderJUnit(mapping, results));
    process.stderr.write(`JUnit XML: ${args.junitPath}\n`);
  }
  if (args.sarifPath) {
    await fs.writeFile(args.sarifPath, renderSarif(mapping, results));
    process.stderr.write(`SARIF: ${args.sarifPath}\n`);
  }

  // CI fail-on policy. Hard-fail the process if any check matches the
  // threshold so CI/build pipelines can gate on visual drift.
  if (args.failOn && args.failOn !== 'none') {
    let trigger = false;
    for (const t of results) {
      for (const c of t.checks || []) {
        if (args.failOn === 'any' && c.summary !== 'pass') trigger = true;
        if (args.failOn === 'drift' && c.summary === 'fail') trigger = true;
        if (args.failOn === 'partial' && (c.summary === 'fail' || c.summary === 'partial')) trigger = true;
      }
      for (const c of t.visualChecks || []) {
        if (args.failOn === 'any' && c.summary !== 'pass') trigger = true;
        if (args.failOn === 'drift' && c.summary === 'fail') trigger = true;
        if (args.failOn === 'partial' && (c.summary === 'fail' || c.summary === 'partial')) trigger = true;
      }
    }
    if (trigger) {
      process.stderr.write(`\nfail-on=${args.failOn}: matched — exiting non-zero\n`);
      process.exit(2);
    }
  }
}

// Cumulative drift heat-map — counts drift occurrences per property type
// across every target/check/viewport. A property that drifted many times
// is usually a single systemic theme bug; surfacing the tally points the
// developer at the highest-leverage fix.
function computeDriftHeatmap(results) {
  const tally = new Map();
  for (const t of results) {
    for (const c of t.checks || []) {
      for (const [vp, vpResult] of Object.entries(c.viewports || {})) {
        for (const d of vpResult.drift || []) {
          if (!tally.has(d.property)) tally.set(d.property, { count: 0, examples: [] });
          const entry = tally.get(d.property);
          entry.count += 1;
          if (entry.examples.length < 5) entry.examples.push({ target: t.id, check: c.id || c.selector, viewport: vp, design: d.design, rendered: d.rendered });
        }
      }
    }
  }
  return [...tally.entries()]
    .map(([property, data]) => ({ property, ...data }))
    .sort((a, b) => b.count - a.count);
}

// ---------- Baseline comparison ----------

function flattenDrift(results) {
  // Returns a map: "<target>::<check>::<viewport>::<property>" → drift entry
  const out = new Map();
  for (const t of results) {
    for (const c of t.checks || []) {
      for (const [vp, vpResult] of Object.entries(c.viewports || {})) {
        for (const d of vpResult.drift || []) {
          const key = `${t.id}::${c.id || c.selector}::${vp}::${d.property}`;
          out.set(key, { ...d, target: t.id, check: c.id || c.selector, viewport: vp });
        }
      }
    }
  }
  return out;
}

function compareToBaseline(baseline, current) {
  const previous = flattenDrift(baseline.results || []);
  const now = flattenDrift(current.results || []);
  const fixed = [];
  const persistent = [];
  const fresh = [];
  for (const [key, d] of previous) {
    if (!now.has(key)) fixed.push(d);
    else persistent.push({ key, baseline: d, current: now.get(key) });
  }
  for (const [key, d] of now) {
    if (!previous.has(key)) fresh.push(d);
  }
  return {
    baselineGeneratedAt: baseline.generatedAt || null,
    counts: { fixed: fixed.length, fresh: fresh.length, persistent: persistent.length },
    fixed,
    fresh,
    persistent,
  };
}

// ---------- JUnit XML ----------

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function visualViewportPassed(result) {
  return !result.error && !result.dimensionMismatch && (result.pass === true ||
    (result.pass === undefined && result.mismatchPercent === 0));
}

function renderJUnit(mapping, results) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  let totalTests = 0, totalFailures = 0;
  const suites = [];
  for (const t of results) {
    const caseLines = [];
    for (const c of t.checks || []) {
      for (const [vp, vpResult] of Object.entries(c.viewports || {})) {
        totalTests += 1;
        const name = `${c.id || c.selector} @ ${vp}`;
        if (vpResult.error) {
          totalFailures += 1;
          caseLines.push(`    <testcase classname="${xmlEscape(t.id)}" name="${xmlEscape(name)}"><failure type="error" message="${xmlEscape(vpResult.error)}"/></testcase>`);
          continue;
        }
        const drift = vpResult.drift || [];
        if (drift.length === 0) {
          caseLines.push(`    <testcase classname="${xmlEscape(t.id)}" name="${xmlEscape(name)}"/>`);
        } else {
          totalFailures += 1;
          const detail = drift.map((d) => `${d.property}: ${d.design} → ${d.rendered}${d.suggestion ? ' (fix: ' + d.suggestion + ')' : ''}`).join('\n');
          caseLines.push(`    <testcase classname="${xmlEscape(t.id)}" name="${xmlEscape(name)}"><failure type="drift" message="${xmlEscape(drift.length + ' property drift(s)')}">${xmlEscape(detail)}</failure></testcase>`);
        }
      }
    }
    for (const c of t.visualChecks || []) {
      for (const [vp, vpResult] of Object.entries(c.viewports || {})) {
        totalTests += 1;
        const name = `${c.id || c.selector || c.aText || 'visual'} @ ${vp} visual`;
        if (vpResult.error) {
          totalFailures += 1;
          caseLines.push(`    <testcase classname="${xmlEscape(t.id)}" name="${xmlEscape(name)}"><failure type="error" message="${xmlEscape(vpResult.error)}"/></testcase>`);
          continue;
        }
        if (visualViewportPassed(vpResult)) {
          caseLines.push(`    <testcase classname="${xmlEscape(t.id)}" name="${xmlEscape(name)}"/>`);
        } else {
          totalFailures += 1;
          const detail = `mismatch ${vpResult.mismatchedPixels} / ${vpResult.totalPixels} px (${vpResult.mismatchPercent}%). diff: ${vpResult.files?.diff || ''}`;
          caseLines.push(`    <testcase classname="${xmlEscape(t.id)}" name="${xmlEscape(name)}"><failure type="visual-drift" message="${xmlEscape('visual mismatch ' + vpResult.mismatchPercent + '%')}">${xmlEscape(detail)}</failure></testcase>`);
        }
      }
    }
    suites.push(`  <testsuite name="${xmlEscape(t.id)}" tests="${caseLines.length}">\n${caseLines.join('\n')}\n  </testsuite>`);
  }
  lines.push(`<testsuites name="figma-qa" tests="${totalTests}" failures="${totalFailures}">`);
  lines.push(suites.join('\n'));
  lines.push('</testsuites>');
  return lines.join('\n') + '\n';
}

// ---------- SARIF ----------

function renderSarif(mapping, results) {
  const findings = [];
  for (const t of results) {
    for (const c of t.checks || []) {
      for (const [vp, vpResult] of Object.entries(c.viewports || {})) {
        if (vpResult.error) {
          findings.push({
            ruleId: 'figma-qa/inspection-error',
            level: 'error',
            message: { text: `${t.id} / ${c.id || c.selector} (${vp}): ${vpResult.error}` },
            locations: [{
              physicalLocation: { artifactLocation: { uri: t.url || mapping.baseUrl } },
              logicalLocations: [{ name: c.selector || c.aText || c.id, kind: c.selector ? 'css-selector' : 'text-locator' }],
            }],
            properties: { target: t.id, check: c.id || c.selector, viewport: vp },
          });
          continue;
        }
        for (const d of vpResult.drift || []) {
          findings.push({
            ruleId: `figma-qa/drift/${d.property}`,
            level: d.status === 'content' ? 'note' : 'warning',
            message: { text: `${t.id} · ${c.id || c.selector} (${vp}): ${d.property} ${d.design} → ${d.rendered}${d.suggestion ? ` (suggestion: ${d.suggestion})` : ''}` },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: t.url || mapping.baseUrl },
              },
              logicalLocations: [{ name: c.selector, kind: 'css-selector' }],
            }],
            properties: {
              target: t.id,
              check: c.id || c.selector,
              viewport: vp,
              property: d.property,
              design: d.design,
              rendered: d.rendered,
              designToken: d.designToken,
              renderedToken: d.renderedToken,
            },
          });
        }
      }
    }
    for (const c of t.visualChecks || []) {
      for (const [vp, vpResult] of Object.entries(c.viewports || {})) {
        if (visualViewportPassed(vpResult)) continue;
        findings.push({
          ruleId: 'figma-qa/visual-drift',
          level: 'warning',
          message: {
            text: vpResult.error
              ? `${t.id} · ${c.id || c.selector || c.aText || 'visual'} (${vp}): ${vpResult.error}`
              : `${t.id} · ${c.id || c.selector || c.aText || 'visual'} (${vp}): ${vpResult.mismatchPercent}% pixel mismatch`,
          },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: t.url || mapping.baseUrl },
            },
            logicalLocations: [{ name: c.selector || c.aText || 'visual', kind: c.selector ? 'css-selector' : 'text-locator' }],
          }],
          properties: {
            target: t.id,
            check: c.id || c.selector || c.aText || 'visual',
            viewport: vp,
            mismatchPercent: vpResult.mismatchPercent,
            mismatchedPixels: vpResult.mismatchedPixels,
            totalPixels: vpResult.totalPixels,
            diff: vpResult.files?.diff,
          },
        });
      }
    }
  }
  return JSON.stringify({
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'figma-qa', informationUri: 'https://github.com/ericlam/dotfiles', rules: [] } },
      results: findings,
    }],
  }, null, 2);
}

main().catch((e) => { process.stderr.write((e.stack || e.message) + '\n'); process.exit(1); });
