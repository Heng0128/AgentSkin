# 路径污染扫描报告

**扫描时间**: 2026/8/26 03:29:41
**扫描目录**: C:\Users\snowb\Desktop\work\desktop-main

⚠️ **本报告仅用于评估，不执行任何删除操作**

---

## 📊 扫描摘要

| 类别 | 数量 | 文件总大小 |
|------|------|------------|
| 确认清理 | 11 | 1551.2 KB |
| 需人工确认 | 5 | 16.5 KB |
| 有价值保留 | 0 | 0.0 KB |

## ✅ 确认清理（高置信度）

### `bio-fix.txt`

- **大小**: 41 bytes
- **类型**: command-output (biome)
- **建议**: biome 命令输出捕获
- **置信度**: 95%

### `bio-out.txt`

- **大小**: 43 bytes
- **类型**: command-output (biome)
- **建议**: biome 命令输出捕获
- **置信度**: 95%

### `madge-err.txt`

- **大小**: 50 bytes
- **类型**: command-output (madge)
- **建议**: madge 命令输出捕获
- **置信度**: 95%

### `madge-out.txt`

- **大小**: 29 bytes
- **类型**: command-output (biome)
- **建议**: biome 命令输出捕获
- **置信度**: 95%

### `mcp-debug.log`

- **大小**: 276255 bytes
- **类型**: command-output (mcp/debug)
- **建议**: mcp/debug 命令输出捕获
- **置信度**: 95%

### `mcp-stdout.log`

- **大小**: 2239 bytes
- **类型**: command-output (vite)
- **建议**: vite 命令输出捕获
- **置信度**: 95%

### `test-outputimage-analyzer-run.txt`

- **大小**: 69716 bytes
- **类型**: command-output (runtime)
- **建议**: runtime 命令输出捕获
- **置信度**: 95%

### `test-outputport-test.log`

- **大小**: 11530 bytes
- **类型**: command-output (runtime)
- **建议**: runtime 命令输出捕获
- **置信度**: 95%

### `test-outputscope-test.log`

- **大小**: 1228568 bytes
- **类型**: command-output (runtime)
- **建议**: runtime 命令输出捕获
- **置信度**: 95%

### `tsc-errors.txt`

- **大小**: 0 bytes
- **类型**: unknown
- **建议**: 空文件，无内容
- **置信度**: 100%

### `tsc-out.txt`

- **大小**: 0 bytes
- **类型**: unknown
- **建议**: 空文件，无内容
- **置信度**: 100%

## ⚠️ 需人工确认

### `mcp-stderr.log`

- **大小**: 4339 bytes
- **建议**: 文件内容无法自动识别，需人工确认
- **内容预览**:
```
[16:16:54] [Main] [WARN] [PreviewCache] Skipping L1 generation for unsupported format (.gif): C:\Program Files (x86)\Steam\steamapps\workshop\content\431960\3446801024\preview.gif
[16:16:54] [Main] [W
```

### `test-outputatomic-test.log`

- **大小**: 9224 bytes
- **建议**: 文件内容无法自动识别，需人工确认
- **内容预览**:
```

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.11 [39m[90mC:/Users/snowb/Desktop/work/desktop-main[39m

 [31m❯[39m [30m[45m main [49m[39m src/main/fs-utils-atomic.test.ts [2m([22m[2m15 test
```

### `tsc-output.txt`

- **大小**: 560 bytes
- **建议**: 文件内容无法自动识别，需人工确认
- **内容预览**:
```

[41m                                                                               [0m
[41m[37m                This is not the tsc command you are looking for                [0m
[41m           
```

### `vit-inst.txt`

- **大小**: 2258 bytes
- **建议**: 文件内容无法自动识别，需人工确认
- **内容预览**:
```

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90mC:/Users/snowb/Desktop/work/desktop-main[39m

[90mstdout[2m | src/main/catalog/theme-installer.test.ts
[22m[39m[agentskin:cdp-patch]
```

### `vit-out.txt`

- **大小**: 527 bytes
- **建议**: 文件内容无法自动识别，需人工确认
- **内容预览**:
```

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90mC:/Users/snowb/Desktop/work/desktop-main[39m

 [32m✓[39m [30m[45m ui [49m[39m src/ui/pages/WorkspacePage.test.tsx [2m([22m[2m11 
```

## 🛡️ 安全操作指引

### 对"确认清理"的文件
1. 确认这些文件不在 .gitignore 中
2. 如果要清理，请使用 `git rm <file>`（如果已跟踪）或直接删除
3. 如果尚未被 git 跟踪，从 .gitignore 中添加对应规则即可

### 对"需人工确认"的文件
1. 阅读上述内容预览
2. 如果确实无用，按上述方式清理
3. 如果有任何不确定的，**保留不动**

### 兜底原则
- **不确定的文件 → 保留**
- **有疑问的目录 → 保留**
- **宁可多保留，不可误删**
