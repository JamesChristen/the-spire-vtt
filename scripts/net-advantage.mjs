// Net Advantage — stacking advantage/disadvantage system
// Replaces the binary advantage/disadvantage with a numeric net value.
// Net +N → roll (1+N)d20 keep highest
// Net -N → roll (1+N)d20 keep lowest
// Net  0 → normal 1d20

const MODULE_ID = "the-spire";

// Store the net advantage value set by the user in the roll dialog.
// This is read by the pre-roll hooks to modify the roll formula.
let _pendingNetAdvantage = 0;

// --- Dialog Injection ---

export function initNetAdvantage() {
  // Intercept roll dialogs to replace advantage/disadvantage with net advantage input
  Hooks.on("renderDialog", (app, html, data) => {
    // Only target dnd5e roll dialogs that have the advantage mode selector
    const form = html.find("form");
    // dnd5e roll dialogs use radio buttons or a select for advantage mode
    // Look for the advantage mode fieldset/group
    const advGroup = html.find('[name="advantage"]').closest(".form-group")
      ?? html.find('[name="advMode"]').closest(".form-group")
      ?? html.find('[name="advantageMode"]').closest(".form-group");

    // Try multiple selectors for the advantage controls
    const advControls =
      html.find('[name="advantage"]').closest(".form-group, fieldset, .advantage-mode") ||
      html.find('[name="advMode"]').closest(".form-group, fieldset, .advantage-mode") ||
      html.find('[name="advantageMode"]').closest(".form-group, fieldset, .advantage-mode");

    if (!advControls.length) {
      // Also try finding by radio button labels containing "Advantage"
      const advRadios = html.find('input[type="radio"]').filter(function () {
        const label = $(this).closest("label").text() || $(this).next("label").text();
        return label.match(/advantage|disadvantage|normal/i);
      });
      if (!advRadios.length) return;
      replaceAdvantageControls(advRadios.closest(".form-group, fieldset, .dialog-content > div"), html);
      return;
    }

    replaceAdvantageControls(advControls, html);
  });
}

function replaceAdvantageControls(container, html) {
  if (!container.length) return;

  // Reset pending value
  _pendingNetAdvantage = 0;

  // Replace the container content with our net advantage input
  container.replaceWith(`
    <div class="form-group spire-net-advantage">
      <label>Net Advantage</label>
      <div class="spire-net-adv-control">
        <button type="button" class="spire-net-adv-minus" title="Decrease">-</button>
        <input type="number" class="spire-net-adv-value" value="0" step="1">
        <button type="button" class="spire-net-adv-plus" title="Increase">+</button>
      </div>
      <span class="spire-net-adv-desc">0 = normal, + = advantage, - = disadvantage</span>
    </div>
  `);

  const input = html.find(".spire-net-adv-value");

  input.on("change", () => {
    _pendingNetAdvantage = parseInt(input.val()) || 0;
  });

  html.find(".spire-net-adv-minus").on("click", (e) => {
    e.preventDefault();
    const current = parseInt(input.val()) || 0;
    input.val(current - 1);
    _pendingNetAdvantage = current - 1;
  });

  html.find(".spire-net-adv-plus").on("click", (e) => {
    e.preventDefault();
    const current = parseInt(input.val()) || 0;
    input.val(current + 1);
    _pendingNetAdvantage = current + 1;
  });
}

// --- Roll Modification ---

export function applyNetAdvantage(config) {
  const net = _pendingNetAdvantage;

  // Override the advantage mode so dnd5e doesn't apply its own logic
  // advantageMode: -1 = disadvantage, 0 = normal, 1 = advantage
  // We set it to 0 (normal) and handle the dice ourselves
  if (config.advantageMode !== undefined) {
    // If dnd5e already set an advantage mode from a status effect or similar,
    // factor it into our net calculation
    const systemAdv = config.advantageMode; // -1, 0, or 1
    _pendingNetAdvantage = 0; // reset for next roll
    const totalNet = net + systemAdv;
    applyNetToConfig(config, totalNet);
  } else {
    _pendingNetAdvantage = 0;
    applyNetToConfig(config, net);
  }
}

function applyNetToConfig(config, net) {
  if (net === 0) {
    // Normal roll — ensure no advantage mode
    config.advantageMode = 0;
    return;
  }

  // Override advantage mode to normal — we handle it via the formula
  config.advantageMode = 0;

  const diceCount = 1 + Math.abs(net);
  const keep = net > 0 ? "kh" : "kl";

  // Replace the d20 term in the roll
  // dnd5e uses config.formula or builds from parts
  // We need to ensure the roll uses NdXkh/kl instead of 1d20
  if (config.formula) {
    config.formula = config.formula.replace(/\d*d20(kh|kl)?/g, `${diceCount}d20${keep}`);
  }

  // Also set the dice configuration if available
  if (config.rolls) {
    // dnd5e 3.x sometimes uses a rolls array
    for (const roll of config.rolls) {
      if (roll.options) {
        roll.options.advantageMode = 0;
      }
    }
  }

  // Store on config for the D20Roll to pick up
  config.spireNetAdvantage = net;
}

// Hook into D20Roll to modify the formula before evaluation
export function initD20RollOverride() {
  // Wrap the D20Roll class to support net advantage
  Hooks.once("ready", () => {
    const D20Roll = CONFIG.Dice?.D20Roll ?? game.dnd5e?.dice?.D20Roll;
    if (!D20Roll) {
      console.warn("The Spire | Could not find D20Roll class for net advantage override");
      return;
    }

    const origConfigureDialog = D20Roll.prototype.configureDialog;
    if (origConfigureDialog) {
      D20Roll.prototype.configureDialog = async function (options = {}) {
        const result = await origConfigureDialog.call(this, options);
        // After dialog closes, apply the net advantage to this roll
        const net = _pendingNetAdvantage;
        _pendingNetAdvantage = 0;

        if (net !== 0 && this.terms) {
          const diceCount = 1 + Math.abs(net);
          const keep = net > 0 ? "kh" : "kl";

          // Find the d20 term and modify it
          for (const term of this.terms) {
            if (term.faces === 20) {
              term.number = diceCount;
              term.modifiers = term.modifiers.filter(m => !m.startsWith("kh") && !m.startsWith("kl"));
              term.modifiers.push(`${keep}1`);
              term.results = []; // clear cached results so it re-rolls
            }
          }
          // Rebuild the formula
          this._formula = this.constructor.getFormula(this.terms);
        }

        return result;
      };
    }
  });
}
