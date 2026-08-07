// SPDX-License-Identifier: MPL-2.0

/** Swiss section label (kopf / section kicker) */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase"
      style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}
    >
      <span className="size-[3px] rounded-full" style={{ background: 'var(--primary)' }} />
      <span>{children}</span>
    </div>
  );
}
