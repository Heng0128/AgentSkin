// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { findParticleOperator, parseParticleJson, type SceneParticleData } from './particle-parser';

// ---------------------------------------------------------------------------
// Fixtures — real Wallpaper Engine install assets (assets/particles/example*,
// assets/presets/lightshafts/particles/presets/light_shafts_0.json).
// ---------------------------------------------------------------------------

const EXAMPLE_PARTICLE = {
  material: 'materials/particle/halo.json',
  maxcount: 500,
  starttime: 0,
  emitter: [
    {
      name: 'sphererandom',
      rate: 20,
      origin: '0 0 0',
      directions: '1 1 0',
      distancemin: 32,
      distancemax: 512,
    },
  ],
  initializer: [
    { name: 'lifetimerandom', min: 3, max: 5 },
    { name: 'sizerandom', min: 50, max: 200 },
    { name: 'velocityrandom', min: '-50 -50 0', max: '50 50 0' },
    { name: 'colorrandom', min: '255 255 255', max: '255 255 255' },
  ],
  operator: [
    { name: 'movement', gravity: '0 0 0' },
    { name: 'alphafade', fadeintime: 0.5 },
  ],
};

/** Real light_shafts preset used by workshop scene.pkg files. */
const LIGHT_SHAFTS = {
  animationmode: null,
  children: null,
  emitter: [
    {
      directions: '1 1 0',
      distancemax: 0,
      distancemin: 0,
      id: 8,
      name: 'sphererandom',
      origin: '-70 0 0',
      rate: 0.2,
    },
  ],
  initializer: [
    { id: 2, max: 20, min: 8, name: 'lifetimerandom' },
    { id: 3, max: 1000, min: 850, name: 'sizerandom' },
    { id: 4, max: '20 10 0', min: '20 10 0', name: 'velocityrandom' },
    { id: 5, max: '170 110 40', min: '110 92 20', name: 'colorrandom' },
    { id: 6, max: '0 0 0', min: '0 0 0', name: 'rotationrandom' },
    { id: 7, max: '0 0 -0.05', min: '0 0 -0.05', name: 'angularvelocityrandom' },
  ],
  material: 'materials/presets/light_shafts_0.json',
  maxcount: 16,
  operator: [
    { gravity: '0 0 0', id: 9, name: 'movement' },
    { fadeintime: 0.1, id: 10, name: 'alphafade' },
    { force: '0 0 0', id: 11, name: 'angularmovement' },
  ],
  renderer: [{ id: 1, name: 'sprite' }],
  starttime: 10,
};

function parseExample(): SceneParticleData {
  const data = parseParticleJson(EXAMPLE_PARTICLE);
  expect(data).not.toBeNull();
  return data!;
}

describe('parseParticleJson — real WE particle format', () => {
  it('parses a simple emitter with rate, origin and spawn distances', () => {
    const data = parseExample();
    expect(data.emitters).toHaveLength(1);
    expect(data.emitters[0].name).toBe('sphererandom');
    expect(data.emitters[0].rate).toBe(20);
    expect(data.emitters[0].origin).toEqual({ x: 0, y: 0, z: 0 });
    expect(data.emitters[0].distanceMin).toBe(32);
    expect(data.emitters[0].distanceMax).toBe(512);
  });

  it('parses initializer random ranges, normalizing colors to 0-1', () => {
    const data = parseExample();
    expect(data.initializers.lifetime).toEqual({ min: 3, max: 5 });
    expect(data.initializers.size).toEqual({ min: 50, max: 200 });
    expect(data.initializers.velocity).toEqual({
      min: { x: -50, y: -50, z: 0 },
      max: { x: 50, y: 50, z: 0 },
    });
    // WE colors are 0-255 → normalized to 0-1
    expect(data.initializers.color).toEqual({
      min: { r: 1, g: 1, b: 1 },
      max: { r: 1, g: 1, b: 1 },
    });
  });

  it('parses movement/alphafade operators', () => {
    const data = parseExample();
    const movement = findParticleOperator(data, 'movement');
    expect(movement).not.toBeNull();
    expect(movement!.gravity).toEqual({ x: 0, y: 0, z: 0 });
    const alphaFade = findParticleOperator(data, 'alphafade');
    expect(alphaFade).not.toBeNull();
    expect(alphaFade!.fadeInTime).toBe(0.5);
  });

  it('parses the light_shafts preset (real workshop scene reference)', () => {
    const data = parseParticleJson(LIGHT_SHAFTS)!;
    expect(data).not.toBeNull();
    expect(data.material).toBe('materials/presets/light_shafts_0.json');
    expect(data.maxCount).toBe(16);
    expect(data.startTime).toBe(10);
    expect(data.emitters[0].rate).toBeCloseTo(0.2);
    expect(data.emitters[0].origin).toEqual({ x: -70, y: 0, z: 0 });
    expect(data.initializers.size).toEqual({ min: 850, max: 1000 });
    // Color string "170 110 40" → 0.667/0.431/0.157
    expect(data.initializers.color.max.r).toBeCloseTo(170 / 255);
    expect(data.initializers.color.max.g).toBeCloseTo(110 / 255);
    expect(data.initializers.color.max.b).toBeCloseTo(40 / 255);
    expect(data.operators.some((o) => o.name === 'angularmovement')).toBe(true);
    expect(data.renderer).toEqual(['sprite']);
    // Drag field of 'movement' defaults to 0 when absent
    expect(findParticleOperator(data, 'movement')!.drag).toBe(0);
  });

  it('handles absent renderer/material sections with defaults', () => {
    const data = parseParticleJson({ emitter: [{ name: 'sphererandom', rate: 5 }] })!;
    expect(data.material).toBeNull();
    expect(data.renderer).toEqual([]);
    expect(data.maxCount).toBe(1000);
    expect(data.emitters[0].rate).toBe(5);
  });

  it('returns null for non-object input', () => {
    expect(parseParticleJson(null)).toBeNull();
    expect(parseParticleJson(42)).toBeNull();
    expect(parseParticleJson('emitter')).toBeNull();
    expect(parseParticleJson([{ name: 'x' }])).toBeNull();
    expect(parseParticleJson(undefined)).toBeNull();
  });

  it('ignores malformed emitters and unknown initializers', () => {
    const data = parseParticleJson({
      emitter: [
        null,
        'bad',
        { name: 'boxrandom', rate: 'lots' },
        { name: 'sphererandom', rate: 7 },
      ],
      initializer: [
        { name: 'notaninitializer', min: 1, max: 2 },
        { name: 'lifetimerandom' }, // no min/max → defaults 0
      ],
      operator: [42, { name: 'movement' }],
    })!;
    expect(data.emitters).toHaveLength(2); // 'bad' string dropped, invalid rate defaulted
    expect(data.emitters[0].rate).toBe(1);
    expect(data.emitters[1].rate).toBe(7);
    // lifetime entry parsed with 0/0 (no min/max in the fixture)
    expect(data.initializers.lifetime).toEqual({ min: 0, max: 0 });
    // unknown initializer ignored — velocity keeps defaults
    expect(data.initializers.velocity.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(data.operators).toHaveLength(1);
  });
});
