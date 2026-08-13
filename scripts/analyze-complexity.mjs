// Complexity hotspot analyzer for AgentSkin
// Identifies high-complexity files based on nesting, function length, and file size

import { execSync } from 'node:child_process';
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

function analyzeFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const lineCount = lines.length;

  // Count max nesting depth
  let maxNesting = 0;
  let currentNesting = 0;
  let functionCount = 0;
  const longFunctions = [];
  let anyTypeCount = 0;
  let currentFunctionStart = -1;
  let currentFunctionLines = 0;
  let inFunction = false;

  const functionPatterns = [
    /^(export\s+)?(async\s+)?function\s+\w+/,
    /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/,
    /^(export\s+)?\w+\s*[:(].*=>/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track braces for nesting
    for (const char of line) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        currentNesting--;
        if (currentNesting < 0) currentNesting = 0;
      }
    }

    // Detect function start if nesting is at level 1 (file-level)
    if (currentNesting <= 1) {
      for (const pattern of functionPatterns) {
        if (pattern.test(line) || (line.includes('(') && line.includes('=>'))) {
          if (inFunction && currentFunctionLines > 50) {
            longFunctions.push({ line: currentFunctionStart + 1, lines: currentFunctionLines });
          }
          functionCount++;
          inFunction = true;
          currentFunctionStart = i;
          currentFunctionLines = 1;
          break;
        }
      }
    } else if (inFunction) {
      currentFunctionLines++;
    }

    // Count any types
    if (/\bany\b/.test(line) && !/\/\//.test(line.split('any')[0])) {
      anyTypeCount++;
    }
  }

  // Check for long file-level functions at end
  if (inFunction && currentFunctionLines > 50) {
    longFunctions.push({ line: currentFunctionStart + 1, lines: currentFunctionLines });
  }

  // Detect deeply nested patterns (>4 levels)
  const deepNestingPatterns = lines.filter((line) => {
    const indent = line.match(/^(\s*)/)?.[1]?.length || 0;
    return indent >= 16; // 4+ levels of 4-space indentation
  }).length;

  return {
    lineCount,
    maxNesting,
    functionCount,
    longFunctions,
    anyTypeCount,
    deepNestingPatternLines: deepNestingPatterns,
  };
}

// Get git change frequency
function _getGitFrequency(filePath) {
  try {
    const relPath = relative(root, filePath);
    const result = execSync(`git log --oneline -- "${relPath}" 2>/dev/null | wc -l`, {
      encoding: 'utf8',
      cwd: root,
      shell: 'powershell.exe',
    });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// Analyze all files
const files = collectFiles(srcDir);
console.log(`Analyzing ${files.length} source files...\n`);

const hotspots = [];
const severityCount = { high: 0, medium: 0, low: 0 };

for (const file of files) {
  const relPath = relative(srcDir, file).replace(/\\/g, '/');
  const analysis = analyzeFile(file);

  // Skip test files from complexity analysis (different standards)
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;

  let score = 0;
  const issues = [];

  // File length scoring
  if (analysis.lineCount > 600) {
    score += 3;
    issues.push(`Very large: ${analysis.lineCount} lines`);
  } else if (analysis.lineCount > 400) {
    score += 2;
    issues.push(`Large: ${analysis.lineCount} lines`);
  } else if (analysis.lineCount > 300) {
    score += 1;
    issues.push(`Moderate: ${analysis.lineCount} lines`);
  }

  // Nesting depth scoring
  if (analysis.maxNesting > 6) {
    score += 3;
    issues.push(`Deep nesting: ${analysis.maxNesting}`);
  } else if (analysis.maxNesting > 4) {
    score += 2;
    issues.push(`Moderate nesting: ${analysis.maxNesting}`);
  }

  // Long functions
  if (analysis.longFunctions.length > 0) {
    score += analysis.longFunctions.length * 2;
    issues.push(`Long functions: ${analysis.longFunctions.length}`);
  }

  // any types
  if (analysis.anyTypeCount > 10) {
    score += 2;
    issues.push(`Many any: ${analysis.anyTypeCount}`);
  } else if (analysis.anyTypeCount > 5) {
    score += 1;
    issues.push(`Some any: ${analysis.anyTypeCount}`);
  }

  // Deep nesting patterns (indentation-based)
  if (analysis.deepNestingPatternLines > 20) {
    score += 2;
    issues.push(`Deep indentation blocks: ${analysis.deepNestingPatternLines} lines`);
  }

  if (score >= 4) {
    severityCount.high++;
    hotspots.push({
      severity: 'HIGH',
      path: relPath,
      score,
      issues,
      stats: analysis,
    });
  } else if (score >= 2) {
    severityCount.medium++;
    hotspots.push({
      severity: 'MEDIUM',
      path: relPath,
      score,
      issues,
      stats: analysis,
    });
  } else if (score >= 1) {
    severityCount.low++;
    hotspots.push({
      severity: 'LOW',
      path: relPath,
      score,
      issues,
      stats: analysis,
    });
  }
}

// Output results
console.log('=== COMPLEXITY HOTSPOT REPORT ===\n');
console.log(`Summary:`);
console.log(`  HIGH severity: ${severityCount.high}`);
console.log(`  MEDIUM severity: ${severityCount.medium}`);
console.log(`  LOW severity: ${severityCount.low}`);
console.log(`\nTotal hotspots: ${hotspots.length}\n`);

// Sort by score
hotspots.sort((a, b) => b.score - a.score);

let currentSeverity = null;
for (const h of hotspots) {
  if (h.severity !== currentSeverity) {
    currentSeverity = h.severity;
    console.log(`\n[${currentSeverity}] Complexity Hotspots:\n`);
  }
  console.log(`  ${h.path} (score: ${h.score})`);
  for (const issue of h.issues) {
    console.log(`    - ${issue}`);
  }
}

// Export results
const results = {
  summary: severityCount,
  hotspots: hotspots.map((h) => ({
    ...h,
    stats: undefined, // Remove raw stats from output
    ...h.stats,
  })),
  timestamp: new Date().toISOString(),
};

import { writeFileSync } from 'node:fs';

writeFileSync(join(root, '.quality', 'complexity-analysis.json'), JSON.stringify(results, null, 2));
console.log(`\nResults saved to .quality/complexity-analysis.json`);
