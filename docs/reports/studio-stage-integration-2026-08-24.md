# StudioStage 集成 DeviceFrame + Inspector 对接 · 交付报告

| 字段 | 值 |
|------|------|
| 日期 | 2026-08-24 |
| 任务 | 最后一块拼图：StudioStage 集成 DeviceFrame + iframeRef/pickedPath 状态 lift 到 StudioInspector |
| 全量测试 | **504/504 通过（44 files）** |
| Biome | **0 errors** |
| 状态 | **完成** |

---

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| src/ui/components/studio/PreviewWindow.tsx | 修改 | 新增 `onIframeReady` prop |
| src/ui/components/studio/StudioStage.tsx | 修改 | 集成 DeviceFrame + 管理 pickedPath/iframeRef 状态 |
| src/ui/components/studio/StudioInspector.tsx | 修改 | 新增 resolution 控制栏 + 4 个 optional props |
| src/ui/pages/StudioPage.tsx | 修改 | Lift state：iframeRef/pickedPath/resolution/showDeviceFrame |
| package.json | 修改 | 新增 @testing-library/react + dom + jest-dom |

---

## 数据流

```
StudioPage (lifted state)
  ├── stageIframeRef: useRef<HTMLIFrameElement | null>
  ├── pickedPath: useState<string | null>
  ├── resolution: useState<DesktopResolution>
  ├── showDeviceFrame: useState<boolean>
  └── pickEnabled: useState(boolean)
        │
        ├──→ StudioStage
        │     ├── DeviceFrame (preset, showFrame, scale)
        │     │     └── PreviewWindow
        │     │           ├── onIframeReady → sets stageIframeRef
        │     │           ├── onPick → sets pickedPath
        │     │           ├── externalPickedPath = pickedPath
        │     │           └── pickEnabled from parent
        │     └── onPickChange → sets pickedPath
        │
        └──→ StudioInspector
              ├── iframeRef = stageIframeRef
              ├── pickedPath = pickedPath
              ├── onClearPicked → setPickedPath(null)
              ├── resolution + onResolutionChange
              └── showDeviceFrame + onToggleDeviceFrame
```

---

## 验证结果

| 维度 | 结果 |
|------|------|
| 全量 UI 测试 | **44 files, 504 tests, 全部通过** |
| Biome lint（4 改造文件） | **0 errors, 0 warnings** |
| 路径污染 | 无 |

---

## 下一步

1. **FloatingToolbar 接入 pick 开关**：把 `_setPickEnabled` 暴露为真正的 UI 按钮
2. **Playwright e2e**：在真实 Electron 中验证 overlay 点击、元素拾取、A/B 切换
3. **性能探针**：60fps 拖动 override 滑条时 overlay 重算不卡顿
