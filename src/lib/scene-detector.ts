// SPDX-License-Identifier: MPL-2.0

/**
 * Scene Detector — 场景感知 CSS 注入引擎
 *
 * 参考竞品 sutongwuyanzu/WorkBuddy-Skin- 的场景感知注入模式。
 * 通过检测 DOM 中特定选择器的存在来识别当前视图场景，
 * 动态切换 CSS 类名，实现不同场景不同样式。
 *
 * @module scene-detector
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 场景类型
 */
export type SceneType = 'dashboard' | 'chat' | 'settings' | 'unknown';

/**
 * 场景检测配置
 */
export interface SceneDetectorConfig {
  /** 目标应用 ID */
  agentId: 'workbuddy' | 'codex' | 'traework' | 'qoderwork' | 'doubao' | 'zcode';
  /** CSS 选择器映射（按优先级排序） */
  selectors: Record<SceneType, string[]>;
  /** 检测间隔（毫秒），默认 500 */
  pollInterval?: number;
}

/**
 * 场景变化回调函数类型
 */
export type SceneChangeCallback = (scene: SceneType, previousScene: SceneType) => void;

// ============================================================================
// 内置配置
// ============================================================================

/**
 * 预定义的场景检测配置
 *
 * 每个应用有特定的 CSS 选择器，用于识别当前视图。
 * 选择器按优先级排序，第一个匹配的决定场景。
 */
export const BUILTIN_SCENE_CONFIGS: Record<string, SceneDetectorConfig> = {
  workbuddy: {
    agentId: 'workbuddy',
    pollInterval: 500,
    selectors: {
      dashboard: [
        '.wb-dash-active',
        '.wb-scene-tabs__pill[data-scene="dashboard"]',
        '[data-view="dashboard"]',
      ],
      chat: [
        '.wb-scene-tabs__pill[data-scene="chat"]',
        '.conversation-view',
        '.wb-conversation',
        '[data-view="chat"]',
      ],
      settings: ['.wb-settings-panel', '[data-view="settings"]', '.wb-settings'],
      unknown: [],
    },
  },
  codex: {
    agentId: 'codex',
    pollInterval: 500,
    selectors: {
      dashboard: ['.codex-home', '[data-page="home"]', '.codex-dashboard'],
      chat: ['.codex-conversation', '[data-page="conversation"]', '.codex-chat'],
      settings: ['.codex-settings', '[data-page="settings"]'],
      unknown: [],
    },
  },
  traework: {
    agentId: 'traework',
    pollInterval: 500,
    selectors: {
      dashboard: ['.trae-work-home', '.traework-dashboard'],
      chat: ['.trae-work-conversation', '.traework-chat'],
      settings: ['.trae-work-settings', '.traework-settings'],
      unknown: [],
    },
  },
  qoderwork: {
    agentId: 'qoderwork',
    pollInterval: 500,
    selectors: {
      dashboard: ['.qoder-work-home', '.qoderwork-dashboard'],
      chat: ['.qoder-work-conversation', '.qoderwork-chat'],
      settings: ['.qoder-work-settings', '.qoderwork-settings'],
      unknown: [],
    },
  },
  doubao: {
    agentId: 'doubao',
    pollInterval: 500,
    selectors: {
      dashboard: ['.doubao-home', '.doubao-dashboard'],
      chat: ['.doubao-conversation', '.doubao-chat'],
      settings: ['.doubao-settings'],
      unknown: [],
    },
  },
  zcode: {
    agentId: 'zcode',
    pollInterval: 500,
    selectors: {
      dashboard: ['.zcode-home', '.zcode-dashboard'],
      chat: ['.zcode-conversation', '.zcode-chat'],
      settings: ['.zcode-settings'],
      unknown: [],
    },
  },
};

// ============================================================================
// SceneDetector 类
// ============================================================================

/**
 * 场景检测器
 *
 * 监听 DOM 变化，自动检测当前视图场景，并触发回调通知监听者。
 */
