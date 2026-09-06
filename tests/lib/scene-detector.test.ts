// SPDX-License-Identifier: MPL-2.0

/**
 * Scene Detector 测试
 *
 * 覆盖场景类型检测、场景变化回调、CSS 类名生成、
 * 多应用配置、错误处理、启动/停止生命周期。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_SCENE_CONFIGS,
  createSceneDetector,
  SceneDetector,
  type SceneDetectorConfig,
} from '../../src/lib/scene-detector';

// ============================================================================
// Mock DOM 环境
// ============================================================================

/**
 * 创建模拟的 document 对象
 */
function createMockDocument() {
  const elements = new Map<string, boolean>();

  return {
    querySelector(selector: string) {
      return elements.get(selector) ? { selector } : null;
    },
    setElement(selector: string, exists: boolean) {
      if (exists) {
        elements.set(selector, true);
      } else {
        elements.delete(selector);
      }
    },
    clear() {
      elements.clear();
    },
  };
}

// 全局 mock document
let mockDocument: ReturnType<typeof createMockDocument>;

beforeEach(() => {
  mockDocument = createMockDocument();
  // @ts-expect-error - 模拟 DOM 环境
  globalThis.document = mockDocument;
});

afterEach(() => {
  // @ts-expect-error - 清理
  delete globalThis.document;
  vi.restoreAllMocks();
});

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建测试用的 SceneDetector 实例
 */
function createTestDetector(overrides?: Partial<SceneDetectorConfig>): SceneDetector {
  const config: SceneDetectorConfig = {
    agentId: 'workbuddy',
    pollInterval: 50,
    selectors: {
      dashboard: ['.dashboard', '[data-scene="dashboard"]'],
      chat: ['.chat', '[data-scene="chat"]'],
      settings: ['.settings', '[data-scene="settings"]'],
      unknown: [],
    },
    ...overrides,
  };
  return new SceneDetector(config);
}

// ============================================================================
// 测试套件
// ============================================================================

