#!/usr/bin/env node
/**
 * 安全污染扫描脚本 v3.0
 * 
 * 核心原则：
 * 1. 绝不自动删除/移动任何文件，只输出结构化报告
 * 2. 每个疑似污染文件必须读取内容
 * 3. 需要判断文件内容的性质（命令输出 / 配置文件 / 数据文件）
 * 4. 区分 "确认污染 — 建议清理" / "不确定 — 需人工确认" / "有价值 — 保留"
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = process.cwd();
const REPORT = { files: [], directories: [], summary: {} };

// ========== 工具函数 ==========

function readFilePreview(filePath, maxBytes = 2000) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const truncated = content.length > maxBytes ? content.slice(0, maxBytes) + '\n... (truncated)' : content;
    return {
      size: statSync(filePath).size,
      preview: truncated,
      isEmpty: content.trim().length === 0,
    };
  } catch {
    return null;
  }
}

function readFileContent(filePath) {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ========== 内容分析函数 ==========

function analyzeContent(filePath, content, ext) {
  // 判断是否为命令输出
  const commandOutputPatterns = [
    { pattern: /^(Checked|Fixed|Found|Processed|No fixes)/, tool: 'biome' },
    { pattern: /^(√|×|❯|✓|⎯⎯⎯)/, tool: 'vitest/tsc' },
    { pattern: /^(\[.*?\]\s*(POST|GET|server|handling))/m, tool: 'mcp/debug' },
    { pattern: /^(vite v\d|building|transforming|rendering|built in)/m, tool: 'vite' },
    { pattern: /^(This is not the tsc command)/m, tool: 'tsc-misuse' },
    { pattern: /^(-\s+Finding files|√\s+No circular)/m, tool: 'madge' },
    { pattern: /^(Test Files|Tests|Duration|Start at)/m, tool: 'vitest-summary' },
    { pattern: /^(\[Main\]|\[WARN\]|\[ERROR\]|\[INFO\])/m, tool: 'logger' },
    { pattern: /(node:|electron|\.exe)/, tool: 'runtime' },
  ];

  for (const { pattern, tool } of commandOutputPatterns) {
    if (pattern.test(content)) {
      return { type: 'command-output', tool };
    }
  }

  // 判断是否为 JSON/配置文件
  if (ext === '.json') {
    try {
      JSON.parse(content);
      return { type: 'json-data' };
    } catch { /* not valid json */ }
  }

  // 判断是否为 TypeScript 编译产物
  if (ext === '.tsbuildinfo') {
    return { type: 'compiler-cache' };
  }

  // 判断是否为日志文件（时间戳开头）
  if (/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/m.test(content)) {
    return { type: 'timestamped-log' };
  }

  // 无法确定
  return { type: 'unknown' };
}

// ========== 扫描逻辑 ==========

function scanRootFiles() {
  const results = [];
  
  const rootItems = readdirSync(ROOT, { withFileTypes: true })
    .filter(f => f.isFile())
    .map(f => f.name);
  
  for (const file of rootItems) {
    const ext = extname(file).toLowerCase();
    const fullPath = join(ROOT, file);
    
    // 跳过已知合法文件
    const whitelist = [
      'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
      '.gitignore', '.npmrc', '.nvmrc', 'README.md', 'CONTRIBUTING.md',
      'AGENTS.md', 'THEME_SPEC.md', '.gitattributes',
      'biome.json', 'biome.jsonc',
      'vite.config.ts', 'vite.config.test.ts',
      'vitest.config.ts', 'vitest.workspace.ts',
      'playwright.config.ts',
      'tailwind.config.ts',
      '.env.example', '.env.local',
      'electron-builder.json', 'electron-builder.yml',
      'index.html',
      'LICENSE',
    ];
    if (whitelist.includes(file)) continue;
    
    // 只关注潜在污染扩展名
    const suspectExts = ['.txt', '.log', '.tsbuildinfo', '.tmp', '.bak'];
    if (!suspectExts.includes(ext)) continue;
    
    const stat = statSync(fullPath);
    const { size, preview, isEmpty } = readFilePreview(fullPath);
    const content = readFileContent(fullPath);
    const analysis = analyzeContent(fullPath, content, ext);
    
    results.push({
      path: file,
      fullPath,
      extension: ext,
      sizeBytes: size,
      isEmpty,
      contentPreview: preview.slice(0, 500),
      analysis,
      recommendation: getRecommendation(analysis, isEmpty, size),
    });
  }
  
  return results;
}

