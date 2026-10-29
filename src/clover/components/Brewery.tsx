import { useState, type CSSProperties } from "react";
import { fmt, type Save } from "../game/data";
import {
  BREWERY_REBIRTHS, MAX_POTION_STOCK, POTIONS, activePotion, breweryUnlocked,
  canBrewPotion, potionFor, potionRemaining, potionTime, type PotionId,
} from "../game/potions";
import { Block, BlockButton, PixelIcon, PxBar } from "./ui";
import { MaterialIngredients } from "./MaterialIngredients";

export function Brewery({ save, now, onBrew, onDrink }: {
  save: Save;
  now: number;
  onBrew: (id: PotionId) => boolean;
  onDrink: (id: PotionId) => boolean;
}) {
  const [message, setMessage] = useState("");
  const unlocked = breweryUnlocked(save);
  const active = activePotion(save, now);
  const current = active && potionFor(active.id);
  const remaining = potionRemaining(save, now);
  const total = Object.values(save.potions.bottles).reduce((sum, count) => sum + (count ?? 0), 0);

  const brew = (id: PotionId) => {
    const recipe = potionFor(id)!;
    if (onBrew(id)) setMessage(`${recipe.name} BREWED. BOTTLE SAVED.`);
  };

  const drink = (id: PotionId) => {
    const recipe = potionFor(id)!;
    if (onDrink(id)) setMessage(`${recipe.name} ON. ${potionTime(recipe.duration)} OF BUFFS.`);
  };

  return (
    <div id="forge-brewery" className="br-view" role="tabpanel" aria-labelledby="forge-brewery-tab" aria-label="Brewery">
      <div className="fg-top">
        <Block tone="dark" className="fg-count" faceClassName="fg-count-face">
          <PixelIcon name="brewery" className="fg-count-icon" />
          <span className="fg-count-copy">
            <span className="tx-stroke fg-count-value">{fmt(total)}</span>
            <span className="tx-label">BOTTLES IN BAG</span>
          </span>
        </Block>
        <Block className="fg-worn" faceClassName="fg-worn-face">
          <span className="tx-label">{unlocked ? "ONE POTION AT A TIME / FIVE MINUTES EACH" : `UNLOCKS AT REBIRTH ${BREWERY_REBIRTHS}`}</span>
          <span className="tx-label fg-note" role="status" aria-live="polite">{message || (unlocked ? "BREW NOW. DRINK WHEN YOU WANT." : "REBIRTH ONCE TO OPEN THE BREWERY.")}</span>
          <span className="tx-label">{save.potions.brewed} BREWED / {POTIONS.length} RECIPES</span>
          <PxBar value={unlocked ? 1 : save.rebirths / BREWERY_REBIRTHS} className="fg-bar" />
        </Block>
      </div>

      {!unlocked ? (
        <Block tone="dark" className="fg-charm br-locked" faceClassName="rb-crystal-face">
          <div className="rb-crystal-art"><PixelIcon name="lock" className="rb-crystal-clover" /></div>
          <div className="rb-crystal-copy">
            <span className="tx-stroke rb-crystal-title">BREWERY LOCKED</span>
            <span className="tx-label">REBIRTH ONCE TO BREW POWERFUL POTIONS.</span>
            <span className="tx-label rb-crystal-state">{BREWERY_REBIRTHS - save.rebirths} REBIRTH TO GO / CRAFTS STAY LOCKED UNTIL THEN</span>
          </div>
        </Block>
      ) : (
        <Block tone={current ? "tint" : "dark"} style={current ? { "--h": current.hue } as CSSProperties : undefined} className="fg-charm br-active" faceClassName="rb-crystal-face">
          <div className="rb-crystal-art">
            <PixelIcon name={current?.icon ?? "brewery"} className="rb-crystal-clover" />
          </div>
          <div className="rb-crystal-copy">
            <span className="tx-stroke rb-crystal-title">{current ? current.name : "NO POTION ON"}</span>
            <span className="tx-stroke br-power">{current ? current.power : "BREW. DRINK. GET STRONG."}</span>
            <span className="tx-label">{current ? "POTIONS WORK ON ROLLS AND OFFLINE AUTO. TIMER DOES NOT PAUSE." : "POTIONS WAIT IN YOUR BAG UNTIL YOU DRINK THEM. NOTHING IS USED AUTOMATICALLY."}</span>
            {current ? (
              <>
                <span className="tx-stroke br-time" role="timer" aria-label={`${potionTime(remaining)} remaining`}>{potionTime(remaining)} LEFT</span>
                <PxBar value={remaining / current.duration} className="rb-bar" />
              </>
            ) : <span className="tx-label br-note">BREWING DOES NOT DRINK A BOTTLE OR START THE TIMER.</span>}
          </div>
        </Block>
      )}

      <div className="fg-list br-recipes">
        {POTIONS.map((recipe) => {
          const count = save.potions.bottles[recipe.id] ?? 0;
          const recipeLocked = save.rebirths < recipe.unlockAt;
          const drinking = active?.id === recipe.id;
          const ready = canBrewPotion(save, recipe.id);
          const canDrink = unlocked && !active && count > 0;
          const full = count >= MAX_POTION_STOCK;
          return (
            <Block key={recipe.id} tone={drinking ? "tint" : "metal"}
              className={`fg-charm br-potion${drinking ? " is-worn" : ""}${recipe.id === "curse" ? " fg-cursed" : recipe.id === "glitch" ? " fg-glitched" : ""}`} faceClassName="fg-charm-face" style={{ "--h": recipe.hue } as CSSProperties}>
              <div className="fg-art"><PixelIcon name={recipe.icon} className="fg-art-icon" /></div>
              <div className="fg-copy">
                <span className="tx-stroke fg-name">{recipe.name}</span>
                <span className="tx-stroke fg-power">{recipe.power}</span>
                <span className="tx-label fg-desc">{recipeLocked ? `UNLOCKS AT REBIRTH ${recipe.unlockAt} / ${recipe.unlockAt - save.rebirths} TO GO` : recipe.description}</span>
                <span className="tx-label fg-desc">{potionTime(recipe.duration)} / {count} IN BAG{drinking ? " / DRINKING" : ""}</span>
                {(recipe.id === "fast" || recipe.id === "god") && <span className="tx-label fg-desc">AUTO NEEDS 500 MANUAL ROLLS.</span>}
                {recipe.id === "god" && <span className="tx-label fg-desc">CRYSTAL DROPS NEED REBIRTH 5.</span>}
                <MaterialIngredients save={save} ingredients={recipe.ingredients} label={`${recipe.name} materials`} />
              </div>
              <div className="br-controls">
                <BlockButton tone={ready ? "gold" : "metal"} className="fg-btn" faceClassName="fg-btn-face" disabled={!ready} onClick={() => brew(recipe.id)}
                  title={recipeLocked ? `Unlocks at rebirth ${recipe.unlockAt}` : full ? "Bag holds 99 of each potion" : undefined}
                  aria-label={recipeLocked ? `${recipe.name}, unlocks at rebirth ${recipe.unlockAt}` : `Brew ${recipe.name}`}>
                  <span className="tx-stroke">{recipeLocked ? "LOCKED" : full ? "BAG FULL" : "BREW"}</span>
                </BlockButton>
                <BlockButton tone={drinking ? "tint" : "green"} disabled={!canDrink || recipeLocked} className="fg-btn" faceClassName="fg-btn-face" onClick={() => drink(recipe.id)}
                  title={recipeLocked ? `Unlocks at rebirth ${recipe.unlockAt}` : active ? "One potion at a time. Wait for this one to end." : !count ? "Brew one first" : undefined}
                  aria-label={`Drink ${recipe.name}`}>
                  <span className="tx-stroke">{drinking ? "DRINKING" : "DRINK"}</span>
                </BlockButton>
              </div>
            </Block>
          );
        })}
      </div>
    </div>
  );
}
