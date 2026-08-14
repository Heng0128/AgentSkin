// SPDX-License-Identifier: MPL-2.0

import type { UiMessages } from '@shared/i18n';
import type { CssMatchedRule } from '@shared/types';

// ---------------------------------------------------------------------------
// Cascade View — DevTools-grade cascade for a selected node
//
// Single source for rendering a NodeCascade: render fonts + box-model badge +
// matched CSS rules. Both the landmark inspector (right rail) and the
// live-inspect tab render through this component.
// ---------------------------------------------------------------------------

const MAX_RULES = 8;
const MAX_DECLARATIONS = 12;

export function CascadeView({
  cascade,
  t,
}: {
  cascade: {
    matchedRules: CssMatchedRule[];
    platformFonts: string[];
    boxModel: { width?: number; height?: number; left?: number; top?: number } | null;
    computed?: Array<{ property: string; value: string }>;
  };
  t: UiMessages;
}) {
  const boxModel = cascade.boxModel;
  return (
    <div className="space-y-2">
      {/* Render fonts */}
      {cascade.platformFonts.length > 0 && (
        <div className=" bg-card p-1.5" style={{ borderRadius: 'var(--radius)' }}>
          <div
            className="mb-1 font-mono text-[10px] "
            style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.7 }}
          >
            RENDER FONTS
          </div>
          <div className="flex flex-wrap gap-1">
            {cascade.platformFonts.map((f) => (
              <span
                key={f}
                className="bg-muted px-1 py-0 font-mono text-[10px]"
                style={{ color: 'var(--foreground)', borderRadius: 'var(--radius)' }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Box model badge */}
      {boxModel && (boxModel.width !== undefined || boxModel.height !== undefined) && (
        <div className="flex items-center gap-1">
          <span
            className="bg-muted px-1 py-0 font-mono text-[10px]"
            style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
          >
            {boxModel.width ?? '?'} × {boxModel.height ?? '?'}
          </span>
          {boxModel.left !== undefined && boxModel.top !== undefined && (
            <span
              className="bg-muted px-1 py-0 font-mono text-[10px]"
              style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
            >
              @ {boxModel.left}, {boxModel.top}
            </span>
          )}
        </div>
      )}

      {/* Matched CSS rules */}
      <div className=" bg-card p-1.5" style={{ borderRadius: 'var(--radius)' }}>
        <div
          className="mb-1 font-mono text-[10px] "
          style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.7 }}
        >
          CASCADE
        </div>
        {cascade.matchedRules.length === 0 ? (
          <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
            {t.studioCascadeNoRules}
          </p>
        ) : (
          <div className="space-y-1.5">
            {cascade.matchedRules.slice(0, MAX_RULES).map((rule, idx) => {
              const declKey = rule.declarations[0]
                ? `${rule.declarations[0].name}:${rule.declarations[0].value}`
                : 'empty';
              const stableKey = `${rule.origin}::${rule.selector ?? ''}::${declKey}::${idx}`;
              return <CssRuleRow key={stableKey} rule={rule} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CssRuleRow({ rule }: { rule: CssMatchedRule }) {
  return (
    <div className=" bg-muted p-1" style={{ borderRadius: 'var(--radius)' }}>
      <div className="flex items-center gap-1">
        <span
          className="px-1 py-0 font-mono text-[10px]"
          style={{
            borderRadius: 'var(--radius)',
            color: 'var(--primary)',
            background: 'var(--accent)',
          }}
        >
          {rule.origin}
        </span>
        <span
          className="truncate font-mono text-[10px]"
          style={{ color: 'var(--foreground)' }}
          title={rule.selector ?? ''}
        >
          {rule.selector ?? '(inline style)'}
        </span>
      </div>
      {rule.declarations.length > 0 && (
        <div className="mt-1 space-y-px">
          {rule.declarations.slice(0, MAX_DECLARATIONS).map((d) => (
            <div
              key={`${d.name}:${d.value}${d.important ? '!important' : ''}`}
              className="flex items-baseline gap-1 px-0 font-mono text-[10px]"
            >
              <span
                className="w-[100px] shrink-0 truncate"
                style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
              >
                {d.name}
              </span>
              <span className="truncate" style={{ color: 'var(--foreground)' }}>
                {d.value}
                {d.important ? ' !important' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
