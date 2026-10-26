// SPDX-License-Identifier: MPL-2.0

/**
 * Scene Detector 测试
 *
 * 覆盖场景类型检测、场景变化回调、CSS 类名生成、
 * 多应用配置、错误处理、启动/停止生命周期。
 *
 * 稳定性（flake 稳化 2026-09-07）：本文件历史上使用真实
 * `setTimeout(100)` 赌 50ms 轮询在负载下按时触发——全量并行时
 * 线程池争抢会让定时器延迟，偶发断言失败。现全部改用
 * `vi.useFakeTimers()` + `advanceTimersByTimeAsync()`，轮询时机
 * 完全确定，不再依赖真实调度。
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
  // 确定性时钟：SceneDetector 内部用 setInterval 轮询（pollInterval 50ms）
  vi.useFakeTimers();
});

afterEach(() => {
  // @ts-expect-error - 清理
  delete globalThis.document;
  vi.useRealTimers();
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

/**
 * 前进两个轮询周期（pollInterval=50ms），确保至少一次轮询已执行。
 * start() 内部还有一次同步初始检测，这里只做确定性兜底。
 */
async function tickPolls(ms = 110): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
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
    it('应检测到 dashboard 场景', async () => {
      const detector = createTestDetector();
      mockDocument.setElement('.dashboard', true);
      detector.start();

      await tickPolls();
      expect(detector.getCurrentScene()).toBe('dashboard');
      detector.stop();
    });

    it('应检测到 chat 场景', async () => {
      const detector = createTestDetector();
      mockDocument.setElement('.chat', true);
      detector.start();

      await tickPolls();
      expect(detector.getCurrentScene()).toBe('chat');
      detector.stop();
    });

    it('应检测到 settings 场景', async () => {
      const detector = createTestDetector();
      mockDocument.setElement('.settings', true);
      detector.start();

      await tickPolls();
      expect(detector.getCurrentScene()).toBe('settings');
      detector.stop();
    });

    it('无匹配选择器时应返回 unknown', async () => {
      const detector = createTestDetector();
      detector.start();

      await tickPolls();
      expect(detector.getCurrentScene()).toBe('unknown');
      detector.stop();
    });

    it('应按优先级选择场景（dashboard > chat > settings）', async () => {
      const detector = createTestDetector();
      mockDocument.setElement('.dashboard', true);
      mockDocument.setElement('.chat', true);
      mockDocument.setElement('.settings', true);
      detector.start();

      await tickPolls();
      // dashboard 优先级最高
      expect(detector.getCurrentScene()).toBe('dashboard');
      detector.stop();
    });
  });

  // -------------------------------------------------------------------------
  // 场景变化回调测试
  // -------------------------------------------------------------------------

  describe('场景变化回调', () => {
    it('应触发场景变化回调', async () => {
      const detector = createTestDetector();
      const callback = vi.fn();
      detector.onSceneChange(callback);

      mockDocument.setElement('.dashboard', true);
      detector.start();

      await tickPolls();
      expect(callback).toHaveBeenCalledWith('dashboard', 'unknown');
      detector.stop();
    });

    it('应支持多个回调', async () => {
      const detector = createTestDetector();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      detector.onSceneChange(callback1);
      detector.onSceneChange(callback2);

      mockDocument.setElement('.chat', true);
      detector.start();

      await tickPolls();
      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      detector.stop();
    });

    it('应支持移除回调', async () => {
      const detector = createTestDetector();
      const callback = vi.fn();
      detector.onSceneChange(callback);
      detector.offSceneChange(callback);

      mockDocument.setElement('.settings', true);
      detector.start();

      // 负断言：推进多个轮询周期确认回调从未触发
      await tickPolls(200);
      expect(callback).not.toHaveBeenCalled();
      detector.stop();
    });

    it('回调异常不应影响其他回调', async () => {
      const detector = createTestDetector();
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalCallback = vi.fn();

      detector.onSceneChange(errorCallback);
      detector.onSceneChange(normalCallback);

      mockDocument.setElement('.dashboard', true);
      detector.start();

      await tickPolls();
      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
      detector.stop();
    });
  });

  // -------------------------------------------------------------------------
  // CSS 类名生成测试
  // -------------------------------------------------------------------------

  describe('CSS 类名生成', () => {
    it('应生成正确的场景类名', async () => {
      const detector = createTestDetector();
      mockDocument.setElement('.dashboard', true);
      detector.start();

      await tickPolls();
      expect(detector.getSceneClass()).toBe('agent-skin-scene-dashboard');
      detector.stop();
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
    it('无效选择器应返回 false 不抛异常', async () => {
      const detector = createTestDetector({
        selectors: {
          dashboard: ['[invalid selector'],
          chat: [],
          settings: [],
          unknown: [],
        },
      });
      detector.start();

      await tickPolls();
      expect(detector.getCurrentScene()).toBe('unknown');
      detector.stop();
    });

    it('document 未定义时应返回 unknown', async () => {
      // @ts-expect-error - 模拟无 document 环境
      delete globalThis.document;

      const detector = createTestDetector();
      detector.start();

      await tickPolls();
      expect(detector.getCurrentScene()).toBe('unknown');
      detector.stop();
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
