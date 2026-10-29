import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const source = buildSync({
  stdin: {
    contents: 'import * as data from "./src/clover/game/data.ts"; import * as charms from "./src/clover/game/charms.ts"; import * as offline from "./src/clover/game/offline.ts"; import * as mats from "./src/clover/game/materials.ts"; export { data, charms, offline, mats };',
    sourcefile: "test-entry.ts",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
}).outputFiles[0].text;

const { data, charms, offline, mats } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const withStock = () => {
  const save = data.newSave();
  for (const charm of charms.CHARMS) {
    for (const { key, count } of charm.ingredients) {
      save.materials[key] = (save.materials[key] ?? 0) + count;
    }
  }
  return save;
};

test("twenty recipes use pooled materials and all custom charm sprites are valid", () => {
  const icons = readFileSync("src/clover/game/icons.ts", "utf8");
  const palette = new Set([...icons.split("const PAL:")[1].split("};")[0].matchAll(/\b([A-Za-z]):/g)].map((match) => match[1]));
  assert.equal(charms.CHARMS.length, 20);
  assert.equal(new Set(charms.CHARMS.map((charm) => charm.id)).size, charms.CHARMS.length);
  for (const charm of charms.CHARMS) {
    for (const { key, count } of charm.ingredients) {
      assert(mats.MATERIALS.some((material) => material.id === key), `${key} is a real material`);
      assert(Number.isSafeInteger(count) && count > 0);
    }
    // Every charm must use its own bespoke sprite, never an icon borrowed from elsewhere in the game.
    assert(charm.icon.startsWith("charm"), `${charm.id} uses a dedicated charm sprite`);
  }
  const icon = (charm) => charm.icon;
  assert.equal(new Set(charms.CHARMS.map(icon)).size, charms.CHARMS.length, "no two charms share art");

  for (const name of ["forge", ...charms.CHARMS.map(icon)]) {
    const block = icons.split(`  ${name}: {`)[1]?.split("  },")[0];
    assert(block, `${name} exists`);
    const rows = [...block.split("rows: [")[1].split("]")[0].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    assert.equal(rows.length, 16, `${name} has 16 rows`);
    assert(rows.every((row) => row.length === 16), `${name} rows are 16 wide`);
    assert(rows.every((row) => [...row].every((pixel) => pixel === "." || palette.has(pixel))), `${name} uses palette colours`);
    assert(rows.some((row) => row.trim().replace(/\./g, "") !== ""), `${name} is not blank`);
  }

  // Charm sprites must not duplicate the pixel grid of any pre-existing game icon.
  const gridOf = (name) => icons.split(`  ${name}: {`)[1].split("rows: [")[1].split("]")[0].replace(/\s|"/g, "");
  const reused = ["gem", "dice", "coin", "star", "crown", "medal", "moneyBag", "crystals", "sparkles", "eye", "map", "dial", "chest", "cursed", "glitched", "shine", "quest"];
  const existing = new Set(reused.filter((name) => icons.includes(`  ${name}: {`)).map(gridOf));
  for (const charm of charms.CHARMS) assert(!existing.has(gridOf(charm.icon)), `${charm.icon} is original art`);
});

test("each real roll adds one crafting material independently of discoveries", () => {
  const save = data.newSave();
  const { next, result } = data.rollOnce(save, () => 1);
  const key = data.foundKey(result.tier, result.variant);
  assert.equal(next.rolls, 1);
  assert.equal(next.found[key], 1);
  assert.equal(next.materials[result.material], 1);
  assert.equal(next.clovers, result.value);
  assert.equal(save.found[key], undefined);
  assert.equal(save.materials[result.material], undefined);
  assert.equal(charms.canCraftCharm(next, "gem"), false);
});

test("forging spends only materials, never discoveries or currency", () => {
  const stock = withStock();
  const beforeFound = { ...stock.found };
  const beforeClovers = stock.clovers;
  assert.equal(charms.canCraftCharm(stock, "gem"), true);
  const forged = charms.craftCharm(stock, "gem");
  assert(forged);
  assert.equal(forged.materials.common ?? 0, stock.materials.common - 12);
  assert.equal(forged.materials.uncommon ?? 0, stock.materials.uncommon - 3);
  assert.deepEqual(forged.found, beforeFound);
  assert.equal(forged.clovers, beforeClovers);
  assert.deepEqual(forged.charms, { owned: ["gem"], equipped: ["gem"] });
  assert.equal(charms.craftCharm(forged, "gem"), null);
  assert.equal(stock.charms.owned.length, 0);
});

test("three equipped slots, unequipping and equipping preserve ownership", () => {
  let save = withStock();
  for (const charm of charms.CHARMS.slice(0, 4)) {
    save = charms.craftCharm(save, charm.id);
    assert(save);
  }
  assert.equal(save.charms.owned.length, 4);
  assert.equal(save.charms.equipped.length, 3);
  assert.equal(charms.toggleCharm(save, "bolt"), null);
  const unequipped = charms.toggleCharm(save, "gem");
  assert(unequipped);
  assert.equal(unequipped.charms.equipped.length, 2);
  assert.equal(unequipped.charms.owned.length, 4);
  const equipped = charms.toggleCharm(unequipped, "bolt");
  assert(equipped);
  assert(equipped.charms.equipped.includes("bolt"));
  assert.equal(charms.toggleCharm(equipped, "unknown"), null);
  assert.equal(charms.charmBonuses(equipped).luck, 1);
});

test("core charms change live rolls and offline calculations only while equipped", () => {
  const base = data.newSave();
  const active = (id) => ({ ...base, charms: { owned: [id], equipped: [id] } });
  assert.equal(data.getLuck(active("gem")), data.getLuck(base) * 1.35);
  assert.equal(data.valueMult(active("coin")), data.valueMult(base) * 1.5);
  assert.equal(data.getShinyChance(active("star")), data.getShinyChance(base) * 2);
  assert.equal(data.critChance(active("bolt")), data.critChance(base) + 0.08);
  const maxCrit = { ...base, upgrades: { ...base.upgrades, crit: 20 } };
  assert(Math.abs(data.critChance({ ...maxCrit, charms: { owned: ["bolt"], equipped: ["bolt"] } }) - 0.68) < 1e-12);
  assert.equal(data.autoInterval(active("gear")), data.ROLL_DURATION + 825);
  assert.equal(data.autoInterval(base), data.ROLL_DURATION + 1500);
  const reborn = { ...base, rebirths: data.CRYSTAL_REBIRTHS };
  const crystal = { ...reborn, charms: { owned: ["drop"], equipped: ["drop"] } };
  assert(data.getCrystalChance(reborn) > 0);
  assert.equal(data.getCrystalChance(crystal), data.getCrystalChance(reborn) * 2.5);
  assert.equal(data.getCrystalChance(active("drop")), 0);
  assert(data.expectedPayout(active("coin")) > data.expectedPayout(base));
  const unlocked = { ...base, auto: true, lifetime: { ...base.lifetime, manualRolls: 500 } };
  assert(offline.offlineCloversPerSecond(unlocked) > 0);
  const boosted = { ...unlocked, charms: { owned: ["coin"], equipped: ["coin"] } };
  assert(offline.offlineCloversPerSecond(boosted) > offline.offlineCloversPerSecond(unlocked));
  assert.equal(offline.offlineCloversPerSecond({ ...unlocked, auto: false }), 0);
  assert.equal(offline.offlineCloversPerSecond({ ...base, auto: true }), 0);
});

test("feature charms add bag copies, craft refunds, crit power, and real extra slots", () => {
  const base = data.newSave();
  const harvest = { ...base, charms: { owned: ["pouch"], equipped: ["pouch"] } };
  const duplicator = { ...base, charms: { owned: ["trio"], equipped: ["trio"] } };
  const random = Math.random;
  try {
    Math.random = () => 0.001;
    const normal = data.rollOnce(base, () => 1);
    const extra = data.rollOnce(harvest, () => 2);
    const huge = data.rollOnce(duplicator, () => 3);
    const normalKey = normal.result.material;
    assert.equal(extra.next.materials[normalKey], normal.next.materials[normalKey] + 1);
    assert.equal(huge.next.materials[normalKey], normal.next.materials[normalKey] + 3);

    const voidSave = { ...base, upgrades: { ...base.upgrades, crit: 1 }, charms: { owned: ["burst"], equipped: ["burst"] } };
    const voidRoll = data.rollOnce(voidSave, () => 4).result;
    assert.equal(voidRoll.critMultiplier, 30);

    const refund = { ...base, materials: { common: 12, uncommon: 3 }, charms: { owned: ["spool"], equipped: ["spool"] } };
    const crafted = charms.craftCharm(refund, "gem");
    assert(crafted);
    assert.deepEqual(crafted.materials, refund.materials);
  } finally {
    Math.random = random;
  }

  // The Twin Ring grants two slots while occupying one, so wearing it is a real net gain of one charm.
  const plain = { ...base, charms: { owned: ["gem", "coin", "bolt", "star"], equipped: ["gem", "coin", "bolt"] } };
  assert.equal(charms.charmSlotLimit(plain), charms.BASE_CHARM_SLOTS);
  assert.equal(charms.toggleCharm(plain, "star"), null);

  const withTwin = { ...base, charms: { owned: ["gem", "coin", "bolt", "star", "twin"], equipped: ["gem", "coin", "twin"] } };
  assert.equal(charms.charmSlotLimit(withTwin), charms.BASE_CHARM_SLOTS + 2);
  const fourth = charms.toggleCharm(withTwin, "bolt");
  assert.equal(fourth.charms.equipped.length, 4);
  const fifth = charms.toggleCharm(fourth, "star");
  assert.equal(fifth.charms.equipped.length, 5);
  // Four of those five are ordinary charms, one more than the base three.
  assert.equal(fifth.charms.equipped.filter((id) => id !== "twin").length, charms.BASE_CHARM_SLOTS + 1);
  assert.equal(charms.toggleCharm(fifth, "drop"), null);

  // Removing the Twin Ring shrinks the loadout back down instead of leaving ghost charms equipped.
  const shrunk = charms.toggleCharm(fifth, "twin");
  assert.equal(shrunk.charms.equipped.length, charms.BASE_CHARM_SLOTS);
  assert(!shrunk.charms.equipped.includes("twin"));
  assert.equal(shrunk.charms.owned.length, 5);

  const autoSlot = withStock();
  autoSlot.charms = { owned: ["gem", "coin", "bolt"], equipped: ["gem", "coin", "bolt"] };
  const autoTwin = charms.craftCharm(autoSlot, "twin");
  assert(autoTwin?.charms.equipped.includes("twin"));
  assert.equal(autoTwin.charms.equipped.length, 4);
  assert.equal(data.valueMult({ ...base, charms: { owned: ["sun"], equipped: ["sun"] } }), data.valueMult(base) * 5);
});

test("value charms change the payout of an actual roll with the same RNG", () => {
  const plain = data.newSave();
  const boosted = { ...plain, charms: { owned: ["coin"], equipped: ["coin"] } };
  const random = Math.random;
  try {
    Math.random = () => 0.001;
    const first = data.rollOnce(plain, () => 1).result;
    const second = data.rollOnce(boosted, () => 2).result;
    assert.equal(first.tier, second.tier);
    assert.equal(first.variant, second.variant);
    assert(second.value > first.value);
  } finally {
    Math.random = random;
  }
});

test("old saves receive copies once, and a save/load does not refill spent materials", () => {
  const legacy = { ...data.newSave(), version: 9, found: { common: 18, uncommon: 5 }, materials: undefined, charms: undefined };
  const migrated = data.sanitizeSave(legacy);
  assert.equal(migrated.materials.common, 18);
  assert.equal(migrated.materials.uncommon, 5);
  const forged = charms.craftCharm(migrated, "gem");
  assert(forged);
  const reloaded = data.sanitizeSave(JSON.parse(JSON.stringify(forged)));
  assert.equal(reloaded.materials.common, 6);
  assert.equal(reloaded.materials.uncommon, 2);
  assert.equal(reloaded.found.common, 18);
  assert.deepEqual(reloaded.charms, { owned: ["gem"], equipped: ["gem"] });
  assert.equal(charms.craftCharm(reloaded, "gem"), null);
});

test("crafted charms and spent materials survive an actual localStorage round trip", () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    const forged = charms.craftCharm(withStock(), "gem");
    assert(forged);
    assert.equal(data.storeSave(forged), true);
    const loaded = data.loadSave();
    assert.deepEqual(loaded.charms, forged.charms);
    assert.deepEqual(loaded.materials, forged.materials);
    assert.deepEqual(loaded.found, forged.found);
  } finally {
    globalThis.localStorage = previous;
  }
});

test("rebirth keeps bag and charms; reset clears them; corrupted charm data is filtered", () => {
  const forged = charms.craftCharm(withStock(), "gem");
  assert(forged);
  const reborn = data.doRebirth({ ...forged, clovers: data.rebirthCost(0) });
  assert.deepEqual(reborn.materials, forged.materials);
  assert.deepEqual(reborn.charms, forged.charms);
  assert.equal(reborn.clovers, 0);
  assert.equal(reborn.upgrades.luck, 0);
  assert.deepEqual(data.newSave().charms, { owned: [], equipped: [] });
  assert.deepEqual(data.newSave().materials, {});
  const cleaned = data.sanitizeSave({
    ...data.newSave(), found: { common: 3 }, materials: { common: 999, rare: -80, unknown: 30 },
    charms: { owned: ["gem", "gem", "made-up"], equipped: ["made-up", "gem", "gem", "coin"] },
  });
  assert.deepEqual(cleaned.materials, { common: 999 });
  assert.deepEqual(cleaned.charms, { owned: ["gem"], equipped: ["gem"] });
  assert.equal(charms.charmBonuses({ ...data.newSave(), charms: { owned: [], equipped: ["gem"] } }).luck, 1);
});