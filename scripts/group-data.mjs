// Weapon/Spell Group data helpers — group lookup, levels, bonuses, dice parsing.
// Shared by weapon-groups (rolls, chat, sheet), group-scaling (activity data) and group-xp.

export const MODULE_ID = "the-spire";

// Default scaling rates per level (GM can override per group)
const DEFAULT_SCALING = {
  range: 0,
  duration: 0,
  targets: 0,
  area: 0,
};

// --- Groups ---

export function getGroups() {
  return game.settings.get(MODULE_ID, "weaponGroups");
}

export function findGroupForItem(item) {
  if (!item?.name) return null;
  const name = item.name.toLowerCase();
  for (const [groupId, group] of Object.entries(getGroups())) {
    const match = group.items?.find(i => i.name.toLowerCase() === name && i.type === item.type);
    if (match) return { groupId, group };
  }
  return null;
}

// Group + level for the character that owns this activity's item, or null.
export function getActivityGroup(activity) {
  const item = activity?.item;
  const actor = item?.actor;
  if (actor?.type !== "character") return null;
  const result = findGroupForItem(item);
  if (!result) return null;
  return { ...result, actor, level: getGroupLevel(actor, result.groupId) };
}

export function getGroupScaling(group) {
  return { ...DEFAULT_SCALING, ...(group.scaling ?? {}) };
}

export function getUnlockedMilestones(group, level) {
  if (!group.milestones || !Array.isArray(group.milestones)) return [];
  return group.milestones
    .filter(m => m.level <= level)
    .sort((a, b) => a.level - b.level);
}

// --- Levels ---

// Incremental XP cost to advance from `level` to `level + 1`, given the group's DDN.
function levelUpCost(level, ddn) {
  return Math.ceil(ddn * Math.pow(level + 1, 1 + 0.1 * level));
}

// Resolve current level from total XP by walking incremental costs.
// ddn <= 0 means the group is unconfigured — stays at level 0.
export function levelFromXp(xp, ddn) {
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

export function getGroupXp(actor, groupId) {
  return actor.getFlag(MODULE_ID, "groupXp")?.[groupId] ?? 0;
}

export function getGroupLevel(actor, groupId) {
  return levelFromXp(getGroupXp(actor, groupId), getGroups()[groupId]?.ddn ?? 0);
}

// --- Bonuses ---

export function getToHitBonus(level) {
  return Math.max(0, level - 1);
}

export function getSpellSaveDcBonus(level) {
  return Math.max(0, Math.floor((level - 1) / 2));
}

// Flat damage bonus: half the base damage's expected dice total (each rounded down), per level.
// e.g. longsword 1d8 → 4.5 → 4 → 2, so +2 at Lv 1, +4 at Lv 2.
export function getFlatDamageBonus(baseDice, level) {
  if (level <= 0) return 0;
  return Math.floor(Math.floor(expectedDice(baseDice)) / 2) * level;
}

// --- Dice ---

// Dice terms in a formula string, e.g. "2d6 + 1d4 + @mod" → [{count:2,size:6},{count:1,size:4}]
export function parseDice(formula) {
  return [...String(formula ?? "").matchAll(/(\d*)d(\d+)/g)]
    .map(m => ({ count: parseInt(m[1] || "1"), size: parseInt(m[2]) }));
}

export function expectedDice(dice) {
  return dice.reduce((sum, d) => sum + d.count * (d.size + 1) / 2, 0);
}

export function maxDice(dice) {
  return dice.reduce((sum, d) => sum + d.count * d.size, 0);
}

// The base damage roll among a set of damage roll configs. Weapon attacks flag it with
// `base: true`; spells and other activities don't, so fall back to the first part with dice.
export function findBaseRoll(rolls) {
  return rolls?.find(r => r.base) ?? rolls?.find(r => parseDice(r.parts?.[0]).length) ?? null;
}

// Dice in a roll config's base formula. parts[0] is the resolved scaled formula (e.g. "1d8"),
// which already includes dice injected at roll time (Monk Martial Arts, cantrip scaling).
export function baseRollDice(roll) {
  return parseDice(roll?.parts?.[0]);
}

// Base damage dice of an activity, resolved without rolling (no hooks fire).
export function getActivityBaseDice(activity) {
  try {
    return baseRollDice(findBaseRoll(activity?.getDamageConfig?.({})?.rolls));
  } catch (err) {
    console.warn("The Spire | Could not read damage config", err);
    return [];
  }
}

export function formatDice(dice) {
  return dice.map(d => `${d.count}d${d.size}`).join(" + ");
}
