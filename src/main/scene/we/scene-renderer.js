// SPDX-License-Identifier: MPL-2.0 OR MIT
export { applyBloom } from './we-renderer/bloom.js';
export {
  computeParallaxDisplacement,
  resolveCameraPose,
  setupCameraMatrices,
} from './we-renderer/camera.js';
export { Canvas, decodePngBuffer, encodePng } from './we-renderer/canvas.js';
// Ported from dsh-plugin-wallpaper-engine v0.7.1 (MIT)
// https://github.com/elysia395/dsh-wallpaper-engine
// WE 渲染引擎 — 兼容入口 (re-export from we-renderer/)
// 实际实现在 lib/we-renderer/core.js (SceneRenderer 主体) + 工具子模块
export { SceneRenderer } from './we-renderer/core.js';
export { applyBlending, getVal, parseVec2, parseVec3 } from './we-renderer/math.js';
export { parseMdlPuppet, parseMdlStatic } from './we-renderer/mdl.js';
export { loadPngFile, loadTexImage, readPkg, readPkgDir } from './we-renderer/textures.js';
