// SPDX-License-Identifier: MPL-2.0
// API Surface Auditor for AgentSkin
// Extracts exported symbols and validates against documentation

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcDir = join(root, 'src');

function collectFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractExports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const exports = {
    functions: [],
    classes: [],
    types: [],
    interfaces: [],
    constants: [],
    enums: [],
    reexports: [],
  };

  // Match export declarations
  const lines = content.split('\n');
  let jsdocComment = '';
  let inJsdoc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track JSDoc comments
    if (line.startsWith('/**')) {
      inJsdoc = true;
      jsdocComment = line;
      continue;
    }
    if (inJsdoc) {
      jsdocComment += `\n${line}`;
      if (line.includes('*/')) {
        inJsdoc = false;
      }
      continue;
    }

    // Skip non-export lines
    if (!line.startsWith('export')) continue;

    const hasJSDoc = jsdocComment.length > 0;
    const tags = parseJsdocTags(jsdocComment);

    // export function
    const funcMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      exports.functions.push({
        name: funcMatch[1],
        documented: hasJSDoc,
        deprecated: tags.deprecated !== undefined,
        returnsAny: line.includes(': any') || line.includes(': any;'),
        paramsHaveAny: /\(\s*[^)]*\bany\b/.test(line),
        hasReturnType:
          /:\s*(?!void)/.test(line.split('{')[0]) || /:\s*(?!void)/.test(line.split('=>')[0]),
      });
      jsdocComment = '';
      continue;
    }

    // export class
    const classMatch = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      exports.classes.push({
        name: classMatch[1],
        documented: hasJSDoc,
        deprecated: tags.deprecated !== undefined,
      });
      jsdocComment = '';
      continue;
    }

    // export interface
    const ifaceMatch = line.match(/^export\s+(?:interface|type)\s+(\w+)/);
    if (ifaceMatch) {
      const typeEntry = {
        name: ifaceMatch[1],
        documented: hasJSDoc,
        deprecated: tags.deprecated !== undefined,
        containsAny: false,
      };
      // Check the full type definition for any usage near the declaration
      const nextLines = lines.slice(i, Math.min(i + 10, lines.length)).join('\n');
      typeEntry.containsAny = /\bany\b[^:]/.test(nextLines);
      exports.types.push(typeEntry);
      jsdocComment = '';
      continue;
    }

    // export const/let/var
    const constMatch = line.match(/^export\s+(?:const|let|var)\s+(\w+)/);
    if (constMatch) {
      exports.constants.push({
        name: constMatch[1],
        documented: hasJSDoc,
        deprecated: tags.deprecated !== undefined,
        containsAny: /:\s*any\b/.test(line),
      });
      jsdocComment = '';
      continue;
    }

    // export enum
    const enumMatch = line.match(/^export\s+enum\s+(\w+)/);
    if (enumMatch) {
      exports.enums.push({
        name: enumMatch[1],
        documented: hasJSDoc,
      });
      jsdocComment = '';
      continue;
    }

    // export { ... } or export * from
    if (line.match(/^export\s+\{/) || line.match(/^export\s+\*/)) {
      exports.reexports.push({
        line: line.slice(0, 80),
        documented: hasJSDoc,
      });
      jsdocComment = '';
    }
  }

  return exports;
}

function parseJsdocTags(comment) {
  const tags = {};
  const lines = comment.split('\n');
  for (const line of lines) {
    const trimmed = line.trim().replace(/^\*\s*/, '');
    if (trimmed.startsWith('@deprecated')) {
      tags.deprecated = trimmed.replace('@deprecated', '').trim();
    }
    if (trimmed.startsWith('@param')) {
      // Check for any type params
    }
    if (trimmed.startsWith('@returns') || trimmed.startsWith('@return')) {
      tags.returns = trimmed;
    }
  }
  return tags;
}

// Analyze and collect
const files = collectFiles(srcDir);
console.log(`Auditing API surface across ${files.length} files...\n`);

const allExports = new Map();
const undocumented = [];
const deprecated = [];
const anyTypes = [];
let totalExported = 0;

