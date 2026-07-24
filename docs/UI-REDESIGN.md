# AgentSkin UI Redesign (Phase 4.2.8.3)

> Living proposal. **v2** updates P2 from an "Agent console upgrade" to a genuine
> product-model redesign: the primary subject changes from **Agent** to **Environment**.

## 0. Product framing (corrected)

AgentSkin is **not** a tool that manages TRAE / Qoder / WorkBuddy.
It manages the developer's **AI work environment**.

- Agent + Skin(theme) + State + Preference are bound into one **Environment persona**.
- A named Environment (Frontend Work / Backend Work / AI Research) is what "Skin" means:
  a complete work-environment skin for an AI agent.
- Unified product language tree:
  `Workspace → { Environments, Skins, Agents }`

## 1. Information architecture

```
Workspace            (Home — current environment + recent activity)
 ├ Environments      (AI Environment Center: current env, env cards, switcher)
 ├ Skins             (P3: was Theme Library → Skin Studio)
 └ Agents            (underlying agent discovery/status, read-only, de-emphasized)
Settings
```

"Agents" remains the underlying registry/discovery layer, but the user-facing primary
concept is **Environments**. The management-table feel is removed.

## 2. P2 — AI Environment Center (phased)

### P2.1 — Renderer concept validation (NO Main Process change)
- New UI types: `src/ui/types/environment.ts` → `EnvironmentModel` v1.
- New hook: `src/ui/hooks/useEnvironments.ts` backed by **mock data**.
- New page: `EnvironmentsPage` composing:
  - `EnvironmentHero` — current environment (name, agent + skin, last used)
  - `EnvironmentCard` — a saved environment
  - `AgentSwitcher` — switch active environment
  - `EnvironmentTimeline` — recent usage
  - `QuickEnvironmentActions` — Apply / Restore / Customize
- Nav: "Agents" → "Environments".
- Goal: validate page structure, card design, user mental model. Main Process untouched.

### P2.5 — Confirm model
`EnvironmentModel v1 = { id, name, agentId, themeId, themeName?, lastUsed?, status }`.
(Defer v2 extras: workspace path, font, settings, prompt profile.)

### P2.6 — Promote to infrastructure
- New `src/main/environment-service.ts` (JSON store under userData/).
- IPC: `environment:list | create | update | delete`.
- `useEnvironments` swaps mock → real service. Main Process now touched (acceptable,
  narrowly scoped; does NOT touch Runtime / Adapter / Core / Theme Engine).

## 3. EnvironmentModel (v1)

```ts
export type EnvironmentStatus = 'active' | 'idle';

export interface EnvironmentModel {
  id: string;
  name: string;
  agentId: AgentId;
  themeId: string;
  themeName: string;   // display only, mock-era convenience
  lastUsed?: string;   // ISO; undefined = never activated
  status: EnvironmentStatus;
}
```

## 4. Component tree (P2.1)

```
EnvironmentsPage
 ├ EnvironmentHero         (current environment)
 ├ QuickEnvironmentActions (Apply / Restore / Customize)
 ├ EnvironmentCard × N     (saved environments grid)
 ├ AgentSwitcher           (switch active environment)
 └ EnvironmentTimeline      (recent usage)
```

## 5. Design tokens

Unchanged from v1 — the design system in `src/ui/design` already supports this
(dark-default, surface/hover/transition utilities reused).

## 6. P3 — Skin Studio (after P2)

Theme Library → **Skin Studio**: themes reframed as skins bound to environments.
Product language: `Skins` instead of `Themes` in nav.

## 7. Migration status

- P1 ✅ Home→Workspace rename (renderer-only, `npm run check` green).
- P2.1 🔄 Environments concept (renderer-only, mock data) — this turn.
- P2.5 ⏳ confirm EnvironmentModel v1.
- P2.6 ⏳ environment-service + IPC (deferred until model stable).
- P3  ⏳ Skin Studio (after P2).
