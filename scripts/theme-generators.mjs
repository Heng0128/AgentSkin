// SPDX-License-Identifier: MPL-2.0
//
// # theme-generators.mjs — facade module (re-exports).
//
// All per-agent CSS generators and utility functions have been extracted into
// ./theme-utils.mjs (pure CSS utilities + buildContext) and ./generators/
// (one file per agent). This file remains as the stable public entry point
// so that existing imports ({ buildContext, GENERATORS }) continue to work.

import codexCss from './generators/codexCss.mjs';
import doubaoCss from './generators/doubaoCss.mjs';
import qoderworkCss from './generators/qoderworkCss.mjs';
import traeworkCss from './generators/traeworkCss.mjs';
import workbuddyCss from './generators/workbuddyCss.mjs';
import zcodeCss from './generators/zcodeCss.mjs';
import { buildContext } from './theme-utils.mjs';

export { buildContext, codexCss, doubaoCss, qoderworkCss, traeworkCss, workbuddyCss, zcodeCss };

export const GENERATORS = Object.freeze({
  traework: traeworkCss,
  qoderwork: qoderworkCss,
  workbuddy: workbuddyCss,
  doubao: doubaoCss,
  zcode: zcodeCss,
  codex: codexCss,
});
