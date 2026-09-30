// Net Advantage — stacking advantage/disadvantage system
// Replaces the binary advantage/disadvantage with a numeric net value.
// Net +N → roll (1+N)d20 keep highest
// Net -N → roll (1+N)d20 keep lowest
// Net  0 → normal 1d20
//
// dnd5e: D20RollConfigurationDialog has 3 submit buttons (advantage/normal/disadvantage).
// We inject a +/- net advantage control into the dialog, then in postRollConfiguration combine
// the control's value with the button that was clicked and rebuild the d20.

// Net advantage value entered in each open dialog, keyed by the dialog's process config.
// dnd5e passes that same config object to dnd5e.postRollConfiguration, so the value is tied to
// exactly one roll — a cancelled dialog can't leak into a later fast-forwarded roll.
const _netAdvantage = new WeakMap();

// --- Dialog Injection ---

/**
 * renderD20RollConfigurationDialog fires for every subclass too (AttackRollConfigurationDialog,
 * SkillToolRollConfigurationDialog, …), since ApplicationV2 calls render hooks up the class chain.
 */
function injectNetAdvantageUI(app, element) {
  // Don't inject twice
  if (element.querySelector(".spire-net-advantage")) return;

  const configSection = element.querySelector('[data-application-part="configuration"]')
    ?? element.querySelector("form");

  if (!configSection) {
    console.warn("The Spire | Could not find roll dialog configuration section");
    return;
  }

  const config = app.config;
  const setValue = value => {
    _netAdvantage.set(config, value);
    input.value = String(value);
  };

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
  input.step = "1";
  // Preserve the value if the configuration part is re-rendered while the dialog is open
  input.value = String(_netAdvantage.get(config) ?? 0);

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "spire-net-adv-plus";
  plusBtn.title = "Increase";
  plusBtn.textContent = "+";

  control.append(minusBtn, input, plusBtn);

  const desc = document.createElement("span");
  desc.className = "spire-net-adv-desc";
  desc.textContent = "Combined with the button you roll with: Advantage +1, Disadvantage -1";

  container.append(label, control, desc);
  configSection.appendChild(container);

  // Register the dialog even at 0, so choosing "Normal" with a net of 0 is still honoured.
  _netAdvantage.set(config, parseInt(input.value) || 0);

  input.addEventListener("change", () => setValue(parseInt(input.value) || 0));
  minusBtn.addEventListener("click", () => setValue((parseInt(input.value) || 0) - 1));
  plusBtn.addEventListener("click", () => setValue((parseInt(input.value) || 0) + 1));
}

// --- Roll Modification ---

/**
 * Hook: dnd5e.postRollConfiguration — (rolls, config, dialog, message). Fires once the dialog has
 * closed and the D20Roll instances are built. The dialog's _finalizeConfig has already written the
 * clicked button into roll.options.advantageMode (+1 / 0 / -1), so we read it back from there
 * rather than intercepting button clicks (which also covers submitting with Enter).
 */
function handlePostRollConfiguration(rolls, config) {
  // Only rolls made through a dialog with our control; fast-forwarded rolls are left alone.
  if (!_netAdvantage.has(config)) return;
  const inputValue = _netAdvantage.get(config);
  _netAdvantage.delete(config);

  const { ADV_MODE } = CONFIG.Dice.D20Roll;

  for (const roll of rolls) {
    const die = roll.d20;
    if (!die) continue;

    const net = inputValue + (roll.options.advantageMode ?? ADV_MODE.NORMAL);

    // Net 0 means a plain d20 even if a button implied adv/dis (e.g. +1 then "Disadvantage")
    if (net === 0) {
      die.applyAdvantage(ADV_MODE.NORMAL);
      roll.options.advantageMode = ADV_MODE.NORMAL;
      roll.resetFormula();
      continue;
    }

    const mode = net > 0 ? ADV_MODE.ADVANTAGE : ADV_MODE.DISADVANTAGE;

    // Clear adv/dis/kh/kl modifiers, then apply the net dice count with an explicit keep
    die.applyAdvantage(ADV_MODE.NORMAL);
    // Elven Accuracy: dnd5e rolls an extra die on advantage ("adv2") — keep that on top of net
    const elvenBonus = (net > 0 && die.options.elvenAccuracy) ? 1 : 0;
    die.number = 1 + Math.abs(net) + elvenBonus;
    die.modifiers.push(net > 0 ? "kh1" : "kl1");

    // Keep advantageMode consistent for any downstream code that reads it
    die.options.advantageMode = mode;
    roll.options.advantageMode = mode;

    roll.resetFormula();
  }
}

// --- Exports ---

export function initNetAdvantage() {
  Hooks.on("renderD20RollConfigurationDialog", injectNetAdvantageUI);
  Hooks.on("dnd5e.postRollConfiguration", handlePostRollConfiguration);
}
