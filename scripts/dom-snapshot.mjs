// SPDX-License-Identifier: MPL-2.0
//
// # dom-snapshot.mjs — DOM Snapshot API for AI-Assisted Theme Creation
//
// Provides a read-only DOM snapshot interface that connects to a running Agent
// application via CDP, captures the DOM tree with computed styles, filters
// sensitive information, generates stable CSS selector candidates, and outputs
// a structured JSON document for AI-assisted theme creation workflows.
//
// Architecture:
//   CDP WebSocket → Runtime.evaluate (in-page capture script) → Filter →
//   Selector candidates → JSON output
//
// The capture is strictly READ-ONLY. No DOM mutation occurs in the target page.
//
// Usage:
//   node scripts/dom-snapshot.mjs --port 9222 --adapter workbuddy
//   node scripts/dom-snapshot.mjs --port 9222 --adapter workbuddy --include-hidden
//   node scripts/dom-snapshot.mjs --port 9222 --adapter workbuddy --out snapshot.json

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tag names excluded from the snapshot (non-visible / infrastructure). */
const EXCLUDED_TAGS = Object.freeze([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'META',
  'LINK',
  'BASE',
  'HEAD',
  'TITLE',
  'SVG',
  'PATH',
  'DEFS',
  'CLIPPATH',
  'USE',
  'SYMBOL',
  'G',
]);

/** Attributes considered sensitive — stripped from output to protect user privacy. */
const SENSITIVE_ATTRIBUTES = Object.freeze([
  'aria-label',
  'aria-describedby',
  'aria-labelledby',
  'aria-placeholder',
  'aria-valuetext',
  'value',
  'placeholder',
  'href',
  'src',
  'srcset',
  'action',
  'data-src',
  'data-href',
  'data-url',
  'data-action',
  'data-clipboard-target',
]);

/** URL-bearing attribute names (any attr starting with these prefixes is stripped). */
const _URL_ATTRIBUTE_PREFIXES = Object.freeze(['data-src', 'data-href', 'data-url', 'data-']);

/** Computed style properties captured for each element. */
const COMPUTED_STYLE_FIELDS = Object.freeze([
  'backgroundColor',
  'color',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'borderColor',
  'borderRadius',
  'borderWidth',
  'boxShadow',
  'opacity',
  'display',
  'position',
]);

/** Default maximum number of elements to record. */
const DEFAULT_MAX_ELEMENTS = 1500;

/** CDP connect timeout in milliseconds. */
const CONNECT_TIMEOUT = 8000;

/** CDP command timeout in milliseconds. */
const COMMAND_TIMEOUT = 15000;

// ---------------------------------------------------------------------------
// CDP Client (lightweight, for direct port connection)
// ---------------------------------------------------------------------------

/**
 * Minimal CDP WebSocket client for sending commands and receiving results.
 * Supports the subset of CDP commands needed by dom-snapshot:
 *   - Runtime.evaluate
 *   - DOM.getDocument / DOM.querySelectorAll (fallback probes)
 *
 * @internal
 */
