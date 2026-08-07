// SPDX-License-Identifier: MPL-2.0

/**
 * # variable-graph — CSS Variable Dependency Graph Inference Engine
 *
 * Analyzes live CSS to extract custom properties (`--*`), resolve `var()` cross
 * references into a directed dependency graph, infer each variable's design-role
 * type from its usage context, and notify subscribers when a variable's value
 * changes so the engine can propagate updates to all dependents.
 *
 * ## Integration with token-extractor.ts
 *
 * `TokenExtractor.sample()` produces `ExtractedTokens` (color / font / spacing
 * frequency lists). The variable graph is the **complementary** view: it captures
 * the *structural* layer (which variable controls which design dimension and how
 * variables compose) while TokenExtractor captures the *frequency-distribution*
 * layer (which concrete values appear most). Together they give the palette
 * builder (`palette/generator.ts` and its `buildPaletteCss`) both:
 *
 *   1. The concrete color values from `TokenExtractor` (already in `#RRGGBB`).
 *   2. The dependency topology from this graph (which `--primary` feeds into
 *      `--surface-border`, so changing `--primary` cascades correctly).
 *
 * A typical pipeline order is:
 *
 *   ```
 *   const cascade = await captureNodeCascade(session, nodeId);
 *   const tokens = await extractor.sample();
 *   const graph = new CssVariableGraph();
 *   graph.extractFromStyle(cascade.computedCssText); // or any CSS block
 *   graph.resolveReferences();
 *   // Now graph.getByType(VarType.BgColor) returns all background vars.
 *   ```
 *
 * ## Dark Reader comparison
 *
 * This implementation is inspired by Dark Reader's `VariablesStore` but diverges
 * in three key ways:
 *
 *   1. **Bitmask types** — Dark Reader uses a single-type enum; we use a bitmask
 *      (`VarType`) so a single variable can simultaneously be `BgColor | TextColor`
 *      when used in multiple contexts. This is common for ambiguous vars like
 *      `--foreground` that appear in both `color` and `border-color`.
 *
 *   2. **Lazy type inference** — Dark Reader infers types at value-resolution time;
 *      we infer eagerly at `resolveReferences()` time from the `usageContext` map.
 *      This lets the palette builder query all background variables upfront without
 *      walking resolved values.
 *
 *   3. **Immutable subscriber snapshots** — Dark Reader notifies subscribers with
 *      the live variable object; we pass a shallow-frozen snapshot to prevent
 *      callbacks from accidentally mutating internal graph state.
 */

// ---------------------------------------------------------------------------
// VarType bitmask
// ---------------------------------------------------------------------------

/**
 * Bitmask describing which CSS property contexts a variable participates in.
 * A variable can have multiple bits set (e.g. `BgColor | TextColor` when used
 * in both `background-color` and `color` declarations).
 */
export enum VarType {
  None = 0,
  BgColor = 1 << 0, // 1  — used in background-color, background, etc.
  TextColor = 1 << 1, // 2  — used in color
  BorderColor = 1 << 2, // 4  — used in border-color, outline-color
  BgImage = 1 << 3, // 8  — used in background-image
  FontFamily = 1 << 4, // 16 — used in font-family
}

// ---------------------------------------------------------------------------
// CSS property → VarType mapping
// ---------------------------------------------------------------------------

/** CSS properties that map to the BgColor bit. */
const BG_COLOR_PROPS = new Set([
  'background',
  'background-color',
  'background-image', // also sets BgImage below — handled specially
  '--background', // custom longhands from themes
]);

/** CSS properties that map to the BgImage bit. */
const BG_IMAGE_PROPS = new Set(['background-image', 'background']);

/** CSS properties that map to the TextColor bit. */
const TEXT_COLOR_PROPS = new Set(['color', '--foreground', '--text']);

/** CSS properties that map to the BorderColor bit. */
const BORDER_COLOR_PROPS = new Set([
  'border',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline',
  'outline-color',
]);

