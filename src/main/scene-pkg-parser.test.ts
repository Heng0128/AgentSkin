// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { parseSceneJson } from './scene-pkg-parser';

// ---------------------------------------------------------------------------
// Test fixtures — based on real scene.json from Wallpaper Engine workshop
// ---------------------------------------------------------------------------

/** Minimal scene.json with only the required fields. */
const MINIMAL_SCENE = {
  general: {
    clearcolor: '0.0 0.0 0.0',
    clearenabled: true,
    orthogonalprojection: { width: 1920, height: 1080 },
  },
  camera: {
    center: '0.0 0.0 -1.0',
    eye: '0.0 0.0 0.0',
    up: '0.0 1.0 0.0',
  },
  objects: [
    {
      id: 1,
      name: 'Background',
      image: 'models/background.json',
      origin: '960.0 540.0 0.0',
      angles: '0.0 0.0 0.0',
      scale: '1.0 1.0 1.0',
      size: '1920.0 1080.0',
      visible: true,
      solid: true,
    },
  ],
};

/** Full scene.json with all general fields (from workshop id 2134765860). */
const FULL_GENERAL_SCENE = {
  general: {
    ambientcolor: '0.3 0.3 0.3',
    bloom: true,
    bloomhdrfeather: 0.1,
    bloomhdriterations: 8,
    bloomhdrscatter: 1.619,
    bloomhdrstrength: 2,
    bloomhdrthreshold: 1,
    bloomstrength: { script: 'export function update() { return 1; }', value: 1 },
    bloomthreshold: { user: 'new_property', value: 0.7 },
    bloomtint: '1.0 1.0 1.0',
    camerafade: true,
    cameraparallax: false,
    cameraparallaxamount: 0.08,
    cameraparallaxdelay: 0.1,
    cameraparallaxmouseinfluence: -1,
    camerapreview: true,
    camerashake: false,
    camerashakeamplitude: 0.5,
    camerashakeroughness: 1,
    camerashakespeed: 3,
    clearcolor: '0.0 0.0 0.0',
    clearenabled: true,
    farz: 10000,
    fov: 50,
    gravitydirection: '0.0 -1.0 0.0',
    gravitystrength: 1,
    hdr: false,
    nearz: 0.01,
    orthogonalprojection: { width: 1920, height: 1080 },
    perspectiveoverridefov: 95,
    skylightcolor: '0.3 0.3 0.3',
    winddirection: '0.707 0.707 0.0',
    windenabled: false,
    windstrength: 1,
    zoom: 1,
  },
  camera: {
    center: '0.0 0.0 -1.0',
    eye: '0.0 0.0 0.0',
    up: '0.0 1.0 0.0',
  },
  objects: [],
  version: 2,
};

/** Scene with a particle object (has particle + instanceoverride fields). */
const PARTICLE_SCENE = {
  general: { clearcolor: '0 0 0', clearenabled: true },
  objects: [
    {
      id: 13,
      name: 'Light shafts 0',
      image: null,
      origin: '831.773 999.849 0.0',
      angles: '0.0 -0.0 1.376',
      scale: '-2.646 2.254 1.977',
      visible: true,
      particle: 'particles/presets/light_shafts_0.json',
      instanceoverride: { colorn: '0.69 0.52 0.22', id: 14 },
      locktransforms: false,
      parallaxDepth: '1.0 1.0',
    },
  ],
};

