// SPDX-License-Identifier: MPL-2.0

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inferSemantics,
  isMappable,
  runPipeline,
  seedToSelector,
} from './merge-selector-harvest.mjs';

// ---------------------------------------------------------------------------
// seedToSelector
// ---------------------------------------------------------------------------

describe('seedToSelector — kind 映射', () => {
  it('返回 data-testid 属性选择器', () => {
    const result = seedToSelector({ kind: 'data-testid', anchor: 'chat-input' });
    expect(result).toBe('[data-testid="chat-input"]');
  });

  it('返回 id 选择器', () => {
    const result = seedToSelector({ kind: 'id', anchor: 'root' });
    expect(result).toBe('#root');
  });

  it('返回 data-attr 属性选择器', () => {
    const result = seedToSelector({ kind: 'data-attr', anchor: 'data-loading' });
    expect(result).toBe('[data-loading]');
  });

  it('接受含下划线的 anchor', () => {
    const result = seedToSelector({ kind: 'id', anchor: 'my_selector' });
    expect(result).toBe('#my_selector');
  });

  it('接受含连字符的 anchor', () => {
    const result = seedToSelector({ kind: 'data-testid', anchor: 'my-selector' });
    expect(result).toBe('[data-testid="my-selector"]');
  });
});

describe('seedToSelector — 无效 anchor 拒绝', () => {
  it('拒绝空字符串 anchor', () => {
    const result = seedToSelector({ kind: 'data-testid', anchor: '' });
    expect(result).toBeNull();
  });

  it('拒绝含空格的 anchor', () => {
    const result = seedToSelector({ kind: 'id', anchor: 'has space' });
    expect(result).toBeNull();
  });

  it('拒绝含引号的 anchor', () => {
    const result = seedToSelector({ kind: 'data-testid', anchor: 'has"quote' });
    expect(result).toBeNull();
  });

  it('拒绝数字开头的 anchor', () => {
    const result = seedToSelector({ kind: 'id', anchor: '123start' });
    expect(result).toBeNull();
  });

  it('拒绝未知 kind', () => {
    const result = seedToSelector({ kind: 'class', anchor: 'header' });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferSemantics
// ---------------------------------------------------------------------------

describe('inferSemantics — 语义推断', () => {
  it('推断 composer 语义', () => {
    const result = inferSemantics('chat-input');
    // 'chat-input' 同时匹配 input(composer) 和 chat(messageList)
    expect(result).toEqual(['composer', 'messageList']);
  });

  it('推断 sidebar 语义', () => {
    const result = inferSemantics('sidebar-panel');
    expect(result).toEqual(['sidebar']);
  });

  it('推断 messageList 语义', () => {
    const result = inferSemantics('message-list');
    expect(result).toEqual(['messageList']);
  });

  it('推断 toolbar 语义', () => {
    const result = inferSemantics('toolbar-wrap');
    expect(result).toEqual(['toolbar']);
  });

  it('推断 root 语义', () => {
    const result = inferSemantics('app-root');
    expect(result).toEqual(['root']);
  });

  it('无匹配时返回空数组', () => {
    const result = inferSemantics('xyz-nomatch');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isMappable
// ---------------------------------------------------------------------------

describe('isMappable — 可映射性判断', () => {
  it('返回 true 当 stability=high 且 kind=data-testid', () => {
    const result = isMappable({ kind: 'data-testid', anchor: 'test', stability: 'high' });
    expect(result).toBe(true);
  });

  it('返回 true 当 stability=high 且 kind=id', () => {
    const result = isMappable({ kind: 'id', anchor: 'root', stability: 'high' });
    expect(result).toBe(true);
  });

  it('返回 true 当 stability=high 且 kind=data-attr', () => {
    const result = isMappable({ kind: 'data-attr', anchor: 'data-loading', stability: 'high' });
    expect(result).toBe(true);
  });

  it('返回 false 当 stability=medium', () => {
    const result = isMappable({ kind: 'data-testid', anchor: 'test', stability: 'medium' });
    expect(result).toBe(false);
  });

  it('返回 false 当 stability=low', () => {
    const result = isMappable({ kind: 'id', anchor: 'root', stability: 'low' });
    expect(result).toBe(false);
  });

  it('返回 false 当 kind 不可映射', () => {
    const result = isMappable({ kind: 'class', anchor: '.header', stability: 'high' });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

describe('runPipeline — 主流程', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `selector-harvest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(name, data) {
    const filePath = join(tmpDir, name);
    writeFileSync(filePath, JSON.stringify(data));
    return filePath;
  }

  it('正常输入返回完整输出结构', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [
        { kind: 'data-testid', anchor: 'chat-input', stability: 'high' },
        { kind: 'id', anchor: 'root', stability: 'high' },
      ],
    });

    const result = runPipeline('traework', inputPath);

    expect(result.output.meta).toBeDefined();
    expect(result.output.meta.agentId).toBe('traework');
    expect(result.output.meta.source).toBe('extract-summary.json');
    expect(result.output.meta.totalSeeds).toBe(2);
    expect(result.output.meta.mappedSeeds).toBe(2);
    expect(result.output.candidates).toHaveLength(2);
    expect(result.output.byKind['data-testid']).toHaveLength(1);
    expect(result.output.byKind.id).toHaveLength(1);
    expect(result.output.byKind['data-attr']).toHaveLength(0);
  });

  it('文件不存在时抛出 input file not found', () => {
    const missingPath = join(tmpDir, 'nonexistent.json');
    expect(() => runPipeline('traework', missingPath)).toThrow(/input file not found/);
  });

  it('JSON 解析失败时抛出 failed to parse', () => {
    const inputPath = join(tmpDir, 'bad.json');
    writeFileSync(inputPath, '{ invalid json }');

    expect(() => runPipeline('traework', inputPath)).toThrow(/failed to parse/);
  });

  it('空 fragilitySeeds 返回零候选', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [],
    });

    const result = runPipeline('traework', inputPath);

    expect(result.output.meta.totalSeeds).toBe(0);
    expect(result.output.candidates).toEqual([]);
    expect(result.output.meta.filterRate).toBe('0%');
  });

  it('去重逻辑：重复 kind:anchor 只保留一个', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [
        { kind: 'data-testid', anchor: 'chat-input', stability: 'high' },
        { kind: 'data-testid', anchor: 'chat-input', stability: 'high' },
        { kind: 'data-testid', anchor: 'chat-input', stability: 'medium' },
      ],
    });

    const result = runPipeline('traework', inputPath);

    expect(result.output.meta.totalSeeds).toBe(3);
    expect(result.output.candidates).toHaveLength(1);
    expect(result.output.candidates[0].selector).toBe('[data-testid="chat-input"]');
  });

  it('过滤逻辑：仅 stability=high 通过', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [
        { kind: 'data-testid', anchor: 'stable-one', stability: 'high' },
        { kind: 'id', anchor: 'medium-one', stability: 'medium' },
        { kind: 'data-attr', anchor: 'low-one', stability: 'low' },
      ],
    });

    const result = runPipeline('traework', inputPath);

    expect(result.output.meta.totalSeeds).toBe(3);
    expect(result.output.meta.mappedSeeds).toBe(1);
    expect(result.output.candidates).toHaveLength(1);
    expect(result.output.candidates[0].selector).toBe('[data-testid="stable-one"]');
  });

  it('byKind 分桶正确归类候选', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [
        { kind: 'data-testid', anchor: 'a', stability: 'high' },
        { kind: 'data-testid', anchor: 'b', stability: 'high' },
        { kind: 'id', anchor: 'c', stability: 'high' },
        { kind: 'data-attr', anchor: 'data-x', stability: 'high' },
      ],
    });

    const result = runPipeline('traework', inputPath);

    expect(result.output.byKind['data-testid']).toHaveLength(2);
    expect(result.output.byKind.id).toHaveLength(1);
    expect(result.output.byKind['data-attr']).toHaveLength(1);
  });

  it('filterRate 格式化为百分比字符串', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [
        { kind: 'data-testid', anchor: 'a', stability: 'high' },
        { kind: 'data-testid', anchor: 'b', stability: 'medium' },
        { kind: 'data-testid', anchor: 'c', stability: 'low' },
      ],
    });

    const result = runPipeline('traework', inputPath);

    // 1/3 mapped → 67% filtered
    expect(result.output.meta.filterRate).toBe('67%');
    expect(result.output.meta.mappedSeeds).toBe(1);
  });

  it('候选携带正确的 suggestedSemantics', () => {
    const inputPath = writeFixture('extract-summary.json', {
      fragilitySeeds: [{ kind: 'data-testid', anchor: 'editor-box', stability: 'high' }],
    });

    const result = runPipeline('traework', inputPath);

    expect(result.output.candidates[0].suggestedSemantics).toEqual(['composer']);
    expect(result.output.candidates[0].source).toEqual({
      kind: 'data-testid',
      anchor: 'editor-box',
      stability: 'high',
    });
  });
});
