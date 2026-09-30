// Potions — Health and Mana potion pool system with cooldown tracking

import { getSheetTabPanel } from "./sheet-tabs.mjs";

const MODULE_ID = "the-spire";

// --- Data Helpers ---

function getPotionData(actor) {
  const potions = actor.getFlag(MODULE_ID, "potions") ?? { health: {}, mana: {} };
  potions.health = potions.health ?? {};
  potions.mana = potions.mana ?? {};
  return potions;
}

function getCooldown(actor) {
  return actor.getFlag(MODULE_ID, "potionCooldown") ?? null;
}

function isOnCooldown(actor) {
  const cd = getCooldown(actor);
  if (!cd || cd.rounds <= 0) return false;
  const combat = game.combat;
  if (!combat || combat.id !== cd.combatId) return false;
  return true;
}

// --- Potion Consumption ---

async function useHealthPotion(actor, level) {
  const potions = getPotionData(actor);
  const count = potions.health[level] ?? 0;
  if (count <= 0) {
    ui.notifications.warn("No health potions of that level available.");
    return;
  }

  if (isOnCooldown(actor)) {
    const proceed = await confirmCooldownWarning(actor);
    if (!proceed) return;
  }

  await actor.setFlag(MODULE_ID, `potions.health.${level}`, count - 1);

  // Roll healing: Nd6 where N = potion level
  const roll = await new Roll(`${level}d6`).evaluate();
  const healing = roll.total;

  // Apply healing (capped at effective max HP, which includes temp max HP)
  const hp = actor.system.attributes.hp;
  const newHp = Math.min(hp.effectiveMax ?? hp.max, hp.value + healing);
  await actor.update({ "system.attributes.hp.value": newHp });

  await applyCooldown(actor, level);

  roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>Health Potion (Lv ${level})</strong> — Healed ${newHp - hp.value} HP`,
  });
}

async function useManaPotion(actor, level) {
  const potions = getPotionData(actor);
  const count = potions.mana[level] ?? 0;
  if (count <= 0) {
    ui.notifications.warn("No mana potions of that level available.");
    return;
  }

  if (isOnCooldown(actor)) {
    const proceed = await confirmCooldownWarning(actor);
    if (!proceed) return;
  }

  await actor.setFlag(MODULE_ID, `potions.mana.${level}`, count - 1);

  // Find a spell slot to recover (at potion level, or fall back to highest available lower)
  const spells = actor.system.spells;
  let recoveredLevel = null;

  for (let checkLevel = level; checkLevel >= 1; checkLevel--) {
    const slotKey = `spell${checkLevel}`;
    const slot = spells[slotKey];
    if (slot && slot.value < slot.max) {
      await actor.update({ [`system.spells.${slotKey}.value`]: slot.value + 1 });
      recoveredLevel = checkLevel;
      break;
    }
  }

  await applyCooldown(actor, level);

  const effect = recoveredLevel
    ? `Recovered 1x Level ${recoveredLevel} spell slot`
    : `No available spell slots to recover`;

  ChatMessage.create({
    content: `<strong>Mana Potion (Lv ${level})</strong> — ${effect}`,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

async function confirmCooldownWarning(actor) {
  const cd = getCooldown(actor);
  // Foundry v14: use DialogV2
  return foundry.applications.api.DialogV2.confirm({
    window: { title: "Potion Cooldown Active" },
    content: `<p>You have a potion cooldown active (${cd.rounds} rounds remaining). Are you sure you want to drink another potion?</p>`,
    yes: { default: false },
  });
}

async function applyCooldown(actor, potionLevel) {
  const combat = game.combat;
  if (!combat) return;

  await actor.setFlag(MODULE_ID, "potionCooldown", {
    rounds: potionLevel,
    combatId: combat.id,
  });
}

// --- Combat Turn Hook (cooldown decrement) ---

// combatTurnChange fires on every client AFTER the turn has advanced, so `current` is the
// combatant whose turn is starting. A cooldown therefore lasts until the drinker's next turn
// starts (the old combatTurn/combatRound hooks fired before the update, on the clicking client
// only, and ticked the drinker's own turn as it ended — a Lv 1 cooldown expired immediately).
export function handleCombatTurnChange(combat, previous, current) {
  if (!game.user.isActiveGM) return;

  // Only tick when moving forward — rewinding a turn shouldn't consume cooldown.
  const forward = (current.round > previous.round)
    || ((current.round === previous.round) && (current.turn > previous.turn));
  if (!forward) return;

  const actor = combat.combatants.get(current.combatantId)?.actor;
  if (!actor) return;

  const cd = actor.getFlag(MODULE_ID, "potionCooldown");
  if (!cd || cd.combatId !== combat.id || cd.rounds <= 0) return;

  const newRounds = cd.rounds - 1;
  if (newRounds <= 0) {
    actor.unsetFlag(MODULE_ID, "potionCooldown");
  } else {
    actor.setFlag(MODULE_ID, "potionCooldown", { ...cd, rounds: newRounds });
  }
}

// --- Character Sheet Tab (native DOM) ---

// Fills the natively-registered "potions" panel. Runs on every sheet render; flag changes
// re-render the sheet, so handlers just write flags and the next render rebuilds the content.
export function renderPotionsTab(app, element) {
  const panel = getSheetTabPanel(element, "potions");
  if (!panel) return;

  const actor = app.actor;
  panel.replaceChildren(buildPotionsContent(actor));
  if (actor.isOwner) wirePotionButtons(actor, panel);
}

function buildPotionsContent(actor) {
  const potions = getPotionData(actor);
  const cooldown = getCooldown(actor);
  const isOwner = actor.isOwner;
  const onCooldown = isOnCooldown(actor);

  const tabContent = document.createDocumentFragment();

  // Cooldown notice
  if (onCooldown) {
    const cdDiv = document.createElement("div");
    cdDiv.className = "potion-cooldown-active";

    const cdIcon = document.createElement("i");
    cdIcon.className = "fas fa-hourglass-half";
    cdDiv.appendChild(cdIcon);
    cdDiv.append(` Cooldown: ${cooldown.rounds} rounds remaining`);

    if (isOwner) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "potion-cooldown-cancel";
      cancelBtn.title = "Cancel cooldown";
      const cancelIcon = document.createElement("i");
      cancelIcon.className = "fas fa-times";
      cancelBtn.appendChild(cancelIcon);
      cancelBtn.append(" Cancel");
      cdDiv.appendChild(cancelBtn);
    }

    tabContent.appendChild(cdDiv);
  }

  // Health potions section
  tabContent.appendChild(buildPotionSection("Health Potions", potions.health, "health", isOwner));

  // Mana potions section
  tabContent.appendChild(buildPotionSection("Mana Potions", potions.mana, "mana", isOwner));

  // Add potion controls (owner only)
  if (isOwner) {
    const addRow = document.createElement("div");
    addRow.className = "potion-add-row";

    const typeSelect = document.createElement("select");
    typeSelect.className = "potion-add-type";
    typeSelect.append(
      new Option("Health", "health"),
      new Option("Mana", "mana")
    );

    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.className = "potion-add-level";
    levelInput.min = "1";
    levelInput.value = "1";

    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.className = "potion-add-count";
    countInput.min = "1";
    countInput.value = "1";

    const typeLabel = document.createElement("label");
    typeLabel.className = "potion-add-field";
    typeLabel.append("Type", typeSelect);

    const levelLabel = document.createElement("label");
    levelLabel.className = "potion-add-field";
    levelLabel.append("Level", levelInput);

    const countLabel = document.createElement("label");
    countLabel.className = "potion-add-field";
    countLabel.append("Qty", countInput);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "potion-add-btn";
    addBtn.title = "Add Potions";
    const addIcon = document.createElement("i");
    addIcon.className = "fas fa-plus";
    addBtn.appendChild(addIcon);
    addBtn.append(" Add");

    addRow.append(typeLabel, levelLabel, countLabel, addBtn);
    tabContent.appendChild(addRow);
  }

  return tabContent;
}

function wirePotionButtons(actor, panel) {
  panel.querySelector(".potion-add-btn")?.addEventListener("click", async () => {
    const type = panel.querySelector(".potion-add-type").value;
    const level = parseInt(panel.querySelector(".potion-add-level").value) || 1;
    const count = parseInt(panel.querySelector(".potion-add-count").value) || 1;
    if (level < 1 || count < 1) return;

    const current = getPotionData(actor)[type][level] ?? 0;
    await actor.setFlag(MODULE_ID, `potions.${type}.${level}`, current + count);
  });

  panel.querySelector(".potion-cooldown-cancel")?.addEventListener("click", async () => {
    await actor.unsetFlag(MODULE_ID, "potionCooldown");
  });

  panel.querySelectorAll(".potion-use").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".potion-row");
      const type = row.dataset.potionType;
      const level = parseInt(row.dataset.potionLevel);
      if (type === "health") {
        await useHealthPotion(actor, level);
      } else {
        await useManaPotion(actor, level);
      }
    });
  });

  panel.querySelectorAll(".potion-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".potion-row");
      const type = row.dataset.potionType;
      const level = parseInt(row.dataset.potionLevel);
      const currentPotions = getPotionData(actor);
      const current = currentPotions[type][level] ?? 0;
      if (current <= 0) return;
      await actor.setFlag(MODULE_ID, `potions.${type}.${level}`, current - 1);
    });
  });
}

function buildPotionSection(title, pool, type, isOwner) {
  const section = document.createElement("section");
  section.className = "potion-section";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  section.appendChild(h3);

  const list = document.createElement("div");
  list.className = "potion-list";

  const entries = Object.entries(pool)
    .map(([level, count]) => ({ level: parseInt(level), count }))
    .filter(e => e.count > 0)
    .sort((a, b) => a.level - b.level);

  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "potion-empty";
    empty.textContent = "None";
    list.appendChild(empty);
  } else {
    for (const { level, count } of entries) {
      const row = document.createElement("div");
      row.className = "potion-row";
      row.dataset.potionType = type;
      row.dataset.potionLevel = String(level);

      const labelSpan = document.createElement("span");
      labelSpan.className = "potion-label";
      labelSpan.textContent = `Lv ${level}`;

      const countSpan = document.createElement("span");
      countSpan.className = "potion-count";
      countSpan.textContent = `x${count}`;

      const effect = type === "health" ? `${level}d6 HP` : `Lv ${level} slot`;
      const effectSpan = document.createElement("span");
      effectSpan.className = "potion-effect";
      effectSpan.textContent = `(${effect})`;

      row.append(labelSpan, countSpan, effectSpan);

      if (isOwner) {
        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.className = "potion-use";
        useBtn.title = "Use potion";
        const useIcon = document.createElement("i");
        useIcon.className = "fas fa-flask";
        useBtn.appendChild(useIcon);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "potion-remove";
        removeBtn.title = "Remove from pool";
        const removeIcon = document.createElement("i");
        removeIcon.className = "fas fa-minus";
        removeBtn.appendChild(removeIcon);

        row.append(useBtn, removeBtn);
      }

      list.appendChild(row);
    }
  }

  section.appendChild(list);
  return section;
}
