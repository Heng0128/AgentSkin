// SPDX-License-Identifier: MPL-2.0

/**
 * # 粒子模拟
 *
 * Wallpaper Engine 粒子系统的 2D 模拟。
 *
 * 核心函数设计为纯函数或显式传参形式，使其可直接单元测试，
 * 无需构建 Canvas 环境或 HTML 嵌入。
 */

import type { ParticleLayer, ParticleState } from './scene-renderer-types';

/** 风配置: on/off + 方向 + 强度 */
export interface WindConfig {
  on: boolean;
  dir: [number, number];
  strength: number;
}

/** 生成单个粒子状态（无闭包依赖的纯函数） */
export function spawnParticle(cfg: ParticleLayer): ParticleState {
  let x = cfg.origin.x;
  let y = cfg.origin.y;

  if (cfg.spawn === 'box') {
    x += (Math.random() * 2 - 1) * cfg.directions.x;
    y += (Math.random() * 2 - 1) * cfg.directions.y;
  } else {
    const dist = cfg.distanceMin + Math.random() * (cfg.distanceMax - cfg.distanceMin);
    const ang = Math.random() * Math.PI * 2;
    x += Math.cos(ang) * dist;
    y += Math.sin(ang) * dist;
  }

  const size = randomRange(cfg.sizeMin, cfg.sizeMax);
  return {
    x,
    y,
    vx: randomRange(cfg.velocityMin.x, cfg.velocityMax.x),
    vy: randomRange(cfg.velocityMin.y, cfg.velocityMax.y),
    age: 0,
    life: Math.max(0.05, randomRange(cfg.lifetimeMin, cfg.lifetimeMax)),
    size: size > 0 ? size : 1,
    r: randomRange(cfg.colorMin.r, cfg.colorMax.r) * (cfg.tint ? cfg.tint.r : 1),
    g: randomRange(cfg.colorMin.g, cfg.colorMax.g) * (cfg.tint ? cfg.tint.g : 1),
    b: randomRange(cfg.colorMin.b, cfg.colorMax.b) * (cfg.tint ? cfg.tint.b : 1),
  };
}

/** 推进粒子模拟一步 */
export function stepParticles(
  sources: Array<{
    cfg: ParticleLayer;
    parts: ParticleState[];
    emitAcc: number;
    lastT: number | null;
  }>,
  wind: WindConfig,
  t: number,
  dtSec: number,
): void {
  const wx = wind.on ? wind.dir[0] * wind.strength * 20 : 0;
  const wy = wind.on ? wind.dir[1] * wind.strength * 20 : 0;

  for (const ps of sources) {
    if (!ps.lastT) {
      ps.lastT = t;
      continue;
    }
    const dt = Math.min(0.1, dtSec);
    ps.lastT = t;
    const cfg = ps.cfg;

    // 发射
    ps.emitAcc += cfg.rate * dt;
    let n = Math.floor(ps.emitAcc);
    ps.emitAcc -= n;
    while (n > 0 && ps.parts.length < cfg.maxCount) {
      ps.parts.push(spawnParticle(cfg));
      n--;
    }

    // 积分
    for (let i = ps.parts.length - 1; i >= 0; i--) {
      const p = ps.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps.parts.splice(i, 1);
        continue;
      }
      p.vx += (cfg.gravity.x + wx) * dt;
      p.vy += (cfg.gravity.y + wy) * dt;
      const drag = Math.max(0, 1 - cfg.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
}

/** 渲染粒子（传入 canvas ctx + 坐标变换函数） */
export function drawParticles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  audio: number,
  cfg: ParticleLayer,
  parts: ParticleState[],
  img: HTMLImageElement | null,
  coverScale: number,
  sceneCoord: (
    x: number,
    y: number,
    projW: number,
    projH: number,
    vw: number,
    vh: number,
  ) => { x: number; y: number; scale: number },
  canvasVars: { PROJ_W: number; PROJ_H: number },
): void {
  if (parts.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = cfg.additive ? 'lighter' : 'source-over';

  for (const p of parts) {
    const pos = sceneCoord(p.x, p.y, canvasVars.PROJ_W, canvasVars.PROJ_H, w, h);

    // 淡入淡出
    let a = cfg.fadeInTime > 0 ? Math.min(1, p.age / cfg.fadeInTime) : 1;
    const lifeLeft = 1 - p.age / p.life;
    if (lifeLeft < 0.2) a *= lifeLeft / 0.2;
    if (a <= 0.01) continue;

    ctx.globalAlpha = cfg.alpha * a;
    const size = Math.abs(p.size * coverScale * cfg.scaleX) * (1 + audio * 0.2);
    const wd = size;
    const hd = size / cfg.aspect;

    const col = `rgb(${Math.round(p.r * 255)},${Math.round(p.g * 255)},${Math.round(p.b * 255)})`;
    ctx.fillStyle = col;

    if (cfg.rotation !== 0) {
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(cfg.rotation);
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -wd / 2, -hd / 2, wd, hd);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.5, wd / 2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (img?.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, pos.x - wd / 2, pos.y - hd / 2, wd, hd);
    } else {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(0.5, wd / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 生成 [min, max) 范围内的随机数 */
function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
