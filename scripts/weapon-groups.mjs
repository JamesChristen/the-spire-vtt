// Weapon/Spell Group Scaling — XP tracking, roll bonuses, spell params, milestones

import { WeaponGroupConfig } from "./WeaponGroupConfig.mjs";

const MODULE_ID = "the-spire";

// Default scaling rates per level (GM can override per group)
const DEFAULT_SCALING = {
  range: 0,
  duration: 0,
  targets: 0,
  area: 0,
};

// --- Data Helpers ---

function getGroups() {
  return game.settings.get(MODULE_ID, "weaponGroups");
}

function findGroupForItem(item) {
  const groups = getGroups();
  for (const [groupId, group] of Object.entries(groups)) {
    const match = group.items?.find(i =>
      i.name.toLowerCase() === item.name.toLowerCase() && i.type === item.type
    );
    if (match) return { groupId, group };
  }
  return null;
}

// Incremental XP cost to advance from `level` to `level + 1`, given the group's DDN.
function levelUpCost(level, ddn) {
  return Math.ceil(ddn * Math.pow(level + 1, 1 + 0.1 * level));
}

// Resolve current level from total XP by walking incremental costs.
// ddn <= 0 means the group is unconfigured — stays at level 0.
function levelFromXp(xp, ddn) {
  if (!ddn || ddn <= 0) return 0;
  let level = 0;
  let cumulative = 0;
  while (level < 100) {
    const cost = levelUpCost(level, ddn);
    if (cumulative + cost > xp) break;
    cumulative += cost;
    level++;
  }
  return level;
}

function getGroupLevel(actor, groupId) {
  const xp = actor.getFlag(MODULE_ID, "groupXp")?.[groupId] ?? 0;
  const ddn = getGroups()[groupId]?.ddn ?? 0;
  return levelFromXp(xp, ddn);
}

function getToHitBonus(level) {
  return Math.max(0, level - 1);
}

function getSpellSaveDcBonus(level) {
  return Math.max(0, Math.floor((level - 1) / 2));
}

function getExtraDiceMultiplier(level) {
  return Math.max(0, Math.floor((level - 1) / 2));
}

// Parse the first "NdM" die out of a damage formula string.
function parseDieFormula(formula) {
  const match = String(formula ?? "").match(/(\d+)d(\d+)/);
  if (!match) return null;
  return { count: parseInt(match[1]), size: parseInt(match[2]) };
}

// Find the base damage die from a set of roll configs (each with a `parts` array of
// formula strings). This reads the formula that will actually be rolled, so it works
// even when the die is injected at roll time (e.g. Monk Martial Arts) and never appears
// on item.system.damage.base.
function baseDieFromRolls(rolls) {
  for (const roll of rolls ?? []) {
    for (const part of roll?.parts ?? []) {
      const die = parseDieFormula(part);
      if (die) return die;
    }
  }
  return null;
}

// Resolve an activity's base damage die without rolling, by building its damage config.
function getActivityBaseDie(activity) {
  try {
    return baseDieFromRolls(activity?.getDamageConfig?.({})?.rolls);
  } catch (err) {
    console.warn("The Spire | Could not read damage config", err);
    return null;
  }
}

// All checks operate on the SPECIFIC activity being used (config/data.subject), not the
// item — a single item (e.g. the 2024 Unarmed Strike) can carry several activities
// (Attack + Grapple/Shove saves), so scanning the whole item misreads an attack as a save.
function activityIsAttack(activity) {
  return activity?.type === "attack";
}

function activityIsSave(activity) {
  return activity?.type === "save";
}

function activityHasRange(activity) {
  return (activity?.range?.value ?? 0) > 0 || (activity?.range?.long ?? 0) > 0;
}

function activityHasDuration(activity) {
  return !!activity?.duration?.value;
}

function activityHasArea(activity) {
  return !!activity?.target?.template?.type && (Number(activity?.target?.template?.size) > 0);
}

function getGroupScaling(group) {
  return { ...DEFAULT_SCALING, ...(group.scaling ?? {}) };
}

