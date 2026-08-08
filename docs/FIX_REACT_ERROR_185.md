# React Error #185 修复方案

**日期**: 2026-08-08
**错误**: `Minified React error #185` — Maximum update depth exceeded
**严重程度**: P1（导致应用启动后无限循环崩溃）

---

## 一、错误现象

应用启动后约 1-2 秒内，控制台连续输出：

```
Error: Minified React error #185; visit https://react.dev/errors/185 ...
    at getRootForUpdatedFiber
    at enqueueConcurrentRenderForLane
    at forceStoreRerender
    at updateStoreInstance
    at commitHookEffectListMount
    at commitPassiveMountOnFiber
```

ErrorBoundary 捕获后显示，导致应用无法正常使用。

---

## 二、根因分析

### 2.1 React 19 的 useSyncExternalStore 检测机制

React 19 的 `useSyncExternalStore` 在 passive effect commit 阶段（`commitHookEffectListMount`）会检测 store 快照是否在此期间发生变化。如果检测到变化（tearing），会调用 `forceStoreRerender` 强制重渲染。如果该重渲染又导致新的 store 更新，就会触发无限循环，最终达到最大更新深度（error #185）。

### 2.2 触发链路

错误堆栈中的 `commitPassiveMountOnFiber → commitHookEffectListMount → updateStoreInstance → forceStoreRerender` 明确指向：

**在 passive mount effect 执行期间，某个 store 的 state 被同步更新了。**

### 2.3 具体定位

经过代码审查，找到了三个高风险触发点：

#### 触发点 A：`useBoot.ts` 第 101-103 行

```typescript
queueMicrotask(() => {
  if (!disposed) triggerPoll();  // → refreshStatus() → set({ isRefreshing: true })
});
```

注释中已明确说明了问题原因，但 `queueMicrotask` 的执行时机仍然过早：
- `queueMicrotask` 在当前同步任务完成后立即执行
- React 的 `commitPassiveMountOnFiber` 是在 commit 阶段的同步回调中执行的
- `queueMicrotask` 可能在 passive effects 尚未完全提交时执行
- 此时 `set({ isRefreshing: true })` 会触发 tearing 检测

#### 触发点 B：`useAppController.ts` 第 224-233 行

```typescript
useEffect(() => {
  let disposed = false;
  queueMicrotask(() => {
    if (disposed) return;
    void useThemeStore.getState().refreshThemes()    // 可能同步 set()
      .finally(() => useThemeStore.setState({ loading: false }));  // 同步 set()
    void useWallpaperStore.getState().initialize();   // 异步 await 后 set()
    void useAgentStore.getState().loadAgents();       // 异步 await 后 set()
    useEnvironmentStore.getState().loadPresets();     // ⚠️ 同步 set({ presets: ... })
  });
  ...
}, []);
```

`useEnvironmentStore.loadPresets()` 是**同步的 store set 调用**：

```typescript
// environmentStore.ts 第 92-94 行
loadPresets: () => {
  set({ presets: loadPresets() });  // 同步执行！
},
```

当 `queueMicrotask` 在 passive-commit 阶段触发时，这个 `set()` 会在 React 仍然处于 commit 阶段时修改 store state，触发 tearing 检测 → `forceStoreRerender` → 无限循环。

#### 触发点 C：`themeStore.ts` 第 125-135 行

```typescript
// 在 create() 函数内部注册 IPC 订阅
offFileImported = api.onFileImported(async (result) => {
  await get().refreshThemes();  // refreshThemes 内部调用 set()
  ...
});
offTrayApply = api.onTrayApply((request) => {
  void get().applyToApp(request.themeId, request.themeName, request.appId);
});
```

虽然这些是异步回调，但如果 IPC 事件恰好在 passive-commit 阶段到达（例如启动时主进程发送的初始化事件），`await` 之后的 `set()` 仍然可能在 commit 阶段内执行。

---

## 三、修复方案

### 方案核心：将 microtask 降级为 macrotask

`queueMicrotask` 的执行时机位于当前同步任务结束之前，可能与 React 的 passive-commit 重叠。**宏任务（macrotask）如 `setTimeout` 或 `requestAnimationFrame` 总是在当前 commit 阶段完全结束后才执行。**

