// Spire Levels — parallel leveling and stat allocation system

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
    cha: { label: "Barter", value: `${getBonus(bases.cha ?? 0)}%` },
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

  // STR: +5ft movement per 5 points — movement.walk is a base value prepareDerivedData adds to
  const moveBonus = getBonus(bases.str ?? 0) * 5;
  if (moveBonus > 0 && attrs.movement) {
    attrs.movement.walk = (Number(attrs.movement.walk) || 0) + moveBonus;
  }
}

// Called AFTER origPrepare — AC and HP max are fully recomputed by prepareDerivedData,
// so we must add on top of the finished values rather than trying to pre-set them.
function applySpirePostBonuses(actor) {
  if (actor.type !== "character") return;

  const bases = actor.getFlag(MODULE_ID, "bases");
  if (!bases) return;

  const attrs = actor.system.attributes;

  // DEX: +1 AC per 5 points
  const acBonus = getBonus(bases.dex ?? 0);
  if (acBonus > 0 && attrs.ac) {
    attrs.ac.value = (attrs.ac.value ?? 0) + acBonus;
  }

  // CON: +1 max HP per 1 point
  const hpBonus = bases.con ?? 0;
  if (hpBonus > 0 && attrs.hp) {
    attrs.hp.max = (attrs.hp.max ?? 0) + hpBonus;
    attrs.hp.effectiveMax = Math.max(attrs.hp.max + (attrs.hp.tempmax ?? 0), 0);
  }
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

// --- Rest Handling ---

export async function handleRestCompleted(actor, result) {
  if (!result?.longRest) return;
  if (actor?.type !== "character") return;
  const hp = actor.system.attributes?.hp;
  if (!hp || hp.max == null) return;
  if (hp.value >= hp.max) return;
  await actor.update({ "system.attributes.hp.value": hp.max });
}

// --- Exports ---

export function initSpireLevels() {
  const ActorClass = CONFIG.Actor.documentClass;

  const origBase = ActorClass.prototype.prepareBaseData;
  ActorClass.prototype.prepareBaseData = function () {
    origBase.call(this);
    applySpirePreBonuses(this);
  };

  const origDerived = ActorClass.prototype.prepareDerivedData;
  ActorClass.prototype.prepareDerivedData = function () {
    origDerived.call(this);
    applySpirePostBonuses(this);
  };
}

export function renderSpireLevelTab(app, element) {
  const actor = app.actor;

  // Find the tab navigation — dnd5e 5.x renders a <nav class="tabs" data-group="primary"> via sidebar-tabs.hbs
  const tabNav = element.querySelector('nav.tabs[data-group="primary"]')
    ?? element.querySelector(".tabs-right .tab-list")
    ?? element.querySelector('[role="tablist"]')
    ?? element.querySelector(".sheet-tabs");

  if (!tabNav) {
    console.warn("The Spire | Could not find tab navigation in character sheet");
    return;
  }

  // Only skip if our nav button is already present.
  // A partial re-render can remove the nav button while leaving the panel behind —
  // in that case we fall through, clean up the orphaned panel, and re-inject both.
  if (tabNav.querySelector('[data-tab="spire"]')) return;
  element.querySelector('.tab[data-tab="spire"]')?.remove();

  // Add tab button — match dnd5e 5.x's <a class="item control" data-action="tab"> pattern
  const tabButton = document.createElement("a");
  tabButton.className = "item control";
  tabButton.dataset.action = "tab";
  tabButton.dataset.tab = "spire";
  tabButton.dataset.group = "primary";

  const tabIcon = document.createElement("i");
  tabIcon.className = "fa-solid fa-tower-observation";
  tabButton.appendChild(tabIcon);
  tabNav.appendChild(tabButton);

  // Find the tab content container
  const tabBody = element.querySelector("#tabs")
    ?? element.querySelector(".tab-body")
    ?? element.querySelector(".sheet-body");

  if (!tabBody) {
    console.warn("The Spire | Could not find tab body container");
    return;
  }

  // Create the spire tab content
  const tabContent = document.createElement("div");
  tabContent.className = "tab spire";
  tabContent.dataset.group = "primary";
  tabContent.dataset.tab = "spire";
  tabContent.setAttribute("role", "tabpanel");
  tabContent.appendChild(buildSpireLevelContent(actor));
  tabBody.appendChild(tabContent);

  // Restore active state if this tab was active before the re-render
  if (app.tabGroups?.primary === "spire") {
    tabButton.classList.add("active");
    tabContent.classList.add("active");
  }

  // Tab switching is handled by data-action="tab" — Foundry's changeTab toggles .active on nav + panels

  // Wire up interactive buttons (owner only), rebuilding content after each change
  if (!actor.isOwner) return;
  wireSpireButtons(actor, tabContent);
}

function wireSpireButtons(actor, tabContent) {
  function refresh() {
    tabContent.replaceChildren(buildSpireLevelContent(actor));
    wireSpireButtons(actor, tabContent);
  }

  tabContent.querySelector(".spire-level-down")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "spireLevel") ?? 0;
    if (current <= 0) return;
    await actor.setFlag(MODULE_ID, "spireLevel", current - 1);
    refresh();
  });

  tabContent.querySelector(".spire-level-up")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "spireLevel") ?? 0;
    await actor.setFlag(MODULE_ID, "spireLevel", current + 1);
    refresh();
  });

  tabContent.querySelectorAll(".spire-stat-plus").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { spireLevel, bases } = getSpireData(actor);
      const allocated = Object.values(bases).reduce((sum, v) => sum + v, 0);
      if (allocated >= spireLevel) return;
      const ability = btn.closest(".spire-stat").dataset.ability;
      const current = bases[ability] ?? 0;
      await actor.setFlag(MODULE_ID, `bases.${ability}`, current + 1);
      refresh();
    });
  });

  tabContent.querySelectorAll(".spire-stat-minus").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ability = btn.closest(".spire-stat").dataset.ability;
      const bases = actor.getFlag(MODULE_ID, "bases") ?? {};
      const current = bases[ability] ?? 0;
      if (current <= 0) return;
      await actor.setFlag(MODULE_ID, `bases.${ability}`, current - 1);
      refresh();
    });
  });
}
