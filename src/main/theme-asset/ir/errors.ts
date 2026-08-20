// SPDX-License-Identifier: MPL-2.0

/**
 * # 错误类型定义 — Theme Asset Engine 管线错误契约
 *
 * 定义管线各阶段的错误类型，支持结构化错误处理。
 */

/** 基础管线错误 */
export class ThemeAssetError extends Error {
  constructor(
    message: string,
    /** 错误阶段 */
    public readonly stage:
      | 'detect'
      | 'parse'
      | 'infer'
      | 'adapt'
      | 'deepen'
      | 'enhance'
      | 'verify'
      | 'install'
      | 'regen',
    /** 是否可恢复（true = 可降级） */
    public readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = 'ThemeAssetError';
  }
}

/** 输入无效（缺 path/buffer、格式错误等） */
export class InvalidInputError extends ThemeAssetError {
  constructor(message: string) {
    super(message, 'detect', false);
    this.name = 'InvalidInputError';
  }
}

/** 不支持的格式（所有 adapter 都 detect=false） */
export class UnsupportedFormatError extends ThemeAssetError {
  constructor(message: string) {
    super(message, 'detect', false);
    this.name = 'UnsupportedFormatError';
  }
}

/** 输入过大（超过 MAX_INPUT_BYTES） */
export class InputTooLargeError extends ThemeAssetError {
  constructor(message: string) {
    super(message, 'detect', false);
    this.name = 'InputTooLargeError';
  }
}

/** 适配器解析失败 */
export class AdapterParseError extends ThemeAssetError {
  constructor(
    message: string,
    /** 源格式标识 */
    public readonly sourceFormat: string,
  ) {
    super(message, 'parse', true);
    this.name = 'AdapterParseError';
  }
}

/** 推导失败（部分 token 无法补全） */
export class InferenceError extends ThemeAssetError {
  constructor(message: string) {
    super(message, 'infer', true);
    this.name = 'InferenceError';
  }
}
