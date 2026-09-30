// Damage Labels — labelled flat terms in the damage chat card breakdown
//
// dnd5e's damage card collapses all flat terms of a damage part into a single "+N" chip, and
// only counts plain numeric terms — a modifier that resolves to a parenthetical term is left out
// of the chip (though still in the total), so "1d8 + mod + Spire" showed as "6 +8 = 17".
//
// At preRollDamage we label each flat part of the base roll (ability mod, Spire, magic, …) and
// store the list in roll.options, which is saved with the message. On render we replace the
// part's chip with one chip per label, plus an unlabelled chip for anything else (e.g. a
// situational bonus typed into the dialog), computed from the roll total so they always add up.

import { findBaseRoll } from "./group-data.mjs";

// Known roll-data references → label (ability mod is resolved per roll)
const PART_LABELS = {
  "@spireDamage": "Spire",
  "@magicalBonus": "Magic",
  "@ammoBonus": "Ammo",
};

/**
 * dnd5e.preRollDamage — (config, dialogConfig, messageConfig). Runs for every damage/healing roll.
 */
export function handleLabelDamageParts(config) {
  const base = findBaseRoll(config.rolls);
  if (!base?.parts?.length) return;

  const ability = base.data?.roll?.ability ?? config.subject?.ability;
  const abilityLabel = CONFIG.DND5E.abilities[ability]?.abbreviation?.toUpperCase() ?? "Mod";

  const constants = [];
  for (const part of base.parts.slice(1)) {
    const value = evaluateFlat(part, base.data);
    if (!value) continue;
    const label = part === "@mod" ? abilityLabel : (PART_LABELS[part] ?? "Bonus");
    constants.push({ label, value });
  }
  if (!constants.length) return;

  base.options ??= {};
  base.options.spireConstants = constants;
}

// Value of a formula part if it's deterministic (no dice), else null.
function evaluateFlat(part, data) {
  try {
    const roll = new Roll(Roll.replaceFormulaData(part, data ?? {}));
    return roll.isDeterministic ? roll.evaluateSync().total : null;
  } catch {
    return null;
  }
}

/**
 * dnd5e.renderChatMessage — (message, html); fires after dnd5e has inserted the card. Rewrites the constant chip of the base roll's
 * breakdown section on damage cards.
 */
export function handleRenderDamageLabels(message, html) {
  const rolls = message.rolls ?? [];
  const base = rolls.find(r => r.options?.spireConstants?.length);
  if (!base) return;

  const sections = html.querySelectorAll(".dice-tooltip .tooltip-part");
  if (!sections.length) return;

  // The card shows one section per damage type (aggregated) or one per roll, in order.
  const aggregate = CONFIG.DND5E.aggregateDamageDisplay;
  const types = [...new Set(rolls.map(r => r.options.type))];
  const index = aggregate ? types.indexOf(base.options.type) : rolls.indexOf(base);
  const list = sections[index]?.querySelector("ol.dice-rolls");
  if (!list) return;

  // Total flat damage in that section = roll totals minus dice, over the rolls it contains.
  const sectionRolls = aggregate ? rolls.filter(r => r.options.type === base.options.type) : [base];
  const flatTotal = sectionRolls.reduce((sum, r) =>
    sum + r.total - (r.dice ?? []).reduce((d, die) => d + (die.total ?? 0), 0), 0);

  const constants = [...base.options.spireConstants];
  const remainder = flatTotal - constants.reduce((sum, c) => sum + c.value, 0);
  if (remainder) constants.push({ label: "", value: remainder });

  list.querySelectorAll("li.constant").forEach(li => li.remove());
  for (const { label, value } of constants) {
    const li = document.createElement("li");
    li.className = "constant spire-constant";
    // Same shape as dnd5e's chip: dimmed sign span, then the magnitude
    const sign = document.createElement("span");
    sign.className = "sign";
    sign.textContent = value < 0 ? "−" : "+";
    li.append(sign, String(Math.abs(value)));
    if (label) {
      const span = document.createElement("span");
      span.className = "spire-constant-label";
      span.textContent = label;
      li.appendChild(span);
    }
    list.appendChild(li);
  }
}
