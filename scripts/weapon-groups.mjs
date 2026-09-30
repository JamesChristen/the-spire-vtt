// Weapon/Spell Group Scaling — roll bonuses, group chat card, sheet section
// Data helpers live in group-data.mjs, activity-data bonuses in group-scaling.mjs,
// XP sources in group-xp.mjs.

import { WeaponGroupConfig } from "./WeaponGroupConfig.mjs";
import { getSheetTabPanel } from "./sheet-tabs.mjs";
import {
  MODULE_ID, getGroups, getActivityGroup, getGroupScaling, getUnlockedMilestones, levelFromXp, xpForLevel,
  getToHitBonus, getSpellSaveDcBonus, getFlatDamageBonus,
  findBaseRoll, baseRollDice, getActivityBaseDice,
} from "./group-data.mjs";
import { awardUtilityXp } from "./group-xp.mjs";

// --- Init ---

export function initWeaponGroups() {
  game.settings.register(MODULE_ID, "weaponGroups", {
    name: "Weapon/Spell Groups",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.registerMenu(MODULE_ID, "weaponGroupsMenu", {
    name: "Configure Weapon/Spell Groups",
    label: "Configure Groups",
    icon: "fas fa-swords",
    type: WeaponGroupConfig,
    restricted: true,
  });
}

// --- Roll Hook Handlers ---
// All checks operate on the SPECIFIC activity being used (config.subject), not the item — a
// single item (e.g. the 2024 Unarmed Strike) can carry several activities (Attack + Grapple/Shove
// saves), so scanning the whole item misreads an attack as a save.

/**
 * dnd5e.preRollAttack — (config, dialogConfig, messageConfig); config.subject is the Activity.
 */
export function handlePreAttack(config, dialogConfig, messageConfig) {
  const activity = config.subject;
  if (activity?.type !== "attack") return;
  const info = getActivityGroup(activity);
  if (!info) return;

  const bonus = getToHitBonus(info.level);
  if (bonus <= 0 || !config.rolls?.length) return;

  // preRollAttack fires before _buildAttackConfig populates parts/data — initialize
  // parts ourselves so our bonus is preserved when the attack parts are appended later.
  for (const roll of config.rolls) {
    roll.parts ??= [];
    roll.data ??= {};
    roll.parts.push("@spireBonus");
    roll.data.spireBonus = bonus;
  }
}

/**
 * dnd5e.preRollDamage — (config, dialogConfig, messageConfig). Also fires for healing.
 * Adds a flat bonus to the BASE damage roll only (riders like a Flame Tongue's fire are ignored),
 * sized from the dice that will actually be rolled — so Monk Martial Arts dice and cantrip
 * scaling count.
 */
export function handlePreDamage(config, dialogConfig, messageConfig) {
  const info = getActivityGroup(config.subject);
  if (!info) return;

  const base = findBaseRoll(config.rolls);
  const bonus = getFlatDamageBonus(baseRollDice(base), info.level);
  if (!base || bonus <= 0) return;

  base.parts.push("@spireDamage");
  base.data ??= {};
  base.data.spireDamage = bonus;
}

// --- Activity Use Hook (group chat card + utility XP) ---

/**
 * dnd5e.postUseActivity — (activity, usageConfig, results). `activity` belongs to a scaled clone
 * of the item, so upcast spells report their cast level.
 */
export function handleActivityUse(activity, usageConfig, results) {
  const actor = activity?.item?.actor;
  if (actor?.type !== "character") return;

  const baseDice = getActivityBaseDice(activity);
  const isAttack = activity.type === "attack";
  const isSave = activity.type === "save";

  const info = getActivityGroup(activity);
  if (!info) {
    // Only nag for things that attack or deal damage — not every utility feature.
    if (!isAttack && !isSave && !baseDice.length) return;
    ChatMessage.create({
      content: `<div class="spire-item-scaling">No weapon group found</div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: [],
      flags: { [MODULE_ID]: { type: "scaling-info" } },
    });
    return;
  }

  awardUtilityXp(activity, info);

  const { group, level } = info;
  const scaling = getGroupScaling(group);
  const milestones = getUnlockedMilestones(group, level);
  const scalingLines = [];

  // Bonuses for THIS activity. To-hit and damage are added by the roll hooks above; the rest are
  // already baked into the activity's data by group-scaling.mjs.
  if (isAttack) {
    const toHit = getToHitBonus(level);
    if (toHit > 0) scalingLines.push(`To Hit: +${toHit}`);
  }
  const damageBonus = getFlatDamageBonus(baseDice, level);
  if (damageBonus > 0) scalingLines.push(`${activity.type === "heal" ? "Healing" : "Damage"}: +${damageBonus}`);
  if (activity.range?.value && scaling.range > 0) scalingLines.push(`Range: +${scaling.range * level}ft`);
  if (activity.duration?.value && scaling.duration > 0) {
    scalingLines.push(`Duration: x${1 + scaling.duration * level}`);
  }
  if (activity.target?.affects?.count && scaling.targets > 0) {
    scalingLines.push(`Extra Targets: +${scaling.targets * level}`);
  }
  if (activity.target?.template?.type && scaling.area > 0) scalingLines.push(`Area: +${scaling.area * level}ft`);
  if (isSave) {
    const dcBonus = getSpellSaveDcBonus(level);
    if (dcBonus > 0) scalingLines.push(`Save DC: +${dcBonus}`);
  }

  // Always post the group's current info, even with no bonuses yet. The data attributes let the
  // GM-only "Award XP" button (group-xp.mjs) find the actor and group.
  const parts = [`<div class="spire-item-scaling" data-actor-uuid="${actor.uuid}" data-group-id="${info.groupId}">`];
  parts.push(`<strong>${group.name}</strong> (Lv ${level})`);

  parts.push(`<div class="spire-scaling-bonuses">${scalingLines.length > 0 ? scalingLines.join(" | ") : "No bonuses yet"}</div>`);

  if (milestones.length > 0) {
    parts.push(`<ul class="spire-milestones">`);
    for (const m of milestones) {
      parts.push(`<li><strong>Lv ${m.level}:</strong> ${m.text}</li>`);
    }
    parts.push(`</ul>`);
  }

  parts.push(`</div>`);

  ChatMessage.create({
    content: parts.join(""),
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: [],
    flags: { [MODULE_ID]: { type: "scaling-info" } },
  });
}

// --- Character Sheet Display (native DOM) ---

// Appends to the "spire" panel — must run after renderSpireLevelTab, which rebuilds the panel.
export function renderWeaponGroupsSection(app, element) {
  const spireTab = getSheetTabPanel(element, "spire");
  if (!spireTab) return;

  const actor = app.actor;
  const groupEntries = Object.entries(getGroups());
  if (groupEntries.length === 0) return;

  const groupXp = actor.getFlag(MODULE_ID, "groupXp") ?? {};
  const isGM = game.user.isGM;

  const section = document.createElement("section");
  section.className = "spire-weapon-groups";

  const h3 = document.createElement("h3");
  h3.textContent = "Weapon Groups";
  section.appendChild(h3);

  for (const [groupId, group] of groupEntries) {
    const xp = groupXp[groupId] ?? 0;
    const level = levelFromXp(xp, group.ddn ?? 0);
    const toHit = getToHitBonus(level);
    const spellDc = getSpellSaveDcBonus(level);
    const scaling = getGroupScaling(group);
    const milestones = getUnlockedMilestones(group, level);
    const itemList = group.items?.map(i => i.name).join(", ") || "No items";

    const groupDiv = document.createElement("div");
    groupDiv.className = "spire-weapon-group";
    groupDiv.dataset.groupId = groupId;

    // Main row
    const mainRow = document.createElement("div");
    mainRow.className = "group-row-main";

    const nameSpan = document.createElement("span");
    nameSpan.className = "group-name";
    nameSpan.textContent = group.name;

    const levelSpan = document.createElement("span");
    levelSpan.className = "group-level";
    levelSpan.textContent = `Lv ${level}`;

    mainRow.append(nameSpan, levelSpan);

    if (isGM) {
      const xpInput = document.createElement("input");
      xpInput.type = "number";
      xpInput.className = "group-xp-input";
      xpInput.dataset.groupId = groupId;
      xpInput.value = String(xp);
      xpInput.min = "0";
      xpInput.title = "Adjust XP";
      xpInput.addEventListener("change", async (event) => {
        const newXp = Math.max(0, parseInt(event.currentTarget.value) || 0);
        await actor.setFlag(MODULE_ID, `groupXp.${groupId}`, newXp);
      });
      mainRow.appendChild(xpInput);
    } else {
      const xpValue = document.createElement("span");
      xpValue.className = "group-xp-value";
      xpValue.textContent = String(xp);
      mainRow.appendChild(xpValue);
    }

    // "/ 145 XP" — total XP at which the next level is reached (omitted if the group has no DDN)
    const nextXp = xpForLevel(level + 1, group.ddn ?? 0);
    const xpLabel = document.createElement("span");
    xpLabel.className = "group-xp-label";
    xpLabel.textContent = nextXp === null ? "XP" : `/ ${nextXp} XP`;
    if (nextXp !== null) xpLabel.title = `${nextXp - xp} XP to Lv ${level + 1}`;
    mainRow.appendChild(xpLabel);

    groupDiv.appendChild(mainRow);

    // Detail row
    const detailRow = document.createElement("div");
    detailRow.className = "group-row-detail";

    const scalingParts = [];
    if (toHit > 0) scalingParts.push(`+${toHit} hit`);
    if (level > 0) scalingParts.push(`+${level}× ½ avg dmg`);
    if (spellDc > 0) scalingParts.push(`+${spellDc} DC`);
    if (scaling.range > 0) scalingParts.push(`+${scaling.range * level}ft range`);
    if (scaling.area > 0) scalingParts.push(`+${scaling.area * level}ft area`);
    if (scaling.targets > 0) scalingParts.push(`+${scaling.targets * level} targets`);
    if (scaling.duration > 0) scalingParts.push(`x${1 + scaling.duration * level} duration`);

    const bonusesSpan = document.createElement("span");
    bonusesSpan.className = "group-bonuses";
    bonusesSpan.textContent = scalingParts.length > 0 ? scalingParts.join(" | ") : "No bonuses yet";

    const itemsSpan = document.createElement("span");
    itemsSpan.className = "group-items";
    itemsSpan.title = itemList;
    itemsSpan.textContent = itemList;

    detailRow.append(bonusesSpan, itemsSpan);
    groupDiv.appendChild(detailRow);

    // Milestones
    if (milestones.length > 0) {
      const milestoneList = document.createElement("ul");
      milestoneList.className = "group-milestones";
      for (const m of milestones) {
        const li = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = `Lv ${m.level}: `;
        li.appendChild(strong);
        li.append(m.text);
        milestoneList.appendChild(li);
      }
      groupDiv.appendChild(milestoneList);
    }

    section.appendChild(groupDiv);
  }

  spireTab.appendChild(section);
}
