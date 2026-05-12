// GM Configuration Window for Weapon/Spell Groups

const MODULE_ID = "the-spire";

export class WeaponGroupConfig extends FormApplication {

  constructor(...args) {
    super(...args);
    this._groups = foundry.utils.deepClone(game.settings.get(MODULE_ID, "weaponGroups"));
    // Ensure all groups have scaling and milestones
    for (const group of Object.values(this._groups)) {
      group.scaling = group.scaling ?? { range: 0, duration: 0, targets: 0, area: 0 };
      group.milestones = group.milestones ?? [];
      group.items = group.items ?? [];
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

    // --- Group Management ---

    html.find(".add-group").on("click", () => {
      const id = foundry.utils.randomID();
      this._groups[id] = {
        name: "New Group",
        items: [],
        scaling: { range: 0, duration: 0, targets: 0, area: 0 },
        milestones: [],
      };
      this.render();
    });

    html.find(".remove-group").on("click", (event) => {
      const groupId = $(event.currentTarget).closest(".weapon-group-entry").data("group-id");
      delete this._groups[groupId];
      this.render();
    });

    html.find(".group-name-input").on("change", (event) => {
      const groupId = $(event.currentTarget).closest(".weapon-group-entry").data("group-id");
      this._groups[groupId].name = event.currentTarget.value;
    });

    // --- Item Management ---

    html.find(".add-item").on("click", (event) => {
      const entry = $(event.currentTarget).closest(".weapon-group-entry");
      const groupId = entry.data("group-id");
      const nameInput = entry.find(".new-item-name");
      const typeSelect = entry.find(".new-item-type");
      const name = nameInput.val()?.trim();
      const type = typeSelect.val();

      if (!name) return;

      this._groups[groupId].items.push({ name, type });
      nameInput.val("");
      this.render();
    });

    html.find(".remove-item").on("click", (event) => {
      const entry = $(event.currentTarget).closest(".weapon-group-entry");
      const groupId = entry.data("group-id");
      const index = $(event.currentTarget).data("index");
      this._groups[groupId].items.splice(index, 1);
      this.render();
    });

    // --- Scaling Params ---

    html.find(".scaling-input").on("change", (event) => {
      const groupId = $(event.currentTarget).closest(".weapon-group-entry").data("group-id");
      const param = $(event.currentTarget).data("param");
      const value = parseFloat(event.currentTarget.value) || 0;
      this._groups[groupId].scaling[param] = value;
    });

    // --- Milestones ---

    html.find(".add-milestone").on("click", (event) => {
      const entry = $(event.currentTarget).closest(".weapon-group-entry");
      const groupId = entry.data("group-id");
      const levelInput = entry.find(".new-milestone-level");
      const textInput = entry.find(".new-milestone-text");
      const level = parseInt(levelInput.val()) || 1;
      const text = textInput.val()?.trim();

      if (!text) return;

      this._groups[groupId].milestones.push({ level, text });
      this._groups[groupId].milestones.sort((a, b) => a.level - b.level);
      levelInput.val("");
      textInput.val("");
      this.render();
    });

    html.find(".remove-milestone").on("click", (event) => {
      const entry = $(event.currentTarget).closest(".weapon-group-entry");
      const groupId = entry.data("group-id");
      const index = $(event.currentTarget).data("index");
      this._groups[groupId].milestones.splice(index, 1);
      this.render();
    });

    // --- Save ---

    html.find(".save-groups").on("click", async () => {
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
