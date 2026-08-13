# Automation Lock Integration

跨进程文件锁，防止 CatPaw automation 并行执行时产生竞态（如 commit 覆盖）。

## 文件

| 文件 | 角色 |
|------|------|
| `scripts/automation-lock.mjs` | 底层锁原语：acquire / release / status / force-release / check-exists |
| `scripts/automation-guard.mjs` | 高层封装：`withLock()` 函数 + CLI 入口 |

锁文件位置：`.codebuddy/automations/.lock`
Stale 阈值：5 分钟（超时视为过期可抢占）
并发安全：`fs.openSync(path, 'wx')` 原子创建

---

## 使用方式

### 1. CLI — 运行任意命令

```bash
node scripts/automation-guard.mjs <automation-name> -- <command> [args...]
```

示例：

```bash
# 执行 git 提交，期间持有锁
node scripts/automation-guard.mjs theme-commit -- git commit -m "update theme"

# 执行构建脚本
node scripts/automation-guard.mjs build -- npm run build

# 执行多步操作（通过 shell）
node scripts/automation-guard.mjs deploy -- bash -c "npm run build && npm run deploy"
```

行为：

1. 尝试获取锁；成功则继续，失败则打印持有者信息并 `exit(1)`。
2. spawn 子进程，stdio 直接透传（子进程的 stdin/stdout/stderr 与父进程共享）。
3. 子进程结束（无论成功或失败）后自动释放锁。
4. 父进程以子进程的 exit code 退出。

### 2. 程序化 API — withLock()

```js
import { withLock } from '../../scripts/automation-guard.mjs';

await withLock('my-automation', async () => {
  await doGitAdd();
  await doGitCommit();
  await doGitPush();
});
```

`withLock` 在 `finally` 中释放锁，即使 `fn` 抛异常也会释放。锁被持有时抛出 `Error`。

### 3. Shell 条件判断 — check-exists

```bash
# 仅在锁空闲时执行（适合 bash/powershell 条件调度）
if node scripts/automation-lock.mjs check-exists; then
  echo "free"
else
  echo "held"
fi
```

`check-exists` 返回 `exit(0)` = 锁空闲，`exit(1)` = 锁被持有，可在 shell 脚本中直接用于 `&&` / `if`。

---

## 手动干预

```bash
# 查看当前锁状态
node scripts/automation-lock.mjs status

# 强制释放锁（仅在确认持有者已退出时使用）
node scripts/automation-lock.mjs force-release
```

---

## 常见问题

**Q: 锁持有者进程已退出，但仍显示 HELD？**
A: 5 分钟 stale 阈值未过期。使用 `force-release` 手动清除。

**Q: Windows 下执行 `.cmd` / `.bat` 脚本？**
A: `automation-guard.mjs` 的 CLI 在 Windows 下自动对 `.cmd` / `.bat` / `.ps1` 使用 `shell: true`。

**Q: 子进程被 SIGINT / SIGTERM 终止？**
A: 父进程以 `128 + signal code` 退出，锁在 `finally` 中释放。

**Q: 与现有 automation.json 冲突吗？**
A: 不冲突。本脚本不对应用层调度做侵入，只提供外层包装，按需在调用处引入。

---

## 约束

- 不引入第三方依赖（仅 `node:fs` / `node:child_process` / `node:path` / `node:url`）
- 不修改 CatPaw 应用层调度逻辑
- 锁目录 `.codebuddy/automations/` 由 `mkdirSync({ recursive: true })` 自动创建
