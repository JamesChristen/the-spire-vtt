// GM Configuration Window for Weapon/Spell Groups
// Uses FormApplication (deprecated in v14 but still functional)

const MODULE_ID = "the-spire";

export class WeaponGroupConfig extends FormApplication {

  constructor(...args) {
    super(...args);
    this._groups = foundry.utils.deepClone(game.settings.get(MODULE_ID, "weaponGroups"));
    for (const group of Object.values(this._groups)) {
      group.scaling = group.scaling ?? { range: 0, duration: 0, targets: 0, area: 0 };
      group.milestones = group.milestones ?? [];
      group.items = group.items ?? [];
      group.ddn = group.ddn ?? 0;
    }
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "spire-weapon-group-config",
      title: "Weapon/Spell Group Configuration",
      template: `modules/${MODULE_ID}/templates/weapon-group-config.html`,
      width: 700,
      height: "auto",
      closeOnSubmit: false,
      resizable: true,
    });
  }

  getData() {
    return {
      groups: this._groups,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // In Foundry v14, FormApplication still passes jQuery-wrapped html
    // but we use native DOM via html[0] for future-proofing
    const el = html[0] ?? html;

    // --- Group Management ---

    el.querySelector(".add-group")?.addEventListener("click", () => {
      const id = foundry.utils.randomID();
      this._groups[id] = {
        name: "New Group",
        items: [],
        scaling: { range: 0, duration: 0, targets: 0, area: 0 },
        milestones: [],
      };
      this.render();
    });

    el.querySelectorAll(".remove-group").forEach(btn => {
      btn.addEventListener("click", () => {
        const groupId = btn.closest(".weapon-group-entry").dataset.groupId;
        delete this._groups[groupId];
        this.render();
      });
    });

    el.querySelectorAll(".group-name-input").forEach(input => {
      input.addEventListener("change", () => {
        const groupId = input.closest(".weapon-group-entry").dataset.groupId;
        this._groups[groupId].name = input.value;
      });
    });

    el.querySelectorAll(".group-ddn-input").forEach(input => {
      input.addEventListener("change", () => {
        const groupId = input.closest(".weapon-group-entry").dataset.groupId;
        this._groups[groupId].ddn = Math.max(0, parseInt(input.value) || 0);
      });
    });

    // --- Item Management ---

    el.querySelectorAll(".add-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const entry = btn.closest(".weapon-group-entry");
        const groupId = entry.dataset.groupId;
        const nameInput = entry.querySelector(".new-item-name");
        const typeSelect = entry.querySelector(".new-item-type");
        const name = nameInput.value?.trim();
        const type = typeSelect.value;

        if (!name) return;

        this._groups[groupId].items.push({ name, type });
        nameInput.value = "";
        this.render();
      });
    });

    el.querySelectorAll(".remove-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const entry = btn.closest(".weapon-group-entry");
        const groupId = entry.dataset.groupId;
        const index = parseInt(btn.dataset.index);
        this._groups[groupId].items.splice(index, 1);
        this.render();
      });
    });

    // --- Scaling Params ---

    el.querySelectorAll(".scaling-input").forEach(input => {
      input.addEventListener("change", () => {
        const groupId = input.closest(".weapon-group-entry").dataset.groupId;
        const param = input.dataset.param;
        const value = parseFloat(input.value) || 0;
        this._groups[groupId].scaling[param] = value;
      });
    });

    // --- Milestones ---

    el.querySelectorAll(".add-milestone").forEach(btn => {
      btn.addEventListener("click", () => {
        const entry = btn.closest(".weapon-group-entry");
        const groupId = entry.dataset.groupId;
        const levelInput = entry.querySelector(".new-milestone-level");
        const textInput = entry.querySelector(".new-milestone-text");
        const level = parseInt(levelInput.value) || 1;
        const text = textInput.value?.trim();

        if (!text) return;

        this._groups[groupId].milestones.push({ level, text });
        this._groups[groupId].milestones.sort((a, b) => a.level - b.level);
        levelInput.value = "";
        textInput.value = "";
        this.render();
      });
    });

    el.querySelectorAll(".remove-milestone").forEach(btn => {
      btn.addEventListener("click", () => {
        const entry = btn.closest(".weapon-group-entry");
        const groupId = entry.dataset.groupId;
        const index = parseInt(btn.dataset.index);
        this._groups[groupId].milestones.splice(index, 1);
        this.render();
      });
    });

    // --- Save ---

    el.querySelector(".save-groups")?.addEventListener("click", async () => {
      await this._saveGroups();
    });
  }

  async _updateObject(event, formData) {
    await this._saveGroups();
  }

  async _saveGroups() {
    await game.settings.set(MODULE_ID, "weaponGroups", this._groups);
    ui.notifications.info("Weapon/Spell Groups saved.");
  }
}
