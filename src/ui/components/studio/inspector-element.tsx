// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorElement
 *
 * Element details panel for the Studio inspector. When an element is picked,
 * this component reads its computed styles, CSS variables, DOM breadcrumb,
 * and box model from the iframe's contentDocument and renders a detailed
 * inspection panel.
 *
 * Also includes a "Transform" section that surfaces the element's current
 * ledger entry (action + enabled toggle) and provides whitelist / blacklist
 * override buttons for the human-in-the-loop correction loop.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';

import { toMessage } from '@shared/errors';
import { X } from 'lucide-react';

interface InspectorElementProps {
  /** Ref to the iframe element. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Selector path of the picked element, or null. */
  pickedPath: string | null;
  /** Close callback. */
  onClose: () => void;
}

interface ElementDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ComputedStylesSubset {
  fontSize: string;
  color: string;
  backgroundColor: string;
  margin: string;
  padding: string;
  borderRadius: string;
  boxShadow: string;
  display: string;
}

interface ElementDetails {
  tag: string;
  classes: string[];
  id: string | null;
  dimensions: ElementDimensions;
  computedStyles: ComputedStylesSubset;
  /** CSS custom property values from the element's style (starting with --as-). */
  cssVariables: string[];
  /** Breadcrumb path: "html > body > main > div.send" */
  breadcrumb: string;
}

const READ_COMPUTED_PROPS: Record<keyof ComputedStylesSubset, string> = {
  fontSize: 'font-size',
  color: 'color',
  backgroundColor: 'background-color',
  margin: 'margin',
  padding: 'padding',
  borderRadius: 'border-radius',
  boxShadow: 'box-shadow',
  display: 'display',
};

// --- Box-model visualization constants ---
const BOX_MODEL_MARGIN_MIN_WIDTH = 80;
const BOX_MODEL_PADDING_MIN_WIDTH = 40;
const BOX_MODEL_MARGIN_BORDER_OPACITY = 40;
const BOX_MODEL_MARGIN_BG_OPACITY = 5;
const BOX_MODEL_PADDING_BORDER_OPACITY = 30;
const BOX_MODEL_PADDING_BG_OPACITY = 5;

function readElementDetails(doc: Document, selectorPath: string): ElementDetails | null {
  const el = doc.querySelector(selectorPath);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const computed = doc.defaultView?.getComputedStyle(el);

  const computedStyles: ComputedStylesSubset = {
    fontSize: '',
    color: '',
    backgroundColor: '',
    margin: '',
    padding: '',
    borderRadius: '',
    boxShadow: '',
    display: '',
  };

  if (computed) {
    for (const [key, cssProp] of Object.entries(READ_COMPUTED_PROPS)) {
      computedStyles[key as keyof ComputedStylesSubset] = computed.getPropertyValue(cssProp);
    }
  }

  // Extract CSS variables from the element's own style declaration
  const cssVariables: string[] = [];
  if (el instanceof HTMLElement && el.style) {
    for (let i = 0; i < el.style.length; i++) {
      const propName = el.style[i];
      if (propName.startsWith('--as-')) {
        const value = el.style.getPropertyValue(propName).trim();
        if (value) cssVariables.push(`${propName}: ${value}`);
      }
    }
  }

  // Build breadcrumb (parent chain)
  const breadcrumbParts: string[] = [];
  let current: Element | null = el;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (current === doc.documentElement) {
      breadcrumbParts.unshift('html');
      break;
    }
    breadcrumbParts.unshift(tag);
    current = current.parentElement;
  }
  const breadcrumb = breadcrumbParts.join(' > ');

  return {
    tag: el.tagName.toLowerCase(),
    classes: Array.from(el.classList),
    id: el.getAttribute('id'),
    dimensions: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    computedStyles,
    cssVariables,
    breadcrumb,
  };
}

