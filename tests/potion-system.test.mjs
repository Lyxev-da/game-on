import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSync } from "esbuild";

const source = buildSync({
  stdin: {
    contents: 'import * as data from "./src/clover/game/data.ts"; import * as charms from "./src/clover/game/charms"; import * as potions from "./src/clover/game/potions"; import * as offline from "./src/clover/game/offline"; import * as mats from "./src/clover/game/materials.ts"; export { data, charms, potions, offline, mats };',
    sourcefile: "potion-entry.ts", resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
}).outputFiles[0].text;
const { data, charms, potions: p, offline, mats } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const NOW = 1_000_000;
const r1 = () => ({ ...data.newSave(), rebirths: 1 });
const stocked = (id = "luck") => {
  const save = r1();
  for (const ingredient of p.potionFor(id).ingredients) {
    save.materials[ingredient.key] = ingredient.count;
  }
  return save;
};
const drunk = (id, now = NOW) => p.drinkPotion(p.brewPotion(stocked(id), id), id, now);

// All time-dependent tests use the exact timestamp of the attempted action.
test("nine original bottles have simple names, real ingredients, and five-minute durations", () => {
  const icons = readFileSync("src/clover/game/icons.ts", "utf8");
  const palette = new Set([...icons.split("const PAL:")[1].split("};")[0].matchAll(/\b([A-Za-z]):/g)].map((match) => match[1]));
  assert.equal(p.POTIONS.length, 9);
  assert.equal(p.BREWERY_REBIRTHS, 1);
  assert.equal(new Set(p.POTIONS.map((potion) => potion.id)).size, 9);
  assert.equal(new Set(p.POTIONS.map((potion) => potion.icon)).size, 9);
  for (const recipe of p.POTIONS) {
    assert(recipe.id.length <= 6);
    assert(/^[A-Z ]+ POTION$/.test(recipe.name), recipe.name);
    assert.equal(recipe.duration, p.POTION_DURATION_MS);
    assert(recipe.icon.startsWith("potion"));
    for (const { key, count } of recipe.ingredients) {
      assert(mats.MATERIALS.some((material) => material.id === key));
      assert(Number.isSafeInteger(count) && count > 0);
    }
  }
  for (const name of ["brewery", ...p.POTIONS.map((potion) => potion.icon)]) {
    const block = icons.split(`  ${name}: {`)[1]?.split("  },")[0];
    assert(block, `${name} exists`);
    const rows = [...block.split("rows: [")[1].split("]")[0].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    assert.equal(rows.length, 16, `${name} is 16 pixels tall`);
    assert(rows.every((row) => row.length === 16 && [...row].every((c) => c === "." || palette.has(c))), `${name} is a valid sprite`);
  }
  const original = p.POTIONS.every((recipe) => !["gem", "coin", "star", "crown", "medal", "moneyBag", "charmGem", "charmCoin", "charmStar"].includes(recipe.icon));
  assert(original, "potion assets are their own art");
});

test("Rebirth 1 is required to brew or drink, including when a bottle is already in the bag", () => {
  const fresh = stocked();
  fresh.rebirths = 0;
  assert(!p.breweryUnlocked(fresh));
  assert.equal(p.brewPotion(fresh, "luck"), null);
  assert.equal(p.drinkPotion({ ...fresh, potions: { bottles: { luck: 1 }, active: null, brewed: 1 } }, "luck", NOW), null);
  assert(!p.canBrewPotion(fresh, "luck"));
  assert(p.breweryUnlocked(r1()));
  assert.equal(p.drinkPotion(fresh, "unknown", NOW), null);
  assert.equal(p.brewPotion(fresh, "unknown"), null);
  assert(p.canBrewPotion(r1WithStock(), "luck"));
});

function r1WithStock() { return stocked(); }

test("brewing spends materials once and stores a bottle without starting its timer", () => {
  const save = stocked("luck");
  const before = { ...save.materials };
  const found = { ...save.found };
  const clovers = save.clovers;
  const brewed = p.brewPotion(save, "luck");
  assert(brewed);
  assert.equal(brewed.potions.bottles.luck, 1);
  assert.equal(brewed.potions.brewed, 1);
  assert.equal(brewed.potions.active, null);
  assert.equal(brewed.materials.common ?? 0, before.common - 15);
  assert.equal(brewed.materials.uncommon ?? 0, before.uncommon - 4);
  assert.deepEqual(brewed.found, found);
  assert.equal(brewed.clovers, clovers);
  assert.deepEqual(save.materials, before);
  assert.equal(save.potions.bottles.luck, undefined);
  assert.equal(p.brewPotion(brewed, "luck"), null);
});

test("bottles are consumed exactly once, cannot stack, and never replace an active potion", () => {
  const brewed = p.brewPotion(stocked(), "luck");
  const on = p.drinkPotion(brewed, "luck", NOW);
  assert(on);
  assert.equal(on.potions.bottles.luck, undefined);
  assert.equal(on.potions.active.startedAt, NOW);
  assert.equal(on.potions.active.expiresAt, NOW + p.POTION_DURATION_MS);
  assert.equal(p.drinkPotion(on, "luck", NOW + 1), null);
  const two = { ...on, potions: { ...on.potions, bottles: { luck: 2, gold: 2 } } };
  assert.equal(p.drinkPotion(two, "gold", NOW + 2), null);
  assert.equal(p.drinkPotion(brewed, "gold", NOW), null);
  assert.equal(p.drinkPotion(brewed, "unknown", NOW), null);
});

test("99-bottle cap cannot spend materials or create a hundredth bottle", () => {
  const save = stocked();
  save.potions.bottles.luck = p.MAX_POTION_STOCK;
  assert(!p.canBrewPotion(save, "luck"));
  assert.equal(p.brewPotion(save, "luck"), null);
  assert.equal(save.potions.bottles.luck, p.MAX_POTION_STOCK);
  assert.equal(save.materials.common, 15);
});

test("every named buff changes actual roll calculations and ends at exactly five minutes", () => {
  const active = drunk("luck");
  const normal = { ...active, potions: { ...active.potions, active: null } };
  assert.equal(data.getLuck(active, NOW + 1), data.getLuck(normal, NOW + 1) * 2);
  assert.equal(data.getLuck(active, NOW + p.POTION_DURATION_MS), data.getLuck(normal, NOW + p.POTION_DURATION_MS));
  assert.equal(data.valueMult(drunk("gold"), NOW + 1), data.valueMult(normal, NOW + 1) * 2);
  assert.equal(data.getShinyChance(drunk("shiny"), NOW + 1), data.getShinyChance(normal, NOW + 1) * 3);
  assert.equal(data.critChance(drunk("crit"), NOW + 1), 0.25);
  assert.equal(data.critMultiplier(drunk("crit"), NOW + 1), 20);
  assert.equal(data.autoInterval(drunk("fast"), NOW + 1), data.ROLL_DURATION + 750);
  assert.equal(data.autoInterval(normal, NOW + 1), data.ROLL_DURATION + 1500);
  assert.equal(data.autoInterval(drunk("fast"), NOW + p.POTION_DURATION_MS), data.autoInterval(normal, NOW + p.POTION_DURATION_MS));
  const bagSave = drunk("bag");
  const roll = data.rollOnce(bagSave, () => 1, NOW + 1);
  const key = data.foundKey(roll.result.tier, roll.result.variant);
  assert.equal(roll.next.materials[roll.result.material], (bagSave.materials[roll.result.material] ?? 0) + 3);
  assert.equal(roll.next.found[key], (bagSave.found[key] ?? 0) + 1);
  assert.equal(roll.next.rolls, 1);
});

test("GOD buffs are real, but they cannot exceed the valid variant probability budget", () => {
  const save = drunk("god");
  const upgraded = { ...save, rebirths: 15, upgrades: { ...save.upgrades, shiny: 25, crit: 20 }, charms: { owned: ["star", "coin", "drop"], equipped: ["star", "coin", "drop"] } };
  const plainSave = { ...save, potions: { ...save.potions, active: null } };
  assert.equal(data.getLuck(save, NOW + 1), data.getLuck(plainSave, NOW + 1) * 3);
  assert.equal(data.valueMult(save, NOW + 1), data.valueMult(plainSave, NOW + 1) * 3);
  assert.equal(data.critChance(save, NOW + 1), 0.25);
  assert.equal(data.critMultiplier(save, NOW + 1), 20);
  const rng = data.getVariantChances(upgraded, NOW + 1);
  const sum = rng.shiny + rng.crystal + rng.cursed + rng.glitched;
  assert(sum > 0 && sum <= 0.990000001);
  for (let i = 0; i < data.TIERS.length; i++) {
    const probabilities = data.tierProbabilities(data.getLuck(upgraded, NOW + 1));
    assert(probabilities.every((chance) => Number.isFinite(chance) && chance >= 0));
    assert(Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  }
  assert.equal(data.getCrystalChance(save, NOW + 1), 0, "God potion cannot unlock crystal drops at rebirth 1");
  const crystal = { ...save, rebirths: 5 };
  const ordinary = { ...r1(), rebirths: 5 };
  assert(data.getCrystalChance(crystal, NOW + 1) > data.getCrystalChance(ordinary, NOW + 1) * 2);
});

test("speed potions do not unlock auto, and auto always needs 500 manual rolls", () => {
  const fast = drunk("fast");
  assert.equal(data.autoUnlocked(fast), false);
  assert.equal(data.autoRollsPerSecond(fast, NOW + 1), 0);
  assert.equal(offline.offlineCloversPerSecond({ ...fast, auto: true }, NOW + 1), 0);
  const unlocked = { ...fast, auto: true, lifetime: { ...fast.lifetime, manualRolls: 500 } };
  assert.equal(data.autoUnlocked(unlocked), true);
  assert.equal(data.passiveRollsPerSecond(unlocked, NOW + 1), 1000 / (data.ROLL_DURATION + 750));
  assert.equal(data.manualRollsPerSecond(unlocked), 1000 / data.ROLL_DURATION);
});

test("the timer is real wall-clock time and does not extend on load or drink attempts", () => {
  const save = drunk("luck");
  assert.equal(p.potionTime(p.potionRemaining(save, NOW)), "5:00");
  assert.equal(p.potionTime(p.potionRemaining(save, NOW + 1001)), "4:59");
  assert.equal(p.potionTime(p.potionRemaining(save, NOW + p.POTION_DURATION_MS)), "0:00");
  assert(p.activePotion(save, NOW + 299999));
  assert.equal(p.activePotion(save, NOW + 300000), null);
  assert.equal(p.expirePotion(save, NOW + 299999), save);
  assert.equal(p.expirePotion(save, NOW + 300000).potions.active, null);
  assert.equal(p.drinkPotion(save, "luck", NOW + 300000), null, "cannot drink with an empty bottle");
  const noBuff = p.potionBonuses(save, NOW + 300000);
  assert.equal(noBuff.luck, 1);
  assert.equal(noBuff.value, 1);
  assert.equal(noBuff.crit, 0);
});

test("potions and bottles survive rebirth but not a full reset, and expiry does not wipe a bottle", () => {
  const made = p.brewPotion(stocked(), "luck");
  const withTwo = { ...made, potions: { ...made.potions, bottles: { luck: 2 } } };
  const on = p.drinkPotion(withTwo, "luck", NOW);
  const reborn = data.doRebirth({ ...on, clovers: data.rebirthCost(1) });
  assert.deepEqual(reborn.potions, on.potions);
  assert.equal(reborn.rebirths, 2);
  assert.equal(reborn.potions.active.expiresAt, on.potions.active.expiresAt);
  const cleaned = p.expirePotion(reborn, on.potions.active.expiresAt);
  assert.equal(cleaned.potions.bottles.luck, 1);
  assert.equal(cleaned.potions.active, null);
  assert.deepEqual(data.newSave().potions, p.newPotionState());
});

test("save migration never refills spent ingredients or refills potion stock from discoveries", () => {
  const old = { ...r1(), version: 10, inventory: { common: 2 }, found: { common: 20, rare: 4 }, potions: undefined };
  const migrated = data.sanitizeSave(old);
  assert.equal(migrated.materials.common, 2, "v10 material spending is kept");
  assert.equal(migrated.found.common, 20);
  assert.deepEqual(migrated.potions, p.newPotionState());
  const on = drunk("luck");
  const stored = data.sanitizeSave(JSON.parse(JSON.stringify(on)));
  assert.deepEqual(stored.potions, on.potions);
  assert.equal(data.sanitizeSave({ ...stored, rebirths: 0 }).potions.active, null, "resets cannot keep a bottle buff active");
  assert.equal(data.sanitizeSave({ ...on, potions: { bottles: { luck: 999, gold: -5, unknown: 22 }, active: { id: "fake", startedAt: NOW, expiresAt: NOW + 1000 }, brewed: -2 } }).potions.bottles.luck, 99);
});

test("offline awards are split between boosted and normal time, never a whole-absence free multiplier", () => {
  const start = drunk("gold");
  const prior = NOW;
  const after = NOW + 360000;
  const leaving = { ...start, auto: true, lastActiveAt: prior, lifetime: { ...start.lifetime, manualRolls: 500 }, potions: { ...start.potions, active: { id: "gold", startedAt: prior, expiresAt: prior + p.POTION_DURATION_MS } } };
  const plain = { ...leaving, potions: { ...leaving.potions, active: null } };
  const plainRate = offline.offlineCloversPerSecond(plain, prior);
  const boostRate = offline.offlineCloversPerSecond(leaving, prior);
  const settled = offline.settleOfflineEarnings(leaving, after);
  const expected = Math.floor((boostRate * 300000 + plainRate * 60000) / 1000);
  assert.equal(settled.offlineReward.amount, expected);
  assert.equal(settled.potions.active, null);
  assert.equal(settled.offlineReward.creditedMs, 360000);
  assert(expected < boostRate * 360000 / 1000, "boost does not extend into the ordinary minute");
  assert(settled.offlineReward.amount >= 1);
  const collected = offline.redeemOfflineReward(settled, settled.offlineReward.id, after);
  assert.equal(collected.clovers, leaving.clovers + expected);
  assert.equal(collected.offlineReward, null);
  assert.equal(p.activePotion(collected, after), null);
});

test("short absences and disabled auto do not invent offline potion earnings", () => {
  const save = drunk("gold");
  assert.equal(offline.offlineCloversPerSecond(save, NOW + 1), 0, "potion does not unlock auto");
  const withAuto = { ...save, auto: true, lifetime: { ...save.lifetime, manualRolls: 500 }, lastActiveAt: NOW };
  const before = offline.settleOfflineEarnings(withAuto, NOW + 1000);
  assert.equal(before.offlineReward, null);
  assert.equal(p.potionRemaining(before, NOW + 1000), 299000);
});

test("invalid or expired bottled state stays safe and does not re-enable the brewery", () => {
  const save = data.sanitizeSave({ ...data.newSave(), potions: { bottles: { luck: "100", unknown: 10, crit: -1, gold: Infinity }, active: { id: "god", startedAt: 0, expiresAt: Infinity }, brewed: "99" } });
  assert.deepEqual(save.potions.bottles, {});
  assert.equal(save.potions.active, null);
  assert.equal(save.potions.brewed, 0);
  assert.equal(p.potionBonuses({ ...save, potions: { active: { id: "gold", startedAt: NOW, expiresAt: NOW + 300000 } } }, NOW + 1).value, 1, "rebirth 0 rejects a saved active potion");
});


test("potion crits combine with a charm without losing their five-minute expiry", () => {
  const save = drunk("crit");
  const equipped = { ...save, charms: { owned: ["burst"], equipped: ["burst"] } };
  assert.equal(data.critChance(equipped, NOW + 1), 0.25);
  assert.equal(data.critMultiplier(equipped, NOW + 1), 60);
  assert.equal(data.critMultiplier(equipped, NOW + p.POTION_DURATION_MS), 30);
  assert.equal(data.critChance(equipped, NOW + p.POTION_DURATION_MS), 0);
});

test("50% less auto pause is accurate at upgraded Auto Speed levels", () => {
  const save = drunk("fast");
  const max = { ...save, upgrades: { ...save.upgrades, auto: 12 } };
  const plain = { ...max, potions: { ...max.potions, active: null } };
  const originalPause = data.autoInterval(plain, NOW + 1) - data.ROLL_DURATION;
  const boostedPause = data.autoInterval(max, NOW + 1) - data.ROLL_DURATION;
  assert.equal(Math.round(originalPause * 0.5), boostedPause);
  assert.equal(data.manualRollsPerSecond(max), 1000 / data.ROLL_DURATION);
  assert.equal(data.autoInterval(max, NOW + p.POTION_DURATION_MS), data.autoInterval(plain, NOW + p.POTION_DURATION_MS));
});

test("a long absence credits only the real boosted minutes within the offline cap", () => {
  const start = drunk("god");
  const enabled = { ...start, auto: true, lifetime: { ...start.lifetime, manualRolls: 500 }, lastActiveAt: NOW };
  const plain = { ...enabled, potions: { ...enabled.potions, active: null } };
  const baseRate = offline.offlineCloversPerSecond(plain, NOW);
  const boostedRate = offline.offlineCloversPerSecond(enabled, NOW);
  const hours = 30 * 3600000;
  const settled = offline.settleOfflineEarnings(enabled, NOW + hours);
  const ms = offline.OFFLINE_CAP_MS;
  const amount = Math.floor((boostedRate * p.POTION_DURATION_MS + baseRate * (ms - p.POTION_DURATION_MS)) / 1000);
  assert.equal(settled.offlineReward.creditedMs, ms);
  assert.equal(settled.offlineReward.amount, amount);
  assert(settled.offlineReward.capped);
  assert.equal(settled.potions.active, null);
});


test("weaker potions stay inside every probability cap, even fully stacked", () => {
  const stacked = { ...drunk("god"), rebirths: 15, upgrades: { ...drunk("god").upgrades, shiny: 25, crit: 20 }, charms: { owned: ["star", "coin", "drop", "bolt", "burst"], equipped: ["star", "coin", "drop", "bolt", "burst"] } };
  const chances = data.getVariantChances(stacked, NOW + 1);
  const total = chances.shiny + chances.crystal + chances.cursed + chances.glitched;
  assert(total <= 0.990000001, `variant odds stay normalizable, got ${total}`);
  assert(data.getShinyChance(stacked, NOW + 1) <= 0.5 + 1e-12, "shiny never passes 50%");
  assert(data.critChance(stacked, NOW + 1) <= 0.95 + 1e-12, "crit never passes 95%");
  assert(data.critChance(stacked, NOW + 1) < 1, "crit is no longer guaranteed");
  // Luck and pay are now strong nudges, not multi-thousand-percent spikes.
  const plain = { ...stacked, potions: { ...stacked.potions, active: null } };
  assert.equal(data.getLuck(stacked, NOW + 1) / data.getLuck(plain, NOW + 1), 3);
  assert.equal(data.valueMult(stacked, NOW + 1) / data.valueMult(plain, NOW + 1), 3);
});
