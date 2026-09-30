// Spire Levels — parallel leveling and stat allocation system

import { getSheetTabPanel } from "./sheet-tabs.mjs";

const MODULE_ID = "the-spire";
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

// --- Helpers ---

function getSpireData(actor) {
  const spireLevel = actor.getFlag(MODULE_ID, "spireLevel") ?? 0;
  const bases = actor.getFlag(MODULE_ID, "bases") ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  const allocated = Object.values(bases).reduce((sum, v) => sum + v, 0);
  return { spireLevel, bases, allocated, unallocated: spireLevel - allocated };
}

function getBonus(base) {
  return Math.floor(base / 5);
}

function formatBonus(bonus) {
  return bonus > 0 ? `+${bonus}` : "0";
}

function getSpirePerks(bases) {
  return {
    str: { label: "Movement", value: `+${getBonus(bases.str ?? 0) * 5}ft` },
    dex: { label: "AC", value: `+${getBonus(bases.dex ?? 0)}` },
    con: { label: "Max HP", value: `+${bases.con ?? 0}` },
    int: { label: "Prof/Expertise", value: getBonus(bases.int ?? 0) },
    wis: { label: "Exam Tips", value: getBonus(bases.wis ?? 0) },
    cha: { label: "Barter", value: `${bases.cha ?? 0}%` },
  };
}

// --- Stat Modifications ---

// Called from a prepareBaseData wrapper so values land before system.prepareDerivedData()
// runs prepareAbilities (which computes .mod from .value). Hooking prepareDerivedData was
// too late — Foundry runs system.prepareDerivedData *before* Actor.prepareDerivedData.
function applySpirePreBonuses(actor) {
  if (actor.type !== "character") return;

  const bases = actor.getFlag(MODULE_ID, "bases");
  if (!bases) return;

  const abilities = actor.system.abilities;
  const attrs = actor.system.attributes;

  // Ability scores — cascade to modifiers, saves, skills
  for (const ability of ABILITIES) {
    const scoreBonus = getBonus(bases[ability] ?? 0);
    if (scoreBonus > 0 && abilities[ability]) {
      abilities[ability].value = (abilities[ability].value ?? 0) + scoreBonus;
    }
  }

  // DEX: +1 AC per 5 points. ac.bonus is a non-persisted formula that dnd5e 6.x initialises
  // fresh each prepare and folds into ac.value in prepareArmorClass (so it respects AC overrides).
  const acBonus = getBonus(bases.dex ?? 0);
  if (acBonus > 0 && attrs.ac) appendFormula(attrs.ac, "bonus", acBonus);

  // CON: +1 max HP per 1 point. Inject via dnd5e's own hp.bonuses.overall formula so the
  // bonus is folded into hp.max during prepareHitPoints (step 4) BEFORE it clamps
  // hp.value to effectiveMax. Adding to hp.max in prepareDerivedData (step 5) is too
  // late — the clamp has already pinned displayed HP to the base max.
  const hpBonus = bases.con ?? 0;
  if (hpBonus > 0 && attrs.hp?.bonuses) appendFormula(attrs.hp.bonuses, "overall", hpBonus);
}

// Called from a system.prepareDerivedData wrapper, just before dnd5e's prepareMovement. It can't
// go in the base step: species speed is applied during embedded prep and only fills speeds that
// are still empty, so a base-step bonus would replace a species' 30ft walk with just the bonus.
function applySpireMovementBonus(actor) {
  if (actor.type !== "character") return;

  // STR: +5ft walking speed per 5 points
  const moveBonus = getBonus(actor.getFlag(MODULE_ID, "bases")?.str ?? 0) * 5;
  const speeds = actor.system.attributes.movement?.speeds;
  if (moveBonus > 0 && speeds) appendFormula(speeds, "walk", moveBonus);
}

// Add a flat bonus to a dnd5e formula-string field, preserving whatever is already there.
function appendFormula(obj, key, bonus) {
  const current = obj[key];
  obj[key] = current ? `${current} + ${bonus}` : String(bonus);
}

// --- Tab Rendering (native DOM — no jQuery) ---
// Note: innerHTML usage below is safe — all interpolated values are module-controlled
// (ability labels, numeric values). No user-supplied content is injected.

function getUnmodifiedScores(actor) {
  const bases = actor.getFlag(MODULE_ID, "bases") ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  const scores = {};
  for (const ability of ABILITIES) {
    const current = actor.system.abilities[ability]?.value ?? 10;
    const spireBonus = getBonus(bases[ability] ?? 0);
    scores[ability] = current - spireBonus;
  }
  return scores;
}

