// SPDX-License-Identifier: MPL-2.0

/**
 * A1 — schema 权威副本一致性（SPEC-2 的强制力之一）。
 *
 * `src/main/catalog/manifest-v2.schema.json` 是唯一权威副本（可被打包
 * import），`docs/manifest-v2.schema.json` 只是镜像。两个副本必须逐字节
 * 一致；docs 侧因 `$schema` 声明为 draft-07，不应单独漂移。
 *
 * 若此测试失败：以 `src/main/catalog/` 为准，重新同步 docs 镜像。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CATALOG_SCHEMA = path.resolve(__dirname, 'manifest-v2.schema.json');
const DOCS_SCHEMA = path.resolve(__dirname, '../../../docs/manifest-v2.schema.json');

describe('manifest schema single-source-of-truth (A1)', () => {
  it('docs mirror is byte-identical to the catalog authority', async () => {
    const [catalog, docs] = await Promise.all([readFile(CATALOG_SCHEMA), readFile(DOCS_SCHEMA)]);
    expect(catalog.equals(docs)).toBe(true);
  });

  it('schema is valid JSON and declares the v2 contract', async () => {
    const raw = await readFile(CATALOG_SCHEMA, 'utf8');
    const schema = JSON.parse(raw) as {
      $schema?: string;
      title?: string;
      type?: string;
      required?: string[];
    };
    expect(schema.$schema).toContain('json-schema.org/draft-07');
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('colors');
    expect(schema.required).toContain('icon');
    expect(schema.required).toContain('preview');
  });

  it('colors contract requires background', async () => {
    const raw = await readFile(CATALOG_SCHEMA, 'utf8');
    const schema = JSON.parse(raw) as {
      properties?: { colors?: { required?: string[] } };
    };
    expect(schema.properties?.colors?.required).toContain('background');
  });
});
