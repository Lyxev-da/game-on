import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("rarity selector, material inventory, unlocked boosts and full-color locked art render correctly", async () => {
  const previousDocument = globalThis.document;
  const previousPath = globalThis.Path2D;
  globalThis.Path2D = class { rect() {} };
  globalThis.document = { createElement() {
    const paints = [];
    const canvas = { width: 20, height: 20, toDataURL: () => `data:image/png;base64,${createHash("sha256").update(JSON.stringify(paints)).digest("base64")}` };
    canvas.getContext = () => ({ canvas,
      set fillStyle(value) { paints.push(value); },
      fillRect() {}, fill() {}, setTransform() {}, drawImage() {}, clearRect() {}, save() {}, restore() {},
      getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; },
    });
    return canvas;
  } };
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
  try {
    const [ui, { CharmForge }, d, m, c, p, icons] = await Promise.all([
      server.ssrLoadModule("/src/clover/components/panels.tsx"),
      server.ssrLoadModule("/src/clover/components/CharmForge.tsx"),
      server.ssrLoadModule("/src/clover/game/data.ts"),
      server.ssrLoadModule("/src/clover/game/materials.ts"),
      server.ssrLoadModule("/src/clover/game/charms.ts"),
      server.ssrLoadModule("/src/clover/game/potions.ts"),
      server.ssrLoadModule("/src/clover/game/icons.ts"),
    ]);
    const fresh = d.newSave();
    const settings = renderToStaticMarkup(React.createElement(ui.SettingsModal, {
      save: fresh, onToggleSound() {}, onTogglePerformance() {}, onLuckScale() {}, onReset() {}, onClose() {},
    }));
    assert(settings.includes('type="range"'));
    assert(settings.includes("FIND A RARITY"));
    assert.equal((settings.match(/<option\b/g) ?? []).length, 9);
    for (const rarity of d.RARITIES) assert(new RegExp(`<option value="${rarity.id}"[^>]*>${rarity.label}</option>`).test(settings));
    assert(!settings.includes("<optgroup"), "no individual clover groups in the selector");
    assert(!settings.includes("Frost Clover"));

    const bag = renderToStaticMarkup(React.createElement(ui.IndexModal, { save: fresh, onClose() {} }));
    assert(bag.includes("CRAFTING MATERIALS"));
    assert(bag.includes("RARITY MATERIALS") && bag.includes("VARIANT MATERIALS"));
    for (const material of m.MATERIALS) {
      assert(bag.includes(material.name));
      assert(bag.includes(icons.getPixelIconUrl(material.icon, false)), `${material.name} art remains colorful even with zero stock`);
    }

    const props = { save: fresh, storageEnabled: true, saveError: false, onCraft() {}, onToggle() {}, onBrew() {}, onDrink() {}, onClose() {} };
    const forge = renderToStaticMarkup(React.createElement(CharmForge, props));
    for (const recipe of c.CHARMS) {
      assert(forge.includes(recipe.name));
      assert(forge.includes(icons.getPixelIconUrl(recipe.icon, false)), `${recipe.name} is full-color while locked`);
    }
    assert(forge.includes("CURSED ESSENCE"));
    assert(forge.includes("GLITCH CHIP"));
    assert(!forge.includes("Frost Clover") && !forge.includes("Copper Clover"), "craft costs never require exact clovers");

    const brewery = renderToStaticMarkup(React.createElement(CharmForge, { ...props, initialView: "brewery" }));
    assert(brewery.includes("BREWERY LOCKED"));
    for (const recipe of p.POTIONS) assert(brewery.includes(icons.getPixelIconUrl(recipe.icon, false)), `${recipe.name} is still full-color before Rebirth 1`);

    const lockedShop = renderToStaticMarkup(React.createElement(ui.ShopModal, { save: fresh, onBuy() {}, onBuyMax() {}, onClose() {} }));
    for (const [type, at] of [["CRYSTAL", 5], ["CURSED", 10], ["GLITCHED", 15]]) {
      assert(lockedShop.includes(`${type} BOOST`));
      assert(lockedShop.includes(`UNLOCKS AT REBIRTH ${at}`));
    }
    const unlockedShop = renderToStaticMarkup(React.createElement(ui.ShopModal, { save: { ...fresh, rebirths: 15 }, onBuy() {}, onBuyMax() {}, onClose() {} }));
    assert(unlockedShop.includes("DROP CHANCE"));
    for (const [type] of [["CRYSTAL", 5], ["CURSED", 10], ["GLITCHED", 15]]) {
      assert.match(unlockedShop, new RegExp(`Discover (?:gleaming|shadowy|fractured), \\d+x-value variants`));
    }
    for (const name of ["boostCrystal", "boostCursed", "boostGlitched"]) assert(lockedShop.includes(icons.getPixelIconUrl(name, false)));
  } finally {
    await server.close();
    globalThis.document = previousDocument;
    globalThis.Path2D = previousPath;
  }
});