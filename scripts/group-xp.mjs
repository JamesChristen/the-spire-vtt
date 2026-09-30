// Group XP — every way a weapon/spell group earns XP, plus the award pipeline.
//
// Sources:
//  • Damage/healing APPLIED from a chat card: XP = DDN × min(dice rolled, HP actually changed)
//    ÷ max base dice. Capped by the target's remaining (or missing) HP, no XP on misses, each
//    target of an area effect counted separately.
//  • Failed saves against a non-damaging save activity: DDN × save factor × spell level.
//  • Utility/buff activities (no attack, save, damage or healing): DDN × utility factor × level.
//  • GM award: button on the group chat card, or the macro API.
//
// Awards that must only happen once (per damage message + target) are recorded on the chat
// message. Updating another user's message/actor needs GM rights, so non-GM clients relay
// those awards to the active GM over the module socket.

import {
  MODULE_ID, getGroups, getActivityGroup, getGroupXp, levelFromXp,
  getActivityBaseDice, maxDice,
} from "./group-data.mjs";

const SOCKET = `module.${MODULE_ID}`;

// --- Init ---

export function initGroupXp() {
  game.settings.register(MODULE_ID, "xpSaveFactor", {
    name: "Group XP: Failed Save Factor",
    hint: "XP per target failing a save against a non-damaging save ability = DDN × this × spell level (min 1). "
      + "For scale, an average damage hit earns roughly DDN × 0.5.",
    scope: "world",
    config: true,
    type: Number,
    default: 0.5,
  });

  game.settings.register(MODULE_ID, "xpUtilityFactor", {
    name: "Group XP: Utility Use Factor",
    hint: "XP per use of a utility/buff ability (no attack, save, damage or healing) = DDN × this × spell level (min 1).",
    scope: "world",
    config: true,
    type: Number,
    default: 0.5,
  });
}

export function readyGroupXp() {
  game.socket.on(SOCKET, data => {
    if (data?.type === "award" && game.user.isActiveGM) grantXp(data.award);
  });

  // Macro API: game.modules.get("the-spire").api.awardGroupXp(actor, groupId, amount, reason)
  game.modules.get(MODULE_ID).api = {
    awardGroupXp: (actor, groupId, amount, reason) =>
      awardGroupXp({ actorUuid: actor.uuid, groupId, amount, reason, announce: true }),
  };
}

// --- Award pipeline ---

/**
 * @param {object} award
 * @param {string} award.actorUuid
 * @param {string} award.groupId
 * @param {number} award.amount
 * @param {string} [award.reason]     Shown in the chat announcement.
 * @param {boolean} [award.announce]  Post a chat message for the award itself (level-ups always post).
 * @param {{messageId: string, key: string}} [award.once]  Only award once per message + key.
 */
export async function awardGroupXp(award) {
  if (!(award.amount > 0)) return;
  const actor = fromUuidSync(award.actorUuid);
  if (game.user.isActiveGM || (actor?.isOwner && !award.once)) return grantXp(award);

  if (!game.users.activeGM) {
    ui.notifications.warn("The Spire | A GM must be online to award group XP.");
    return;
  }
  game.socket.emit(SOCKET, { type: "award", award });
}

async function grantXp({ actorUuid, groupId, amount, reason, announce, once }) {
  const actor = await fromUuid(actorUuid);
  const group = getGroups()[groupId];
  if (!actor || !group) return;

  if (once) {
    const message = game.messages.get(once.messageId);
    if (message?.getFlag(MODULE_ID, `xpAwarded.${once.key}`)) return;
    await message?.setFlag(MODULE_ID, `xpAwarded.${once.key}`, true);
  }

  const ddn = group.ddn ?? 0;
  const currentXp = getGroupXp(actor, groupId);
  const newXp = currentXp + Math.round(amount);
  await actor.setFlag(MODULE_ID, `groupXp.${groupId}`, newXp);

  const speaker = ChatMessage.getSpeaker({ actor });
  if (announce) {
    ChatMessage.create({
      content: `<div class="spire-xp-award"><strong>${actor.name}</strong> gains <strong>${Math.round(amount)} XP</strong> in <strong>${group.name}</strong>${reason ? ` — ${foundry.utils.escapeHTML(reason)}` : ""}</div>`,
      speaker,
    });
  }

  const oldLevel = levelFromXp(currentXp, ddn);
  const newLevel = levelFromXp(newXp, ddn);
  if (newLevel > oldLevel) {
    ChatMessage.create({
      content: `<div class="spire-levelup">Congratulations <strong>${actor.name}</strong>! You have reached level <strong>${newLevel}</strong> in <strong>${group.name}</strong></div>`,
      speaker,
    });
  }
}

// Key for "once per target": token id for unlinked tokens (which share an actor id), else actor id.
function targetKey(prefix, actor) {
  return `${prefix}-${actor.token?.id ?? actor.id}`;
}

// --- Damage & healing applied ---

/**
 * dnd5e.preApplyDamage — (actor, amount, updates, options). Record how much HP actually changed
 * (clamped by dnd5e to the target's remaining/missing HP) for the post-apply hook.
 */