export class SceneDetector {
  private config: SceneDetectorConfig;
  private currentScene: SceneType = 'unknown';
  private previousScene: SceneType = 'unknown';
  private callbacks: SceneChangeCallback[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /**
   * 创建场景检测器
   * @param config 检测配置
   */
  constructor(config: SceneDetectorConfig) {
    this.config = {
      pollInterval: 500,
      ...config,
    };
  }

  /**
   * 开始监听场景变化
   *
   * 幂等设计：重复调用 start() 不会创建多个定时器。
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    // 初始检测
    this.detectScene();

    // 设置轮询
    const interval = this.config.pollInterval ?? 500;
    this.intervalId = setInterval(() => {
      this.detectScene();
    }, interval);
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 获取当前场景
   */
  getCurrentScene(): SceneType {
    return this.currentScene;
  }

  /**
   * 注册场景变化回调
   * @param callback 场景变化时调用的函数
   */
  onSceneChange(callback: SceneChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 移除场景变化回调
   * @param callback 要移除的回调函数
   */
  offSceneChange(callback: SceneChangeCallback): void {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }

  /**
   * 生成场景感知 CSS 类名
   *
   * 返回如 `agent-skin-scene-dashboard` 格式的类名，
   * 可直接添加到 root 元素上。
   */
  getSceneClass(): string {
    return `agent-skin-scene-${this.currentScene}`;
  }

  /**
   * 获取所有场景 CSS 类名
   *
   * 返回所有可能的场景类名数组，用于 CSS 预定义。
   */
  getAllSceneClasses(): string[] {
    return ['dashboard', 'chat', 'settings', 'unknown'].map((scene) => `agent-skin-scene-${scene}`);
  }

  /**
   * 检查是否正在运行
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 检测当前场景
   */
  private detectScene(): void {
    const newScene = this.evaluateScene();

    if (newScene !== this.currentScene) {
      this.previousScene = this.currentScene;
      this.currentScene = newScene;
      this.notifyCallbacks();
    }
  }

  /**
   * 评估当前 DOM 状态，返回匹配的场景
   */
  private evaluateScene(): SceneType {
    const { selectors } = this.config;

    // 按优先级顺序检查场景
    const scenePriority: SceneType[] = ['dashboard', 'chat', 'settings'];

    for (const scene of scenePriority) {
      for (const selector of selectors[scene]) {
        if (this.querySelectorExists(selector)) {
          return scene;
        }
      }
    }

    return 'unknown';
  }

  /**
   * 检查 DOM 中是否存在匹配选择器的元素
   */
  private querySelectorExists(selector: string): boolean {
    try {
      if (typeof document === 'undefined') {
        return false;
      }
      return document.querySelector(selector) !== null;
    } catch {
      // 无效选择器返回 false
      return false;
    }
  }

  /**
   * 通知所有注册的回调
   */
  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      try {
        callback(this.currentScene, this.previousScene);
      } catch (error) {
        // 单个回调异常不影响其他回调
        console.warn('[SceneDetector] Callback error:', error);
      }
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 场景检测器创建选项
 */
export interface CreateSceneDetectorOptions {
  /** 是否自动开始监听，默认 false */
  autoStart?: boolean;
  /** 自定义选择器覆盖（合并到内置配置） */
  selectorsOverride?: Partial<Record<SceneType, string[]>>;
  /** 自定义检测间隔 */
  pollInterval?: number;
}

/**
 * 根据应用 ID 自动创建场景检测器
 *
 * 使用内置配置，可选择性地覆盖部分设置。
 *
 * @param agentId 应用 ID
 * @param options 创建选项
 * @return 配置好的 SceneDetector 实例
 */
export function createSceneDetector(
  agentId: SceneDetectorConfig['agentId'],
  options: CreateSceneDetectorOptions = {},
): SceneDetector {
  const builtinConfig = BUILTIN_SCENE_CONFIGS[agentId];

  if (!builtinConfig) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const config: SceneDetectorConfig = {
    ...builtinConfig,
    ...(options.pollInterval !== undefined && { pollInterval: options.pollInterval }),
    ...(options.selectorsOverride && {
      selectors: {
        ...builtinConfig.selectors,
        ...options.selectorsOverride,
      },
    }),
  };

  const detector = new SceneDetector(config);

  if (options.autoStart) {
    detector.start();
  }

  return detector;
}

// ============================================================================
// 导出类型
// ============================================================================

export type { SceneDetector as SceneDetectorInstance };
