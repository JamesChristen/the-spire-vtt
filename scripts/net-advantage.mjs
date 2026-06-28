// Net Advantage — stacking advantage/disadvantage system
// Replaces the binary advantage/disadvantage with a numeric net value.
// Net +N → roll (1+N)d20 keep highest
// Net -N → roll (1+N)d20 keep lowest
// Net  0 → normal 1d20
//
// dnd5e 5.x: D20RollConfigurationDialog has 3 submit buttons (advantage/normal/disadvantage).
// We hook its render to inject a +/- net advantage control, then intercept the roll
// finalization to apply the net value instead of binary advantage.

const MODULE_ID = "the-spire";

// Pending net advantage value — set by dialog UI, consumed by roll hooks
let _pendingNetAdvantage = 0;

// --- Dialog Injection ---

/**
 * Hook the render of D20RollConfigurationDialog to inject net advantage controls.
 * The dialog is an ApplicationV2, so the render hook pattern is:
 *   renderD20RollConfigurationDialog(app, element, options)
 * If that name is wrong, we fall back to renderApplication and filter by class name.
 */
function injectNetAdvantageUI(app, element) {
  // Only target d20 roll dialogs
  const className = app.constructor.name;
  if (className !== "D20RollConfigurationDialog"
    && className !== "AttackRollConfigurationDialog") return;

  // Don't inject twice
  if (element.querySelector(".spire-net-advantage")) return;

  // Reset pending value for this new dialog
  _pendingNetAdvantage = 0;

  // Find a good place to inject — look for the configuration section or button area
  const configSection = element.querySelector(".roll-configuration")
    ?? element.querySelector('[data-application-part="configuration"]')
    ?? element.querySelector("form");

  if (!configSection) {
    console.warn("The Spire | Could not find roll dialog configuration section");
    return;
  }

  // Build the net advantage control
  const container = document.createElement("div");
  container.className = "form-group spire-net-advantage";

  const label = document.createElement("label");
  label.textContent = "Net Advantage";

  const control = document.createElement("div");
  control.className = "spire-net-adv-control";

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "spire-net-adv-minus";
  minusBtn.title = "Decrease";
  minusBtn.textContent = "-";

  const input = document.createElement("input");
  input.type = "number";
  input.className = "spire-net-adv-value";
  input.value = "0";
  input.step = "1";

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "spire-net-adv-plus";
  plusBtn.title = "Increase";
  plusBtn.textContent = "+";

  control.append(minusBtn, input, plusBtn);

  const desc = document.createElement("span");
  desc.className = "spire-net-adv-desc";
  desc.textContent = "0 = normal, + = advantage, - = disadvantage";

  container.append(label, control, desc);
  configSection.appendChild(container);

  // Event handlers
  input.addEventListener("change", () => {
    _pendingNetAdvantage = parseInt(input.value) || 0;
  });

  minusBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const current = parseInt(input.value) || 0;
    input.value = String(current - 1);
    _pendingNetAdvantage = current - 1;
  });

  plusBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const current = parseInt(input.value) || 0;
    input.value = String(current + 1);
    _pendingNetAdvantage = current + 1;
  });

  // Intercept the dialog's submit buttons to capture advantage mode + net value
  // The dialog has buttons: advantage, normal, disadvantage
  // When clicked, _finalizeRolls(action) is called with the action name
  // We need to combine the button's implicit ±1 with our net advantage value
  const submitButtons = element.querySelectorAll('button[data-action="advantage"], button[data-action="normal"], button[data-action="disadvantage"]');

  for (const btn of submitButtons) {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      // Map button action to advantage offset
      let buttonOffset = 0;
      if (action === "advantage") buttonOffset = 1;
      else if (action === "disadvantage") buttonOffset = -1;

      // Combine with net advantage
      _pendingNetAdvantage = (parseInt(input.value) || 0) + buttonOffset;
    }, { capture: true }); // capture phase so we run before the dialog's handler
  }
}

// --- Roll Modification ---

/**
 * After the dialog closes and D20Roll instances are fully built, apply net advantage
 * by directly modifying the d20 die's number and keep modifier.
 * Hook: dnd5e.postRollConfiguration — fires with (rolls, config, dialog, message)
 * where rolls are actual D20Roll instances with .d20 available.
 */
function handlePostRollConfiguration(rolls) {
  const net = _pendingNetAdvantage;
  _pendingNetAdvantage = 0; // always consume

  if (net === 0) return;

  const absNet = Math.abs(net);
  const keep = net > 0 ? "kh" : "kl";

  for (const roll of rolls) {
    const die = roll.d20;
    if (!die) continue;

    // Clear adv/dis/kh/kl modifiers set by _finalizeRolls → configureModifiers
    die.modifiers.findSplice(m => m.startsWith("adv") || m.startsWith("dis") || m === "kh" || m === "kl");

    // Apply net dice count and explicit keep modifier
    die.number = 1 + absNet;
    die.modifiers.push(`${keep}1`);

    // Keep advantageMode consistent for any downstream code that reads it
    roll.options.advantageMode = net > 0
      ? CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE
      : CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE;

    roll.resetFormula();
  }
}

// --- Exports ---

export function initNetAdvantage() {
  // Try the specific hook first
  Hooks.on("renderD20RollConfigurationDialog", (app, element, options) => {
    injectNetAdvantageUI(app, element);
  });

  Hooks.on("renderAttackRollConfigurationDialog", (app, element, options) => {
    injectNetAdvantageUI(app, element);
  });

  // Fallback: catch all ApplicationV2 renders and filter by class name
  Hooks.on("renderApplication", (app, element, options) => {
    const name = app.constructor.name;
    if (name === "D20RollConfigurationDialog" || name === "AttackRollConfigurationDialog") {
      injectNetAdvantageUI(app, element);
    }
  });

  // Post-configuration: fires after the dialog closes with fully-built D20Roll instances.
  // _pendingNetAdvantage is already set by the button click listeners above.
  Hooks.on("dnd5e.postRollConfiguration", (rolls) => {
    handlePostRollConfiguration(rolls);
  });
}