### 3.1 修复 useBoot.ts

```typescript
// Before (line 101-103)
queueMicrotask(() => {
  if (!disposed) triggerPoll();
});

// After
requestAnimationFrame(() => {
  if (!disposed) triggerPoll();
});
```

或使用 `setTimeout(() => { ... }, 0)` 作为降级方案。

### 3.2 修复 useAppController.ts 初始化 effect

```typescript
// Before (line 224)
queueMicrotask(() => {
  if (disposed) return;
  void useThemeStore.getState().refreshThemes()
    .finally(() => useThemeStore.setState({ loading: false }));
  void useWallpaperStore.getState().initialize();
  void useAgentStore.getState().loadAgents();
  useEnvironmentStore.getState().loadPresets();
});

// After
requestAnimationFrame(() => {
  if (disposed) return;
  void useThemeStore.getState().refreshThemes()
    .finally(() => useThemeStore.setState({ loading: false }));
  void useWallpaperStore.getState().initialize();
  void useAgentStore.getState().loadAgents();
  useEnvironmentStore.getState().loadPresets();
});
```

### 3.3 修复 environmentStore.loadPresets() 异步化

```typescript
// Before (line 92-94)
loadPresets: () => {
  set({ presets: loadPresets() });
},

// After
loadPresets: () => {
  queueMicrotask(() => {
    set({ presets: loadPresets() });
  });
},
```

这样即使 `loadPresets()` 被同步调用，其内部的 `set()` 也会被推迟到安全的 macrotask 中执行。

### 3.4 可选：themeStore IPC 回调防御

```typescript
// Before
offFileImported = api.onFileImported(async (result) => {
  await get().refreshThemes();
  ...
});

// After — 确保回调中的 state 更新在宏任务中执行
offFileImported = api.onFileImported((result) => {
  void (async () => {
    await get().refreshThemes();
    requestAnimationFrame(() => {
      useNotificationStore.getState().showToast(
        currentT().importedTheme(result.theme.displayName)
      );
    });
  })();
});
```

---

## 四、风险与验证

### 4.1 风险评估

| 改动点 | 风险 | 影响 |
|--------|------|------|
| `useBoot.ts` 改用 rAF | 极低 | 首帧状态轮询延迟 16ms，用户无感知 |
| `useAppController` 改用 rAF | 极低 | 初始化延迟 16ms，用户无感知 |
| `environmentStore.loadPresets` 异步化 | 低 | presets 加载延迟一微任务，无 UI 影响 |
| `themeStore` IPC 回调防御 | 低 | toast 延迟 16ms 显示，无影响 |

### 4.2 验证清单

- [ ] 应用启动不再出现 Error #185
- [ ] `console` 无 `Maximum update depth exceeded` 警告
- [ ] 主题列表正常加载
- [ ] 壁纸列表正常加载
- [ ] Agent 目录正常加载
- [ ] Environment presets 正常加载
- [ ] 状态轮询正常工作（3s 间隔）
- [ ] IPC 事件（文件导入、托盘应用）正常响应
- [ ] 1248 个现有测试全部通过

---

## 五、后续预防

1. **代码审查规则**：所有 store action 中如果存在 "同步读取 + 同步 set" 模式，必须确保调用时机在 React commit 阶段之外。
2. **Linter 规则**：考虑添加 eslint-plugin 规则，禁止在 `useEffect` 的 `queueMicrotask` 中直接调用 `useXxxStore.getState().syncAction()`。
3. **文档沉淀**：将此案例加入架构文档的 "React 19 Compatibility" 章节。

---

## 六、结论

本次 Error #185 的根本原因是 `queueMicrotask` 的执行时机与 React 19 的 passive-commit 阶段重叠，导致同步的 store `set()` 调用触发了 `useSyncExternalStore` 的 tearing 检测机制。修复方案简单明确：将关键初始化逻辑从 `queueMicrotask` 迁移到 `requestAnimationFrame`（宏任务），即可确保 store 更新发生在 React commit 阶段完全结束之后。
