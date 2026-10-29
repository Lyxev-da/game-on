import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const output = buildSync({
  stdin: {
    contents: 'import * as data from "./src/clover/game/data.ts"; export { data };',
    resolveDir: process.cwd(), sourcefile: "variant-luck-entry.ts", loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
}).outputFiles[0].text;
const { data: d } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const NOW = 1_700_000_000_000;
const mk = (luckScale = 1, extra = {}) => ({
  ...d.newSave(), rebirths: 15, luckScale,
  upgrades: { ...d.newSave().upgrades, ...extra },
});

test("luck scales every variant smoothly, including below 1x", () => {
  const low = mk(0.001);
  const mid = mk(0.05);
  const full = mk(1);
  assert(d.variantLuck(low, NOW) < 1, "low luck dial must reduce variants");
  assert(d.variantLuck(low, NOW) >= d.VARIANT_LUCK_MIN);
  assert(d.variantLuck(mid, NOW) > d.variantLuck(low, NOW));
  assert(d.variantLuck(full, NOW) > d.variantLuck(mid, NOW));
  assert(d.variantLuck(full, NOW) <= d.VARIANT_LUCK_CAP);
  for (const [fn, name] of [[d.getShinyChance, "shiny"], [d.getCrystalChance, "crystal"], [d.getCursedChance, "cursed"], [d.getGlitchedChance, "glitched"]]) {
    assert(fn(low, NOW) < fn(mid, NOW), `${name} rises with luck`);
    assert(fn(mid, NOW) < fn(full, NOW), `${name} rises with luck`);
  }
  // Lucky boost lifts every variant, never just tiers.
  const boost = d.luckyMultiplier(full);
  for (const [fn, name] of [[d.getShinyChance, "shiny"], [d.getCrystalChance, "crystal"], [d.getCursedChance, "cursed"], [d.getGlitchedChance, "glitched"]]) {
    assert(fn(full, NOW, boost) > fn(full, NOW, 1), `lucky lifts ${name}`);
  }
});

test("nominal base odds are 50 / 500 / 2000 / 10000", () => {
  assert.equal(d.variantBaseOdds("normal"), 1);
  assert.equal(d.variantBaseOdds("shiny"), 50);
  assert.equal(d.variantBaseOdds("crystal"), 500);
  assert.equal(d.variantBaseOdds("cursed"), 2000);
  assert.equal(d.variantBaseOdds("glitched"), 10000);
});

test("sampleVariant follows the chances rarest-first and stored odds match the roll", () => {
  const save = mk(1);
  const chances = d.getVariantChances(save, NOW);
  const N = 120000;
  const counts = { normal: 0, shiny: 0, crystal: 0, cursed: 0, glitched: 0 };
  for (let i = 0; i < N; i++) counts[d.sampleVariant(chances, Math.random())]++;
  for (const key of ["shiny", "crystal", "cursed", "glitched"]) {
    const expected = chances[key] * N;
    const tolerance = Math.max(expected * 0.25, 30);
    assert(Math.abs(counts[key] - expected) < tolerance, `${key}: got ${counts[key]}, expected ~${Math.round(expected)}`);
  }
  // Rarest-first: a roll inside the glitched band is always glitched.
  assert.equal(d.sampleVariant({ shiny: 0.02, crystal: 0.002, cursed: 0.0005, glitched: 0.0001 }, 0.00005), "glitched");
  assert.equal(d.sampleVariant({ shiny: 0.02, crystal: 0.002, cursed: 0.0005, glitched: 0.0001 }, 0.999), "normal");
  // Every stored result carries its exact combined odds.
  for (let i = 0; i < 25; i++) {
    const { result } = d.rollOnce(save, () => i, NOW);
    const probs = d.tierProbabilities(d.getLuck(save, NOW) * result.luckyMultiplier);
    const ch = d.getVariantChances(save, NOW, result.luckyMultiplier);
    const pv = result.variant === "normal"
      ? 1 - ch.shiny - ch.crystal - ch.cursed - ch.glitched
      : ch[result.variant];
    assert(Math.abs(result.odds - 1 / (probs[result.tier] * pv)) / result.odds < 1e-9);
  }
});

test("expected payout averages the lucky spin instead of ignoring it", () => {
  const save = mk(1);
  const ordinary = d.expectedPayoutForBoost(save, NOW, 1);
  const lucky = d.expectedPayoutForBoost(save, NOW, d.luckyMultiplier(save));
  const interval = d.luckyInterval(save);
  assert(lucky > ordinary, "lucky spin must pay more on average");
  assert.equal(d.expectedPayout(save, NOW), ((interval - 1) * ordinary + lucky) / interval);
});

test("variant caps still hold at maximum stacking", () => {
  const base = mk(1);
  const stacked = {
    ...base, rebirths: 50,
    upgrades: { ...base.upgrades, shiny: 25, crystal: 25, cursed: 25, glitched: 25, luck: 60 },
    charms: { owned: ["star", "rainbow", "drop", "moon", "thorn", "static"], equipped: ["star", "rainbow", "drop", "moon", "thorn"] },
  };
  assert(d.getShinyChance(stacked, NOW) <= 0.5 + 1e-12);
  assert(d.getCrystalChance(stacked, NOW) <= d.MAX_CRYSTAL_CHANCE + 1e-12);
  assert(d.getCursedChance(stacked, NOW) <= d.MAX_CURSED_CHANCE + 1e-12);
  assert(d.getGlitchedChance(stacked, NOW) <= d.MAX_GLITCHED_CHANCE + 1e-12);
  const total = Object.values(d.getVariantChances(stacked, NOW)).reduce((a, b) => a + b, 0);
  assert(total <= 0.9900000001);
});
