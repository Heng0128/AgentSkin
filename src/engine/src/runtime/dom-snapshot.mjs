export const DOM_SNAPSHOT_DEFAULT_MAX_NODES = 1000;
export const DOM_SNAPSHOT_MAX_NODES = 5000;

function landmarkProfile(adapter) {
  const verification = adapter.verification ?? {};
  return [
    { name: "root", kind: "root", any: verification.rootAny ?? ["body"] },
    ...(verification.required ?? []).map((item) => ({ name: item.name, kind: "required", any: item.any })),
    ...(verification.recommended ?? []).map((item) => ({ name: item.name, kind: "recommended", any: item.any })),
  ];
}

export function buildDomSnapshotExpression(adapter, {
  maxNodes = DOM_SNAPSHOT_DEFAULT_MAX_NODES,
  includeHidden = false,
} = {}) {
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > DOM_SNAPSHOT_MAX_NODES) {
    throw new Error(`DOM snapshot maxNodes must be an integer from 1 to ${DOM_SNAPSHOT_MAX_NODES}.`);
  }
  const config = JSON.stringify({
    appId: adapter.id,
    maxNodes,
    includeHidden: Boolean(includeHidden),
    landmarks: landmarkProfile(adapter),
  });

  return `(() => {
    const config = ${config};
    const round = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
    const limit = (value, length = 160) => String(value ?? '').slice(0, length);
    const cssEscape = (value) => {
      if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
      return String(value).replace(/(^-?\\d)|[^a-zA-Z0-9_-]/g, (character) =>
        '\\\\' + character.codePointAt(0).toString(16) + ' ');
    };
    const attributeEscape = (value) => String(value)
      .replace(/\\\\/g, '\\\\\\\\')
      .replace(/"/g, '\\\\"')
      .replace(/[\\n\\r\\f]/g, ' ');
    const generatedClass = (name) =>
      name.length > 80 || /^css-[a-z0-9]{6,}$/i.test(name) ||
      /^_[a-z][a-z0-9]*_[a-z0-9]{5,}_\\d+$/i.test(name) ||
      /(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(name);
    const elementVisible = (element, style, rect) =>
      rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.contentVisibility !== 'hidden';
    const selectorCount = (selector) => {
      try { return { selector, count: document.querySelectorAll(selector).length, valid: true }; }
      catch (error) { return { selector, count: 0, valid: false, error: limit(error?.message ?? error) }; }
    };
    const candidateSelectors = (element, tag, semanticClasses, attributes) => {
      const candidates = [];
      if (element.id) candidates.push('#' + cssEscape(element.id));
      for (const name of ['data-testid', 'data-test-id', 'data-qa', 'data-component', 'data-feature']) {
        if (attributes[name]) candidates.push('[' + name + '="' + attributeEscape(attributes[name]) + '"]');
      }
      if (attributes.role) {
        const role = '[role="' + attributeEscape(attributes.role) + '"]';
        candidates.push(attributes.contenteditable ? role + '[contenteditable="' + attributeEscape(attributes.contenteditable) + '"]' : role);
      }
      for (const name of semanticClasses.slice(0, 4)) candidates.push('.' + cssEscape(name));
      if (semanticClasses[0]) candidates.push(tag + '.' + cssEscape(semanticClasses[0]));
      if (semanticClasses.length > 1) {
        candidates.push('.' + cssEscape(semanticClasses[0]) + '.' + cssEscape(semanticClasses[1]));
      }
      if (!candidates.length && ['main', 'aside', 'nav', 'header', 'footer', 'dialog'].includes(tag)) candidates.push(tag);
      return [...new Set(candidates)].slice(0, 8).map(selectorCount);
    };
    const safeAttributeNames = [
      'role', 'data-testid', 'data-test-id', 'data-qa', 'data-component', 'data-feature',
      'data-state', 'aria-current', 'aria-expanded', 'aria-selected', 'contenteditable',
      'type', 'name', 'tabindex',
    ];
    const styleFields = [
      'display', 'position', 'zIndex', 'boxSizing', 'flexDirection', 'alignItems',
      'justifyContent', 'gap', 'padding', 'margin', 'width', 'height', 'minWidth',
      'maxWidth', 'minHeight', 'maxHeight', 'overflowX', 'overflowY', 'color',
      'backgroundColor', 'backgroundImage', 'background', 'backgroundPosition',
      'backgroundSize', 'backgroundRepeat', 'backgroundClip', 'backgroundOrigin',
      'border', 'borderRadius', 'borderColor', 'borderWidth', 'borderStyle',
      'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderBottomColor',
      'outline', 'outlineColor', 'outlineWidth', 'outlineStyle', 'boxShadow',
      'textShadow', 'opacity', 'fill', 'stroke', 'cursor', 'transition', 'transform',
      'textDecoration', 'textTransform', 'letterSpacing', 'wordSpacing', 'whiteSpace',
      'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign',
      'gridTemplateColumns', 'gridTemplateRows', 'flex', 'flexWrap', 'flexGrow',
      'flexShrink', 'flexBasis', 'alignSelf', 'justifySelf', 'objectFit',
      'mixBlendMode', 'filter', 'backdropFilter', 'pointerEvents', 'userSelect',
      'contentVisibility', 'appearance',
    ];
    const elements = document.querySelectorAll('*');
    const recorded = new Map();
    const nodes = [];
    let eligibleNodes = 0;
    let openShadowRoots = 0;
    let truncated = false;
    for (const element of elements) {
      if (element.shadowRoot) openShadowRoots += 1;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible = elementVisible(element, style, rect);
      if (!config.includeHidden && !visible) continue;
      eligibleNodes += 1;
      if (nodes.length >= config.maxNodes) {
        truncated = true;
        break;
      }
      const tag = element.tagName.toLowerCase();
      const classes = [...element.classList].map((name) => limit(name, 120));
      const semanticClasses = classes.filter((name) => !generatedClass(name));
      const attributes = {};
      for (const name of safeAttributeNames) {
        const value = element.getAttribute(name);
        if (value !== null && value !== '') attributes[name] = limit(value);
      }
      let parent = element.parentElement;
      while (parent && !recorded.has(parent)) parent = parent.parentElement;
      let depth = 0;
      for (let current = element.parentElement; current; current = current.parentElement) depth += 1;
      const styles = {};
      for (const field of styleFields) {
        const value = field === 'backgroundImage'
          ? String(style[field] ?? '').replace(/url\\((?:"[^"]*"|'[^']*'|[^)]*)\\)/gi, 'url(<redacted>)')
          : style[field];
        styles[field] = limit(value, 240);
      }
      // Design-token capture: record CSS custom properties (--*) that this
      // node overrides relative to its parent. This surfaces the actual theme
      // tokens (e.g. workbuddy's --cb-* set, --agentskin-* overrides) that the
      // fixed styleFields list above cannot see. Inherited root tokens are
      // skipped so the payload stays bounded while the root still reports all
      // of its own tokens (it has no parent to dedup against).
      const customProperties = {};
      const parentEl = element.parentElement;
      const parentStyle = parentEl ? getComputedStyle(parentEl) : null;
      for (let i = 0; i < style.length; i++) {
        const name = style[i];
        if (name.charCodeAt(0) !== 45 || name.charCodeAt(1) !== 45) continue; // starts with "--"
        const value = style.getPropertyValue(name).trim();
        if (!value) continue;
        if (parentStyle) {
          const parentValue = parentStyle.getPropertyValue(name).trim();
          if (parentValue === value) continue;
        }
        customProperties[name] = limit(value, 240);
      }
      const index = nodes.length;
      nodes.push({
        index,
        parentIndex: parent ? recorded.get(parent) : null,
        depth,
        tag,
        id: element.id ? limit(element.id, 160) : null,
        classes,
        semanticClasses,
        attributes,
        selectors: candidateSelectors(element, tag, semanticClasses, attributes),
        rect: {
          x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),
        },
        states: {
          visible,
          interactive: element.matches('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]'),
          editable: element.matches('input,textarea,[role="textbox"],[contenteditable="true"]'),
        },
        styles,
        customProperties,
      });
      recorded.set(element, index);
    }
    const landmarkResults = config.landmarks.map((landmark) => ({
      name: landmark.name,
      kind: landmark.kind,
      selectors: landmark.any.map((selector) => {
        const result = selectorCount(selector);
        return { ...result, visibleCount: result.valid ? [...document.querySelectorAll(selector)].filter((element) => {
          const rect = element.getBoundingClientRect();
          return elementVisible(element, getComputedStyle(element), rect);
        }).length : 0 };
      }),
    }));
    const redactSegment = (segment) => {
      if (/^[a-f0-9]{16,}$/i.test(segment) || /^[0-9]{6,}$/.test(segment) ||
          /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || segment.length > 48) return ':id';
      return segment;
    };
    const pathname = String(globalThis.location?.pathname ?? '')
      .split('/').map(redactSegment).join('/').slice(0, 300);
    const activeState = globalThis.__AGENTSKIN__?.hosts?.[config.appId];
    const activeThemeId = activeState?.themeId ?? document.documentElement?.dataset?.agentskinTheme ?? null;
    const activeThemeVersion = activeState?.version ?? document.documentElement?.dataset?.agentskinThemeVersion ?? null;
    return {
      schemaVersion: 1,
      appId: config.appId,
      capturedAt: new Date().toISOString(),
      activeTheme: {
        installed: Boolean(activeState || activeThemeId),
        id: activeThemeId,
        version: activeThemeVersion,
      },
      route: {
        protocol: limit(globalThis.location?.protocol ?? '', 32),
        origin: globalThis.location?.origin && globalThis.location.origin !== 'null' ? limit(globalThis.location.origin, 160) : null,
        pathname,
      },
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      },
      privacy: {
        textContent: false,
        formValues: false,
        accessibleNames: false,
        linksAndMediaSources: false,
        queryAndHash: false,
      },
      limits: { maxNodes: config.maxNodes, includeHidden: config.includeHidden },
      summary: {
        documentElements: elements.length,
        eligibleNodes,
        recordedNodes: nodes.length,
        truncated,
        openShadowRoots,
      },
      landmarks: landmarkResults,
      nodes,
    };
  })()`;
}
