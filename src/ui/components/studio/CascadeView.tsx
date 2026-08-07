// SPDX-License-Identifier: MPL-2.0

import type { CssMatchedRule } from '@shared/types';

// ---------------------------------------------------------------------------
// Cascade View — DevTools-grade cascade for a selected node
// ---------------------------------------------------------------------------

export function CascadeView({
  cascade,
}: {
  cascade: {
    matchedRules: CssMatchedRule[];
    platformFonts: string[];
    boxModel: { width?: number; height?: number; left?: number; top?: number } | null;
    computed?: Array<{ property: string; value: string }>;
  };
}) {
  return (
    <div className="space-y-2">
      {cascade.platformFonts.length > 0 && (
        <div
          className="border border-border bg-card p-1.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <div
            className="mb-1 font-mono text-[9px] uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.7 }}
          >
            RENDER FONTS
          </div>
          <div className="flex flex-wrap gap-1">
            {cascade.platformFonts.map((f) => (
              <span
                key={f}
                className="bg-muted px-1 py-0.5 font-mono text-[8px]"
                style={{ color: 'var(--foreground)', borderRadius: 'var(--radius)' }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="border border-border bg-card p-1.5" style={{ borderRadius: 'var(--radius)' }}>
        <div
          className="mb-1 font-mono text-[9px] uppercase"
          style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.7 }}
        >
          CASCADE
        </div>
        {cascade.matchedRules.length === 0 ? (
          <p className="font-mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
            无（CDP CSS 域不可用）
          </p>
        ) : (
          <div className="space-y-1.5">
            {cascade.matchedRules.map((rule) => {
              const firstDecl = rule.declarations[0];
              const declKey = firstDecl
                ? `${firstDecl.name}:${firstDecl.value}${firstDecl.important ? '!important' : ''}`
                : 'no-decls';
              const stableKey = `${rule.origin}::${rule.selector ?? ''}::${declKey}`;
              return (
                <div
                  key={stableKey}
                  className="border border-border bg-muted p-1"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="px-1 py-0.5 font-mono text-[8px]"
                      style={{
                        borderRadius: 'var(--radius)',
                        color: 'var(--primary)',
                        background: 'var(--accent)',
                      }}
                    >
                      {rule.origin}
                    </span>
                    <span
                      className="truncate font-mono text-[8.5px]"
                      style={{ color: 'var(--foreground)' }}
                      title={rule.selector ?? ''}
                    >
                      {rule.selector ?? '(inline style)'}
                    </span>
                  </div>
                  {rule.declarations.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {rule.declarations.slice(0, 14).map((d) => {
                        const declKey = `${d.name}:${d.value}${d.important ? '!important' : ''}`;
                        return (
                          <div
                            key={declKey}
                            className="flex items-baseline gap-1 px-0.5 font-mono text-[8.5px]"
                          >
                            <span
                              className="w-[110px] shrink-0 truncate"
                              style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                            >
                              {d.name}
                            </span>
                            <span className="truncate" style={{ color: 'var(--foreground)' }}>
                              {d.value}
                              {d.important ? ' !important' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
