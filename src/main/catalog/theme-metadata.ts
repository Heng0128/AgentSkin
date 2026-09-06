// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeMetadata — 主题元数据标准化（署名链合规）
 *
 * 参考 dsh-deep-whale 的署名链合规模型，为 AgentSkin 主题提供标准化的
 * 元数据校验能力。确保每个主题都携带完整的署名链信息：作者、许可、版本、
 * 强调色、wiringId。
 *
 * 与 AgentSkin 的 14-token 契约结合，在构建期校验主题元数据合规性。
 *
 * ## 署名链模型（Attribution Chain）
 *
 * 每个主题必须声明：
 * - **author**: 主题作者（name + optional url）
 * - **license**: 许可证标识（SPDX 或知名许可证）
 * - **version**: 语义化版本号
 * - **accent**: 强调色（从 14-token 的 colors.accent 派生或独立声明）
 * - **wiringId**: 主题接线标识（对齐 dsh-deep-whale 的 wiring.id）
 *
 * ## 合规等级
 *
 * - **strict**: 所有必填字段必须存在且有效（用于官方主题）
 * - **lenient**: 允许部分字段缺失（用于社区/历史主题，仅警告）
 */

import type { ThemeManifest } from './theme-manifest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 署名链合规等级。
 * - strict: 必填字段缺失即报错
 * - lenient: 必填字段缺失仅警告
 */
export type MetadataComplianceLevel = 'strict' | 'lenient';

/**
 * 主题元数据标准化接口（对齐 dsh-deep-whale skin.json 的署名链模型）。
 */
export interface ThemeMetadata {
  /** 主题作者信息。 */
  author: {
    /** 作者名（必填）。 */
    name: string;
    /** 作者主页或联系 URL（可选）。 */
    url?: string;
  };
  /** 许可证标识（SPDX 或知名许可证，如 MPL-2.0, MIT, CC-BY-NC-SA-4.0）。 */
  license: string;
  /** 语义化版本号。 */
  version: string;
  /** 强调色（CSS 颜色值，通常与 colors.accent 一致）。 */
  accent: string;
  /**
   * 主题接线标识（对齐 dsh-deep-whale 的 wiring.id）。
   * 用于在运行时唯一标识主题的"接线"配置，确保主题与目标应用正确绑定。
   * 格式：小写字母数字 + 连字符/下划线。
   */
  wiringId: string;
}

/**
 * 元数据校验结果。
 */
export interface MetadataValidationResult {
  /** 是否合规（无 errors 即为合规）。 */
  compliant: boolean;
  /** 错误列表（阻断性问题）。 */
  errors: MetadataError[];
  /** 警告列表（非阻断性问题）。 */
  warnings: MetadataError[];
}

/**
 * 单个元数据错误/警告。
 */
