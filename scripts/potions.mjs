// Potions — Health and Mana potion pool system with cooldown tracking

const MODULE_ID = "the-spire";

// --- Data Helpers ---

/**
 * Potion data stored as actor flags:
 * actor.flags["the-spire"]["potions"] = {
 *   health: { 1: 3, 2: 1, 5: 2 },   // level: count
 *   mana:   { 1: 4, 3: 2 }
 * }
 * actor.flags["the-spire"]["potionCooldown"] = {
 *   rounds: 3,      // rounds remaining
 *   combatId: "xxx" // which combat this is tracked in
 * }
 */

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
  // Only active if in the same combat
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

  // Check cooldown warning
  if (isOnCooldown(actor)) {
    const proceed = await confirmCooldownWarning(actor);
    if (!proceed) return;
  }

  // Consume the potion
  await actor.setFlag(MODULE_ID, `potions.health.${level}`, count - 1);

  // Roll healing: Nd6 where N = potion level
  const roll = await new Roll(`${level}d6`).evaluate({ async: true });
  const healing = roll.total;

  // Apply healing (capped at max HP)
  const hp = actor.system.attributes.hp;
  const newHp = Math.min(hp.max, hp.value + healing);
  await actor.update({ "system.attributes.hp.value": newHp });

  // Apply cooldown
  await applyCooldown(actor, level);

  // Chat message
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

  // Check cooldown warning
  if (isOnCooldown(actor)) {
    const proceed = await confirmCooldownWarning(actor);
    if (!proceed) return;
  }

  // Consume the potion
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

  // Apply cooldown
  await applyCooldown(actor, level);

  // Chat message
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
  return Dialog.confirm({
    title: "Potion Cooldown Active",
    content: `<p>You have a potion cooldown active (${cd.rounds} rounds remaining). Are you sure you want to drink another potion?</p>`,
    yes: () => true,
    no: () => false,
    defaultYes: false,
  });
}

async function applyCooldown(actor, potionLevel) {
  const combat = game.combat;
  if (!combat) return; // No cooldown outside combat

  await actor.setFlag(MODULE_ID, "potionCooldown", {
    rounds: potionLevel,
    combatId: combat.id,
  });
}

// --- Combat Turn Hook (cooldown decrement) ---

export function handleCombatTurn(combat, updateData, updateOptions) {
  // Decrement cooldown for the combatant whose turn just started
  const combatant = combat.combatants.get(combat.current?.combatantId);
  const actor = combatant?.actor;
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

// --- Character Sheet Tab ---

export function renderPotionsTab(app, html) {
  const actor = app.actor;
  const potions = getPotionData(actor);
  const cooldown = getCooldown(actor);
  const isOwner = actor.isOwner;
  const onCooldown = isOnCooldown(actor);

  // Build potion rows
  const healthRows = buildPotionRows(potions.health, "health", isOwner);
  const manaRows = buildPotionRows(potions.mana, "mana", isOwner);

  const cooldownHtml = onCooldown
    ? `<div class="potion-cooldown-active"><i class="fas fa-hourglass-half"></i> Cooldown: ${cooldown.rounds} rounds remaining</div>`
    : "";

  const addPotionHtml = isOwner ? `
    <div class="potion-add-row">
      <select class="potion-add-type">
        <option value="health">Health</option>
        <option value="mana">Mana</option>
      </select>
      <input type="number" class="potion-add-level" placeholder="Lv" min="1" value="1">
      <input type="number" class="potion-add-count" placeholder="Qty" min="1" value="1">
      <button class="potion-add-btn" title="Add Potions"><i class="fas fa-plus"></i> Add</button>
    </div>` : "";

  // Inject the Potions tab nav + content
  const tabs = html.find('.tabs[data-group="primary"]');
  tabs.append(`<a class="item" data-tab="potions"><i class="fa-solid fa-flask"></i> Potions</a>`);

  const tabContent = `
    <div class="tab potions" data-group="primary" data-tab="potions">
      ${cooldownHtml}
      <section class="potion-section">
        <h3>Health Potions</h3>
        <div class="potion-list">${healthRows || '<span class="potion-empty">None</span>'}</div>
      </section>
      <section class="potion-section">
        <h3>Mana Potions</h3>
        <div class="potion-list">${manaRows || '<span class="potion-empty">None</span>'}</div>
      </section>
      ${addPotionHtml}
    </div>`;

  html.find(".sheet-body").append(tabContent);

  // --- Event Handlers ---

  if (!isOwner) return;

  // Use potion
  html.find(".potion-use").on("click", async (event) => {
    const row = $(event.currentTarget).closest(".potion-row");
    const type = row.data("potion-type");
    const level = parseInt(row.data("potion-level"));
    if (type === "health") {
      await useHealthPotion(actor, level);
    } else {
      await useManaPotion(actor, level);
    }
  });

  // Remove single potion from pool
  html.find(".potion-remove").on("click", async (event) => {
    const row = $(event.currentTarget).closest(".potion-row");
    const type = row.data("potion-type");
    const level = parseInt(row.data("potion-level"));
    const potions = getPotionData(actor);
    const current = potions[type][level] ?? 0;
    if (current <= 0) return;
    await actor.setFlag(MODULE_ID, `potions.${type}.${level}`, current - 1);
  });

  // Add potions
  html.find(".potion-add-btn").on("click", async () => {
    const type = html.find(".potion-add-type").val();
    const level = parseInt(html.find(".potion-add-level").val()) || 1;
    const count = parseInt(html.find(".potion-add-count").val()) || 1;
    if (level < 1 || count < 1) return;

    const potions = getPotionData(actor);
    const current = potions[type][level] ?? 0;
    await actor.setFlag(MODULE_ID, `potions.${type}.${level}`, current + count);
  });
}

function buildPotionRows(pool, type, isOwner) {
  const entries = Object.entries(pool)
    .map(([level, count]) => ({ level: parseInt(level), count }))
    .filter(e => e.count > 0)
    .sort((a, b) => a.level - b.level);

  if (entries.length === 0) return "";

  return entries.map(({ level, count }) => {
    const useBtn = isOwner
      ? `<button class="potion-use" title="Use potion"><i class="fas fa-flask"></i></button>`
      : "";
    const removeBtn = isOwner
      ? `<button class="potion-remove" title="Remove from pool"><i class="fas fa-minus"></i></button>`
      : "";

    const effect = type === "health" ? `${level}d6 HP` : `Lv ${level} slot`;

    return `
      <div class="potion-row" data-potion-type="${type}" data-potion-level="${level}">
        <span class="potion-label">Lv ${level}</span>
        <span class="potion-count">x${count}</span>
        <span class="potion-effect">(${effect})</span>
        ${useBtn}
        ${removeBtn}
      </div>`;
  }).join("");
}
