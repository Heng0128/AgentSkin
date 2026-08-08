// SPDX-License-Identifier: MPL-2.0

/**
 * # 层构建
 *
 * 将 Wallpaper Engine scene.json 的 objects 解析为 RenderLayer[]。
 * 每种对象类型（粒子 / 纯色 / 纹理 / 文本）均有独立分支。
 */

import type { SceneData, SceneObject, SceneParticle } from './scene-pkg-parser';
import {
  findParticleOperator,
  resolveObjectTexture,
  resolveSceneParticle,
} from './scene-pkg-parser';
import { alignmentToAnchor, computeLayerDisplaySize } from './scene-renderer-coords';
import type { ParticleLayer, RenderLayer } from './scene-renderer-types';

// ---------------------------------------------------------------------------
// 主导出: 构建 RenderLayer[]
// ---------------------------------------------------------------------------

/**
 * 从场景对象提取可渲染层。
 * 每种可见对象（有纹理 / 纯色 / 粒子 / 文本）生成一个层。
 * 最终按视差深度排序（从远到近）。
 */
export function buildRenderLayers(scene: SceneData, weInstallRoot: string | null): RenderLayer[] {
  const layers: RenderLayer[] = [];
  const projSize = scene.general.orthogonalProjection;

  for (const obj of scene.objects) {
    if (!obj.visible) continue;
    const { anchorX, anchorY } = alignmentToAnchor(obj.alignment);

    // --- 粒子层 ---
    if (obj.particle) {
      const particle = resolveSceneParticle(obj, scene, weInstallRoot);
      if (particle) {
        layers.push(buildParticleLayer(obj, particle, anchorX, anchorY));
        continue;
      }
    }

    // --- 纯色层 ---
    if (obj.color && isSolidLayer(scene, obj)) {
      const solidSize =
        obj.size.x > 0 && obj.size.y > 0 ? { width: obj.size.x, height: obj.size.y } : projSize;
      layers.push({
        dataUrl: null,
        frames: null,
        x: obj.origin.x,
        y: obj.origin.y,
        scaleX: obj.scale.x,
        scaleY: obj.scale.y,
        rotation: (obj.angles.z * Math.PI) / 180,
        alpha: obj.alpha,
        solidColor: obj.color,
        parallaxDepth: obj.parallaxDepth ?? 0,
        width: solidSize.width || 1920,
        height: solidSize.height || 1080,
        anchorX,
        anchorY,
        texAspect: null,
        particle: null,
        audioResponsive: !!obj.audioResponsive,
        audioBand: (obj.audioBand ?? -1) as number as 0 | 1 | 2 | -1,
        audioGain: obj.audioGain ?? 1,
        windAmount: 0,
        text: null,
        font: null,
        pointSize: null,
        horizontalAlign: null,
        verticalAlign: null,
        brightness: null,
        backgroundColor: null,
      });
      continue;
    }

    // --- 文本层 ---
    if (obj.text) {
      const textSize =
        obj.size.x > 0 && obj.size.y > 0 ? { width: obj.size.x, height: obj.size.y } : projSize;
      layers.push({
        dataUrl: null,
        frames: null,
        x: obj.origin.x,
        y: obj.origin.y,
        scaleX: obj.scale.x,
        scaleY: obj.scale.y,
        rotation: (obj.angles.z * Math.PI) / 180,
        alpha: obj.alpha,
        solidColor: null,
        parallaxDepth: obj.parallaxDepth ?? 0,
        width: textSize.width || 1920,
        height: textSize.height || 1080,
        anchorX,
        anchorY,
        texAspect: null,
        particle: null,
        audioResponsive: !!obj.audioResponsive,
        audioBand: (obj.audioBand ?? -1) as number as 0 | 1 | 2 | -1,
        audioGain: obj.audioGain ?? 1,
        windAmount: 0,
        text: obj.text,
        font: obj.font ?? null,
        pointSize: obj.pointSize ?? 24,
        horizontalAlign: (obj.horizontalAlign as 'left' | 'center' | 'right' | null) ?? 'center',
        verticalAlign: (obj.verticalAlign as 'top' | 'center' | 'bottom' | null) ?? 'center',
        brightness: null,
        backgroundColor: obj.backgroundColor ?? null,
      });
      continue;
    }

    // --- 纹理层 ---
    const texture = resolveObjectTexture(obj, scene);
    if (!texture || !texture.dataUrl) continue;

    const quad = computeLayerDisplaySize(
      obj.size,
      { width: texture.width, height: texture.height },
      projSize,
    );

    const depth = obj.parallaxDepth ?? 0;
    const windAmount = scene.general.windEnabled
      ? obj.solid
        ? 0
        : Math.min(1, 0.2 + 0.8 * Math.max(0, (depth + 1) / 2)) *
          (scene.general.windTurbulence ?? 1)
      : 0;

    layers.push({
      dataUrl: texture.dataUrl,
      frames: texture.frames ?? null,
      x: obj.origin.x,
      y: obj.origin.y,
      scaleX: obj.scale.x,
      scaleY: obj.scale.y,
      rotation: (obj.angles.z * Math.PI) / 180,
      alpha: obj.alpha,
      solidColor: null,
      parallaxDepth: obj.parallaxDepth ?? 0,
      width: quad.width,
      height: quad.height,
      anchorX,
      anchorY,
      texAspect: texture.height > 0 ? texture.width / texture.height : 1,
      particle: null,
      audioResponsive: !!obj.audioResponsive,
      audioBand: (obj.audioBand ?? -1) as number as 0 | 1 | 2 | -1,
      audioGain: obj.audioGain ?? 1,
      windAmount,
      text: null,
      font: null,
      pointSize: null,
      horizontalAlign: null,
      verticalAlign: null,
      brightness: obj.brightness ?? null,
      backgroundColor: obj.backgroundColor ?? null,
    });
  }

  // 从远到近排序
  layers.sort((a, b) => a.parallaxDepth - b.parallaxDepth);
  return layers;
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/** 解析 "0.69 0.52 0.22" 格式的 RGB 字符串 (instanceoverride.colorn) */
function parseInstanceColor(v: unknown): { r: number; g: number; b: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

/** 构建粒子模拟层 */
function buildParticleLayer(
  obj: SceneObject,
  particle: SceneParticle,
  anchorX: number,
  anchorY: number,
): RenderLayer {
  const data = particle.data;
  const emitter =
    data.emitters[0] ??
    ({
      name: 'sphererandom',
      rate: 1,
      origin: { x: 0, y: 0, z: 0 },
      directions: { x: 1, y: 1, z: 1 },
      distanceMin: 0,
      distanceMax: 0,
    } as {
      name: string;
      rate: number;
      origin: { x: number; y: number; z: number };
      directions: { x: number; y: number; z: number };
      distanceMin: number;
      distanceMax: number;
    });
  const movement = findParticleOperator(data, 'movement');
  const alphaFade = findParticleOperator(data, 'alphafade');

  const origin = {
    x: obj.origin.x + emitter.origin.x,
    y: obj.origin.y + emitter.origin.y,
    z: obj.origin.z + emitter.origin.z,
  };

  const tex = particle.texture;
  const cfg: ParticleLayer = {
    rate: Math.max(0, emitter.rate),
    maxCount: Math.max(1, data.maxCount),
    spawn: emitter.name.toLowerCase().includes('box') ? 'box' : 'sphere',
    origin,
    directions: emitter.directions,
    distanceMin: emitter.distanceMin,
    distanceMax: Math.max(emitter.distanceMin, emitter.distanceMax),
    lifetimeMin: data.initializers.lifetime.min,
    lifetimeMax: data.initializers.lifetime.max,
    sizeMin: data.initializers.size.min,
    sizeMax: data.initializers.size.max,
    velocityMin: data.initializers.velocity.min,
    velocityMax: data.initializers.velocity.max,
    colorMin: data.initializers.color.min,
    colorMax: data.initializers.color.max,
    tint: parseInstanceColor(obj.instanceOverride?.colorn),
    gravity: movement?.gravity ?? { x: 0, y: 0, z: 0 },
    drag: movement?.drag ?? 0,
    fadeInTime: alphaFade?.fadeInTime ?? 0,
    additive: particle.blending === 'additive',
    image: tex?.dataUrl ?? null,
    aspect: tex && tex.height > 0 ? tex.width / tex.height : 1,
    scaleX: obj.scale.x,
    scaleY: obj.scale.y,
    rotation: (obj.angles.z * Math.PI) / 180,
    alpha: obj.alpha,
    parallaxDepth: obj.parallaxDepth ?? 0,
  };

  return {
    dataUrl: null,
    frames: null,
    x: obj.origin.x,
    y: obj.origin.y,
    scaleX: obj.scale.x,
    scaleY: obj.scale.y,
    rotation: (obj.angles.z * Math.PI) / 180,
    alpha: obj.alpha,
    solidColor: null,
    parallaxDepth: obj.parallaxDepth ?? 0,
    width: 0,
    height: 0,
    anchorX,
    anchorY,
    texAspect: null,
    particle: cfg,
    audioResponsive: !!obj.audioResponsive,
    audioBand: (obj.audioBand ?? -1) as number as 0 | 1 | 2 | -1,
    audioGain: obj.audioGain ?? 1,
    windAmount: 0,
    text: null,
    font: null,
    pointSize: null,
    horizontalAlign: null,
    verticalAlign: null,
    brightness: null,
    backgroundColor: null,
  };
}

/** 判断对象是否为纯色层（无纹理模型但有颜色） */
function isSolidLayer(scene: SceneData, obj: SceneObject): boolean {
  if (!obj.image) return true;
  const modelKey = obj.image
    .replace(/\.(json|model)$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  const model = scene.models.get(modelKey);
  return model?.solidLayer ?? false;
}
