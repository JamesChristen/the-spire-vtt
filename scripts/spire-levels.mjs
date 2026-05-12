// Spire Levels — parallel leveling and stat allocation system

const MODULE_ID = "the-spire";
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

// Track which sheet had the spire tab active so we can restore it after re-render
const _activeSpireSheets = new Set();

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
    cha: { label: "Barter", value: `${getBonus(bases.cha ?? 0)}%` },
  };
}

// --- Stat Modifications ---

function applySpireStatBonuses(actor) {
  if (actor.type !== "character") return;

  const bases = actor.getFlag(MODULE_ID, "bases");
  if (!bases) return;

  const abilities = actor.system.abilities;
  const attrs = actor.system.attributes;

  // Modify base ability scores — cascades to modifiers, saves, skills
  for (const ability of ABILITIES) {
    const scoreBonus = getBonus(bases[ability] ?? 0);
    if (scoreBonus > 0 && abilities[ability]) {
      abilities[ability].value = (abilities[ability].value ?? 0) + scoreBonus;
    }
  }

  // STR: +5ft movement per 5 points
  const moveBonus = getBonus(bases.str ?? 0) * 5;
  if (moveBonus > 0 && attrs.movement) {
    attrs.movement.walk = (attrs.movement.walk ?? 0) + moveBonus;
  }

  // DEX: +1 AC per 5 points
  const acBonus = getBonus(bases.dex ?? 0);
  if (acBonus > 0 && attrs.ac) {
    attrs.ac.bonus = (attrs.ac.bonus ?? 0) + acBonus;
  }

  // CON: +1 max HP per 1 point
  const hpBonus = bases.con ?? 0;
  if (hpBonus > 0 && attrs.hp) {
    attrs.hp.max = (attrs.hp.max ?? 0) + hpBonus;
  }
}

// --- Tab Rendering ---

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

function buildSpireLevelContent(actor) {
  const { spireLevel, bases, unallocated } = getSpireData(actor);
  const isOwner = actor.isOwner;
  const perks = getSpirePerks(bases);
  const originalScores = getUnmodifiedScores(actor);

  const statRows = ABILITIES.map(ability => {
    const value = bases[ability] ?? 0;
    const bonus = getBonus(value);
    const perk = perks[ability];
    const original = originalScores[ability];
    const minusDisabled = !isOwner || value <= 0 ? "disabled" : "";
    const plusDisabled = !isOwner || unallocated <= 0 ? "disabled" : "";

    return `
      <div class="spire-stat" data-ability="${ability}">
        <span class="spire-stat-label">${ABILITY_LABELS[ability]}</span>
        <span class="spire-stat-original" title="Base score without Spire">${original}</span>
        <button class="spire-stat-minus" ${minusDisabled} title="Remove point">-</button>
        <span class="spire-stat-value">${value}</span>
        <button class="spire-stat-plus" ${plusDisabled} title="Add point">+</button>
        <span class="spire-stat-bonus">(${formatBonus(bonus)})</span>
        <span class="spire-stat-perk">${perk.label}: ${perk.value}</span>
      </div>`;
  }).join("");

  const levelUpButton = isOwner
    ? `<button class="spire-level-up" title="Gain 1 Spire Level">+1</button>`
    : "";

  return `
    <section class="spire-header">
      <div class="spire-level">
        <h3>Spire Level: <span class="spire-level-value">${spireLevel}</span></h3>
        ${levelUpButton}
      </div>
      <div class="spire-points">
        <span>Unallocated Points: <strong class="spire-unallocated">${unallocated}</strong></span>
      </div>
    </section>
    <section class="spire-stats">
      ${statRows}
    </section>`;
}

// --- Exports ---

export function initSpireLevels() {
  const ActorClass = CONFIG.Actor.documentClass;
  const origPrepare = ActorClass.prototype.prepareDerivedData;
  ActorClass.prototype.prepareDerivedData = function () {
    origPrepare.call(this);
    applySpireStatBonuses(this);
  };
}

export function renderSpireLevelTab(app, html) {
  const actor = app.actor;

  // Inject tab nav item
  const tabs = html.find('.tabs[data-group="primary"]');
  tabs.append(`<a class="item" data-tab="spire"><i class="fa-solid fa-tower-observation"></i> Spire</a>`);

  // Inject tab with spire-level content (weapon groups section appended separately)
  const tabDiv = $(`<div class="tab spire" data-group="primary" data-tab="spire"></div>`);
  tabDiv.append(buildSpireLevelContent(actor));
  html.find(".sheet-body").append(tabDiv);

  // Restore tab selection if it was active before re-render
  if (_activeSpireSheets.has(app.appId)) {
    app._tabs[0]?.activate("spire");
  }

  // Track tab selection
  html.find('.tabs[data-group="primary"] .item').on("click", (event) => {
    const tab = event.currentTarget.dataset.tab;
    if (tab === "spire") {
      _activeSpireSheets.add(app.appId);
    } else {
      _activeSpireSheets.delete(app.appId);
    }
  });

  // Event handlers (owner only)
  if (!actor.isOwner) return;

  html.find(".spire-level-up").on("click", async () => {
    const current = actor.getFlag(MODULE_ID, "spireLevel") ?? 0;
    await actor.setFlag(MODULE_ID, "spireLevel", current + 1);
  });

  html.find(".spire-stat-plus").on("click", async (event) => {
    const { spireLevel, bases } = getSpireData(actor);
    const allocated = Object.values(bases).reduce((sum, v) => sum + v, 0);
    if (allocated >= spireLevel) return;
    const ability = $(event.currentTarget).closest(".spire-stat").data("ability");
    const current = bases[ability] ?? 0;
    await actor.setFlag(MODULE_ID, `bases.${ability}`, current + 1);
  });

  html.find(".spire-stat-minus").on("click", async (event) => {
    const ability = $(event.currentTarget).closest(".spire-stat").data("ability");
    const bases = actor.getFlag(MODULE_ID, "bases") ?? {};
    const current = bases[ability] ?? 0;
    if (current <= 0) return;
    await actor.setFlag(MODULE_ID, `bases.${ability}`, current - 1);
  });
}

// Clean up tracking when sheet is closed
Hooks.on("closeActorSheet", (app) => {
  _activeSpireSheets.delete(app.appId);
});