export function InspectorElement({ iframeRef, pickedPath, onClose }: InspectorElementProps) {
  const [details, setDetails] = useState<ElementDetails | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument || !pickedPath) {
      setDetails(null);
      return;
    }

    // Read immediately and after a microtask (in case iframe is still settling)
    let disposed = false;
    const read = () => {
      if (disposed) return;
      const doc = iframe.contentDocument;
      if (!doc) {
        setDetails(null);
        return;
      }
      const d = readElementDetails(doc, pickedPath);
      if (!disposed) setDetails(d);
    };

    read();
    const timer = requestAnimationFrame(read);

    return () => {
      disposed = true;
      cancelAnimationFrame(timer);
    };
  }, [iframeRef, pickedPath]);

  if (!pickedPath) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {details ? (
            <>
              <span className="text-micro font-semibold text-accent">&lt;{details.tag}&gt;</span>
              {details.id && (
                <span className="text-[11px] text-muted-foreground">#{details.id}</span>
              )}
              {details.classes.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  .{details.classes.join('.')}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">Loading…</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-3" />
        </button>
      </div>

      {details && (
        <>
          {/* Box model visualization */}
          <div
            className="border border-border p-2 text-[11px] text-muted-foreground"
            style={{ background: 'var(--card)' }}
          >
            <div className="mb-1">Box Model</div>
            <div className="flex items-center justify-center">
              <div className="relative inline-flex flex-col items-center">
                <span className="text-micro">margin</span>
                <div
                  className="border border-dashed p-2"
                  style={{
                    minWidth: BOX_MODEL_MARGIN_MIN_WIDTH,
                    borderColor: `color-mix(in srgb, var(--primary) ${BOX_MODEL_MARGIN_BORDER_OPACITY}%, transparent)`,
                    backgroundColor: `color-mix(in srgb, var(--primary) ${BOX_MODEL_MARGIN_BG_OPACITY}%, transparent)`,
                  }}
                >
                  <span className="text-micro">{details.computedStyles.margin || '0'}</span>
                  <div className="mt-1 border border-border bg-background p-2">
                    <span className="text-micro">padding</span>
                    <div
                      className="mt-1 border border-dashed p-2 text-center text-micro"
                      style={{
                        minWidth: BOX_MODEL_PADDING_MIN_WIDTH,
                        borderColor: `color-mix(in srgb, var(--cr-info) ${BOX_MODEL_PADDING_BORDER_OPACITY}%, transparent)`,
                        backgroundColor: `color-mix(in srgb, var(--cr-info) ${BOX_MODEL_PADDING_BG_OPACITY}%, transparent)`,
                      }}
                    >
                      {Math.round(details.dimensions.width)} ×{' '}
                      {Math.round(details.dimensions.height)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Computed styles */}
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
              Computed Styles
            </div>
            <div
              className="flex flex-col gap-1 rounded-md border border-border p-2 text-[11px]"
              style={{ background: 'var(--card)' }}
            >
              {Object.entries(details.computedStyles)
                .filter(([, v]) => v)
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="max-w-[140px] truncate text-foreground">{value}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* CSS Variables */}
          {details.cssVariables.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                CSS Variables
              </div>
              <div
                className="flex flex-col gap-1 rounded-md border border-border p-2 text-[11px]"
                style={{ background: 'var(--card)' }}
              >
                {details.cssVariables.map((v: string) => (
                  <span key={v} className="truncate text-accent">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb */}
          <div>
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">DOM Path</div>
            <div
              className="rounded-md border border-border p-2 text-[11px] text-foreground"
              style={{ background: 'var(--card)', wordBreak: 'break-all' }}
            >
              {details.breadcrumb}
            </div>
          </div>

          {/* Transform Ledger entry for this element */}
          <TransformSection pickedPath={pickedPath} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transform section (ledger lookup + whitelist/blacklist buttons)
// ---------------------------------------------------------------------------

interface LedgerEntry {
  targetRef: string;
  action: string;
  enabled: boolean;
  source: string;
}

function TransformSection({ pickedPath }: { pickedPath: string }) {
  const [entry, setEntry] = useState<LedgerEntry | null>(null);

  const refreshEntry = useCallback(async () => {
    try {
      const state = await api.getLedgerState();
      const found = state.entries.find((e) => e.targetRef === pickedPath) ?? null;
      setEntry(found);
    } catch {
      setEntry(null);
    }
  }, [pickedPath]);

  useEffect(() => {
    void refreshEntry();
  }, [refreshEntry]);

  const handleToggle = useCallback(async () => {
    try {
      await api.toggleLedgerEntry(pickedPath);
      await refreshEntry();
    } catch (e) {
      useNotificationStore.getState().showToast(toMessage(e), 'destructive');
    }
  }, [pickedPath, refreshEntry]);

  const handleWhitelist = useCallback(async () => {
    try {
      await api.addToWhitelist(pickedPath, 'frost');
      await refreshEntry();
    } catch (e) {
      useNotificationStore.getState().showToast(toMessage(e), 'destructive');
    }
  }, [pickedPath, refreshEntry]);

  const handleBlacklist = useCallback(async () => {
    try {
      await api.addToBlacklist(pickedPath, 'keep');
      await refreshEntry();
    } catch (e) {
      useNotificationStore.getState().showToast(toMessage(e), 'destructive');
    }
  }, [pickedPath, refreshEntry]);

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Transform</div>
      <div
        className="flex flex-col gap-2 rounded-md border border-border p-2"
        style={{ background: 'var(--card)' }}
      >
        {entry ? (
          <div className="flex items-center gap-2">
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={() => void handleToggle()}
                className="size-3 accent-accent"
              />
              <span className="rounded-md bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground">
                {entry.action}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">{entry.targetRef}</span>
            </label>
            <span className="shrink-0 text-micro text-muted-foreground">{entry.source}</span>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground">No ledger entry</span>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleWhitelist()}
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
          >
            Whitelist
          </button>
          <button
            type="button"
            onClick={() => void handleBlacklist()}
            className="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
          >
            Blacklist
          </button>
        </div>
      </div>
    </div>
  );
}
