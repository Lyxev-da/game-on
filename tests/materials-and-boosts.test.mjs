import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSync } from "esbuild";

const source = buildSync({
  stdin: {
    contents: 'import * as data from "./src/clover/game/data.ts"; import * as mats from "./src/clover/game/materials.ts"; import * as charms from "./src/clover/game/charms.ts"; import * as potions from "./src/clover/game/potions.ts"; import * as offline from "./src/clover/game/offline.ts"; export { data, mats, charms, potions, offline };',
    sourcefile: "materials-entry.ts", resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
}).outputFiles[0].text;
const { data: d, mats: m, charms: c, potions: p, offline } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const NOW = 1_700_000_000_000;

// Select an outcome from the real RNG bands without mocking any game functions.
function rollCl(data, id, variant = "normal") {
  const index = d.TIERS.findIndex((tier) => tier.id === id);
  assert(index >= 0);
  const boost = data.luckyProgress + 1 >= d.luckyInterval(data) ? d.luckyMultiplier(data) : 1;
  const probabilities = d.tierProbabilities(d.getLuck(data, NOW) * boost);
  const tierSample = probabilities.slice(index + 1).reduce((a, b) => a + b, 0) + probabilities[index] / 2;
  const variants = d.getVariantChances(data, NOW, boost);
  const order = ["glitched", "cursed", "crystal", "shiny"];
  let v = 0;
  if (variant === "normal") v = Object.values(variants).reduce((a, b) => a + b, 0) + 0.001;
  else {
    for (const name of order) {
      if (name === variant) { v += variants[name] / 2; break; }
      v += variants[name];
    }
  }
  const samples = [tierSample, v, 0.999];
  const original = Math.random;
  try {
    Math.random = () => samples.shift() ?? 0.5;
    const roll = d.rollOnce(data, () => 1, NOW);
    assert.equal(roll.result.tier, index);
    assert.equal(roll.result.variant, variant);
    return roll;
  } finally { Math.random = original; }
}

test("there are exactly nine rarity resources and four special-variant resources", () => {
  assert.equal(m.MATERIALS.length, 13);
  assert.equal(new Set(m.MATERIALS.map((material) => material.id)).size, 13);
  for (const rarity of d.RARITIES) assert(m.MATERIALS.some((material) => material.id === rarity.id));
  for (const variant of ["shiny", "crystal", "cursed", "glitched"]) assert(m.MATERIALS.some((material) => material.id === variant));
  for (const tier of d.TIERS) {
    assert.equal(m.materialFromClover(tier, "normal"), tier.rarity);
    for (const variant of ["shiny", "crystal", "cursed", "glitched"]) assert.equal(m.materialFromClover(tier, variant), variant);
  }
});

test("every normal clover of the same rarity pools into the same stack", () => {
  let save = d.newSave();
  const frost = rollCl(save, "rare");
  assert.equal(frost.result.material, "rare");
  const copper = rollCl(frost.next, "copper");
  assert.equal(copper.result.material, "rare");
  assert.equal(copper.next.materials.rare, 2);
  assert.equal(copper.next.found.rare, 1);
  assert.equal(copper.next.found.copper, 1);
  assert.equal(copper.next.rolls, 2);
  assert.equal(Object.hasOwn(copper.next, "inventory"), false);
  assert.equal(save.materials.rare, undefined);
});

test("all 53 clovers and every special variant award exactly one matching material", () => {
  const fresh = { ...d.newSave(), rebirths: 15 };
  for (const tier of d.TIERS) {
    for (const variant of d.VARIANTS) {
      const roll = rollCl(fresh, tier.id, variant);
      const material = m.materialFromClover(tier, variant);
      assert.deepEqual(roll.next.materials, { [material]: 1 });
      assert.equal(roll.result.material, material);
      assert.equal(roll.result.materialAmount, 1);
      assert.equal(roll.next.found[d.foundKey(roll.result.tier, variant)], 1);
      assert.equal(roll.next.clovers, roll.result.value);
    }
  }
});

test("special variants never also pay a normal rarity material", () => {
  const save = { ...d.newSave(), rebirths: 15 };
  for (const variant of ["shiny", "crystal", "cursed", "glitched"]) {
    const normal = rollCl(save, "common", variant);
    const rarest = rollCl(normal.next, "empyrean", variant);
    assert.deepEqual(rarest.next.materials, { [variant]: 2 });
    assert.equal(rarest.next.materials.secret, undefined);
    assert.equal(rarest.next.materials.common, undefined);
  }
});

test("yield charms and potions increase materials without fabricating Index discoveries or rolls", () => {
  const save = { ...d.newSave(), rebirths: 1, charms: { owned: ["pouch", "trio"], equipped: ["pouch", "trio"] },
    potions: { bottles: {}, brewed: 1, active: { id: "bag", startedAt: NOW - 1, expiresAt: NOW - 1 + p.POTION_DURATION_MS } } };
  const roll = rollCl(save, "common");
  assert.equal(roll.result.materialAmount, 7);
  assert.deepEqual(roll.next.materials, { common: 7 });
  assert.equal(roll.next.found.common, 1);
  assert.equal(roll.next.rolls, 1);
  const reloaded = d.sanitizeSave(JSON.parse(JSON.stringify(roll.next)));
  assert.deepEqual(reloaded.materials, roll.next.materials, "extra materials must not be clamped to the discovery count");
});

test("v13 unspent copies migrate once, combine all clovers, and preserve earned progress", () => {
  const prior = {
    ...d.newSave(), version: 13, luckyProgress: 17, rolls: 93, clovers: 9000, totalEarned: 20000, rebirths: 15,
    materials: undefined,
    inventory: { common: 4, starfall: 2, firefly: 3, uncommon: 3, dewdrop: 6, moss: 1, rare: 3, copper: 2,
      "common:shiny": 1, "rare:shiny": 3, "common:crystal": 1, "cosmic:cursed": 2, "empyrean:glitched": 1 },
    found: { common: 40, starfall: 3, firefly: 3, uncommon: 10, dewdrop: 8, moss: 5, rare: 9, copper: 6,
      "common:shiny": 1, "rare:shiny": 3, "common:crystal": 1, "cosmic:cursed": 2, "empyrean:glitched": 1 },
    charms: { owned: ["gem", "thorn"], equipped: ["gem", "thorn"] },
    potions: { bottles: { luck: 2, glitch: 1 }, active: null, brewed: 3 },
  };
  const migrated = d.sanitizeSave(prior);
  assert.equal(migrated.version, 14);
  assert.equal(migrated.luckyProgress, 17, "lucky progression must not restart on this update");
  assert.deepEqual(migrated.materials, { common: 9, uncommon: 10, rare: 5, shiny: 4, crystal: 1, cursed: 2, glitched: 1 });
  for (const key of ["found", "charms", "potions", "clovers", "totalEarned", "rolls"]) assert.deepEqual(migrated[key], prior[key]);
  assert.equal(Object.hasOwn(migrated, "inventory"), false);
  migrated.materials.common = 1;
  migrated.materials.rare = 0;
  const reloaded = d.sanitizeSave(JSON.parse(JSON.stringify(migrated)));
  assert.equal(reloaded.materials.common, 1);
  assert.equal(reloaded.materials.rare, undefined);
  assert.equal(reloaded.found.common, 40, "discoveries never refill spent resources");
});

test("all 29 recipes accept materials only and never require a specific clover", () => {
  for (const recipe of [...c.CHARMS, ...p.POTIONS]) {
    const save = { ...d.newSave(), rebirths: 15 };
    for (const { key, count } of recipe.ingredients) {
      assert(m.MATERIALS.some((material) => material.id === key));
      assert(!key.includes(":"));
      save.materials[key] = count;
    }
    const before = structuredClone(save);
    const charm = c.CHARMS.includes(recipe);
    const crafted = charm ? c.craftCharm(save, recipe.id) : p.brewPotion(save, recipe.id);
    assert(crafted, recipe.name);
    for (const { key } of recipe.ingredients) assert.equal(crafted.materials[key] ?? 0, 0);
    assert.deepEqual(crafted.found, before.found);
    assert.equal(crafted.clovers, before.clovers);
    assert.deepEqual(save, before, "crafting cannot mutate the prior snapshot");
  }
});

test("partial, negative, duplicate, and damaged ingredient stacks cannot mint free materials", () => {
  const save = { ...d.newSave(), materials: { common: 5, rare: 1 } };
  assert.equal(m.spendMaterials(save, [{ key: "common", count: 6 }]), null);
  assert.equal(m.spendMaterials(save, [{ key: "common", count: -1 }]), null);
  assert.equal(m.spendMaterials(save, [{ key: "unknown", count: 1 }]), null);
  assert.equal(m.spendMaterials(save, []), null);
  assert.equal(m.spendMaterials(save, [{ key: "common", count: 4 }, { key: "common", count: 4 }]), null);
  assert.deepEqual(save.materials, { common: 5, rare: 1 });
  assert.deepEqual(m.spendMaterials(save, [{ key: "common", count: 3 }, { key: "rare", count: 1 }]), { common: 2 });
});

test("material inventories survive rebirth and load, but a full reset starts empty", () => {
  const save = { ...d.newSave(), materials: { common: 25, cursed: 3 }, found: { common: 2 }, clovers: d.rebirthCost(0) };
  const reborn = d.doRebirth(save);
  assert.deepEqual(reborn.materials, save.materials);
  assert.deepEqual(d.sanitizeSave(reborn).materials, save.materials);
  assert.deepEqual(d.newSave().materials, {});
  const bad = d.sanitizeSave({ ...d.newSave(), materials: { common: 2.9, rare: -2, shiny: NaN, cursed: Infinity, unknown: 999 } });
  assert.deepEqual(bad.materials, { common: 2 });
});

test("the three boosts unlock at rebirth 5, 10, and 15 and cannot be bought early", () => {
  for (const [id, at] of [["crystal", 5], ["cursed", 10], ["glitched", 15]]) {
    const upgrade = d.UPGRADES.find((u) => u.id === id);
    assert.equal(upgrade.unlockAt, at);
    const early = { ...d.newSave(), clovers: 1e9, rebirths: at - 1 };
    assert.equal(d.upgradeUnlocked(early, id), false);
    assert.equal(d.purchaseUpgrade(early, id), null);
    const unlocked = { ...early, rebirths: at };
    const bought = d.purchaseUpgrade(unlocked, id);
    assert(bought);
    assert.equal(bought.upgrades[id], 1);
    assert.equal(bought.clovers, unlocked.clovers - upgrade.cost(0));
    assert.match(upgrade.effect(1), /%$/);
    assert.deepEqual(bought.materials, unlocked.materials);
  }
});

test("boost upgrades scale odds in percentage steps up to exact maximum caps", () => {
  const base = { ...d.newSave(), rebirths: 15 };
  const caps = { crystal: d.MAX_CRYSTAL_CHANCE, cursed: d.MAX_CURSED_CHANCE, glitched: d.MAX_GLITCHED_CHANCE };
  const chances = { crystal: d.getCrystalChance, cursed: d.getCursedChance, glitched: d.getGlitchedChance };
  for (const id of Object.keys(chances)) {
    const save = { ...base, upgrades: { ...base.upgrades, [id]: 1 } };
    assert(chances[id](save, NOW) > chances[id](base, NOW));
    for (const other of Object.keys(chances).filter((key) => key !== id)) assert.equal(chances[other](save, NOW), chances[other](base, NOW));
    const lockedAt = d.UPGRADES.find((upgrade) => upgrade.id === id).unlockAt;
    assert.equal(chances[id]({ ...save, rebirths: lockedAt - 1 }, NOW), 0);
    
    // Max level (25) caps precisely at 10% (crystal), 7.5% (cursed), and 5% (glitched)
    const maxed = { ...base, upgrades: { ...base.upgrades, [id]: 25 } };
    assert.equal(chances[id](maxed, NOW), caps[id]);
  }
});

test("Buy Max, save clamps, odds caps, and rebirth resets apply to new boosts", () => {
  const save = { ...d.newSave(), clovers: 1e18, rebirths: 50 };
  let maxed = save;
  for (const id of ["crystal", "cursed", "glitched"]) {
    maxed = d.purchaseUpgrade(maxed, id, true);
    assert(maxed);
    assert.equal(maxed.upgrades[id], 25);
    assert.equal(d.purchaseUpgrade(maxed, id), null);
  }
  const odds = d.getVariantChances(maxed, NOW, 3.5);
  assert(Object.values(odds).every((chance) => Number.isFinite(chance) && chance >= 0));
  assert(Object.values(odds).reduce((a, b) => a + b, 0) <= 0.9900000001);
  const loaded = d.sanitizeSave({ ...maxed, upgrades: { ...maxed.upgrades, cursed: 99, crystal: -5 } });
  assert.equal(loaded.upgrades.cursed, 25);
  assert.equal(loaded.upgrades.crystal, 0);
  const reborn = d.doRebirth({ ...maxed, rebirths: 1, clovers: d.rebirthCost(1) });
  assert.equal(reborn.upgrades.crystal + reborn.upgrades.cursed + reborn.upgrades.glitched, 0);
});

test("boost odds stack with charms and potions and expire without losing the shop boost", () => {
  const base = { ...d.newSave(), rebirths: 15 };
  const boosted = { ...base, upgrades: { ...base.upgrades, cursed: 2 }, charms: { owned: ["thorn"], equipped: ["thorn"] },
    potions: { bottles: {}, brewed: 1, active: { id: "curse", startedAt: NOW, expiresAt: NOW + p.POTION_DURATION_MS } } };
  const activeRate = d.getCursedChance(boosted, NOW + 1);
  const expiredRate = d.getCursedChance(boosted, NOW + p.POTION_DURATION_MS);
  assert(activeRate > expiredRate);
  assert(activeRate <= d.MAX_CURSED_CHANCE);
  assert(expiredRate <= d.MAX_CURSED_CHANCE);
  // Potion active provides a 3x multiplier
  assert(Math.abs(activeRate / expiredRate - 3) < 1e-6);
});

test("rarity recommendation uses all clovers in a group rather than only the similarly named clover", () => {
  const save = { ...d.newSave(), rebirths: 10, upgrades: { ...d.newSave().upgrades, luck: 20 } };
  assert.equal(d.RARITIES.length, 9);
  for (const rarity of d.RARITIES) {
    const rec = d.recommendLuckForRarity(save, rarity.id, NOW);
    const perTier = d.tierProbabilities(rec.luck);
    const expected = d.TIERS.reduce((sum, tier, i) => sum + (tier.rarity === rarity.id ? perTier[i] : 0), 0);
    assert.equal(rec.chance, expected);
  }
  const odds = d.tierProbabilities(1);
  assert(d.rarityProbability("common", 1) > odds[d.TIERS.findIndex((tier) => tier.id === "common")]);
});

test("offline currency never creates phantom materials, and lucky rolls still award one drop", () => {
  const save = { ...d.newSave(), auto: true, materials: { uncommon: 4 }, lifetime: { ...d.newSave().lifetime, manualRolls: 500 }, lastActiveAt: NOW, luckyProgress: 49 };
  const away = offline.settleOfflineEarnings(save, NOW + 60000);
  assert.deepEqual(away.materials, save.materials);
  assert.equal(away.luckyProgress, 49);
  const roll = rollCl(save, "rare");
  assert(roll.result.lucky);
  assert.deepEqual(roll.next.materials, { uncommon: 4, rare: 1 });
});

test("every material and new upgrade has a unique original 16 by 16 pixel icon", () => {
  const source = readFileSync("src/clover/game/icons.ts", "utf8");
  const palette = new Set([...source.split("const PAL:")[1].split("};")[0].matchAll(/\b([A-Za-z]):/g)].map((m) => m[1]));
  const names = [...m.MATERIALS.map((material) => material.icon), "boostCrystal", "boostCursed", "boostGlitched"];
  const rowsFor = (name) => {
    const block = source.split(`  ${name}: {`)[1]?.split("  },")[0];
    assert(block, name);
    return [...block.split("rows: [")[1].split("]")[0].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  };
  const grids = names.map((name) => {
    const rows = rowsFor(name);
    assert.equal(rows.length, 16, name);
    assert(rows.every((row) => row.length === 16 && [...row].every((pixel) => pixel === "." || palette.has(pixel))), name);
    return rows.join("");
  });
  assert.equal(new Set(grids).size, 16);
  for (const old of ["gem", "coin", "charmGem", "potionCursed", "luckyRoll"]) assert(!grids.includes(rowsFor(old).join("")), "new resources have bespoke art");
});