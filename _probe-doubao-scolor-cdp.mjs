/**
 * Probe: Doubao --s-color-* coverage via CDP CSS domain
 * 走 CDP CSS.getStyleSheetText 获取所有样式表（包括跨域不可读的），然后统计
 * - 有多少条规则使用 --s-color-* 作为值
 * - 有多少条规则使用 --dbx-* 作为值
 * - 有多少条规则使用 --semi-color-* 作为值
 * - 采样真实使用场景
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 61055;

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/json/list',
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.commandTimeout = 15000;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WS error'));
      this.ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(m.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        } else if (msg.method) {
          const ls = this.listeners.get(msg.method);
          if (ls) ls.forEach(cb => cb(msg.params));
        }
      };
      setTimeout(() => reject(new Error('WS timeout')), 12000);
    });
  }
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
  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }
  close() { if (this.ws) this.ws.close(); }
}

async function getAllStyleSheetsViaCdp(client) {
  // Enable DOM agent first, then CSS domain
  await client.send('DOM.enable');

  // Collect style sheets from styleSheetAdded events (fires for all existing + new)
  const headers = [];
  client.on('CSS.styleSheetAdded', (p) => {
    headers.push({
      styleSheetId: p.header.styleSheetId,
      sourceURL: p.header.sourceURL || '',
      isInline: p.header.isInline || false
    });
  });
  await client.send('CSS.enable');

  // Give a moment for styleSheetAdded events to arrive
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`Got ${headers.length} total style sheets from CDP events`);

  const sheets = [];
  let failed = 0;

  for (const header of headers) {
    try {
      const { text } = await client.send('CSS.getStyleSheetText', {
        styleSheetId: header.styleSheetId
      });
      sheets.push({
        id: header.styleSheetId,
        href: header.sourceURL || `inline-${header.styleSheetId}`,
        isInline: header.isInline,
        length: (text || '').length,
        text: text || ''
      });
    } catch (e) {
      failed++;
      console.warn(`  Failed for ${header.sourceURL || header.styleSheetId}: ${e.message}`);
    }
  }

  console.log(`Fetched ${sheets.length} texts, failed ${failed}`);
  return { sheets, failed };
}

function analyzeTokenConsumption(sheets) {
  const result = {
    sColor: { rules: 0, samples: [], count: 0 },
    dbx: { rules: 0, samples: [], count: 0 },
    semi: { rules: 0, samples: [], count: 0 },
    ffc: { rules: 0, samples: [], count: 0 },
  };

  const MAX_SAMPLES = 20;

  for (const sheet of sheets) {
    if (!sheet.text || sheet.text.length === 0) continue;

    // Regex to extract all rules with their content
    const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
    let match;

    while ((match = ruleRegex.exec(sheet.text)) !== null) {
      const selector = match[1].trim();
      const body = match[2];

      // Check for each token family usage
      const sColorMatches = (body.match(/--s-color-[a-z0-9-_]+/g) || []);
      const dbxMatches = (body.match(/--dbx-[a-z0-9-_]+/g) || []);
      const semiMatches = (body.match(/--semi-color-[a-z0-9-_]+/g) || []);
      const ffcMatches = (body.match(/--ffc-[a-z0-9-_]+/g) || []);

      result.sColor.count += sColorMatches.length;
      result.dbx.count += dbxMatches.length;
      result.semi.count += semiMatches.length;
      result.ffc.count += ffcMatches.length;

      if (sColorMatches.length > 0) {
        result.sColor.rules++;
        if (result.sColor.samples.length < MAX_SAMPLES) {
          result.sColor.samples.push({
            sheet: sheet.href.split('/').pop(),
            selector: selector.slice(0, 120),
            usages: sColorMatches.length,
            tokens: sColorMatches.slice(0, 5)
          });
        }
      }

      if (dbxMatches.length > 0) {
        result.dbx.rules++;
        if (result.dbx.samples.length < MAX_SAMPLES) {
          result.dbx.samples.push({
            sheet: sheet.href.split('/').pop(),
            selector: selector.slice(0, 120),
            usages: dbxMatches.length,
            tokens: dbxMatches.slice(0, 5)
          });
        }
      }

      if (semiMatches.length > 0) {
        result.semi.rules++;
        if (result.semi.samples.length < MAX_SAMPLES) {
          result.semi.samples.push({
            sheet: sheet.href.split('/').pop(),
            selector: selector.slice(0, 120),
            usages: semiMatches.length,
            tokens: semiMatches.slice(0, 5)
          });
        }
      }

      if (ffcMatches.length > 0) {
        result.ffc.rules++;
        if (result.ffc.samples.length < MAX_SAMPLES) {
          result.ffc.samples.push({
            sheet: sheet.href.split('/').pop(),
            selector: selector.slice(0, 120),
            usages: ffcMatches.length,
            tokens: ffcMatches.slice(0, 5)
          });
        }
      }
    }
  }

  return result;
}

async function getComputedRootTokens(client) {
  // Get computed values for the key tokens to verify our overrides are working
  const expression = `
    (() => {
      const get = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return {
        '--s-color-bg-body': get('--s-color-bg-body'),
        '--s-color-bg-primary': get('--s-color-bg-primary'),
        '--s-color-text-primary': get('--s-color-text-primary'),
        '--s-color-brand-primary-default': get('--s-color-brand-primary-default'),
        '--dbx-bg-float': get('--dbx-bg-float'),
        '--dbx-text-primary': get('--dbx-text-primary'),
        '--semi-color-bg-0': get('--semi-color-bg-0'),
        '--semi-color-text-0': get('--semi-color-text-0'),
        '--semi-color-primary': get('--semi-color-primary'),
      };
    })()
  `;

  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  return r.exceptionDetails ? null : r.result.value;
}

async function main() {
  console.log('Connecting to Doubao @ 127.0.0.1:%d...', PORT);
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('doubao-background'));
  if (!page) { console.error('No chat page found'); return; }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log('Connected: %s\n', page.title);

  // 1. Get all style sheets via CDP
  const { sheets } = await getAllStyleSheetsViaCdp(client);

  // 2. Analyze token consumption
  const consumption = analyzeTokenConsumption(sheets);

  // 3. Get computed token values to verify override effect
  const computedRoot = await getComputedRootTokens(client);

  // 4. Get root document stats for class usage
  const r = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const out = {
          rootAttrs: {},
          rootClass: document.documentElement.className,
          bodyClass: document.body.className,
        };
        for (const attr of document.documentElement.attributes) {
          if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'style') {
            out.rootAttrs[attr.name] = attr.value;
          }
        }
        // Count elements by prefix
        out.sColorClassElements = document.querySelectorAll('[class*="s-color-"], [class*="s-color"]').length;
        out.dbxClassElements = document.querySelectorAll('[class*="dbx-"]').length;
        out.semiClassElements = document.querySelectorAll('[class*="semi-color-"]').length;
        return JSON.stringify(out);
      })()
    `,
    returnByValue: true
  });
  const domStats = JSON.parse(r.result.value);

  client.close();

  // Output summary
  console.log('\n=== Token Consumption (by CSS rules) ===');
  console.log('  --s-color-*  : %d rules, %d total usages', consumption.sColor.rules, consumption.sColor.count);
  console.log('  --dbx-*      : %d rules, %d total usages', consumption.dbx.rules, consumption.dbx.count);
  console.log('  --semi-color-*: %d rules, %d total usages', consumption.semi.rules, consumption.semi.count);
  console.log('  --ffc-*      : %d rules, %d total usages', consumption.ffc.rules, consumption.ffc.count);

  console.log('\n=== DOM Class Element Counts ===');
  console.log('  .*s-color.* : %d elements', domStats.sColorClassElements);
  console.log('  .*dbx-.*    : %d elements', domStats.dbxClassElements);
  console.log('  .*semi-color.*: %d elements', domStats.semiClassElements);

  console.log('\n=== Computed Root Token Values (verify overrides) ===');
  if (computedRoot) {
    for (const [key, val] of Object.entries(computedRoot)) {
      console.log('  %s = %s', key, val);
    }
  }

  // Save full result
  const fullResult = {
    generatedAt: new Date().toISOString(),
    sheetCount: sheets.length,
    consumption,
    computedRoot,
    domStats
  };

  const outPath = path.resolve(process.cwd(), 'agents-run-now/doubao-scolor-full-cdp.json');
  fs.writeFileSync(outPath, JSON.stringify(fullResult, null, 2), 'utf-8');
  console.log('\nFull report saved to: agents-run-now/doubao-scolor-full-cdp.json');
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
