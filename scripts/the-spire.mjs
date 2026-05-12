// The Spire — Entry Point
// Custom level scaling and dice mechanics for D&D 5e

import { initSpireLevels, renderSpireLevelTab } from "./spire-levels.mjs";
import {
  initWeaponGroups,
  renderWeaponGroupsSection,
  handlePreAttack,
  handlePreDamage,
  handleDamageRoll,
  handleItemUse,
} from "./weapon-groups.mjs";
import { initNetAdvantage, initD20RollOverride } from "./net-advantage.mjs";
import { renderPotionsTab, handleCombatTurn } from "./potions.mjs";

Hooks.once("init", () => {
  console.log("The Spire | Initializing");
  initSpireLevels();
  initWeaponGroups();
  initNetAdvantage();
  initD20RollOverride();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error("The Spire requires the D&D 5e system.");
    return;
  }
  console.log("The Spire | Ready");
});

// Character sheet tabs
Hooks.on("renderActorSheet5eCharacter", (app, html, data) => {
  renderSpireLevelTab(app, html);
  renderWeaponGroupsSection(app, html);
  renderPotionsTab(app, html);
});

// Weapon group roll hooks
Hooks.on("dnd5e.preRollAttack", handlePreAttack);
Hooks.on("dnd5e.preRollDamage", handlePreDamage);
Hooks.on("dnd5e.rollDamage", handleDamageRoll);
Hooks.on("dnd5e.useItem", handleItemUse);

// Combat hooks (potion cooldown)
Hooks.on("combatTurn", handleCombatTurn);
Hooks.on("combatRound", handleCombatTurn);