class CdpClient {
  /**
   * @param {string} wsUrl - WebSocket debugger URL (ws://127.0.0.1:PORT/...).
   * @param {object} [opts]
   * @param {number} [opts.connectTimeout] - Connection timeout in ms.
   * @param {number} [opts.commandTimeout] - Per-command timeout in ms.
   */
  constructor(wsUrl, opts = {}) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.connectTimeout = opts.connectTimeout ?? CONNECT_TIMEOUT;
    this.commandTimeout = opts.commandTimeout ?? COMMAND_TIMEOUT;
  }

  /** Open the CDP WebSocket connection. */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WS error: ${e.message || 'connection failed'}`));
      this.ws.onmessage = (msg) => this._handleMessage(msg.data);
      setTimeout(() => reject(new Error('WS connect timeout')), this.connectTimeout);
    });
  }

  /**
   * Send a CDP command and await its result.
   * @param {string} method - CDP domain method (e.g. "Runtime.evaluate").
   * @param {object} [params] - Command parameters.
   * @returns {Promise<object>} The `result` field of the CDP response.
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, this.commandTimeout);
    });
  }

  /** Close the WebSocket connection. */
  close() {
    if (this.ws) this.ws.close();
  }

  /**
   * @param {string} data
   * @private
   */
  _handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
}

// ---------------------------------------------------------------------------
// In-page capture expression
// ---------------------------------------------------------------------------

/**
 * Build the JavaScript expression that runs inside the target page via
 * Runtime.evaluate. Returns a JSON-serializable DOM tree with visible elements,
 * their attributes (privacy-filtered), bounding rects, and computed styles.
 *
 * The expression is pure read-only: it only reads DOM properties and never
 * modifies the document.
 *
 * @param {object} [options]
 * @param {number} [options.maxElements] - Maximum elements to record.
 * @param {boolean} [options.includeHidden] - Whether to include hidden elements.
 * @returns {string} JavaScript source to pass to Runtime.evaluate.
 */
function buildCaptureExpression({
  maxElements = DEFAULT_MAX_ELEMENTS,
  includeHidden = false,
} = {}) {
  const config = JSON.stringify({
    excludedTags: EXCLUDED_TAGS,
    sensitiveAttrs: SENSITIVE_ATTRIBUTES,
    styleFields: COMPUTED_STYLE_FIELDS,
    maxElements,
    includeHidden,
  });

  return `(() => {
    const config = ${config};
    const SKIP = new Set(config.excludedTags);
    const SENSITIVE = new Set(config.sensitiveAttrs);
    const STYLE_FIELDS = config.styleFields;
    const MAX = config.maxElements;
    const INCLUDE_HIDDEN = config.includeHidden;

    const limit = (v, n = 160) => String(v ?? '').slice(0, n);
    const round = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);

    const isVisible = (style, rect) =>
      INCLUDE_HIDDEN || (rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0');

    const isUrlAttr = (name) => {
      if (name === 'src' || name === 'href' || name === 'action' || name === 'srcset') return true;
      if (name.startsWith('data-src') || name.startsWith('data-href') ||
          name.startsWith('data-url') || name.startsWith('data-')) return false;
      return false;
    };

    const elements = document.querySelectorAll('*');
    const recorded = [];
    let eligible = 0;
    let truncated = false;

    for (const el of elements) {
      const tag = el.tagName;
      if (SKIP.has(tag)) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!isVisible(style, rect)) continue;
      eligible++;
      if (recorded.length >= MAX) { truncated = true; continue; }

      const tagName = tag.toLowerCase();
      const attrs = {};
      for (const attr of el.attributes) {
        const name = attr.name;
        if (SENSITIVE.has(name)) continue;
        if (isUrlAttr(name)) continue;
        if (name.startsWith('data-')) {
          // Keep data-* attributes but skip URL-bearing ones already handled above
          attrs[name] = limit(attr.value);
          continue;
        }
        if (name.startsWith('aria-') && SENSITIVE.has(name)) continue;
        if (name === 'class') {
          attrs.class = limit(attr.value);
          continue;
        }
        if (name === 'id' || name === 'role' || name === 'type' || name === 'name' ||
            name === 'tabindex' || name === 'contenteditable') {
          attrs[name] = limit(attr.value);
        }
      }

      const computedStyle = {};
      for (const field of STYLE_FIELDS) {
        const val = style[field];
        if (val && val !== 'none' && val !== 'normal' && val !== '0px' &&
            val !== 'rgba(0, 0, 0, 0)' && val !== 'auto') {
          computedStyle[field] = limit(val, 120);
        }
      }

      recorded.push({
        tagName,
        id: el.id || null,
        attributes: attrs,
        boundingBox: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
        computedStyle,
        visible: true,
      });
    }

    return JSON.stringify({
      url: String(globalThis.location?.pathname ?? ''),
      totalElements: elements.length,
      filteredElements: eligible,
      truncated,
      nodes: recorded,
    });
  })()`;
}

// ---------------------------------------------------------------------------
// Stable selector generation
// ---------------------------------------------------------------------------

/**
 * Generate a stable CSS selector candidate for a DOM snapshot node.
 *
 * Strategy (in priority order):
 *   1. #id              — if the element has an id
 *   2. .class           — first non-hashed class name
 *   3. [data-*]         — data-view-id or similar semantic attributes
 *   4. tagName          — for landmark semantic tags
 *
 * @param {object} node - A node from the captured elements array.
 * @returns {string|null} A CSS selector string, or null if no stable candidate.
 */
export function generateStableSelector(node) {
  const { tagName, id, attributes = {} } = node;

  // Priority 1: id
  if (id) {
    const safeId = id.replace(/^[0-9]/, '\\3$& ').replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
    return `#${safeId}`;
  }

  // Priority 2: data-view-id or data-component
  if (attributes['data-view-id']) return `[data-view-id="${attributes['data-view-id']}"]`;
  if (attributes['data-component']) return `[data-component="${attributes['data-component']}"]`;
  if (attributes['data-testid']) return `[data-testid="${attributes['data-testid']}"]`;

  // Priority 3: first non-hashed class (only if at least one class is stable)
  const classAttr = attributes.class;
  if (classAttr) {
    const classes = classAttr.split(/\s+/).filter(Boolean);
    const stable = classes.find((c) => isStableClassName(c));
    if (stable) {
      const safe = stable.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
      return `.${safe}`;
    }
    // If all classes are CSS Modules hashes, do NOT fall back to classes[0].
    // Let the function fall through to role/tag-based selectors instead.
  }

  // Priority 4: role attribute
  if (attributes.role) return `[role="${attributes.role}"]`;

  // Priority 5: semantic landmark tags
  const landmarks = new Set([
    'main',
    'aside',
    'nav',
    'header',
    'footer',
    'dialog',
    'section',
    'article',
  ]);
  if (landmarks.has(tagName)) return tagName;

  return null;
}