/** Scene with an object that has structured effects. */
const EFFECTS_SCENE = {
  general: { clearcolor: '0 0 0', clearenabled: true },
  objects: [
    {
      id: 100,
      name: 'Layer with effects',
      image: 'models/background.json',
      visible: true,
      effects: [
        {
          file: 'effects/blend/effect.json',
          id: 305,
          name: '',
          passes: [
            {
              combos: { BLENDMODE: 0 },
              constantshadervalues: { alpha: 1, multiply: { script: 'test', value: 1 } },
              id: 36,
              textures: [null, 'nighty'],
            },
          ],
          visible: true,
        },
        {
          file: 'effects/shake/effect.json',
          id: 302,
          name: 'Shake',
          passes: [],
          visible: { user: 'shakeon', value: false },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSceneJson', () => {
  describe('general', () => {
    it('parses minimal general with defaults', () => {
      const { general } = parseSceneJson(MINIMAL_SCENE);
      expect(general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
      expect(general.clearEnabled).toBe(true);
      expect(general.orthogonalProjection).toEqual({ width: 1920, height: 1080 });
      // Defaults
      expect(general.fov).toBe(50);
      expect(general.nearZ).toBe(0.01);
      expect(general.farZ).toBe(10000);
      expect(general.hdr).toBe(false);
      expect(general.bloom).toBe(false);
    });

    it('parses all general fields from a full scene', () => {
      const { general } = parseSceneJson(FULL_GENERAL_SCENE);
      // Rendering
      expect(general.hdr).toBe(false);
      // Camera
      expect(general.fov).toBe(50);
      expect(general.nearZ).toBeCloseTo(0.01);
      expect(general.farZ).toBe(10000);
      expect(general.zoom).toBe(1);
      expect(general.perspectiveOverrideFov).toBe(95);
      expect(general.cameraFade).toBe(true);
      expect(general.cameraParallax).toBe(false);
      expect(general.cameraParallaxAmount).toBeCloseTo(0.08);
      expect(general.cameraParallaxDelay).toBeCloseTo(0.1);
      expect(general.cameraParallaxMouseInfluence).toBe(-1);
      expect(general.cameraPreview).toBe(true);
      expect(general.cameraShake).toBe(false);
      expect(general.cameraShakeAmplitude).toBe(0.5);
      expect(general.cameraShakeRoughness).toBe(1);
      expect(general.cameraShakeSpeed).toBe(3);
      // Lighting
      expect(general.ambientColor).toEqual({ r: 0.3, g: 0.3, b: 0.3 });
      expect(general.skylightColor).toEqual({ r: 0.3, g: 0.3, b: 0.3 });
      // Bloom
      expect(general.bloom).toBe(true);
      // Animated property: bloomstrength has { script, value } → unwrap to value
      expect(general.bloomStrength).toBe(1);
      expect(general.bloomThreshold).toBeCloseTo(0.7);
      expect(general.bloomTint).toEqual({ r: 1, g: 1, b: 1 });
      expect(general.bloomHdrStrength).toBe(2);
      expect(general.bloomHdrThreshold).toBe(1);
      expect(general.bloomHdrScatter).toBeCloseTo(1.619);
      expect(general.bloomHdrFeather).toBeCloseTo(0.1);
      expect(general.bloomHdrIterations).toBe(8);
      // Wind
      expect(general.windEnabled).toBe(false);
      expect(general.windStrength).toBe(1);
      // The fixture stores the direction as a 3-decimal approximation of the
      // 45° unit vector (0.707, not Math.SQRT1_2 exactly), so compare with
      // tolerance — matching how the other float fields in this scene are
      // asserted (cameraParallaxAmount, bloomHdrScatter, …).
      expect(general.windDirection.x).toBeCloseTo(Math.SQRT1_2);
      expect(general.windDirection.y).toBeCloseTo(Math.SQRT1_2);
      // Gravity
      expect(general.gravityStrength).toBe(1);
      expect(general.gravityDirection).toEqual({ x: 0, y: -1, z: 0 });
    });

    it('handles missing general gracefully', () => {
      const { general } = parseSceneJson({});
      expect(general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
      expect(general.clearEnabled).toBe(true);
      expect(general.ambientColor).toEqual({ r: 0.3, g: 0.3, b: 0.3 });
      expect(general.fov).toBe(50);
    });

    it('unwraps animated properties (script+value objects) to scalar', () => {
      const { general } = parseSceneJson({
        general: {
          bloomstrength: { script: 'return 2;', value: 2 },
          fov: { script: 'return 60;', value: 60 },
        },
      });
      expect(general.bloomStrength).toBe(2);
      expect(general.fov).toBe(60);
    });
  });

  describe('camera', () => {
    it('parses camera vectors from strings', () => {
      const { camera } = parseSceneJson(MINIMAL_SCENE);
      expect(camera.center).toEqual({ x: 0, y: 0, z: -1 });
      expect(camera.eye).toEqual({ x: 0, y: 0, z: 0 });
      expect(camera.up).toEqual({ x: 0, y: 1, z: 0 });
    });

    it('uses defaults when camera is missing', () => {
      const { camera } = parseSceneJson({});
      expect(camera.center).toEqual({ x: 0, y: 0, z: -1 });
      expect(camera.eye).toEqual({ x: 0, y: 0, z: 0 });
      expect(camera.up).toEqual({ x: 0, y: 1, z: 0 });
    });
  });

  describe('objects', () => {
    it('parses basic image layer object', () => {
      const { objects } = parseSceneJson(MINIMAL_SCENE);
      expect(objects).toHaveLength(1);
      const obj = objects[0];
      expect(obj.id).toBe(1);
      expect(obj.name).toBe('Background');
      expect(obj.image).toBe('models/background.json');
      expect(obj.origin).toEqual({ x: 960, y: 540, z: 0 });
      expect(obj.visible).toBe(true);
      expect(obj.solid).toBe(true);
      // Previously missing fields — should have safe defaults
      expect(obj.colorBlendMode).toBeNull();
      expect(obj.copyBackground).toBe(false);
      expect(obj.particle).toBeNull();
      expect(obj.sound).toBeNull();
      expect(obj.text).toBeNull();
    });

    it('parses particle object with instanceoverride', () => {
      const { objects } = parseSceneJson(PARTICLE_SCENE);
      expect(objects).toHaveLength(1);
      const obj = objects[0];
      expect(obj.particle).toBe('particles/presets/light_shafts_0.json');
      expect(obj.instanceOverride).not.toBeNull();
      expect(obj.instanceOverride?.id).toBe(14);
      expect(obj.instanceOverride?.colorn).toBe('0.69 0.52 0.22');
    });

    it('parses structured effects with passes', () => {
      const { objects } = parseSceneJson(EFFECTS_SCENE);
      const obj = objects[0];
      expect(obj.effects).toHaveLength(2);
      const e0 = obj.effects[0];
      expect(e0.file).toBe('effects/blend/effect.json');
      expect(e0.id).toBe(305);
      expect(e0.visible).toBe(true);
      expect(e0.passes).toHaveLength(1);
      expect(e0.passes[0].combos).toEqual({ BLENDMODE: 0 });
      expect(e0.passes[0].textures).toEqual([null, 'nighty']);
      // Second effect has animated visible property
      const e1 = obj.effects[1];
      expect(e1.visible).toEqual({
        value: false,
        script: null,
        userTag: 'shakeon',
      });
    });

    it('handles empty objects array', () => {
      const { objects } = parseSceneJson({ objects: [] });
      expect(objects).toEqual([]);
    });

    it('handles object with all optional fields null/missing', () => {
      const { objects } = parseSceneJson({ objects: [{ id: 0, name: '' }] });
      const obj = objects[0];
      expect(obj.id).toBe(0);
      expect(obj.name).toBe('');
      expect(obj.origin).toEqual({ x: 0, y: 0, z: 0 });
      expect(obj.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(obj.alpha).toBe(1);
      expect(obj.visible).toBe(true);
    });
  });

  describe('version', () => {
    it('parses version when present', () => {
      const { version } = parseSceneJson(FULL_GENERAL_SCENE);
      expect(version).toBe(2);
    });

    it('returns null when version is absent', () => {
      const { version } = parseSceneJson(MINIMAL_SCENE);
      expect(version).toBeNull();
    });
  });

  describe('camelCase field compatibility', () => {
    it('accepts both clearcolor and clearColor', () => {
      const lower = parseSceneJson({ general: { clearcolor: '1 0 0' } });
      const camel = parseSceneJson({ general: { clearColor: '1 0 0' } });
      expect(lower.general.clearColor).toEqual({ r: 1, g: 0, b: 0 });
      expect(camel.general.clearColor).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('accepts both orthogonalprojection and orthogonalProjection', () => {
      const { general } = parseSceneJson({
        general: { orthogonalProjection: { width: 2560, height: 1440 } },
      });
      expect(general.orthogonalProjection).toEqual({ width: 2560, height: 1440 });
    });
  });

  describe('malformed input robustness', () => {
    it('returns full defaults for non-object root', () => {
      for (const junk of [null, undefined, 42, 'scene', true, [1, 2]]) {
        const { general, camera, objects, version } = parseSceneJson(junk);
        expect(general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
        expect(general.orthogonalProjection).toEqual({ width: 1920, height: 1080 });
        expect(camera.eye).toEqual({ x: 0, y: 0, z: 0 });
        expect(objects).toEqual([]);
        expect(version).toBeNull();
      }
    });

    it('treats a non-object general block as absent', () => {
      for (const junk of ['opaque', 42, null, [], true]) {
        const { general } = parseSceneJson({ general: junk });
        expect(general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
        expect(general.clearEnabled).toBe(true);
        expect(general.fov).toBe(50);
      }
    });

    it('treats a non-array objects field as an empty list', () => {
      for (const junk of ['layers', 42, null, { a: 1 }]) {
        const { objects } = parseSceneJson({ objects: junk });
        expect(objects).toEqual([]);
      }
    });

    it('skips non-object entries in the objects array instead of crashing', () => {
      const { objects } = parseSceneJson({
        objects: [null, 42, 'text', [1], { id: 1, name: 'kept' }, { id: 'bad' }],
      });
      expect(objects).toHaveLength(2);
      expect(objects[0].id).toBe(1);
      expect(objects[0].name).toBe('kept');
      // Entry that IS an object but has a non-numeric id falls back to 0
      expect(objects[1].id).toBe(0);
    });

    it('falls back to defaults for unparseable vector/color strings', () => {
      const { general, camera, objects } = parseSceneJson({
        general: {
          clearcolor: 'not a color',
          winddirection: 'also not a vector',
          ambientcolor: { r: 'red' },
        },
        camera: { center: 'garbage here', eye: 42, up: null },
        objects: [
          {
            id: 1,
            origin: 'abc def',
            scale: 'not numbers',
            size: 'not numbers at all',
            color: 'x y z',
            parallaxDepth: 'NaN',
          },
        ],
      });
      // Garbage strings parse to zero-component vectors (no crash, no NaN)
      expect(general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
      expect(general.windDirection).toEqual({ x: 0, y: 0 });
      // Object color with non-numeric components → {0,0,0}, not null
      expect(general.ambientColor).toEqual({ r: 0, g: 0, b: 0 });
      expect(camera.center).toEqual({ x: 0, y: 0, z: 0 });
      // A bare number broadcasts to all components
      expect(camera.eye).toEqual({ x: 42, y: 42, z: 42 });
      expect(camera.up).toEqual({ x: 0, y: 1, z: 0 });
      const obj = objects[0];
      expect(obj.origin).toEqual({ x: 0, y: 0, z: 0 });
      expect(obj.scale).toEqual({ x: 0, y: 0, z: 0 });
      expect(obj.size).toEqual({ x: 0, y: 0, z: 0 });
      expect(obj.color).toEqual({ r: 0, g: 0, b: 0 });
      expect(obj.parallaxDepth).toBeNull();
    });

    it('drops garbage effects and effect passes, keeping well-formed ones', () => {
      const { objects } = parseSceneJson({
        objects: [
          {
            id: 1,
            effects: [
              null,
              'shader',
              42,
              { file: 'effects/blur/effect.json', id: 9 },
              { file: 'ok', passes: [null, { id: 3 }, 'bad'] },
            ],
          },
        ],
      });
      const effects = objects[0].effects;
      expect(effects).toHaveLength(2);
      expect(effects[0].file).toBe('effects/blur/effect.json');
      expect(effects[0].passes).toEqual([]);
      expect(effects[1].passes).toHaveLength(1);
      expect(effects[1].passes[0].id).toBe(3);
    });

    it('falls back to defaults when an animated property value is not numeric', () => {
      const { general } = parseSceneJson({
        general: {
          bloomstrength: { script: 'return 2;', value: '2' },
          fov: { value: null },
          gravitystrength: { value: true },
        },
      });
      expect(general.bloomStrength).toBe(1);
      expect(general.fov).toBe(50);
      expect(general.gravityStrength).toBe(1);
    });
  });
});
