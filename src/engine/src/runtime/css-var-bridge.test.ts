// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  TOKEN_ROLES,
  compileBridge,
  compileVarDeclaration,
  isTokenRole,
  normalizeEntry,
  parseColor,
  resolveBridgeColor,
  resolveBridgePalette,
  resolveVariable,
  tokenVar,
  wrapBridgeRule,
} from "./css-var-bridge.mjs";

const flat = (css: string): string => css.replace(/\s+/g, " ").trim();

describe("isTokenRole / TOKEN_ROLES", () => {
  it("recognizes the semantic roles", () => {
    for (const role of ["accent", "bg", "surface", "surface-elevated", "text", "muted", "border"])
      assert.equal(isTokenRole(role), true);
    assert.equal(isTokenRole("nonsense"), false);
    assert.ok(Array.isArray(TOKEN_ROLES));
  });
});

describe("normalizeEntry", () => {
  it("accepts a valid entry and defaults alpha to 1", () => {
    assert.deepEqual(normalizeEntry({ var: "--cb-bg-primary", role: "surface" }), {
      var: "--cb-bg-primary",
      role: "surface",
      alpha: 1,
    });
  });
  it("throws on a non-custom-property var", () => {
    assert.throws(() => normalizeEntry({ var: "color", role: "text" }));
  });
  it("throws on an unknown role", () => {
    assert.throws(() => normalizeEntry({ var: "--x", role: "nope" }));
  });
  it("throws on an out-of-range alpha", () => {
    assert.throws(() => normalizeEntry({ var: "--x", role: "text", alpha: 1.5 }));
    assert.throws(() => normalizeEntry({ var: "--x", role: "text", alpha: 0 }));
  });
});

describe("compileVarDeclaration / compileBridge", () => {
  it("compiles a direct token reference", () => {
    assert.equal(flat(compileVarDeclaration({ var: "--cb-bg-primary", role: "surface" })),
      "--cb-bg-primary: var(--agentskin-surface) !important;");
  });
  it("compiles a color-mix alpha blend", () => {
    assert.equal(flat(compileVarDeclaration({ var: "--cb-text-secondary", role: "text", alpha: 0.7 })),
      "--cb-text-secondary: color-mix(in srgb, var(--agentskin-text) 70%, transparent) !important;");
  });
  it("omits !important when disabled", () => {
    assert.equal(flat(compileVarDeclaration({ var: "--x", role: "accent" }, { important: false })),
      "--x: var(--agentskin-accent);");
  });
  it("compileBridge builds css + index", () => {
    const { css, index } = compileBridge([
      { var: "--cb-bg-primary", role: "surface" },
      { var: "--cb-text-secondary", role: "text", alpha: 0.7 },
    ]);
    assert.match(css, /--cb-bg-primary/);
    assert.match(css, /--cb-text-secondary/);
    assert.ok(index.get("--cb-bg-primary")?.alpha === 1);
    assert.ok(index.get("--cb-text-secondary")?.alpha === 0.7);
    assert.equal(index.size, 2);
  });
  it("wrapBridgeRule scopes declarations under a selector", () => {
    const rule = wrapBridgeRule(`html.agentskin-host-zcode:root`, compileBridge([{ var: "--x", role: "bg" }]).css);
    assert.match(rule, /html\.agentskin-host-zcode:root \{/);
  });
  it("tokenVar returns the agentskin reference", () => {
    assert.equal(tokenVar("accent"), "var(--agentskin-accent)");
  });
});

describe("parseColor", () => {
  it("parses hex shorthand and longhand", () => {
    assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor("#0a0b0c"), { r: 10, g: 11, b: 12, a: 1 });
  });
  it("parses rgb()/rgba()", () => {
    assert.deepEqual(parseColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 });
    assert.equal(parseColor("rgba(10, 20, 30, 0.5)")!.a, 0.5);
  });
  it("ignores non-color values", () => {
    assert.equal(parseColor("var(--agentskin-accent)"), null);
    assert.equal(parseColor("none"), null);
    assert.equal(parseColor(null), null);
  });
});

describe("resolveBridgeColor / resolveBridgePalette / resolveVariable", () => {
  const palette = { surface: "#102030", text: "#e0e8f0" };

  it("returns the exact token for alpha=1 entries", () => {
    assert.equal(resolveBridgeColor({ var: "--cb-bg-primary", role: "surface" }, palette), "#102030");
  });
  it("blends against transparent for alpha<1", () => {
    const out = resolveBridgeColor({ var: "--cb-text-secondary", role: "text", alpha: 0.7 }, palette);
    assert.match(out, /^rgba\(/);
  });
  it("returns null when the token is missing from the palette", () => {
    assert.equal(resolveBridgeColor({ var: "--x", role: "surface-elevated" }, palette), null);
  });
  it("resolveBridgePalette maps every resolvable native var", () => {
    const out: Record<string, string> = resolveBridgePalette(
      [
        { var: "--cb-bg-primary", role: "surface" },
        { var: "--cb-text-secondary", role: "text", alpha: 0.7 },
        { var: "--cb-missing", role: "surface-elevated" },
      ],
      palette,
    );
    assert.equal(out["--cb-bg-primary"], "#102030");
    assert.match(out["--cb-text-secondary"], /^rgba\(/);
    assert.ok(!("--cb-missing" in out), "unresolvable entries are skipped by default");
  });
  it("resolveVariable resolves a native var through the bridged index", () => {
    const { index } = compileBridge([{ var: "--cb-bg-primary", role: "surface" }]);
    assert.equal(resolveVariable("--cb-bg-primary", index, palette), "#102030");
    assert.equal(resolveVariable("--other", index, palette), null);
    assert.equal(resolveVariable("--cb-bg-primary", null, palette), null);
  });
});