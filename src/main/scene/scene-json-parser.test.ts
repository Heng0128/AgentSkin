// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment node
 *
 * Unit tests for scene-json-parser — a pure function module that parses
 * Wallpaper Engine's scene.json into typed structures. This module was
 * explicitly designed to be unit-testable with plain JSON fixtures (per its
 * JSDoc), but had zero tests until this file was created.
 *
 * Coverage targets:
 *   - parseSceneJson: happy path, null/undefined, empty object, malformed data
 *   - Animated property unwrapping (script/value/user)
 *   - Color/vector parsing (string, object, null forms)
 *   - Orthogonal projection and camera defaults
 *   - Object array parsing with effects
 */

import { describe, expect, it } from 'vitest';
import { parseSceneJson } from './scene-json-parser';

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

/** A minimal valid scene.json structure with only required fields. */
function makeMinimalScene() {
  return {
    general: {
      clearcolor: '0.1 0.1 0.1',
    },
    camera: {
      center: '0 0 -1',
      eye: '0 0 0',
      up: '0 1 0',
    },
    objects: [],
  };
}

/** A complete scene.json with representative fields across all categories. */
function makeCompleteScene() {
  return {
    general: {
      clearcolor: '0.1 0.1 0.2',
      clearenabled: true,
      orthogonalprojection: { width: 2560, height: 1440 },
      hdr: true,
      fov: 60,
      nearz: 0.1,
      farz: 5000,
      zoom: 1.5,
      ambientcolor: '0.4 0.4 0.4',
      skylightcolor: '0.5 0.5 0.5',
      bloom: true,
      bloomstrength: 1.2,
      bloomthreshold: 0.7,
      bloomtint: '1 0.9 0.8',
      windenabled: true,
      windstrength: 2,
      winddirection: '1 0',
      windturbulence: 1.5,
      gravitystrength: 1.2,
      gravitydirection: '0 -1 0',
    },
    camera: {
      center: '0 0 -5',
      eye: '0 0 5',
      up: '0 1 0',
    },
    objects: [
      {
        id: 1,
        name: 'hero-image',
        origin: '0 0 0',
        angles: '0 0 0',
        scale: '1 1 1',
        size: '1920 1080 0',
        image: 'hero.png',
        visible: true,
        alpha: 1,
        color: '1 1 1',
        solid: false,
      },
    ],
    version: 2,
  };
}

// ---------------------------------------------------------------------------
// parseSceneJson — top-level
// ---------------------------------------------------------------------------