function getUnlockedMilestones(group, level) {
  if (!group.milestones || !Array.isArray(group.milestones)) return [];
  return group.milestones
    .filter(m => m.level <= level)
    .sort((a, b) => a.level - b.level);
}

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

// --- Roll Hook Handlers (dnd5e 5.x signatures) ---

/**
 * dnd5e.preRollAttack — new signature: (config, dialogConfig, messageConfig)
 * config.subject is the Activity, config.rolls contains roll configurations
 */
export function handlePreAttack(config, dialogConfig, messageConfig) {
  const activity = config.subject;
  const item = activity?.item;
  const actor = item?.actor;
  if (!actor || actor.type !== "character") return;
  if (!activityIsAttack(activity)) return;

  const result = findGroupForItem(item);
  if (!result) return;

  const level = getGroupLevel(actor, result.groupId);
  const bonus = getToHitBonus(level);
  if (bonus <= 0) return;

  // preRollAttack fires before _buildAttackConfig populates parts/data — initialize
  // parts ourselves so our bonus is preserved when the attack parts are appended later.
  if (!config.rolls?.length) return;
  for (const roll of config.rolls) {
    roll.parts ??= [];
    roll.data ??= {};
    roll.parts.push("@spireBonus");
    roll.data.spireBonus = bonus;
  }
}

/**
 * dnd5e.preRollDamage — new signature: (config, dialogConfig, messageConfig)
 */
export function handlePreDamage(config, dialogConfig, messageConfig) {
  const activity = config.subject;
  const item = activity?.item;
  const actor = item?.actor;
  if (!actor || actor.type !== "character") return;

  const result = findGroupForItem(item);
  if (!result) return;

  const multiplier = getExtraDiceMultiplier(getGroupLevel(actor, result.groupId));
  if (multiplier <= 0) return;
  if (!config.rolls?.length) return;

  // Add extra dice scaled to each roll's own base die, read from the formula that will
  // actually be rolled — so an Unarmed Strike gets its bonus dice like any other attack.
  for (const roll of config.rolls) {
    const base = baseDieFromRolls([roll]);
    if (!base) continue;
    roll.parts ??= [];
    roll.parts.push(`${multiplier * base.count}d${base.size}`);
  }
}

/**
 * dnd5e.rollDamage — new signature: (rolls, data)
 * rolls: DamageRoll[], data.subject: Activity
 */