function getRecommendation(analysis, isEmpty, size) {
  // 空文件 -> 可安全删除
  if (isEmpty) {
    return { action: 'delete-empty', confidence: 1.0, reason: '空文件，无内容' };
  }
  
  switch (analysis.type) {
    case 'command-output':
      return { action: 'delete-pollution', confidence: 0.95, reason: `${analysis.tool} 命令输出捕获` };
    case 'compiler-cache':
      return { action: 'delete-cache', confidence: 0.99, reason: '编译器缓存，可重新生成' };
    case 'timestamped-log':
      return { action: 'delete-log', confidence: 0.9, reason: '运行时日志输出' };
    case 'unknown':
      if (size < 100) {
        return { action: 'review-small', confidence: 0.5, reason: '小文件，内容无法识别，建议人工确认' };
      }
      return { action: 'review', confidence: 0.3, reason: '文件内容无法自动识别，需人工确认' };
    default:
      return { action: 'review', confidence: 0.4, reason: `类型为 ${analysis.type}，建议确认` };
  }
}

// ========== 输出报告 ==========

function generateReport(files) {
  let md = `# 路径污染扫描报告\n\n`;
  md += `**扫描时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
  md += `**扫描目录**: ${ROOT}\n\n`;
  md += `⚠️ **本报告仅用于评估，不执行任何删除操作**\n\n`;
  md += `---\n\n`;
  
  // 分类统计
  const categories = {
    '确认清理': files.filter(f => f.recommendation.action.startsWith('delete')),
    '需人工确认': files.filter(f => f.recommendation.action.startsWith('review')),
    '有价值保留': files.filter(f => f.recommendation.action === 'keep'),
  };
  
  md += `## 📊 扫描摘要\n\n`;
  md += `| 类别 | 数量 | 文件总大小 |\n`;
  md += `|------|------|------------|\n`;
  for (const [cat, items] of Object.entries(categories)) {
    const totalSize = items.reduce((sum, f) => sum + f.sizeBytes, 0);
    md += `| ${cat} | ${items.length} | ${(totalSize / 1024).toFixed(1)} KB |\n`;
  }
  md += `\n`;
  
  // 详细列表
  if (categories['确认清理'].length > 0) {
    md += `## ✅ 确认清理（高置信度）\n\n`;
    for (const f of categories['确认清理']) {
      md += `### \`${f.path}\`\n\n`;
      md += `- **大小**: ${f.sizeBytes} bytes\n`;
      md += `- **类型**: ${f.analysis.type}${f.analysis.tool ? ` (${f.analysis.tool})` : ''}\n`;
      md += `- **建议**: ${f.recommendation.reason}\n`;
      md += `- **置信度**: ${(f.recommendation.confidence * 100).toFixed(0)}%\n\n`;
    }
  }
  
  if (categories['需人工确认'].length > 0) {
    md += `## ⚠️ 需人工确认\n\n`;
    for (const f of categories['需人工确认']) {
      md += `### \`${f.path}\`\n\n`;
      md += `- **大小**: ${f.sizeBytes} bytes\n`;
      md += `- **建议**: ${f.recommendation.reason}\n`;
      md += `- **内容预览**:\n\`\`\`\n${f.contentPreview.slice(0, 200)}\n\`\`\`\n\n`;
    }
  }
  
  // 安全操作指引
  md += `## 🛡️ 安全操作指引\n\n`;
  md += `### 对"确认清理"的文件\n1. 确认这些文件不在 .gitignore 中\n2. 如果要清理，请使用 \`git rm <file>\`（如果已跟踪）或直接删除\n3. 如果尚未被 git 跟踪，从 .gitignore 中添加对应规则即可\n\n`;
  md += `### 对"需人工确认"的文件\n1. 阅读上述内容预览\n2. 如果确实无用，按上述方式清理\n3. 如果有任何不确定的，**保留不动**\n\n`;
  md += `### 兜底原则\n- **不确定的文件 → 保留**\n- **有疑问的目录 → 保留**\n- **宁可多保留，不可误删**\n`;
  
  return md;
}

// ========== 主流程 ==========

const files = scanRootFiles();
const report = generateReport(files);

console.log(report);

// 写入报告文件
import { writeFileSync } from 'node:fs';
const reportPath = join(ROOT, 'scripts', 'pollution-scan-report.md');
writeFileSync(reportPath, report);
console.log(`\n📄 报告已保存到: ${reportPath}`);