/**
 * Generate a full-path CSS selector (parent > child hierarchy).
 * Used as the `selector` field in the output.
 *
 * @param {object} node - A node from the captured elements array.
 * @param {Map<number, object>} [indexById] - Optional mapping for path reconstruction.
 * @returns {string} A CSS selector path string.
 */
export function generateFullPathSelector(node) {
  const _parts = [];
  const { tagName, id, attributes = {} } = node;

  if (id) return `#${id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)}`;

  const classAttr = attributes.class;
  if (classAttr) {
    const first = classAttr.split(/\s+/).filter(Boolean)[0];
    if (first) return `${tagName}.${first.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)}`;
  }

  return tagName;
}

/**
 * Determine if a class name is "stable" (not generated by CSS Modules).
 * Filters out hash-suffixed class names like `_assistantRow_14nyt_184`.
 *
 * Uses the same detection logic as scripts/lib/css-modules-matcher.mjs
 * (CSS_MODULES_PATTERN) for consistency across the codebase.
 *
 * @param {string} className
 * @returns {boolean}
 */
function isStableClassName(className) {
  if (className.length > 80) return false;
  if (/^css-[a-z0-9]{6,}$/i.test(className)) return false;
  // CSS Modules pattern: _stem_hash (e.g. _assistantRow_14nyt_184, _header_abc123)
  if (/^_[a-zA-Z][a-zA-Z0-9]*(?:_[a-z0-9]{2,})+$/.test(className)) return false;
  // Hex hash suffix (8+ consecutive hex chars)
  if (/(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(className)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sensitive information filtering
// ---------------------------------------------------------------------------

/**
 * Filter a single element's attributes to remove sensitive data.
 * Strips text content, form values, accessible names, URLs, and query/hash.
 *
 * @param {Record<string, string>} attributes - Raw attribute key-value pairs.
 * @returns {Record<string, string>} Filtered attributes.
 */
export function filterSensitiveAttributes(attributes) {
  const result = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (SENSITIVE_ATTRIBUTES.includes(name)) continue;
    if (name.startsWith('data-src') || name.startsWith('data-href')) continue;
    if (name === 'value' || name === 'placeholder') continue;
    result[name] = value;
  }
  return result;
}

/**
 * Check if an element should be excluded from the snapshot based on its tag.
 *
 * @param {string} tagName - Lowercase tag name.
 * @returns {boolean} True if the element should be excluded.
 */
export function isExcludedTag(tagName) {
  return EXCLUDED_TAGS.includes(tagName.toUpperCase());
}

// ---------------------------------------------------------------------------
// Landmark matching
// ---------------------------------------------------------------------------

/**
 * Match an element against known semantic landmark patterns.
 * Returns the landmark name if matched, or null.
 *
 * @param {object} node - A captured element node.
 * @param {string} adapterId - The adapter identifier for adapter-specific matching.
 * @returns {string|null} Landmark match name or null.
 */
export function matchLandmark(node, _adapterId) {
  const { tagName, attributes = {} } = node;
  const role = attributes.role;
  const id = node.id || '';

  // Role-based matching (highest priority)
  if (role) {
    const roleMap = {
      main: 'main-content',
      navigation: 'nav',
      complementary: 'sidebar',
      banner: 'header',
      contentinfo: 'footer',
      dialog: 'dialog',
      search: 'search',
    };
    if (roleMap[role]) return roleMap[role];
  }

  // ID-based matching
  if (id) {
    const idLower = id.toLowerCase();
    if (/root|app|main/.test(idLower)) return 'root';
    if (/chat|conversation|message/.test(idLower)) return 'chat-surface';
    if (/side|panel|aside/.test(idLower)) return 'sidebar';
    if (/header|banner|top/.test(idLower)) return 'header';
    if (/footer|bottom/.test(idLower)) return 'footer';
    if (/input|compose|editor/.test(idLower)) return 'input-area';
    if (/nav|menu|tab/.test(idLower)) return 'nav';
  }

  // Class-based matching
  const classAttr = attributes.class || '';
  if (classAttr) {
    const clsLower = classAttr.toLowerCase();
    if (/chat|conversation|message/.test(clsLower)) return 'chat-surface';
    if (/side|panel|aside/.test(clsLower)) return 'sidebar';
    if (/header|banner|top-bar/.test(clsLower)) return 'header';
    if (/footer|bottom-bar/.test(clsLower)) return 'footer';
    if (/input|compose|editor/.test(clsLower)) return 'input-area';
    if (/nav|menu|sidebar-nav/.test(clsLower)) return 'nav';
  }

  // Tag-based fallback
  if (tagName === 'main') return 'main-content';
  if (tagName === 'nav') return 'nav';
  if (tagName === 'aside') return 'sidebar';
  if (tagName === 'header') return 'header';
  if (tagName === 'footer') return 'footer';

  return null;
}

// ---------------------------------------------------------------------------
// Snapshot orchestration
// ---------------------------------------------------------------------------

/**
 * Capture a DOM snapshot from a CDP-connected page.
 *
 * Connects to the target page, runs the capture expression, filters results,
 * generates selectors, matches landmarks, and returns the final JSON document.
 *
 * @param {object} options
 * @param {string} options.wsUrl - CDP WebSocket debugger URL.
 * @param {string} options.adapter - Adapter identifier (e.g. "workbuddy").
 * @param {number} [options.maxElements] - Maximum elements to record.
 * @param {boolean} [options.includeHidden] - Whether to include hidden elements.
 * @param {object} [options.cdpClient] - Optional pre-connected CDP client (for testing).
 * @returns {Promise<object>} The structured DOM snapshot JSON document.
 */
export async function captureDomSnapshot({
  wsUrl,
  adapter,
  maxElements = DEFAULT_MAX_ELEMENTS,
  includeHidden = false,
  cdpClient = null,
}) {
  let client = cdpClient;
  let shouldClose = false;

  if (!client) {
    client = new CdpClient(wsUrl);
    await client.connect();
    shouldClose = true;
  }

  try {
    // Enable Runtime domain
    await client.send('Runtime.enable').catch(() => {});

    // Run the capture expression in-page
    const expression = buildCaptureExpression({ maxElements, includeHidden });
    const { result } = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      timeout: COMMAND_TIMEOUT,
    });

    // Parse the in-page result
    let raw;
    try {
      raw = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    } catch {
      throw new Error('Failed to parse DOM snapshot result from page');
    }

    const {
      url = '',
      totalElements = 0,
      filteredElements = 0,
      truncated = false,
      nodes = [],
    } = raw;

    // Transform nodes into the output format
    const elements = [];
    let landmarkMatches = 0;

    for (const node of nodes) {
      const stableSelector = generateStableSelector(node);
      const selector = generateFullPathSelector(node);
      const landmark = matchLandmark(node, adapter);
      if (landmark) landmarkMatches++;

      // Apply final privacy filter to attributes
      const filteredAttrs = filterSensitiveAttributes(node.attributes);

      elements.push({
        tagName: node.tagName,
        selector,
        stableSelector,
        attributes: filteredAttrs,
        boundingBox: node.boundingBox,
        computedStyle: node.computedStyle,
        ...(landmark ? { landmarkMatch: landmark } : {}),
      });
    }

    const snapshot = {
      adapter,
      timestamp: new Date().toISOString(),
      url,
      elements,
      stats: {
        totalElements,
        filteredElements,
        recordedElements: elements.length,
        landmarkMatches,
        truncated,
      },
    };

    return snapshot;
  } finally {
    if (shouldClose) client.close();
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments into an options object.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {object} Parsed options.
 */
export function parseArgs(argv) {
  const args = {
    adapter: null,
    port: null,
    includeHidden: false,
    out: null,
    maxElements: DEFAULT_MAX_ELEMENTS,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port':
        args.port = parseInt(argv[++i], 10);
        break;
      case '--adapter':
        args.adapter = argv[++i];
        break;
      case '--include-hidden':
        args.includeHidden = true;
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--max-elements':
        args.maxElements = parseInt(argv[++i], 10);
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
    }
  }

  return args;
}

/** Print CLI usage information. */
function printUsage() {
  console.log(`dom-snapshot.mjs — DOM Snapshot API for AI-Assisted Theme Creation

Usage:
  node scripts/dom-snapshot.mjs --port <port> --adapter <adapter> [options]

Options:
  --port <port>           CDP remote debugging port (required)
  --adapter <adapter>     Adapter identifier: workbuddy|codex|traework|qoderwork|doubao|zcode
  --include-hidden        Include invisible elements (display:none, visibility:hidden, opacity:0)
  --max-elements <n>      Maximum elements to record (default: ${DEFAULT_MAX_ELEMENTS})
  --out <file>            Write JSON output to file instead of stdout
  --help, -h              Show this help

Output:
  JSON document with adapter, timestamp, url, elements[], stats
`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.port || !args.adapter) {
    console.error('Error: --port and --adapter are required.');
    printUsage();
    process.exit(1);
  }

  // Construct CDP WebSocket URL (assumes single target on localhost)
  const wsUrl = `ws://127.0.0.1:${args.port}/devtools/page`;

  console.error(`Capturing DOM snapshot: adapter=${args.adapter}, port=${args.port}`);

  try {
    const snapshot = await captureDomSnapshot({
      wsUrl,
      adapter: args.adapter,
      maxElements: args.maxElements,
      includeHidden: args.includeHidden,
    });

    const json = JSON.stringify(snapshot, null, 2);

    if (args.out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(args.out, json);
      console.error(`Snapshot written to ${args.out}`);
    } else {
      console.log(json);
    }

    console.error(
      `Done: ${snapshot.stats.recordedElements} elements, ${snapshot.stats.landmarkMatches} landmarks`,
    );
  } catch (e) {
    console.error(`Snapshot failed: ${e.message}`);
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported for testing).
if (import.meta.main) {
  main();
}