export function handlePreApplyDamage(actor, amount, updates, options) {
  const hp = actor.system.attributes.hp;
  const newValue = updates["system.attributes.hp.value"] ?? hp.value;
  const newTemp = updates["system.attributes.hp.temp"] ?? hp.temp;
  options.spireHpChange = {
    damage: Math.max(0, (hp.value + (hp.temp ?? 0)) - (newValue + (newTemp ?? 0))),
    healed: Math.max(0, newValue - hp.value),
  };
}

/**
 * dnd5e.applyDamage — (actor, amount, options). Fires on the client that applied the damage.
 * Chat-card application passes the damage message as `origin` (or `originatingMessage`).
 */
export function handleApplyDamage(target, amount, options) {
  const change = options.spireHpChange;
  const message = [options.origin, options.originatingMessage].find(m => m instanceof ChatMessage);
  if (!change || !message) return;

  const activity = message.getAssociatedActivity({ scaled: true });
  const info = getActivityGroup(activity);
  const ddn = info?.group.ddn ?? 0;
  if (!info || ddn <= 0) return;

  const isHealing = amount < 0;
  const hpChanged = isHealing ? change.healed : change.damage;
  if (hpChanged <= 0) return;

  // Dice actually rolled (excluding flat modifiers), capped by the HP that actually changed.
  let diceSum = 0;
  for (const roll of message.rolls ?? []) {
    for (const die of roll.dice ?? []) diceSum += die.total ?? 0;
  }
  const effective = Math.min(diceSum, hpChanged);

  // Normalise by the base dice's maximum so a d12 weapon doesn't grind faster than a d4.
  const bd = maxDice(getActivityBaseDice(activity));
  if (effective <= 0 || bd <= 0) return;

  awardGroupXp({
    actorUuid: info.actor.uuid,
    groupId: info.groupId,
    amount: ddn * effective / bd,
    once: { messageId: message.id, key: targetKey(isHealing ? "heal" : "dmg", target) },
  });
}

// --- Failed saves ---

/**
 * dnd5e.rollSavingThrow — (rolls, { ability, subject }). Saves rolled from an activity's chat
 * card carry that card's id in roll.options.originatingMessage.
 */
export function handleSavingThrow(rolls, { subject }) {
  const roll = rolls?.[0];
  const message = game.messages.get(roll?.options?.originatingMessage);
  const activity = message?.getAssociatedActivity({ scaled: true });
  if (activity?.type !== "save") return;

  // Damaging saves (e.g. Fireball) already earn XP through damage applied.
  if (activity.damage?.parts?.length) return;

  const info = getActivityGroup(activity);
  const ddn = info?.group.ddn ?? 0;
  if (!info || ddn <= 0 || !subject) return;

  const dc = activity.save.dc.value;
  if (!dc || roll.total >= dc) return;

  awardGroupXp({
    actorUuid: info.actor.uuid,
    groupId: info.groupId,
    amount: ddn * game.settings.get(MODULE_ID, "xpSaveFactor") * spellLevel(activity),
    once: { messageId: message.id, key: targetKey("save", subject) },
  });
}

// --- Utility / buff uses ---

const NON_UTILITY_TYPES = new Set(["attack", "save", "damage", "heal", "cast"]);

// Called from the postUseActivity handler with the (scaled) activity that was used.
export function awardUtilityXp(activity, info) {
  if (NON_UTILITY_TYPES.has(activity.type) || activity.damage?.parts?.length) return;
  const ddn = info.group.ddn ?? 0;
  if (ddn <= 0) return;

  awardGroupXp({
    actorUuid: info.actor.uuid,
    groupId: info.groupId,
    amount: ddn * game.settings.get(MODULE_ID, "xpUtilityFactor") * spellLevel(activity),
  });
}

// Spell level the activity was used at (upcasting included, since usage passes a scaled clone).
// Cantrips and non-spells count as 1.
function spellLevel(activity) {
  return Math.max(1, activity.item?.system?.level ?? 1);
}

// --- GM award button on group chat cards ---

/**
 * renderChatMessageHTML — (message, html). Adds a GM-only "Award XP" button to the group info
 * card posted on activity use. Injected at render so players never see it.
 */
export function handleRenderChatMessage(message, html) {
  if (!game.user.isGM) return;
  const card = html.querySelector(".spire-item-scaling[data-group-id]");
  if (!card || card.querySelector(".spire-award-xp")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "spire-award-xp";
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-star";
  btn.append(icon, " Award XP");
  btn.addEventListener("click", () => promptAwardXp(card.dataset.actorUuid, card.dataset.groupId));
  card.appendChild(btn);
}

async function promptAwardXp(actorUuid, groupId) {
  const actor = fromUuidSync(actorUuid);
  const group = getGroups()[groupId];
  if (!actor || !group) return;

  const data = await foundry.applications.api.DialogV2.input({
    window: { title: `Award XP — ${group.name}` },
    content: `
      <div class="form-group"><label>XP</label><input type="number" name="amount" min="1" step="1" value="${group.ddn || 1}" autofocus></div>
      <div class="form-group"><label>Reason</label><input type="text" name="reason" placeholder="Optional"></div>`,
    ok: { label: "Award", icon: "fa-solid fa-star" },
  });
  const amount = parseInt(data?.amount) || 0;
  if (amount > 0) await awardGroupXp({ actorUuid, groupId, amount, reason: data.reason, announce: true });
}