export interface MetadataError {
  /** 出错的字段路径（如 "author.name"）。 */
  path: string;
  /** 错误描述。 */
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 知名许可证标识集合（SPDX + 常见非 SPDX）。
 * 主题 license 字段应使用这些标准标识之一。
 */
export const KNOWN_LICENSES = [
  'MPL-2.0',
  'MIT',
  'Apache-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'CC-BY-NC-ND-4.0',
  'CC0-1.0',
  'Unlicense',
  'Proprietary',
] as const;

/**
 * wiringId 格式：小写字母数字，可包含连字符和下划线。
 * 对齐 dsh-deep-whale 的 wiring.id 命名约定。
 */
const WIRING_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * 语义化版本正则（宽松，允许预发布标签）。
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/**
 * CSS 颜色值正则（宽松：hex/rgb/rgba/hsl/hsla）。
 */
const COLOR_REGEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * 校验单个主题 manifest 的元数据合规性。
 *
 * 从 ThemeManifest 中提取元数据字段，验证署名链完整性。
 *
 * @param manifest 主题 manifest 对象
 * @param level 合规等级（默认 'strict'）
 * @returns 校验结果，包含 errors 和 warnings
 */
export function validateThemeMetadata(
  manifest: ThemeManifest,
  level: MetadataComplianceLevel = 'strict',
): MetadataValidationResult {
  const errors: MetadataError[] = [];
  const warnings: MetadataError[] = [];

  const addIssue = (path: string, message: string) => {
    if (level === 'strict') {
      errors.push({ path, message });
    } else {
      warnings.push({ path, message });
    }
  };

  // --- author ---
  if (!manifest.author) {
    addIssue('author', 'missing required author field (署名链必填)');
  } else {
    if (!manifest.author.name || typeof manifest.author.name !== 'string') {
      addIssue('author.name', 'author.name is required and must be a non-empty string');
    } else if (manifest.author.name.trim().length === 0) {
      addIssue('author.name', 'author.name must not be empty or whitespace');
    }
    if (manifest.author.url !== undefined) {
      if (typeof manifest.author.url !== 'string') {
        addIssue('author.url', 'author.url must be a string');
      } else if (!isValidUrl(manifest.author.url)) {
        addIssue('author.url', `author.url is not a valid URL: "${manifest.author.url}"`);
      }
    }
  }

  // --- license ---
  if (!manifest.license) {
    addIssue('license', 'missing required license field (署名链必填)');
  } else if (typeof manifest.license !== 'string') {
    addIssue('license', 'license must be a string');
  } else if (!isKnownLicense(manifest.license)) {
    warnings.push({
      path: 'license',
      message: `license "${manifest.license}" is not a known SPDX identifier; consider using a standard license`,
    });
  }

  // --- version ---
  if (!manifest.version) {
    addIssue('version', 'missing required version field');
  } else if (!SEMVER_REGEX.test(manifest.version)) {
    addIssue('version', `version "${manifest.version}" is not valid semver (expected "x.y.z")`);
  }

  // --- accent (from colors) ---
  const accent = manifest.colors?.accent ?? manifest.colors?.primary;
  if (!accent) {
    addIssue('colors.accent', 'missing required accent color (署名链必填，对应 colors.accent)');
  } else if (typeof accent !== 'string' || !COLOR_REGEX.test(accent)) {
    addIssue('colors.accent', `accent color "${String(accent)}" is not a valid CSS color`);
  }

  // --- wiringId ---
  // wiringId 是 P2 新增字段，存储在 manifest.wiring.id 中
  const wiringId = manifest.wiring?.id;
  if (!wiringId) {
    addIssue(
      'wiring.id',
      'missing required wiring.id (署名链必填，对齐 dsh-deep-whale wiring 模型)',
    );
  } else if (typeof wiringId !== 'string') {
    addIssue('wiring.id', 'wiring.id must be a string');
  } else if (!WIRING_ID_REGEX.test(wiringId)) {
    addIssue('wiring.id', `wiring.id "${wiringId}" must match pattern ${WIRING_ID_REGEX.source}`);
  }

  return {
    compliant: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 从 ThemeManifest 中提取标准化的 ThemeMetadata 对象。
 * 用于运行时消费（如 UI 展示、导出）。
 *
 * @param manifest 主题 manifest
 * @returns 标准化的元数据对象（缺失字段用空字符串/占位符填充）
 */
export function extractThemeMetadata(manifest: ThemeManifest): ThemeMetadata {
  return {
    author: {
      name: manifest.author?.name ?? '',
      url: manifest.author?.url,
    },
    license: manifest.license ?? '',
    version: manifest.version ?? '0.0.0',
    accent: manifest.colors?.accent ?? manifest.colors?.primary ?? '',
    wiringId: manifest.wiring?.id ?? '',
  };
}

/**
 * 检查给定的主题 manifest 是否满足署名链合规（严格模式）。
 * 便捷函数，用于快速判断。
 */
export function isAttributionCompliant(manifest: ThemeManifest): boolean {
  return validateThemeMetadata(manifest, 'strict').compliant;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function isKnownLicense(license: string): boolean {
  return (KNOWN_LICENSES as readonly string[]).includes(license);
}
