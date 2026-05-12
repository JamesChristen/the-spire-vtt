// Weapon/Spell Group Scaling — XP tracking, roll bonuses, spell params, milestones

import { WeaponGroupConfig } from "./WeaponGroupConfig.mjs";

const MODULE_ID = "the-spire";

// Default scaling rates per level (GM can override per group)
const DEFAULT_SCALING = {
  range: 0,      // ft per level
  duration: 0,   // multiplier per level (0 = disabled)
  targets: 0,    // extra targets per level
  area: 0,       // ft per level
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

function getGroupLevel(actor, groupId) {
  const xp = actor.getFlag(MODULE_ID, "groupXp")?.[groupId] ?? 0;
  return Math.floor(xp / 10);
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

function getBaseDice(item) {
  const formula = item.system?.damage?.parts?.[0]?.[0] ?? "";
  const match = formula.match(/(\d+)d(\d+)/);
  if (!match) return null;
  return { count: parseInt(match[1]), size: parseInt(match[2]), full: match[0] };
}

// Check what capabilities an item has
function itemHasAttack(item) {
  return !!item.system?.actionType && ["mwak", "rwak", "msak", "rsak"].includes(item.system.actionType);
}

function itemHasDamage(item) {
  return item.system?.damage?.parts?.length > 0;
}

function itemHasSave(item) {
  return !!item.system?.save?.ability;
}

function itemHasRange(item) {
  return (item.system?.range?.value ?? 0) > 0 || (item.system?.range?.long ?? 0) > 0;
}

function itemHasDuration(item) {
  return !!item.system?.duration?.value;
}

function itemHasArea(item) {
  return (item.system?.target?.value ?? 0) > 0 && !!item.system?.target?.type;
}

// Get scaling params for a group (merge defaults with GM overrides)
function getGroupScaling(group) {
  return { ...DEFAULT_SCALING, ...(group.scaling ?? {}) };
}

// Get milestones unlocked at or below the given level
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

// --- Roll Hook Handlers ---

export function handlePreAttack(item, config) {
  const actor = item.actor;
  if (!actor || actor.type !== "character") return;
  if (!itemHasAttack(item)) return;

  const result = findGroupForItem(item);
  if (!result) return;

  const level = getGroupLevel(actor, result.groupId);
  const bonus = getToHitBonus(level);
  if (bonus <= 0) return;

  if (Array.isArray(config.parts)) {
    config.parts.push(bonus.toString());
  } else if (config.bonus !== undefined) {
    config.bonus = config.bonus ? `${config.bonus} + ${bonus}` : bonus.toString();
  } else {
    config.bonus = bonus.toString();
  }
}

export function handlePreDamage(item, config) {
  const actor = item.actor;
  if (!actor || actor.type !== "character") return;
  if (!itemHasDamage(item)) return;

  const result = findGroupForItem(item);
  if (!result) return;

  const level = getGroupLevel(actor, result.groupId);
  const multiplier = getExtraDiceMultiplier(level);
  if (multiplier <= 0) return;

  const baseDice = getBaseDice(item);
  if (!baseDice) return;

  const extraDice = `${multiplier * baseDice.count}d${baseDice.size}`;

  if (Array.isArray(config.parts)) {
    const damageType = item.system?.damage?.parts?.[0]?.[1] ?? "";
    config.parts.push([extraDice, damageType]);
  }
}

export function handleDamageRoll(item, roll) {
  const actor = item.actor;
  if (!actor || actor.type !== "character") return;
  if (!itemHasDamage(item)) return;

  const result = findGroupForItem(item);
  if (!result) return;

  const damage = roll.total ?? 0;
  if (damage <= 0) return;

  const currentXp = actor.getFlag(MODULE_ID, "groupXp")?.[result.groupId] ?? 0;
  actor.setFlag(MODULE_ID, `groupXp.${result.groupId}`, currentXp + damage);
}

// --- Item Use Hook (milestones + scaling display in chat) ---

export function handleItemUse(item) {
  const actor = item.actor;
  if (!actor || actor.type !== "character") return;

  const result = findGroupForItem(item);
  if (!result) return;

  const level = getGroupLevel(actor, result.groupId);
  if (level <= 0) return;

  const { group } = result;
  const scaling = getGroupScaling(group);
  const milestones = getUnlockedMilestones(group, level);
  const scalingLines = [];

  // Only show scaling for properties the item actually has
  if (itemHasRange(item) && scaling.range > 0) {
    scalingLines.push(`Range: +${scaling.range * level}ft`);
  }
  if (itemHasDuration(item) && scaling.duration > 0) {
    scalingLines.push(`Duration: x${1 + scaling.duration * level}`);
  }
  if (scaling.targets > 0) {
    scalingLines.push(`Extra Targets: +${scaling.targets * level}`);
  }
  if (itemHasArea(item) && scaling.area > 0) {
    scalingLines.push(`Area: +${scaling.area * level}ft`);
  }
  if (itemHasSave(item)) {
    const dcBonus = getSpellSaveDcBonus(level);
    if (dcBonus > 0) {
      scalingLines.push(`Save DC: +${dcBonus}`);
    }
  }

  // Nothing to display
  if (scalingLines.length === 0 && milestones.length === 0) return;

  // Build chat message content
  let content = `<div class="spire-item-scaling">`;
  content += `<strong>${group.name}</strong> (Lv ${level})`;

  if (scalingLines.length > 0) {
    content += `<div class="spire-scaling-bonuses">${scalingLines.join(" | ")}</div>`;
  }

  if (milestones.length > 0) {
    content += `<ul class="spire-milestones">`;
    for (const m of milestones) {
      content += `<li><strong>Lv ${m.level}:</strong> ${m.text}</li>`;
    }
    content += `</ul>`;
  }

  content += `</div>`;

  // Post as a chat message
  ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: [], // visible to all
    flags: { [MODULE_ID]: { type: "scaling-info" } },
  });
}