for (const file of files) {
  const relPath = relative(srcDir, file).replace(/\\/g, '/');
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;

  const fileExports = extractExports(file);
  const moduleExports = [];

  for (const fn of fileExports.functions) {
    moduleExports.push({ ...fn, kind: 'function' });
    totalExported++;
    if (!fn.documented) undocumented.push({ ...fn, file: relPath });
    if (fn.deprecated) deprecated.push({ ...fn, file: relPath });
    if (fn.returnsAny || fn.paramsHaveAny)
      anyTypes.push({ ...fn, file: relPath, issue: 'has any params/return' });
  }

  for (const cls of fileExports.classes) {
    moduleExports.push({ ...cls, kind: 'class' });
    totalExported++;
    if (!cls.documented) undocumented.push({ ...cls, file: relPath });
    if (cls.deprecated) deprecated.push({ ...cls, file: relPath });
  }

  for (const t of fileExports.types) {
    moduleExports.push({ ...t, kind: 'type' });
    totalExported++;
    if (!t.documented) undocumented.push({ ...t, file: relPath });
    if (t.containsAny) anyTypes.push({ ...t, file: relPath, issue: 'contains any' });
  }

  for (const c of fileExports.constants) {
    moduleExports.push({ ...c, kind: 'constant' });
    totalExported++;
    if (!c.documented) undocumented.push({ ...c, file: relPath });
    if (c.deprecated) deprecated.push({ ...c, file: relPath });
    if (c.containsAny) anyTypes.push({ ...c, file: relPath, issue: 'typed as any' });
  }

  if (moduleExports.length > 0) {
    allExports.set(relPath, moduleExports);
  }
}

// Output results
console.log('=== API SURFACE AUDIT REPORT ===\n');
console.log(`Total exported symbols: ${totalExported}`);
console.log(`Modules with exports: ${allExports.size}`);

console.log(`\n--- Undocumented Exports (${undocumented.length}) ---`);
if (undocumented.length === 0) {
  console.log('✅ All public symbols are documented');
} else {
  const grouped = {};
  for (const u of undocumented) {
    if (!grouped[u.kind]) grouped[u.kind] = [];
    grouped[u.kind].push(u);
  }
  for (const [kind, items] of Object.entries(grouped)) {
    console.log(`\n  [${kind}] ${items.length} undocumented:`);
    // Show first 5
    for (const item of items.slice(0, 5)) {
      console.log(`    - ${item.file}: ${item.name}`);
    }
    if (items.length > 5) {
      console.log(`    ... and ${items.length - 5} more`);
    }
  }
}

console.log(`\n--- Deprecated Symbols Still in Use (${deprecated.length}) ---`);
for (const d of deprecated.slice(0, 20)) {
  console.log(`  - ${d.file}: ${d.name} [${d.deprecated}]`);
}

console.log(`\n--- Exports with 'any' Types (${anyTypes.length}) ---`);
for (const a of anyTypes.slice(0, 20)) {
  console.log(`  - ${a.file}: ${a.name} (${a.issue})`);
}

// API Stability Index
const documentedCount = totalExported - undocumented.length;
const stabilityIndex = ((documentedCount / totalExported) * 100).toFixed(1);
console.log(`\n--- API Stability Index ---`);
console.log(`  Documented: ${documentedCount}/${totalExported} (${stabilityIndex}%)`);
console.log(`  Undocumented: ${undocumented.length}`);
console.log(`  Deprecated: ${deprecated.length}`);
console.log(`  Any-typed: ${anyTypes.length}`);

// Export results
const results = {
  summary: {
    totalExported,
    modulesWithExports: allExports.size,
    undocumented: undocumented.length,
    deprecated: deprecated.length,
    anyTyped: anyTypes.length,
    stabilityIndex: parseFloat(stabilityIndex),
  },
  undocumented: undocumented.slice(0, 50),
  deprecated,
  anyTyped: anyTypes.slice(0, 50),
  timestamp: new Date().toISOString(),
};

import { writeFileSync } from 'node:fs';

writeFileSync(join(root, '.quality', 'api-audit.json'), JSON.stringify(results, null, 2));
console.log(`\nResults saved to .quality/api-audit.json`);
