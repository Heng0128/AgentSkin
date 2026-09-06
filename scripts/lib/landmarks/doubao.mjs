// SPDX-License-Identifier: MPL-2.0

/**
 * # doubao landmarks — stable DOM anchors for Doubao (豆包).
 *
 * PROBE-VERIFIED selectors from the CSS generators and THEME_SPEC.md.
 * Doubao uses a `--dbx-*` 251-token semantic system. The chat-container
 * and dbx semantic containers are the primary structural nodes.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const doubaoLandmarks = {
  required: [
    {
      name: 'host-root',
      selectors: ['html.agentskin-host-doubao:root', 'html.agentskin-host-doubao'],
    },
  ],
  recommended: [
    {
      name: 'chat-container',
      selectors: ['.chat-container'],
    },
    {
      name: 'background-layer',
      selectors: ['div.agentskin-background-layer'],
    },
    {
      name: 'composer',
      selectors: ['[contenteditable="true"]', '.dbx-composer', '[data-testid="composer"]'],
    },
  ],
};

export default doubaoLandmarks;
