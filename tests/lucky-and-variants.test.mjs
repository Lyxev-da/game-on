import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSync } from "esbuild";

const output = buildSync({
  stdin: {
    contents: 'import * as data from "./src/clover/game/data.ts"; import * as charms from "./src/clover/game/charms.ts"; import * as potions from "./src/clover/game/potions.ts"; import * as offline from "./src/clover/game/offline.ts"; export { data, charms, potions, offline };',
    resolveDir: process.cwd(), sourcefile: "lucky-entry.ts", loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
}).outputFiles[0].text;
const { data: d, charms: c, potions: p, offline } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const NOW = 1_700_000_000_000;

const withIngredients = (recipe, rebirths) => {
  const save = { ...d.newSave(), rebirths };
  for (const { key, count } of recipe.ingredients) {
    save.materials[key] = count;
  }
  return save;
};

test("Fields is gone but v12 saves retain their currency, materials, charms, and potions", () => {
  const prior = {
    ...d.newSave(), version: 12, fields: [NOW + 1000], rolls: 79,
    lifetime: { ...d.newSave().lifetime, rolls: 79, manualRolls: 61 },
    found: { common: 22, rare: 2 }, inventory: { common: 7, rare: 1 },
    clovers: 1900, rebirths: 1,
    charms: { owned: ["gem"], equipped: ["gem"] },
    potions: { bottles: { luck: 2 }, active: null, brewed: 2 },
    luckScale: 0.2,
  };
  const migrated = d.sanitizeSave(prior);
  assert.equal(migrated.version, 14);
  assert.equal(Object.hasOwn(migrated, "fields"), false);
  assert.equal(migrated.clovers, prior.clovers);
  assert.deepEqual(migrated.materials, prior.inventory);
  assert.deepEqual(migrated.charms, prior.charms);
  assert.deepEqual(migrated.potions, prior.potions);
  assert.equal(migrated.luckyProgress, 29);
  assert.equal(migrated.luckScale, 0.2);
  assert.equal(d.newSave().luckyProgress, 0);
});

test("a lucky roll happens on the 50th real spin only and resets for the next cycle", () => {
  let save = d.newSave();
  for (let roll = 1; roll < 50; roll++) {
    const { next, result } = d.rollOnce(save, () => roll, NOW);
    assert.equal(result.lucky, false, `spin ${roll}`);
    assert.equal(result.luckyMultiplier, 1);
    save = d.addLifetime(next, result, true);
    assert.equal(save.luckyProgress, roll);
    assert.equal(d.rollsUntilLucky(save), 50 - roll);
  }
  const fiftieth = d.rollOnce(save, () => 50, NOW);
  assert.equal(fiftieth.result.lucky, true);
  assert.equal(fiftieth.result.luckyMultiplier, 2);
  assert.equal(fiftieth.next.luckyProgress, 0);
  assert.equal(fiftieth.next.rolls, 50);
  assert.equal(fiftieth.next.materials[fiftieth.result.material] > 0, true);
  assert.equal(d.rollOnce(fiftieth.next, () => 51, NOW).result.lucky, false);
  save = d.addLifetime(fiftieth.next, fiftieth.result, true);
  for (let roll = 51; roll < 100; roll++) {
    const { next, result } = d.rollOnce(save, () => roll, NOW);
    assert.equal(result.lucky, false, `spin ${roll}`);
    save = d.addLifetime(next, result, true);
  }
  assert.equal(d.rollOnce(save, () => 100, NOW).result.lucky, true);
});

test("manual and auto spins count equally, but offline clovers do not count as spins", () => {
  const near = { ...d.newSave(), auto: true, rolls: 49, luckyProgress: 49, lifetime: { ...d.newSave().lifetime, rolls: 49, manualRolls: 500 } };
  const roll = d.rollOnce(near, () => 50, NOW);
  const saved = d.addLifetime(roll.next, roll.result, false);
  assert.equal(roll.result.lucky, true);
  assert.equal(saved.lifetime.rolls, 50);
  assert.equal(saved.lifetime.manualRolls, 500);
  const away = { ...saved, lastActiveAt: NOW };
  const settled = offline.settleOfflineEarnings(away, NOW + 60000);
  assert.equal(settled.luckyProgress, 0);
  assert.equal(settled.rolls, 50);
  assert.equal(settled.lifetime.rolls, 50);
});

test("the bonus really changes tier drawing, not the permanent luck or currency multiplier", () => {
  const regular = d.newSave();
  const lucky = { ...regular, luckyProgress: 49 };
  const luck = d.getLuck(regular, NOW);
  const probabilityNormal = d.tierProbabilities(luck);
  const probabilityLucky = d.tierProbabilities(luck * 2);
  const random = Math.random;
  let chosen = -1;
  for (let n = 1; n < 5000; n++) {
    const value = n / 5000;
    Math.random = () => value;
    if (d.drawTier(probabilityLucky) > d.drawTier(probabilityNormal)) { chosen = value; break; }
  }
  assert(chosen > 0, "a roll can actually be promoted by the luck bonus");
  try {
    Math.random = () => chosen;
    const base = d.rollOnce(regular, () => 1, NOW);
    const boosted = d.rollOnce(lucky, () => 2, NOW);
    assert.equal(boosted.result.lucky, true);
    assert(boosted.result.tier > base.result.tier);
    assert.equal(boosted.result.luckyMultiplier, 2);
    assert.equal(d.getLuck(boosted.next, NOW), d.getLuck(lucky, NOW) * (boosted.result.isNew ? 1.1 : 1), "lucky luck is not stored as a permanent buff");
    assert.equal(d.valueMult(boosted.next, NOW), d.valueMult(lucky, NOW));
  } finally { Math.random = random; }
});

test("two shop upgrades lower the countdown and raise only the lucky-spin multiplier", () => {
  const fresh = d.newSave();
  const pace = d.UPGRADES.find((u) => u.id === "luckyPace");
  const power = d.UPGRADES.find((u) => u.id === "luckyPower");
  assert(pace && power);
  assert.equal(d.luckyInterval(fresh), 50);
  assert.equal(d.luckyMultiplier(fresh), 2);
  assert.equal(d.luckyInterval({ ...fresh, upgrades: { ...fresh.upgrades, luckyPace: pace.max } }), 20);
  assert.equal(d.luckyMultiplier({ ...fresh, upgrades: { ...fresh.upgrades, luckyPower: power.max } }), 3.5);
  assert.equal(pace.effect(pace.max), "EVERY 20 ROLLS");
  assert.equal(power.effect(power.max), "x3.50 LUCK");
  const waiting = { ...fresh, luckyProgress: 29, upgrades: { ...fresh.upgrades, luckyPace: 4, luckyPower: 2 } };
  assert.equal(d.luckyInterval(waiting), 30);
  assert.equal(d.rollsUntilLucky(waiting), 1);
  const result = d.rollOnce(waiting, () => 1, NOW);
  assert.equal(result.result.lucky, true);
  assert.equal(result.result.luckyMultiplier, 2.5);
  assert.equal(result.next.luckyProgress, 0);
  const tooFar = { ...waiting, luckyProgress: 49 };
  assert.equal(d.rollsUntilLucky(tooFar), 1);
  assert.equal(d.rollOnce(tooFar, () => 1, NOW).result.lucky, true);
  assert(!Object.hasOwn(fresh.upgrades, "multi"));
});

test("rebirth preserves countdown but resets both shop upgrades; load preserves progress", () => {
  const old = d.newSave();
  const save = { ...old, rebirths: 2, luckyProgress: 17, clovers: d.rebirthCost(2), upgrades: { ...old.upgrades, luckyPace: 5, luckyPower: 4 } };
  const reborn = d.doRebirth(save);
  assert.equal(reborn.luckyProgress, 17);
  assert.equal(reborn.upgrades.luckyPace, 0);
  assert.equal(reborn.upgrades.luckyPower, 0);
  assert.equal(d.luckyInterval(reborn), 50);
  const loaded = d.sanitizeSave(JSON.parse(JSON.stringify(save)));
  assert.equal(loaded.luckyProgress, 17);
  assert.equal(loaded.upgrades.luckyPace, 5);
  assert.equal(loaded.upgrades.luckyPower, 4);
  assert.equal(d.sanitizeSave({ ...save, luckyProgress: 1e8 }).luckyProgress, 49);
});

test("new cursed and glitched charms are locked until their rebirths, then craft once", () => {
  assert.equal(c.CHARMS.length, 20);
  for (const [id, needed] of [["thorn", 10], ["static", 15]]) {
    const recipe = c.CHARMS.find((charm) => charm.id === id);
    assert.equal(recipe.unlockAt, needed);
    const early = withIngredients(recipe, needed - 1);
    assert.equal(c.canCraftCharm(early, id), false);
    assert.equal(c.craftCharm(early, id), null);
    const unlocked = { ...early, rebirths: needed };
    const original = { ...unlocked.materials };
    assert(c.canCraftCharm(unlocked, id));
    const crafted = c.craftCharm(unlocked, id);
    assert(crafted.charms.owned.includes(id));
    assert(crafted.charms.equipped.includes(id));
    assert.equal(c.craftCharm(crafted, id), null);
    assert.deepEqual(unlocked.materials, original);
    for (const { key } of recipe.ingredients) assert.equal(crafted.materials[key] ?? 0, 0);
  }
});

test("variant charms boost only their own unlocked variant", () => {
  const base = { ...d.newSave(), rebirths: 15 };
  const thorn = { ...base, charms: { owned: ["thorn"], equipped: ["thorn"] } };
  const staticCharm = { ...base, charms: { owned: ["static"], equipped: ["static"] } };
  assert.equal(d.getCursedChance(thorn, NOW), d.getCursedChance(base, NOW) * 3);
  assert.equal(d.getGlitchedChance(thorn, NOW), d.getGlitchedChance(base, NOW));
  assert.equal(d.getGlitchedChance(staticCharm, NOW), d.getGlitchedChance(base, NOW) * 4);
  assert.equal(d.getCursedChance(staticCharm, NOW), d.getCursedChance(base, NOW));
  assert.equal(d.getCursedChance({ ...thorn, rebirths: 9 }, NOW), 0);
  assert.equal(d.getGlitchedChance({ ...staticCharm, rebirths: 14 }, NOW), 0);
});

test("a lucky spin also applies its temporary luck to unlocked variant odds", () => {
  const base = { ...d.newSave(), rebirths: 15, luckyProgress: 49 };
  const ordinary = d.getVariantChances(base, NOW);
  const lucky = d.getVariantChances(base, NOW, d.luckyMultiplier(base));
  assert(lucky.crystal > ordinary.crystal);
  assert(lucky.cursed > ordinary.cursed);
  assert(lucky.glitched > ordinary.glitched);
  assert(lucky.shiny > ordinary.shiny);
  const stillLocked = d.getVariantChances({ ...base, rebirths: 0 }, NOW, 2);
  assert.equal(stillLocked.crystal + stillLocked.cursed + stillLocked.glitched, 0);
});

test("variant potions are gated, spend copies, expire, and do not unlock variants early", () => {
  assert.equal(p.POTIONS.length, 9);
  for (const [id, needed, kind, factor] of [["curse", 10, "cursed", 3], ["glitch", 15, "glitched", 4]]) {
    const recipe = p.POTIONS.find((potion) => potion.id === id);
    assert.equal(recipe.unlockAt, needed);
    const early = withIngredients(recipe, needed - 1);
    assert(!p.canBrewPotion(early, id));
    assert.equal(p.brewPotion(early, id), null);
    assert.equal(p.drinkPotion({ ...early, potions: { ...early.potions, bottles: { [id]: 1 } } }, id, NOW), null);
    const unlocked = { ...early, rebirths: needed };
    const brewed = p.brewPotion(unlocked, id);
    assert(brewed);
    assert.equal(brewed.potions.bottles[id], 1);
    const drank = p.drinkPotion(brewed, id, NOW);
    assert(drank);
    const plain = { ...drank, potions: { ...drank.potions, active: null } };
    const chance = kind === "cursed" ? d.getCursedChance : d.getGlitchedChance;
    assert.equal(chance(drank, NOW + 1), chance(plain, NOW + 1) * factor);
    assert.equal(chance(drank, NOW + recipe.duration), chance(plain, NOW + recipe.duration));
    assert.equal(chance({ ...drank, rebirths: needed - 1 }, NOW + 1), 0);
    assert.equal(p.activePotion({ ...drank, rebirths: needed - 1 }, NOW + 1), null);
  }
});

test("all boosted variant probabilities still sum to less than one", () => {
  const base = d.newSave();
  const s = { ...base, rebirths: 50, upgrades: { ...base.upgrades, shiny: 25, luck: 60 }, charms: { owned: ["thorn", "static", "star", "twin"], equipped: ["thorn", "static", "star", "twin"] } };
  const odds = d.getVariantChances(s, NOW);
  assert(Object.values(odds).every((n) => n >= 0 && Number.isFinite(n)));
  assert(Object.values(odds).reduce((a, n) => a + n, 0) <= 0.9900000001);
});

test("slider spans 1/1000 to full luck and recommends the true best stop for every rarity", () => {
  assert.equal(d.luckScaleFromSlider(0), 0.001);
  assert.equal(d.luckScaleFromSlider(100), 1);
  assert.equal(d.sliderFromLuckScale(0.001), 0);
  assert.equal(d.sliderFromLuckScale(1), 100);
  for (let i = 0; i <= 100; i++) {
    assert.equal(d.sliderFromLuckScale(d.luckScaleFromSlider(i)), i);
  }
  const fresh = d.newSave();
  const advanced = { ...fresh, rebirths: 12, upgrades: { ...fresh.upgrades, luck: 35 }, charms: { owned: ["gem"], equipped: ["gem"] } };
  for (const save of [fresh, advanced]) {
    for (const rarity of d.RARITIES) {
      const rec = d.recommendLuckForRarity(save, rarity.id, NOW);
      assert(rec.position >= 0 && rec.position <= 100);
      assert.equal(rec.scale, d.luckScaleFromSlider(rec.position));
      const full = d.baseLuck(save, NOW);
      for (let position = 0; position <= 100; position++) {
        const chance = d.rarityProbability(rarity.id, full * d.luckScaleFromSlider(position));
        assert(rec.chance + 1e-14 >= chance, `${rarity.id}: recommendation must maximize actual odds`);
      }
    }
  }
  assert.equal(d.recommendLuckForRarity(fresh, "common", NOW).scale, 0.001);
  assert.equal(d.sanitizeSave({ ...fresh, luckScale: 0.031623 }).luckScale, 0.031623);
  assert.equal(d.sanitizeSave({ ...fresh, luckScale: 0 }).luckScale, 0.001);
});

test("all seven new icons are original valid 16 by 16 game pixels", () => {
  const icons = readFileSync("src/clover/game/icons.ts", "utf8");
  const palette = new Set([...icons.split("const PAL:")[1].split("};")[0].matchAll(/\b([A-Za-z]):/g)].map((match) => match[1]));
  const names = ["charmThorn", "charmStatic", "potionCursed", "potionGlitched", "luckyRoll", "luckyPace", "luckyPower"];
  const extract = (name) => {
    const block = icons.split(`  ${name}: {`)[1]?.split("  },")[0];
    assert(block, `${name} is defined`);
    return [...block.split("rows: [")[1].split("]")[0].matchAll(/"([.a-zA-Z]+)"/g)].map((match) => match[1]);
  };
  const grids = names.map((name) => {
    const rows = extract(name);
    assert.equal(rows.length, 16);
    assert(rows.every((row) => row.length === 16 && [...row].every((pixel) => pixel === "." || palette.has(pixel))));
    return rows.join("");
  });
  assert.equal(new Set(grids).size, names.length);
  const existing = ["gem", "star", "cursed", "glitched", "charmGem", "charmCoin", "potionLuck", "potionShiny", "potionGod"].map((name) => extract(name).join(""));
  for (const grid of grids) assert(!existing.includes(grid), "new sprites are not reused game art");
});