/** CSS properties that map to the FontFamily bit. */
const FONT_FAMILY_PROPS = new Set(['font-family', '--font']);

// ---------------------------------------------------------------------------
// CssVariable
// ---------------------------------------------------------------------------

export interface CssVariable {
  /** Variable name with leading `--`, e.g. `--primary`. */
  readonly name: string;
  /** Raw value as authored, e.g. `#FF453A` or `var(--accent)`. */
  value: string;
  /** Bitmask of roles inferred from usage contexts. Starts as `None`. */
  type: VarType;
  /** Variables whose values reference this variable (reverse edges). */
  dependents: string[];
  /** Variables referenced by this variable's value (forward edges). */
  dependencies: string[];
  /** Timestamp (Date.now()) of the last `setVariable` touch. */
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Internal — mutable backing record
// ---------------------------------------------------------------------------

interface VariableRecord {
  name: string;
  value: string;
  type: VarType;
  dependents: Set<string>; // names that reference us
  dependencies: Set<string>; // names we reference
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// CssVariableGraph
// ---------------------------------------------------------------------------

/**
 * In-memory directed graph of CSS custom properties.
 *
 * Constructed empty; call {@link extractFromStyle} one or more times to ingest
 * CSS, then call {@link resolveReferences} to wire up the dependency edges.
 * After that the graph is queryable via {@link getByType}, {@link subscribe}, etc.
 */
export class CssVariableGraph {
  private readonly variables = new Map<string, VariableRecord>();
  private readonly subscribers = new Map<string, Set<(v: Readonly<CssVariable>) => void>>();

  /** Tracks the property name each var() was seen in for type inference. */
  private readonly usageContext = new Map<string, Set<string>>();

  // -----------------------------------------------------------------------
  // Ingestion
  // -----------------------------------------------------------------------

