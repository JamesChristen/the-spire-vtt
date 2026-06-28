// The Spire — Entry Point
// Custom level scaling and dice mechanics for D&D 5e
// Requires Foundry v14+ and dnd5e 5.x+

import { initSpireLevels, renderSpireLevelTab, handleRestCompleted } from "./spire-levels.mjs";
import {
  initWeaponGroups,
  renderWeaponGroupsSection,
  handlePreAttack,
  handlePreDamage,
  handleDamageRoll,
  handleActivityUse,
} from "./weapon-groups.mjs";
import { initNetAdvantage } from "./net-advantage.mjs";
import { renderPotionsTab, handleCombatTurn } from "./potions.mjs";

const MODULE_ID = "the-spire";

Hooks.once("init", () => {
  console.log("The Spire | Initializing");
  initSpireLevels();
  initWeaponGroups();
  initNetAdvantage();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error("The Spire requires the D&D 5e system.");
    return;
  }
  console.log("The Spire | Ready");
});

// --- Character Sheet Tabs ---
// dnd5e 5.x uses ApplicationV2. The render hook follows the pattern: render + ClassName.
// CharacterActorSheet is the class name. If this doesn't fire, the fallback catches it.
let _specificHookFired = false;

Hooks.on("renderCharacterActorSheet", (app, element, options) => {
  _specificHookFired = true;
  if (app.actor?.type !== "character") return;
  renderSpireLevelTab(app, element);
  renderWeaponGroupsSection(app, element);
  renderPotionsTab(app, element);
});

// Fallback: if the named hook doesn't exist in this Foundry version
Hooks.on("renderApplication", (app, element, options) => {
  if (_specificHookFired) return;
  if (app.constructor.name !== "CharacterActorSheet") return;
  if (app.actor?.type !== "character") return;

  console.log("The Spire | Using renderApplication fallback for:", app.constructor.name);
  renderSpireLevelTab(app, element);
  renderWeaponGroupsSection(app, element);
  renderPotionsTab(app, element);
});

// --- Roll Hooks (Weapon Groups) ---
// dnd5e 5.x signatures: (config, dialogConfig, messageConfig) for pre-roll
// and (rolls, data) for post-roll
Hooks.on("dnd5e.preRollAttack", handlePreAttack);
Hooks.on("dnd5e.preRollDamage", handlePreDamage);
Hooks.on("dnd5e.rollDamage", handleDamageRoll);

// --- Activity Use (replaces dnd5e.useItem) ---
Hooks.on("dnd5e.postUseActivity", handleActivityUse);

// --- Combat Hooks (potion cooldown) ---
Hooks.on("combatTurn", handleCombatTurn);
Hooks.on("combatRound", handleCombatTurn);

// Long rest: top HP including Spire CON bonus
Hooks.on("dnd5e.restCompleted", handleRestCompleted);