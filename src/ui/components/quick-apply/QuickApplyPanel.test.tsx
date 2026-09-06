// SPDX-License-Identifier: MPL-2.0

/**
 * # QuickApplyPanel 渲染测试
 *
 * 遵循项目 UI 测试约定：使用 renderToStaticMarkup 进行 SSR 渲染测试。
 * 运行在 node 环境（非 jsdom），断言静态 HTML 标记。
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock stores and hooks ---
vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: () => ({ showToast: vi.fn() }),
}));

// --- Mock lucide icons (SSR-safe) ---
vi.mock('lucide-react', () => ({
  UploadCloud: () => '<svg data-icon="UploadCloud"></svg>',
  Image: () => '<svg data-icon="Image"></svg>',
  RotateCcw: () => '<svg data-icon="RotateCcw"></svg>',
  X: () => '<svg data-icon="X"></svg>',
}));

// --- Mock cn utility ---
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// --- Import component AFTER mocks are registered ---
import { QuickApplyPanel } from './QuickApplyPanel';

const mockT = {
  quickApplyTitle: 'Quick Apply',
  quickApplyDropHint: 'Drop an image here',
  quickApplySupportedFormats: 'PNG, JPG, WEBP, BMP, AVIF',
  quickApplyDecoding: 'Decoding...',
  quickApplyAnalyzing: 'Analyzing...',
  quickApplyExtracting: 'Extracting...',
  quickApplyBuilding: 'Building...',
  quickApplyInstalling: 'Installing...',
  quickApplyApplying: 'Applying...',
  quickApplyDone: 'Theme applied!',
  quickApplyError: 'Error',
  quickApplyUndo: 'Undo',
  quickApplyRetry: 'Retry',
  quickApplySelectImage: 'Select image',
  quickApplySuccess: 'Success!',
  quickApplyClipboardError: 'Invalid image format',
};

// --- Helpers ---
function setupWindowMock() {
  (window as unknown as { agentskin: Record<string, unknown> }).agentskin = {
    quickApplySubmit: vi.fn(),
    quickApplyUndo: vi.fn(),
    getPathForFile: vi.fn(() => '/test/image.png'),
    onQuickApplyProgress: vi.fn(() => vi.fn()),
  };
}

function renderPanel() {
  setupWindowMock();
  return renderToStaticMarkup(<QuickApplyPanel t={mockT} selectedAgent="codex" />);
}

// --- Tests ---
describe('QuickApplyPanel — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Quick Apply title', () => {
    const html = renderPanel();
    expect(html).toContain('Quick Apply');
  });

  it('renders the drop zone hint', () => {
    const html = renderPanel();
    expect(html).toContain('Drop an image here');
  });

  it('renders supported formats text', () => {
    const html = renderPanel();
    expect(html).toContain('PNG, JPG, WEBP, BMP, AVIF');
  });

  it('renders the select image button', () => {
    const html = renderPanel();
    expect(html).toContain('Select image');
  });

  it('renders upload icon in idle state', () => {
    const html = renderPanel();
    // renderToStaticMarkup 将双引号转义为 &quot;
    expect(html).toContain('data-icon=&quot;UploadCloud&quot;');
  });
});

// ---------------------------------------------------------------------------
// 注意：交互测试（文件选择、按钮点击、状态转换）已分别由以下模块覆盖：
// - quick-apply-engine.test.ts — 引擎流程 + 错误处理
// - quick-apply-ipc.test.ts — IPC 调用 + 进度推送
// 这与项目 UI 测试约定保持一致：环境为 node，使用 renderToStaticMarkup。
// ---------------------------------------------------------------------------
