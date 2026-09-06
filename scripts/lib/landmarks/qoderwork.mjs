// SPDX-License-Identifier: MPL-2.0

/**
 * # qoderwork landmarks — stable DOM anchors for QoderWork.
 *
 * PROBE-VERIFIED selectors from the CSS generators and THEME_SPEC.md.
 * QoderWork uses an antd-based layout with .agents-layout-root as the
 * primary structural container.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const qoderworkLandmarks = {
  required: [
    {
      name: 'agents-root',
      selectors: ['.agents-layout-root'],
    },
    {
      name: 'host-root',
      selectors: ['html.agentskin-host-qoderwork:root', 'html.agentskin-host-qoderwork'],
    },
  ],
  recommended: [
    {
      name: 'sidebar',
      selectors: ['.agents-sidebar', '[data-resizable-sidebar]'],
    },
    {
      name: 'workspace',
      selectors: ['.agents-content-area', '.agents-layout-body'],
    },
    {
      name: 'composer',
      selectors: [".chat-input-editor-text[contenteditable='true']", '[contenteditable="true"]'],
    },
    {
      name: 'parchment-surface',
      selectors: ['.agents-parchment-paper-surface'],
    },
  ],
};

export default qoderworkLandmarks;
