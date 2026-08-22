// SPDX-License-Identifier: MPL-2.0
// Custom dependency graph analyzer for AgentSkin
// Detects circular dependencies without relying on madge

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcDir = join(root, 'src');

// Read tsconfig paths
const tsconfigPath = join(root, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
const paths = tsconfig?.compilerOptions?.paths || {};
const baseUrl = tsconfig?.compilerOptions?.baseUrl || '.';

// Resolve path aliases
function resolvePathAlias(importPath) {
  for (const [alias, mappings] of Object.entries(paths)) {
    const aliasPrefix = alias.replace('/*', '');
    if (importPath.startsWith(aliasPrefix)) {
      const rest = importPath.slice(aliasPrefix.length).replace(/^\//, '');
      for (const mapping of mappings) {
        const resolvedPath = mapping.replace('/*', '');
        return resolvedPath + (rest ? `/${rest}` : '');
      }
    }
  }
  return null;
}

// Resolve import to file
function resolveImport(from, importPath) {
  const fromDir = dirname(from);

  // Path alias
  const aliasResolved = resolvePathAlias(importPath);
  if (aliasResolved) {
    const fullPath = join(root, baseUrl === '.' ? '' : baseUrl, aliasResolved);
    return tryExtensions(fullPath);
  }

  // Relative import
  if (importPath.startsWith('.')) {
    const fullPath = resolve(fromDir, importPath);
    return tryExtensions(fullPath);
  }

  // External package (skip)
  return null;
}

function tryExtensions(basePath) {
  const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
  // Check if it's already a file with extension
  if (extname(basePath)) {
    if (existsSync(basePath)) return basePath;
  }
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function existsSync(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// Extract imports from file (excluding type-only imports which are erased at compile time)
function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const imports = [];

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip type-only imports (compiled away, no runtime dependency)
    if (trimmed.startsWith('import type')) continue;
    if (/^import\s+type\s+\{/.test(trimmed)) continue;

    // Match static imports: import ... from '...'
    const staticMatch = trimmed.match(/^import\s+.*?\s+from\s+['"](.+?)['"]/);
    if (staticMatch) {
      imports.push(staticMatch[1]);
      continue;
    }

    // Match dynamic imports: import('...')
    const dynamicMatch = trimmed.match(/import\s*\(\s*['"](.+?)['"]\s*\)/);
    if (dynamicMatch) {
      imports.push(dynamicMatch[1]);
      continue;
    }

    // Match require('...')
    const requireMatch = trimmed.match(/require\s*\(\s*['"](.+?)['"]\s*\)/);
    if (requireMatch) {
      imports.push(requireMatch[1]);
    }
  }

  return imports;
}

// Collect all source files
function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!['node_modules', '.git', '.next', 'out', '.workbuddy'].includes(entry)) {
        collectFiles(fullPath, files);
      }
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Build dependency graph
console.log('Building dependency graph...');
const files = collectFiles(srcDir);
console.log(`Found ${files.length} source files`);

const graph = new Map();
const fileToId = new Map();
let idCounter = 0;

for (const file of files) {
  const relPath = relative(srcDir, file).replace(/\\/g, '/');
  if (!fileToId.has(relPath)) {
    fileToId.set(relPath, idCounter++);
  }
  const imports = extractImports(file);
  const deps = [];

  for (const imp of imports) {
    const resolved = resolveImport(file, imp);
    if (resolved?.startsWith(srcDir)) {
      const depRelPath = relative(srcDir, resolved).replace(/\\/g, '/');
      if (!fileToId.has(depRelPath)) {
        fileToId.set(depRelPath, idCounter++);
      }
      deps.push(depRelPath);
    }
  }

  graph.set(relPath, deps);
}

// Detect cycles using DFS
console.log('Detecting circular dependencies...');
const WHITE = 0,
  GRAY = 1,
  BLACK = 2;
const color = new Map();
const _parent = new Map();
const cycles = [];

for (const file of graph.keys()) {
  color.set(file, WHITE);
}

function dfs(node, path = []) {
  color.set(node, GRAY);
  path.push(node);

  const neighbors = graph.get(node) || [];
  for (const neighbor of neighbors) {
    if (!graph.has(neighbor)) continue;

    if (color.get(neighbor) === GRAY) {
      // Found cycle
      const cycleStart = path.indexOf(neighbor);
      const cycle = path.slice(cycleStart);
      cycles.push([...cycle, neighbor]);
    } else if (color.get(neighbor) === WHITE) {
      dfs(neighbor, path);
    }
  }

  path.pop();
  color.set(node, BLACK);
}

for (const file of graph.keys()) {
  if (color.get(file) === WHITE) {
    dfs(file);
  }
}

// Deduplicate cycles
function normalizeCycle(cycle) {
  const minIndex = cycle
    .slice(0, -1)
    .reduce((minIdx, item, idx, arr) => (item < arr[minIdx] ? idx : minIdx), 0);
  const rotated = [...cycle.slice(minIndex, -1), ...cycle.slice(0, minIndex)];
  return `${rotated.join(' -> ')} -> ${rotated[0]}`;
}

const uniqueCycles = new Set();
const dedupedCycles = [];
for (const cycle of cycles) {
  const normalized = normalizeCycle(cycle);
  if (!uniqueCycles.has(normalized)) {
    uniqueCycles.add(normalized);
    dedupedCycles.push(cycle);
  }
}

// Output results
console.log('\\n=== CIRCULAR DEPENDENCY REPORT ===\\n');
if (dedupedCycles.length === 0) {
  console.log('✅ No circular dependencies detected');
} else {
  console.log(`❌ Found ${dedupedCycles.length} circular dependencies:\\n`);
  dedupedCycles.forEach((cycle, i) => {
    console.log(`Cycle ${i + 1}:`);
    console.log(`  ${cycle.slice(0, -1).join(' → ')} → [${cycle[cycle.length - 1]}]`);
    console.log();
  });
}

// Output statistics
const totalEdges = Array.from(graph.values()).reduce((sum, deps) => sum + deps.length, 0);
console.log('\\n=== DEPENDENCY STATISTICS ===\\n');
console.log(`Total modules: ${graph.size}`);
console.log(`Total edges: ${totalEdges}`);
console.log(`Circular dependencies: ${dedupedCycles.length}`);
console.log(`Average deps per module: ${(totalEdges / graph.size).toFixed(2)}`);

// Find cross-layer violations (UI -> API, utils -> business)
console.log('\\n=== LAYER BOUNDARY CHECK ===\\n');
const violations = [];
for (const [file, deps] of graph.entries()) {
  for (const dep of deps) {
    // UI component importing from api/services directly
    if (file.startsWith('ui/components/') && dep.includes('/api/')) {
      violations.push({ type: 'UI→API', from: file, to: dep });
    }
    if (file.startsWith('ui/pages/') && dep.includes('/api/')) {
      violations.push({ type: 'UI→API', from: file, to: dep });
    }
    // Shared importing from business logic
    if (
      file.startsWith('shared/') &&
      !dep.startsWith('shared/') &&
      !dep.startsWith('node_modules')
    ) {
      const depModule = dep.split('/')[0];
      if (['main', 'adapters', 'engine', 'ui'].includes(depModule)) {
        violations.push({ type: 'Shared→Business', from: file, to: dep });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✅ No layer boundary violations detected');
} else {
  console.log(`⚠️ Found ${violations.length} potential layer violations:\\n`);
  for (const v of violations) {
    console.log(`  [${v.type}] ${v.from} → ${v.to}`);
  }
}

// Export results for further processing
const results = {
  modules: graph.size,
  edges: totalEdges,
  circularDeps: dedupedCycles.map((cycle) => cycle.slice(0, -1)),
  violations,
  timestamp: new Date().toISOString(),
};

const outputPath = join(root, '.quality', 'dep-analysis.json');

import { writeFileSync } from 'node:fs';

writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\\nResults saved to ${outputPath}`);
