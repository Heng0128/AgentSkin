// SPDX-License-Identifier: MPL-2.0
//
// # theme-generators.mjs — facade module (re-exports).
//
// All per-agent CSS generators and utility functions have been extracted into
// ./theme-utils.mjs (pure CSS utilities + buildContext) and ./generators/
// (one file per agent). This file remains as the stable public entry point
// so that existing imports ({ buildContext, GENERATORS }) continue to work.

import { buildContext } from './theme-utils.mjs';

import traeworkCss from './generators/traeworkCss.mjs';
import qoderworkCss from './generators/qoderworkCss.mjs';
import workbuddyCss from './generators/workbuddyCss.mjs';
import doubaoCss from './generators/doubaoCss.mjs';
import zcodeCss from './generators/zcodeCss.mjs';
import codexCss from './generators/codexCss.mjs';

export { buildContext };
export { traeworkCss, qoderworkCss, workbuddyCss, doubaoCss, zcodeCss, codexCss };

export const GENERATORS = Object.freeze({
  traework: traeworkCss,
  qoderwork: qoderworkCss,
  workbuddy: workbuddyCss,
  doubao: doubaoCss,
  zcode: zcodeCss,
  codex: codexCss,
});
