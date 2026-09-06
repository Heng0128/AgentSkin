// SPDX-License-Identifier: MPL-2.0
// Dead Code Detector for AgentSkin
// Identifies unused exports and duplicate implementations

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcDir = join(root, 'src');

function collectFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.workbuddy') continue;
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

// Extract all exports from a file
function getExportedNames(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const names = [];

  // export function/const/class/type
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:abstract\s+)?class\s+(\w+)/g,
    /export\s+(?:interface|type)\s+(\w+)(?:\s*=|\s*\{|\s+extends)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+enum\s+(\w+)/g,
    /export\s+\{([^}]+)\}/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match !== null) {
      if (pattern.toString().includes('{')) {
        // Handle export { A, B }
        const namesStr = match[1];
        for (const name of namesStr.split(',')) {
          const trimmed = name
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim();
          if (trimmed && !trimmed.startsWith('//')) {
            names.push(trimmed);
          }
        }
      } else {
        names.push(match[1]);
      }
      match = pattern.exec(content);
    }
  }

  return names;
}

// Extract import references of a specific name across all files
function countReferences(targetName, allFiles, sourceFile) {
  let count = 0;
  const refPatterns = [new RegExp(`\\b${targetName}\\b`, 'g')];

  for (const file of allFiles) {
    if (file === sourceFile) continue;
    const content = readFileSync(file, 'utf8');
    // Skip test file matches to main code exports
    if (file.endsWith('.test.ts') && content.includes('import')) {
      // Only count if this test specifically imports from the source
      const importFromSource =
        content.includes(`from`) &&
        allFiles.find(
          (f) =>
            f === sourceFile &&
            content.includes(
              relative(dirname(file), sourceFile).replace(/\\/g, '/').replace('.ts', ''),
            ),
        );
      if (!importFromSource && !content.includes(targetName)) continue;
    }

    for (const pattern of refPatterns) {
      pattern.lastIndex = 0;
      while (pattern.exec(content)) {
        count++;
      }
    }
  }
  return count;
}

// Find file by name (potential duplicate)
function _findSimilarFiles(files, baseName) {
  const matches = [];
  for (const f of files) {
    const fBase = f
      .split('/')
      .pop()
      ?.replace(/\.(ts|tsx)$/, '');
    if (fBase && (fBase.includes(baseName) || baseName.includes(fBase))) {
      matches.push(f);
    }
  }
  return matches;
}

// Collect all files
const files = collectFiles(srcDir);
console.log(`Scanning ${files.length} files for dead code...\n`);

const exportMap = new Map(); // name -> [{file, references}]
const _totalExports = 0;
const deadExports = [];

for (const file of files) {
  const relPath = relative(srcDir, file).replace(/\\/g, '/');
  if (file.includes('/test') || file.includes('/tests/')) continue;

  const exportedNames = getExportedNames(file);
  for (const name of exportedNames) {
    // Skip common/re-exports and type-only names that might be used implicitly
    if (name.startsWith('use') && name !== 'useId') {
      // React hooks are hard to track - likely used
      continue;
    }

    const refs = countReferences(name, files, file);
    exportMap.set(`${relPath}::${name}`, { file: relPath, name, refs });
    if (refs === 0) {
      deadExports.push({ file: relPath, name });
    }
  }
}

// Simple duplicate detection: files with similar structure
function detectDuplicates(files) {
  const fileContents = new Map();
  const duplicates = [];

  // Read function signatures of files in same directory
  for (const file of files) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const content = readFileSync(file, 'utf8');
    const funcSignatures = [];

    const funcRegex = /export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?/g;
    let match = funcRegex.exec(content);
    while (match !== null) {
      funcSignatures.push(match[0].replace(/\s+/g, ' '));
      match = funcRegex.exec(content);
    }

    if (funcSignatures.length > 0) {
      fileContents.set(file, funcSignatures);
    }
  }

  // Compare function signatures across files
  const processed = new Set();
  for (const [file1, sigs1] of fileContents) {
    if (processed.has(file1)) continue;
    for (const [file2, sigs2] of fileContents) {
      if (file1 === file2 || processed.has(file2)) continue;

      const common = sigs1.filter((s1) => sigs2.some((s2) => similarity(s1, s2) > 0.8));
      if (common.length >= 2) {
        duplicates.push({
          files: [
            relative(srcDir, file1).replace(/\\/g, '/'),
            relative(srcDir, file2).replace(/\\/g, '/'),
          ],
          commonFunctions: common.length,
          similarity: ((common.length / Math.min(sigs1.length, sigs2.length)) * 100).toFixed(0),
        });
        processed.add(file2);
      }
    }
  }
  return duplicates;
}

function similarity(a, b) {
  const aWords = new Set(a.split(/\s+/));
  const bWords = new Set(b.split(/\s+/));
  const intersection = new Set([...aWords].filter((w) => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);
  return intersection.size / union.size;
}

// Output results
console.log('=== DEAD CODE DETECTION REPORT ===\n');
console.log(`Total exports tracked: ${exportMap.size}`);
console.log(`Zero-reference exports: ${deadExports.length}\n`);

console.log('--- Potentially Dead Exports (top 30) ---\n');
// Filter out likely false positives
const filteredDead = deadExports.filter((d) => {
  // Skip React components (hard to detect)
  if (d.name[0] === d.name[0].toUpperCase() && d.name[0] !== d.name[0].toLowerCase()) return false;
  // Skip index re-exports
  if (d.file.endsWith('/index.ts')) return false;
  // Skip common utility exports
  if (['default', 'config', 'options', 'settings', 'types'].includes(d.name.toLowerCase()))
    return false;
  return true;
});

if (filteredDead.length === 0) {
  console.log('✅ No clear dead exports detected');
} else {
  for (const d of filteredDead.slice(0, 30)) {
    console.log(`  ${d.file}: ${d.name}`);
  }
  if (filteredDead.length > 30) {
    console.log(`  ... and ${filteredDead.length - 30} more`);
  }
}

// Duplicate detection
console.log('\n--- Duplicate Implementations ---\n');
const duplicates = detectDuplicates(files);
if (duplicates.length === 0) {
  console.log('✅ No significant duplicate implementations detected');
} else {
  for (const dup of duplicates) {
    console.log(`  Files: ${dup.files.join(' <-> ')}`);
    console.log(`  Common functions: ${dup.commonFunctions} (${dup.similarity}% similar)\n`);
  }
}

// Summary
console.log('=== DEAD CODE SUMMARY ===');
console.log(`Dead export candidates: ${filteredDead.length}`);
console.log(`Duplicate implementation groups: ${duplicates.length}`);

const results = {
  summary: {
    totalExports: exportMap.size,
    deadExports: filteredDead.length,
    duplicateGroups: duplicates.length,
  },
  deadExports: filteredDead.slice(0, 50),
  duplicates,
  timestamp: new Date().toISOString(),
};

import { writeFileSync } from 'node:fs';

writeFileSync(join(root, '.quality', 'dead-code-analysis.json'), JSON.stringify(results, null, 2));
console.log(`\nResults saved to .quality/dead-code-analysis.json`);