describe('SceneDetector', () => {
  // -------------------------------------------------------------------------
  // 基础功能测试
  // -------------------------------------------------------------------------

  describe('基础功能', () => {
    it('应使用默认配置创建实例', () => {
      const detector = createTestDetector();
      expect(detector).toBeDefined();
      expect(detector.getCurrentScene()).toBe('unknown');
      expect(detector.getIsRunning()).toBe(false);
    });

    it('应接受自定义配置', () => {
      const detector = createTestDetector({ pollInterval: 1000 });
      expect(detector).toBeDefined();
    });

    it('初始场景应为 unknown', () => {
      const detector = createTestDetector();
      expect(detector.getCurrentScene()).toBe('unknown');
    });
  });

  // -------------------------------------------------------------------------
  // 场景检测测试
  // -------------------------------------------------------------------------

  describe('场景检测', () => {
    it('应检测到 dashboard 场景', () => {
      const detector = createTestDetector();
      mockDocument.setElement('.dashboard', true);
      detector.start();

      // 等待轮询检测
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getCurrentScene()).toBe('dashboard');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('应检测到 chat 场景', () => {
      const detector = createTestDetector();
      mockDocument.setElement('.chat', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getCurrentScene()).toBe('chat');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('应检测到 settings 场景', () => {
      const detector = createTestDetector();
      mockDocument.setElement('.settings', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getCurrentScene()).toBe('settings');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('无匹配选择器时应返回 unknown', () => {
      const detector = createTestDetector();
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getCurrentScene()).toBe('unknown');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('应按优先级选择场景（dashboard > chat > settings）', () => {
      const detector = createTestDetector();
      mockDocument.setElement('.dashboard', true);
      mockDocument.setElement('.chat', true);
      mockDocument.setElement('.settings', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // dashboard 优先级最高
          expect(detector.getCurrentScene()).toBe('dashboard');
          detector.stop();
          resolve();
        }, 100);
      });
    });
  });

  // -------------------------------------------------------------------------
  // 场景变化回调测试
  // -------------------------------------------------------------------------

  describe('场景变化回调', () => {
    it('应触发场景变化回调', () => {
      const detector = createTestDetector();
      const callback = vi.fn();
      detector.onSceneChange(callback);

      mockDocument.setElement('.dashboard', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback).toHaveBeenCalledWith('dashboard', 'unknown');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('应支持多个回调', () => {
      const detector = createTestDetector();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      detector.onSceneChange(callback1);
      detector.onSceneChange(callback2);

      mockDocument.setElement('.chat', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback1).toHaveBeenCalled();
          expect(callback2).toHaveBeenCalled();
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('应支持移除回调', () => {
      const detector = createTestDetector();
      const callback = vi.fn();
      detector.onSceneChange(callback);
      detector.offSceneChange(callback);

      mockDocument.setElement('.settings', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback).not.toHaveBeenCalled();
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('回调异常不应影响其他回调', () => {
      const detector = createTestDetector();
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalCallback = vi.fn();

      detector.onSceneChange(errorCallback);
      detector.onSceneChange(normalCallback);

      mockDocument.setElement('.dashboard', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(errorCallback).toHaveBeenCalled();
          expect(normalCallback).toHaveBeenCalled();
          detector.stop();
          resolve();
        }, 100);
      });
    });
  });

  // -------------------------------------------------------------------------
  // CSS 类名生成测试
  // -------------------------------------------------------------------------

  describe('CSS 类名生成', () => {
    it('应生成正确的场景类名', () => {
      const detector = createTestDetector();
      mockDocument.setElement('.dashboard', true);
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getSceneClass()).toBe('agent-skin-scene-dashboard');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('应生成所有场景类名', () => {
      const detector = createTestDetector();
      const classes = detector.getAllSceneClasses();
      expect(classes).toEqual([
        'agent-skin-scene-dashboard',
        'agent-skin-scene-chat',
        'agent-skin-scene-settings',
        'agent-skin-scene-unknown',
      ]);
    });

    it('unknown 场景应生成对应类名', () => {
      const detector = createTestDetector();
      expect(detector.getSceneClass()).toBe('agent-skin-scene-unknown');
    });
  });

  // -------------------------------------------------------------------------
  // 生命周期测试
  // -------------------------------------------------------------------------

  describe('生命周期', () => {
    it('start() 应启动检测', () => {
      const detector = createTestDetector();
      detector.start();
      expect(detector.getIsRunning()).toBe(true);
      detector.stop();
    });

    it('stop() 应停止检测', () => {
      const detector = createTestDetector();
      detector.start();
      detector.stop();
      expect(detector.getIsRunning()).toBe(false);
    });

    it('重复 start() 不应创建多个定时器', () => {
      const detector = createTestDetector();
      detector.start();
      detector.start();
      expect(detector.getIsRunning()).toBe(true);
      detector.stop();
    });

    it('重复 stop() 不应报错', () => {
      const detector = createTestDetector();
      detector.start();
      detector.stop();
      detector.stop();
      expect(detector.getIsRunning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 错误处理测试
  // -------------------------------------------------------------------------

  describe('错误处理', () => {
    it('无效选择器应返回 false 不抛异常', () => {
      const detector = createTestDetector({
        selectors: {
          dashboard: ['[invalid selector'],
          chat: [],
          settings: [],
          unknown: [],
        },
      });
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getCurrentScene()).toBe('unknown');
          detector.stop();
          resolve();
        }, 100);
      });
    });

    it('document 未定义时应返回 unknown', () => {
      // @ts-expect-error - 模拟无 document 环境
      delete globalThis.document;

      const detector = createTestDetector();
      detector.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(detector.getCurrentScene()).toBe('unknown');
          detector.stop();
          resolve();
        }, 100);
      });
    });
  });
});

// ============================================================================
// 工厂函数测试
// ============================================================================

describe('createSceneDetector', () => {
  it('应使用内置配置创建检测器', () => {
    const detector = createSceneDetector('workbuddy');
    expect(detector).toBeInstanceOf(SceneDetector);
  });

  it('应支持 autoStart 选项', () => {
    const detector = createSceneDetector('codex', { autoStart: true });
    expect(detector.getIsRunning()).toBe(true);
    detector.stop();
  });

  it('应支持自定义 pollInterval', () => {
    const detector = createSceneDetector('traework', { pollInterval: 1000 });
    expect(detector).toBeInstanceOf(SceneDetector);
  });

  it('应支持选择器覆盖', () => {
    const detector = createSceneDetector('workbuddy', {
      selectorsOverride: {
        dashboard: ['.custom-dashboard'],
      },
    });
    expect(detector).toBeInstanceOf(SceneDetector);
  });

  it('未知 agentId 应抛出错误', () => {
    expect(() => {
      // @ts-expect-error - 测试无效 agentId
      createSceneDetector('unknown-agent');
    }).toThrow('Unknown agent: unknown-agent');
  });
});

// ============================================================================
// 内置配置测试
// ============================================================================

describe('BUILTIN_SCENE_CONFIGS', () => {
  it('应包含 workbuddy 配置', () => {
    const config = BUILTIN_SCENE_CONFIGS.workbuddy;
    expect(config).toBeDefined();
    expect(config.agentId).toBe('workbuddy');
    expect(config.selectors.dashboard.length).toBeGreaterThan(0);
    expect(config.selectors.chat.length).toBeGreaterThan(0);
    expect(config.selectors.settings.length).toBeGreaterThan(0);
  });

  it('应包含 codex 配置', () => {
    const config = BUILTIN_SCENE_CONFIGS.codex;
    expect(config).toBeDefined();
    expect(config.agentId).toBe('codex');
  });

  it('应包含 traework 配置', () => {
    const config = BUILTIN_SCENE_CONFIGS.traework;
    expect(config).toBeDefined();
    expect(config.agentId).toBe('traework');
  });

  it('应包含 qoderwork 配置', () => {
    const config = BUILTIN_SCENE_CONFIGS.qoderwork;
    expect(config).toBeDefined();
    expect(config.agentId).toBe('qoderwork');
  });

  it('应包含 doubao 配置', () => {
    const config = BUILTIN_SCENE_CONFIGS.doubao;
    expect(config).toBeDefined();
    expect(config.agentId).toBe('doubao');
  });

  it('应包含 zcode 配置', () => {
    const config = BUILTIN_SCENE_CONFIGS.zcode;
    expect(config).toBeDefined();
    expect(config.agentId).toBe('zcode');
  });

  it('所有配置应有有效的选择器', () => {
    for (const [_agentId, config] of Object.entries(BUILTIN_SCENE_CONFIGS)) {
      expect(config.selectors).toBeDefined();
      expect(Array.isArray(config.selectors.dashboard)).toBe(true);
      expect(Array.isArray(config.selectors.chat)).toBe(true);
      expect(Array.isArray(config.selectors.settings)).toBe(true);
    }
  });
});