function buildStatRow(ability, bases, unallocated, perks, originalScores, isOwner) {
  const value = bases[ability] ?? 0;
  const bonus = getBonus(value);
  const perk = perks[ability];
  const original = originalScores[ability];
  const minusDisabled = !isOwner || value <= 0;
  const plusHidden = unallocated < 0;
  const plusDisabled = !isOwner || unallocated <= 0;

  const row = document.createElement("div");
  row.className = "spire-stat";
  row.dataset.ability = ability;

  const label = document.createElement("span");
  label.className = "spire-stat-label";
  label.textContent = ABILITY_LABELS[ability];

  const orig = document.createElement("span");
  orig.className = "spire-stat-original";
  orig.title = "Base score without Spire";
  orig.textContent = String(original);

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "spire-stat-minus";
  minusBtn.title = "Remove point";
  minusBtn.textContent = "-";
  if (minusDisabled) minusBtn.disabled = true;


  const valSpan = document.createElement("span");
  valSpan.className = "spire-stat-value";
  valSpan.textContent = String(value);

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "spire-stat-plus";
  plusBtn.title = "Add point";
  plusBtn.textContent = "+";
  if (plusHidden) plusBtn.style.display = "none";
  else if (plusDisabled) plusBtn.disabled = true;

  const effectSpan = document.createElement("span");
  effectSpan.className = "spire-stat-effect";
  effectSpan.textContent = `(${formatBonus(bonus)}) ${perk.label}: ${perk.value}`;

  row.append(label, orig, minusBtn, valSpan, plusBtn, effectSpan);
  return row;
}

function buildSpireLevelContent(actor) {
  const { spireLevel, bases, unallocated } = getSpireData(actor);
  const isOwner = actor.isOwner;
  const perks = getSpirePerks(bases);
  const originalScores = getUnmodifiedScores(actor);

  const container = document.createDocumentFragment();

  // Header section
  const header = document.createElement("section");
  header.className = "spire-header";

  const levelDiv = document.createElement("div");
  levelDiv.className = "spire-level";

  const h3 = document.createElement("h3");
  h3.textContent = "Spire Level: ";
  const levelValue = document.createElement("span");
  levelValue.className = "spire-level-value";
  levelValue.textContent = String(spireLevel);
  h3.appendChild(levelValue);
  levelDiv.appendChild(h3);

  if (isOwner) {
    const levelDownBtn = document.createElement("button");
    levelDownBtn.type = "button";
    levelDownBtn.className = "spire-level-down";
    levelDownBtn.title = "Lose 1 Spire Level";
    levelDownBtn.textContent = "-1";
    if (spireLevel <= 0) levelDownBtn.disabled = true;

    const levelUpBtn = document.createElement("button");
    levelUpBtn.type = "button";
    levelUpBtn.className = "spire-level-up";
    levelUpBtn.title = "Gain 1 Spire Level";
    levelUpBtn.textContent = "+1";

    levelDiv.append(levelDownBtn, levelUpBtn);
  }
  header.appendChild(levelDiv);

  const pointsDiv = document.createElement("div");
  pointsDiv.className = "spire-points";
  const pointsSpan = document.createElement("span");
  pointsSpan.textContent = "Unallocated Points: ";
  const unallocSpan = document.createElement("strong");
  unallocSpan.className = "spire-unallocated";
  unallocSpan.textContent = String(unallocated);
  pointsSpan.appendChild(unallocSpan);
  pointsDiv.appendChild(pointsSpan);
  header.appendChild(pointsDiv);
  container.appendChild(header);

  // Stat rows
  const statsSection = document.createElement("section");
  statsSection.className = "spire-stats";
  for (const ability of ABILITIES) {
    statsSection.appendChild(buildStatRow(ability, bases, unallocated, perks, originalScores, isOwner));
  }
  container.appendChild(statsSection);

  return container;
}

// --- Exports ---

export function initSpireLevels() {
  const ActorClass = CONFIG.Actor.documentClass;

  const origBase = ActorClass.prototype.prepareBaseData;
  ActorClass.prototype.prepareBaseData = function () {
    origBase.call(this);
    applySpirePreBonuses(this);
  };

  // Wrap the character data model (not the Actor): its prepareDerivedData is where dnd5e runs
  // prepareMovement, and it runs after species speed has been applied.
  const CharacterData = CONFIG.Actor.dataModels.character;
  const origSystemDerived = CharacterData.prototype.prepareDerivedData;
  CharacterData.prototype.prepareDerivedData = function () {
    applySpireMovementBonus(this.parent);
    origSystemDerived.call(this);
  };
}

// Fills the natively-registered "spire" panel. Runs on every sheet render; flag changes
// re-render the sheet, so handlers just write flags and the next render rebuilds the content.
export function renderSpireLevelTab(app, element) {
  const panel = getSheetTabPanel(element, "spire");
  if (!panel) return;

  const actor = app.actor;
  panel.replaceChildren(buildSpireLevelContent(actor));
  if (actor.isOwner) wireSpireButtons(actor, panel);
}

function wireSpireButtons(actor, panel) {
  panel.querySelector(".spire-level-down")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "spireLevel") ?? 0;
    if (current <= 0) return;
    await actor.setFlag(MODULE_ID, "spireLevel", current - 1);
  });

  panel.querySelector(".spire-level-up")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "spireLevel") ?? 0;
    await actor.setFlag(MODULE_ID, "spireLevel", current + 1);
  });

  panel.querySelectorAll(".spire-stat-plus").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { bases, unallocated } = getSpireData(actor);
      if (unallocated <= 0) return;
      const ability = btn.closest(".spire-stat").dataset.ability;
      await actor.setFlag(MODULE_ID, `bases.${ability}`, (bases[ability] ?? 0) + 1);
    });
  });

  panel.querySelectorAll(".spire-stat-minus").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { bases } = getSpireData(actor);
      const ability = btn.closest(".spire-stat").dataset.ability;
      const current = bases[ability] ?? 0;
      if (current <= 0) return;
      await actor.setFlag(MODULE_ID, `bases.${ability}`, current - 1);
    });
  });
}