// --- Character Sheet Display ---

export function renderWeaponGroupsSection(app, html) {
  const actor = app.actor;
  const groups = getGroups();
  const groupEntries = Object.entries(groups);

  // Don't render if no groups defined
  if (groupEntries.length === 0) return;

  const groupXp = actor.getFlag(MODULE_ID, "groupXp") ?? {};
  const isGM = game.user.isGM;

  const groupRows = groupEntries.map(([groupId, group]) => {
    const xp = groupXp[groupId] ?? 0;
    const level = Math.floor(xp / 10);
    const toHit = getToHitBonus(level);
    const extraDice = getExtraDiceMultiplier(level);
    const spellDc = getSpellSaveDcBonus(level);
    const scaling = getGroupScaling(group);
    const milestones = getUnlockedMilestones(group, level);
    const itemList = group.items?.map(i => i.name).join(", ") || "No items";

    const xpField = isGM
      ? `<input type="number" class="group-xp-input" data-group-id="${groupId}" value="${xp}" min="0" title="Adjust XP">`
      : `<span class="group-xp-value">${xp}</span>`;

    // Build scaling summary
    const scalingParts = [];
    if (toHit > 0) scalingParts.push(`+${toHit} hit`);
    if (extraDice > 0) scalingParts.push(`+${extraDice} dice`);
    if (spellDc > 0) scalingParts.push(`+${spellDc} DC`);
    if (scaling.range > 0) scalingParts.push(`+${scaling.range * level}ft range`);
    if (scaling.area > 0) scalingParts.push(`+${scaling.area * level}ft area`);
    if (scaling.targets > 0) scalingParts.push(`+${scaling.targets * level} targets`);
    if (scaling.duration > 0) scalingParts.push(`x${1 + scaling.duration * level} duration`);

    const bonusesText = scalingParts.length > 0 ? scalingParts.join(" | ") : "No bonuses yet";

    // Milestones display
    let milestonesHtml = "";
    if (milestones.length > 0) {
      milestonesHtml = `<ul class="group-milestones">` +
        milestones.map(m => `<li><strong>Lv ${m.level}:</strong> ${m.text}</li>`).join("") +
        `</ul>`;
    }

    return `
      <div class="spire-weapon-group" data-group-id="${groupId}">
        <div class="group-row-main">
          <span class="group-name">${group.name}</span>
          <span class="group-level">Lv ${level}</span>
          ${xpField}
          <span class="group-xp-label">XP</span>
        </div>
        <div class="group-row-detail">
          <span class="group-bonuses">${bonusesText}</span>
          <span class="group-items" title="${itemList}">${itemList}</span>
        </div>
        ${milestonesHtml}
      </div>`;
  }).join("");

  const section = $(`
    <section class="spire-weapon-groups">
      <h3>Weapon Groups</h3>
      ${groupRows}
    </section>`);

  // Append to the spire tab
  html.find(".tab.spire").append(section);

  // GM manual XP adjustment
  if (isGM) {
    html.find(".group-xp-input").on("change", async (event) => {
      const groupId = $(event.currentTarget).data("group-id");
      const newXp = Math.max(0, parseInt(event.currentTarget.value) || 0);
      await actor.setFlag(MODULE_ID, `groupXp.${groupId}`, newXp);
    });
  }
}