describe('parseSceneJson', () => {
  describe('null and malformed input', () => {
    it('returns default structure when input is null', () => {
      const result = parseSceneJson(null);
      expect(result).toBeDefined();
      expect(result.objects).toEqual([]);
      expect(result.version).toBeNull();
      expect(result.general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
      expect(result.general.fov).toBe(50);
    });

    it('returns default structure when input is undefined', () => {
      const result = parseSceneJson(undefined);
      expect(result).toBeDefined();
      expect(result.objects).toEqual([]);
    });

    it('returns default structure when input is a number', () => {
      const result = parseSceneJson(42);
      expect(result).toBeDefined();
      expect(result.objects).toEqual([]);
    });

    it('returns default structure when input is a string', () => {
      const result = parseSceneJson('not-json');
      expect(result).toBeDefined();
      expect(result.objects).toEqual([]);
    });

    it('returns default structure when input is an array', () => {
      const result = parseSceneJson([1, 2, 3]);
      expect(result).toBeDefined();
      expect(result.objects).toEqual([]);
    });

    it('handles empty object with all defaults', () => {
      const result = parseSceneJson({});
      expect(result.general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
      expect(result.general.clearEnabled).toBe(true);
      expect(result.general.orthogonalProjection).toEqual({ width: 1920, height: 1080 });
      expect(result.general.fov).toBe(50);
      expect(result.general.nearZ).toBe(0.01);
      expect(result.general.farZ).toBe(10000);
      expect(result.camera.center).toEqual({ x: 0, y: 0, z: -1 });
      expect(result.camera.eye).toEqual({ x: 0, y: 0, z: 0 });
      expect(result.camera.up).toEqual({ x: 0, y: 1, z: 0 });
    });
  });

  describe('minimal valid input', () => {
    it('parses a minimal scene with clear color', () => {
      const result = parseSceneJson(makeMinimalScene());
      expect(result.general.clearColor).toEqual({ r: 0.1, g: 0.1, b: 0.1 });
      expect(result.objects).toEqual([]);
    });

    it('parses camera vectors from space-separated strings', () => {
      const result = parseSceneJson(makeMinimalScene());
      expect(result.camera.center).toEqual({ x: 0, y: 0, z: -1 });
      expect(result.camera.eye).toEqual({ x: 0, y: 0, z: 0 });
      expect(result.camera.up).toEqual({ x: 0, y: 1, z: 0 });
    });
  });

  describe('complete scene with all field categories', () => {
    it('parses complete scene with correct values', () => {
      const result = parseSceneJson(makeCompleteScene());
      expect(result.general.clearColor).toEqual({ r: 0.1, g: 0.1, b: 0.2 });
      expect(result.general.clearEnabled).toBe(true);
      expect(result.general.orthogonalProjection).toEqual({ width: 2560, height: 1440 });
      expect(result.general.hdr).toBe(true);
      expect(result.general.fov).toBe(60);
      expect(result.general.nearZ).toBe(0.1);
      expect(result.general.farZ).toBe(5000);
      expect(result.general.zoom).toBe(1.5);
    });

    it('parses lighting and bloom settings', () => {
      const result = parseSceneJson(makeCompleteScene());
      expect(result.general.ambientColor).toEqual({ r: 0.4, g: 0.4, b: 0.4 });
      expect(result.general.skylightColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
      expect(result.general.bloom).toBe(true);
      expect(result.general.bloomStrength).toBe(1.2);
      expect(result.general.bloomThreshold).toBe(0.7);
      expect(result.general.bloomTint).toEqual({ r: 1, g: 0.9, b: 0.8 });
    });

    it('parses wind and gravity settings', () => {
      const result = parseSceneJson(makeCompleteScene());
      expect(result.general.windEnabled).toBe(true);
      expect(result.general.windStrength).toBe(2);
      expect(result.general.windDirection).toEqual({ x: 1, y: 0 });
      expect(result.general.windTurbulence).toBe(1.5);
      expect(result.general.gravityStrength).toBe(1.2);
      expect(result.general.gravityDirection).toEqual({ x: 0, y: -1, z: 0 });
    });

    it('parses version field', () => {
      const result = parseSceneJson(makeCompleteScene());
      expect(result.version).toBe(2);
    });
  });

  describe('animated properties (script/value/user)', () => {
    it('unwraps animated number property to its value', () => {
      const scene = {
        general: {
          fov: { script: 'audio * 10', value: 75, user: 'fov-control' },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.fov).toBe(75);
    });

    it('unwraps animated boolean property to its value', () => {
      const scene = {
        general: {
          bloom: { script: '', value: true },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.bloom).toBe(true);
    });

    it('uses default when animated property value is wrong type', () => {
      const scene = {
        general: {
          fov: { script: 'x', value: 'not-a-number' },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.fov).toBe(50); // default
    });

    it('persists null when field is explicitly set to null (perspectiveOverrideFov)', () => {
      const scene = {
        general: {
          perspectiveoverridefov: null,
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.perspectiveOverrideFov).toBeNull();
    });
  });

  describe('color parsing variants', () => {
    it('parses color from space-separated string "r g b"', () => {
      const scene = {
        general: {
          clearcolor: '0.5 0.6 0.7',
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.clearColor).toEqual({ r: 0.5, g: 0.6, b: 0.7 });
    });

    it('parses color from object {r, g, b}', () => {
      const scene = {
        general: {
          ambientcolor: { r: 0.2, g: 0.3, b: 0.4 },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.ambientColor).toEqual({ r: 0.2, g: 0.3, b: 0.4 });
    });

    it('parses color from object {x, y, z} (fallback)', () => {
      const scene = {
        general: {
          skylightcolor: { x: 0.1, y: 0.2, z: 0.3 },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.skylightColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    });

    it('uses default color when field is null', () => {
      const scene = {
        general: {
          bloomtint: null,
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.bloomTint).toEqual({ r: 1, g: 1, b: 1 });
    });
  });

  describe('vector parsing variants', () => {
    it('parses vec2 from string "x y"', () => {
      const scene = {
        general: {
          winddirection: '3 4',
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.windDirection).toEqual({ x: 3, y: 4 });
    });

    it('parses vec2 from object {x, y}', () => {
      const scene = {
        general: {
          winddirection: { x: 5, y: 6 },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.windDirection).toEqual({ x: 5, y: 6 });
    });

    it('parses vec3 from string "x y z"', () => {
      const scene = {
        camera: {
          center: '1 2 3',
        },
      };
      const result = parseSceneJson(scene);
      expect(result.camera.center).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('parses vec3 from object {x, y, z}', () => {
      const scene = {
        camera: {
          eye: { x: 10, y: 20, z: 30 },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.camera.eye).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('uses default vec3 when null', () => {
      const scene = {
        general: {
          gravitydirection: null,
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.gravityDirection).toEqual({ x: 0, y: -1, z: 0 });
    });

    it('parses vec3 from scalar number', () => {
      const scene = {
        camera: {
          up: 5,
        },
      };
      const result = parseSceneJson(scene);
      expect(result.camera.up).toEqual({ x: 5, y: 5, z: 5 });
    });
  });

  describe('scene object parsing', () => {
    it('parses a basic image object', () => {
      const scene = {
        objects: [
          {
            id: 42,
            name: 'background',
            image: 'bg.png',
            visible: true,
            alpha: 0.8,
          },
        ],
      };
      const result = parseSceneJson(scene);
      expect(result.objects).toHaveLength(1);
      expect(result.objects[0].id).toBe(42);
      expect(result.objects[0].name).toBe('background');
      expect(result.objects[0].image).toBe('bg.png');
      expect(result.objects[0].alpha).toBe(0.8);
    });

    it('parses object color as {r, g, b}', () => {
      const scene = {
        objects: [{ id: 1, color: '0.5 0.5 0.5' }],
      };
      const result = parseSceneJson(scene);
      expect(result.objects[0].color).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    });

    it('defaults visible to true when field is absent', () => {
      const scene = { objects: [{ id: 1 }] };
      const result = parseSceneJson(scene);
      expect(result.objects[0].visible).toBe(true);
    });

    it('respects visible: false', () => {
      const scene = { objects: [{ id: 1, visible: false }] };
      const result = parseSceneJson(scene);
      expect(result.objects[0].visible).toBe(false);
    });

    it('parses effects array on objects', () => {
      const scene = {
        objects: [
          {
            id: 1,
            effects: [
              {
                id: 10,
                name: 'glow',
                file: 'glow.fx',
                visible: true,
                passes: [
                  { id: 0, combos: { intensity: 1 }, constantShaderValues: {}, textures: [] },
                ],
              },
            ],
          },
        ],
      };
      const result = parseSceneJson(scene);
      expect(result.objects[0].effects).toHaveLength(1);
      expect(result.objects[0].effects[0].id).toBe(10);
      expect(result.objects[0].effects[0].name).toBe('glow');
    });

    it('handles animated effect visible property', () => {
      const scene = {
        objects: [
          {
            id: 1,
            effects: [
              {
                id: 1,
                name: 'bloom',
                file: '',
                visible: { script: 'audio', value: true, user: 'bloom-toggle' },
                passes: [],
              },
            ],
          },
        ],
      };
      const result = parseSceneJson(scene);
      const visible = result.objects[0].effects[0].visible;
      expect(typeof visible).toBe('object');
      if (typeof visible === 'object' && visible !== null && 'value' in visible) {
        expect(visible.value).toBe(true);
        expect(visible.script).toBe('audio');
      }
    });

    it('filters out non-object elements in objects array', () => {
      const scene = {
        objects: [{ id: 1 }, 'not-an-object', 42, null, { id: 2 }],
      };
      const result = parseSceneJson(scene);
      expect(result.objects).toHaveLength(2);
      expect(result.objects[0].id).toBe(1);
      expect(result.objects[1].id).toBe(2);
    });

    it('parses boolean flags (solid, perspective, castShadow, etc.)', () => {
      const scene = {
        objects: [
          {
            id: 1,
            solid: true,
            perspective: true,
            castshadow: true,
            depthtest: true,
            locktransforms: true,
            copybackground: true,
          },
        ],
      };
      const result = parseSceneJson(scene);
      expect(result.objects[0].solid).toBe(true);
      expect(result.objects[0].perspective).toBe(true);
      expect(result.objects[0].castShadow).toBe(true);
      expect(result.objects[0].depthTest).toBe(true);
      expect(result.objects[0].lockTransforms).toBe(true);
      expect(result.objects[0].copyBackground).toBe(true);
    });

    it('maps snake_case WE fields (audioreactive, audioband, audiogain)', () => {
      const scene = {
        objects: [{ id: 1, audioreactive: true, audioband: 2, audiogain: 1.5 }],
      };
      const result = parseSceneJson(scene);
      expect(result.objects[0].audioResponsive).toBe(true);
      expect(result.objects[0].audioBand).toBe(2);
      expect(result.objects[0].audioGain).toBe(1.5);
    });
  });

  describe('orthogonal projection variants', () => {
    it('parses custom width and height', () => {
      const scene = {
        general: {
          orthogonalprojection: { width: 3840, height: 2160 },
        },
      };
      const result = parseSceneJson(scene);
      expect(result.general.orthogonalProjection).toEqual({ width: 3840, height: 2160 });
    });

    it('falls back to Full HD when projection is missing', () => {
      const scene = { general: {} };
      const result = parseSceneJson(scene);
      expect(result.general.orthogonalProjection).toEqual({ width: 1920, height: 1080 });
    });

    it('uses partial fallback when only width is given', () => {
      const scene = {
        general: { orthogonalprojection: { width: 2560 } },
      };
      const result = parseSceneJson(scene);
      expect(result.general.orthogonalProjection).toEqual({ width: 2560, height: 1080 });
    });
  });
});