  /**
   * Parse CSS variable declarations from a style block and absorb them into
   * the graph. Handles:
   *
   *   - Standard declarations: `--color: red; --bg: blue;`
   *   - Multi-word values: `--font: "Space Grotesk", sans-serif;`
   *   - var() fallbacks: `--accent: var(--primary, #FF453A);`
   *   - Comments containing variable names are skipped (slash-star stripped).
   *   - Empty / whitespace-only input: no-op.
   *
   * Re-declaring an existing variable updates its `value` and `lastUpdated`
   * but preserves existing type inference and subscriber wiring — call
   * {@link resolveReferences} again if the new value introduces new var() refs.
   */
  extractFromStyle(styleCss: string): void {
    if (!styleCss || typeof styleCss !== 'string') return;

    // Strip comments to avoid matching variable declarations inside them.
    const cleaned = styleCss.replace(/\/\*[\s\S]*?\*\//g, '');

    // Match: --ident: value; (the value runs until the next semicolon — no
    // need to handle nested parens because CSS custom property values
    // don't contain semicolons inside var() or other functions).
    const declRe = /--([a-zA-Z_][\w-]*)\s*:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
    while ((m = declRe.exec(cleaned)) !== null) {
      const name = `--${m[1]}`;
      const rawValue = m[2].trim();
      this.absorbVariable(name, rawValue);
    }
  }

  /**
   * Associate a `var(--name)` usage with the CSS property it appears in so the
   * type inference pass can tag the variable with the correct `VarType` bits.
   *
   * Typically called by an external parser that walks declarations that
   * _consume_ variables (e.g. `background-color: var(--bg-primary)`) to tell
   * the graph "`--bg-primary` is used as a background color".
   */
  recordUsage(variableName: string, property: string): void {
    if (!variableName || !property) return;
    const ctx = this.usageContext.get(variableName) ?? new Set<string>();
    ctx.add(property);
    this.usageContext.set(variableName, ctx);
  }

  // -----------------------------------------------------------------------
  // Resolution
  // -----------------------------------------------------------------------

  /**
   * Walk every variable's value, find all `var(--name)` references, and build
   * the bidirectional dependency edges. Also runs `inferType` for each
   * variable that has recorded usage contexts.
   *
   * Idempotent — calling multiple times safely re-wires edges from the latest
   * value content. Clears previous dependency/dependent links first.
   */
  resolveReferences(): void {
    // 1. Clear all existing edges.
    for (const v of this.variables.values()) {
      v.dependents.clear();
      v.dependencies.clear();
    }

    // 2. Walk each variable and find var() references.
    //    Supports fallback syntax: var(--a, var(--b)) — only the *primary*
    //    referenced var is treated as a dependency; fallbacks are ignored
    //    for topological purposes (they only activate if primary is absent).
    const varRe = /var\(\s*(--[a-zA-Z_][\w-]*)/g;
    for (const [name, record] of this.variables) {
      const val = record.value;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
      while ((m = varRe.exec(val)) !== null) {
        const refName = m[1];
        if (refName === name) continue; // self-reference: skip
        if (!this.variables.has(refName)) continue; // unknown var: skip

        // Forward edge: this variable depends on refName.
        record.dependencies.add(refName);

        // Reverse edge: refName has this variable as dependent.
        const refRecord = this.variables.get(refName);
        if (refRecord) {
          refRecord.dependents.add(name);
        }
      }
    }

    // 3. Infer types from usage contexts (idempotent — re-tagging is fine).
    for (const [name, record] of this.variables) {
      const ctx = this.usageContext.get(name);
      if (ctx) {
        record.type = this.inferTypeFromProperties(ctx);
      }
    }

    // 4. Propagate types backward through the dependency chain.
    //    If `--surface: var(--bg)` and `--surface` is recorded as used in
    //    `background-color` (BgColor), then `--bg` must also be BgColor —
    //    whatever `--bg` value resolves to becomes `--surface`'s color.
    //    This mirrors Dark Reader's strategy of type inheritance along
    //    reference edges.
    this.propagateTypes();
  }

  /**
   * Propagate each variable's type bits to the variables it depends on.
   * Uses BFS with a visited set to avoid infinite loops on circular refs.
   * A variable that already has some type bits keeps them (bitwise OR).
   */
  private propagateTypes(): void {
    for (const [name, record] of this.variables) {
      if (record.type === VarType.None) continue;
      const visited = new Set<string>([name]);
      const queue = [...record.dependencies];
      while (queue.length > 0) {
        const depName = queue.shift()!;
        if (visited.has(depName)) continue;
        visited.add(depName);
        const dep = this.variables.get(depName);
        if (!dep) continue;
        // Inherit the originating variable's type.
        dep.type |= record.type;
        // Continue propagating further up the chain.
        queue.push(...dep.dependencies);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Type inference
  // -----------------------------------------------------------------------

  /**
   * Map a single CSS property name to the corresponding `VarType` bit.
   * Returns `VarType.None` for properties that don't map cleanly
   * (e.g. `all`, `transition`, custom properties with generic names).
   */
  inferType(usageProperty: string): VarType {
    if (!usageProperty) return VarType.None;
    const prop = usageProperty.trim().toLowerCase();
    let bits = VarType.None;
    if (BG_COLOR_PROPS.has(prop)) bits |= VarType.BgColor;
    if (BG_IMAGE_PROPS.has(prop)) bits |= VarType.BgImage;
    if (TEXT_COLOR_PROPS.has(prop)) bits |= VarType.TextColor;
    if (BORDER_COLOR_PROPS.has(prop)) bits |= VarType.BorderColor;
    if (FONT_FAMILY_PROPS.has(prop)) bits |= VarType.FontFamily;
    return bits;
  }

  /**
   * Union the type bits for a set of property names. A variable used in both
   * `background-color` and `color` will have `BgColor | TextColor`.
   */
  private inferTypeFromProperties(props: Set<string>): VarType {
    let bits = VarType.None;
    for (const p of props) {
      bits |= this.inferType(p);
    }
    return bits;
  }

  // -----------------------------------------------------------------------
  // Mutation + notification
  // -----------------------------------------------------------------------

  /**
   * Update a variable's value, refresh its `lastUpdated` timestamp, and
   * notify all direct subscribers to this variable. Then recursively notifies
   * dependents (variables whose value references this one) so the UI layer
   * can re-resolve and re-render.
   *
   * If the variable does not yet exist, it is created with `VarType.None`.
   * The caller should follow up with a `resolveReferences()` call if the new
   * value introduces or removes var() references.
   */
  setVariable(name: string, value: string): void {
    if (!name) return;
    let record = this.variables.get(name);
    if (!record) {
      record = this.createRecord(name, value);
      this.variables.set(name, record);
    }
    record.value = value;
    record.lastUpdated = Date.now();
    this.notify(record);
  }

  /**
   * Subscribe to changes on a specific variable. The callback receives an
   * immutable snapshot of the variable at the time of the change.
   *
   * Returns an unsubscribe function. Calling it more than once is a safe no-op.
   */
  subscribe(name: string, callback: (v: Readonly<CssVariable>) => void): () => void {
    if (!name) return () => {};
    let subs = this.subscribers.get(name);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(name, subs);
    }
    subs.add(callback);

    // Return unsubscribe function.
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      subs?.delete(callback);
      if (subs && subs.size === 0) {
        this.subscribers.delete(name);
      }
    };
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Return every variable whose type bitmask overlaps with `type`.
   * To match *exactly*, compare `v.type === type` yourself.
   */
  getByType(type: VarType): CssVariable[] {
    const out: CssVariable[] = [];
    for (const record of this.variables.values()) {
      if (record.type & type) {
        out.push(this.toReadonly(record));
      }
    }
    return out;
  }

  /** Return a readonly snapshot of a variable, or `null` if it doesn't exist. */
  get(name: string): Readonly<CssVariable> | null {
    const record = this.variables.get(name);
    return record ? this.toReadonly(record) : null;
  }

  /** Total number of variables in the graph. */
  get size(): number {
    return this.variables.size;
  }

  /** Remove all variables, dependencies, and subscribers. Clears the graph completely. */
  clear(): void {
    this.variables.clear();
    this.subscribers.clear();
    this.usageContext.clear();
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Create or update a variable record during ingestion.
   * Preserves inference and edges if the variable already exists.
   */
  private absorbVariable(name: string, rawValue: string): void {
    const existing = this.variables.get(name);
    if (existing) {
      existing.value = rawValue;
      existing.lastUpdated = Date.now();
    } else {
      this.variables.set(name, this.createRecord(name, rawValue));
    }
  }

  private createRecord(name: string, value: string): VariableRecord {
    return {
      name,
      value,
      type: VarType.None,
      dependents: new Set(),
      dependencies: new Set(),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Notify direct subscribers of this record, then recursively notify
   * subscribers to all dependents. Uses a visited set to prevent infinite
   * loops from circular references.
   */
  private notify(record: VariableRecord): void {
    const visited = new Set<string>();
    const queue: string[] = [record.name];
    visited.add(record.name);

    while (queue.length > 0) {
      const currentName = queue.shift()!;
      const current = this.variables.get(currentName);
      if (!current) continue;

      const subs = this.subscribers.get(currentName);
      if (subs) {
        const snapshot = this.toReadonly(current);
        for (const cb of subs) {
          try {
            cb(snapshot);
          } catch {
            // Callback errors must not break notification of other
            // subscribers. Logged elsewhere if needed.
          }
        }
      }

      // Propagate to dependents (those whose value references this var).
      for (const dep of current.dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  private toReadonly(record: VariableRecord): Readonly<CssVariable> {
    return Object.freeze({
      name: record.name,
      value: record.value,
      type: record.type,
      dependents: [...record.dependents],
      dependencies: [...record.dependencies],
      lastUpdated: record.lastUpdated,
    });
  }
}