export function handleDamageRoll(rolls, data) {
  const activity = data?.subject;
  const item = activity?.item;
  const actor = item?.actor;
  if (!actor || actor.type !== "character") return;

  const result = findGroupForItem(item);
  if (!result) return;

  const ddn = result.group.ddn ?? 0;
  if (ddn <= 0) return;

  // Sum the dice actually rolled (excluding flat modifiers like ability mod). Available for
  // unarmed strikes exactly like any other attack.
  let diceSum = 0;
  for (const roll of (Array.isArray(rolls) ? rolls : [rolls]).filter(Boolean)) {
    for (const die of roll.dice ?? []) diceSum += die.total ?? 0;
  }
  if (diceSum <= 0) return;

  // XP = dice rolled, normalised by the weapon's base die so a d12 weapon doesn't grind
  // faster than a d4, then scaled by the group's DDN.
  const base = getActivityBaseDie(activity);
  const bd = base ? base.count * base.size : 0;
  if (bd <= 0) return;

  const xpGain = Math.round(ddn * diceSum / bd);
  if (xpGain <= 0) return;

  const currentXp = actor.getFlag(MODULE_ID, "groupXp")?.[result.groupId] ?? 0;
  const newXp = currentXp + xpGain;
  const oldLevel = levelFromXp(currentXp, ddn);
  const newLevel = levelFromXp(newXp, ddn);
  actor.setFlag(MODULE_ID, `groupXp.${result.groupId}`, newXp);

  if (newLevel > oldLevel) {
    ChatMessage.create({
      content: `<div class="spire-levelup">Congratulations <strong>${actor.name}</strong>! You have reached level <strong>${newLevel}</strong> in <strong>${result.group.name}</strong></div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  }
}

// --- Activity Use Hook (milestones + scaling display in chat) ---

/**
 * dnd5e.postUseActivity — replaces dnd5e.useItem
 * (activity, usageConfig, results)
 */
export function handleActivityUse(activity, usageConfig, results) {
  const item = activity?.item;
  const actor = item?.actor;
  if (!actor || actor.type !== "character") return;

  const base = getActivityBaseDie(activity);

  // Only react to activities that attack or deal damage — not utility items, features, etc.
  if (!activityIsAttack(activity) && !activityIsSave(activity) && !base) return;

  const result = findGroupForItem(item);
  if (!result) {
    ChatMessage.create({
      content: `<div class="spire-item-scaling">No weapon group found</div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: [],
      flags: { [MODULE_ID]: { type: "scaling-info" } },
    });
    return;
  }

  const { group } = result;
  const level = getGroupLevel(actor, result.groupId);
  const scaling = getGroupScaling(group);
  const milestones = getUnlockedMilestones(group, level);
  const scalingLines = [];

  // Bonuses for THIS activity (mirror what handlePreAttack / handlePreDamage apply).
  if (activityIsAttack(activity)) {
    const toHit = getToHitBonus(level);
    if (toHit > 0) scalingLines.push(`To Hit: +${toHit}`);
  }
  if (base) {
    const diceMult = getExtraDiceMultiplier(level);
    if (diceMult > 0) scalingLines.push(`Damage: +${diceMult * base.count}d${base.size}`);
  }
  if (activityHasRange(activity) && scaling.range > 0) {
    scalingLines.push(`Range: +${scaling.range * level}ft`);
  }
  if (activityHasDuration(activity) && scaling.duration > 0) {
    scalingLines.push(`Duration: x${1 + scaling.duration * level}`);
  }
  if (scaling.targets > 0) {
    scalingLines.push(`Extra Targets: +${scaling.targets * level}`);
  }
  if (activityHasArea(activity) && scaling.area > 0) {
    scalingLines.push(`Area: +${scaling.area * level}ft`);
  }
  if (activityIsSave(activity)) {
    const dcBonus = getSpellSaveDcBonus(level);
    if (dcBonus > 0) scalingLines.push(`Save DC: +${dcBonus}`);
  }

  // Always post the group's current info, even with no bonuses yet.
  const parts = [`<div class="spire-item-scaling">`];
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

export function renderWeaponGroupsSection(app, element) {
  const actor = app.actor;
  const groups = getGroups();
  const groupEntries = Object.entries(groups);

  if (groupEntries.length === 0) return;

  const groupXp = actor.getFlag(MODULE_ID, "groupXp") ?? {};
  const isGM = game.user.isGM;

  // Find or create the spire tab content area
  const spireTab = element.querySelector('.tab.spire, [data-tab="spire"]');
  if (!spireTab) return;

  const section = document.createElement("section");
  section.className = "spire-weapon-groups";

  const h3 = document.createElement("h3");
  h3.textContent = "Weapon Groups";
  section.appendChild(h3);

  for (const [groupId, group] of groupEntries) {
    const xp = groupXp[groupId] ?? 0;
    const level = levelFromXp(xp, group.ddn ?? 0);
    const toHit = getToHitBonus(level);
    const extraDice = getExtraDiceMultiplier(level);
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

    const xpLabel = document.createElement("span");
    xpLabel.className = "group-xp-label";
    xpLabel.textContent = "XP";
    mainRow.appendChild(xpLabel);

    groupDiv.appendChild(mainRow);

    // Detail row
    const detailRow = document.createElement("div");
    detailRow.className = "group-row-detail";

    const scalingParts = [];
    if (toHit > 0) scalingParts.push(`+${toHit} hit`);
    if (extraDice > 0) scalingParts.push(`+${extraDice} dice`);
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
