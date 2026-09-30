// The Spire — Entry Point
// Custom level scaling and dice mechanics for D&D 5e
// Requires Foundry v14+ and dnd5e 6.x+

import { initSpireLevels, renderSpireLevelTab } from "./spire-levels.mjs";
import {
  initWeaponGroups,
  renderWeaponGroupsSection,
  handlePreAttack,
  handlePreDamage,
  handleActivityUse,
} from "./weapon-groups.mjs";
import { initGroupScaling } from "./group-scaling.mjs";
import {
  initGroupXp,
  readyGroupXp,
  handlePreApplyDamage,
  handleApplyDamage,
  handleSavingThrow,
  handleRenderChatMessage,
} from "./group-xp.mjs";
import { initNetAdvantage } from "./net-advantage.mjs";
import { renderPotionsTab, handleCombatTurnChange } from "./potions.mjs";
import { registerSheetTab } from "./sheet-tabs.mjs";

const MODULE_ID = "the-spire";

Hooks.once("init", () => {
  console.log("The Spire | Initializing");
  initSpireLevels();
  initWeaponGroups();
  initGroupScaling();
  initGroupXp();
  initNetAdvantage();

  registerSheetTab({ id: "spire", label: "THE_SPIRE.TabLabel", icon: "fa-solid fa-tower-observation" });
  registerSheetTab({ id: "potions", label: "THE_SPIRE.Potions.TabLabel", icon: "fa-solid fa-flask" });
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error("The Spire requires the D&D 5e system.");
    return;
  }
  readyGroupXp();
  console.log("The Spire | Ready");
});

// --- Character Sheet Tabs ---
// ApplicationV2 fires render{ClassName} for each class in the hierarchy, so this also covers
// any module sheet that subclasses CharacterActorSheet. Fires on every render, including partial.
Hooks.on("renderCharacterActorSheet", (app, element, context, options) => {
  if (app.actor?.type !== "character") return;
  renderSpireLevelTab(app, element);
  renderWeaponGroupsSection(app, element);
  renderPotionsTab(app, element);
});

// --- Roll Hooks (Weapon Groups) ---
// Signatures: (config, dialogConfig, messageConfig) for pre-roll and (rolls, data) for post-roll
Hooks.on("dnd5e.preRollAttack", handlePreAttack);
Hooks.on("dnd5e.preRollDamage", handlePreDamage);

// --- Activity Use ---
Hooks.on("dnd5e.postUseActivity", handleActivityUse);

// --- Group XP (see group-xp.mjs) ---
Hooks.on("dnd5e.preApplyDamage", handlePreApplyDamage);
Hooks.on("dnd5e.applyDamage", handleApplyDamage);
Hooks.on("dnd5e.rollSavingThrow", handleSavingThrow);
Hooks.on("renderChatMessageHTML", handleRenderChatMessage);

// --- Combat Hooks (potion cooldown) ---
Hooks.on("combatTurnChange", handleCombatTurnChange);
