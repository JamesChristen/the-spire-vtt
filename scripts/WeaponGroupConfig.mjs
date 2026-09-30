// GM Configuration Window for Weapon/Spell Groups (ApplicationV2)
//
// Edits are held in this._groups until Save. Group fields (name, DDN, scaling) are named form
// inputs; before any action re-renders the window we read them back into this._groups so
// unsaved typing isn't lost. Items and milestones are lists edited only through the buttons.

const MODULE_ID = "the-spire";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class WeaponGroupConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options) {
    super(options);
    this._groups = foundry.utils.deepClone(game.settings.get(MODULE_ID, "weaponGroups"));
    for (const group of Object.values(this._groups)) {
      group.scaling = group.scaling ?? { range: 0, duration: 0, targets: 0, area: 0 };
      group.milestones = group.milestones ?? [];
      group.items = group.items ?? [];
      group.ddn = group.ddn ?? 0;
    }
  }

  static DEFAULT_OPTIONS = {
    id: "spire-weapon-group-config",
    tag: "form",
    classes: ["spire-group-config"],
    window: {
      title: "Weapon/Spell Group Configuration",
      icon: "fas fa-swords",
      resizable: true,
    },
    position: { width: 700, height: "auto" },
    form: {
      handler: WeaponGroupConfig.#onSubmit,
      closeOnSubmit: false,
    },
    actions: {
      addGroup: WeaponGroupConfig.#addGroup,
      removeGroup: WeaponGroupConfig.#removeGroup,
      addItem: WeaponGroupConfig.#addItem,
      removeItem: WeaponGroupConfig.#removeItem,
      addMilestone: WeaponGroupConfig.#addMilestone,
      removeMilestone: WeaponGroupConfig.#removeMilestone,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/weapon-group-config.hbs`,
      scrollable: [".weapon-group-list"],
    },
  };

  async _prepareContext(options) {
    return { groups: this._groups };
  }

  // --- Form sync ---

  // Copy named group fields (name, ddn, scaling.*) from the form into this._groups.
  #syncFromForm(formData) {
    formData ??= new foundry.applications.ux.FormDataExtended(this.element);
    const edited = foundry.utils.expandObject(formData.object).groups ?? {};
    for (const [groupId, fields] of Object.entries(edited)) {
      const group = this._groups[groupId];
      if (!group) continue;
      group.name = fields.name ?? group.name;
      group.ddn = Math.max(0, parseInt(fields.ddn) || 0);
      for (const [param, value] of Object.entries(fields.scaling ?? {})) {
        group.scaling[param] = parseFloat(value) || 0;
      }
    }
  }

  static #groupId(target) {
    return target.closest(".weapon-group-entry")?.dataset.groupId;
  }

  // --- Actions ---

  static #addGroup(event, target) {
    this.#syncFromForm();
    this._groups[foundry.utils.randomID()] = {
      name: "New Group",
      ddn: 0,
      items: [],
      scaling: { range: 0, duration: 0, targets: 0, area: 0 },
      milestones: [],
    };
    this.render();
  }

  static #removeGroup(event, target) {
    this.#syncFromForm();
    delete this._groups[WeaponGroupConfig.#groupId(target)];
    this.render();
  }

  static #addItem(event, target) {
    const entry = target.closest(".weapon-group-entry");
    const name = entry.querySelector(".new-item-name").value?.trim();
    if (!name) return;
    this.#syncFromForm();
    this._groups[entry.dataset.groupId].items.push({ name, type: entry.querySelector(".new-item-type").value });
    this.render();
  }

  static #removeItem(event, target) {
    this.#syncFromForm();
    this._groups[WeaponGroupConfig.#groupId(target)].items.splice(parseInt(target.dataset.index), 1);
    this.render();
  }

  static #addMilestone(event, target) {
    const entry = target.closest(".weapon-group-entry");
    const text = entry.querySelector(".new-milestone-text").value?.trim();
    if (!text) return;
    this.#syncFromForm();
    const level = parseInt(entry.querySelector(".new-milestone-level").value) || 1;
    const milestones = this._groups[entry.dataset.groupId].milestones;
    milestones.push({ level, text });
    milestones.sort((a, b) => a.level - b.level);
    this.render();
  }

  static #removeMilestone(event, target) {
    this.#syncFromForm();
    this._groups[WeaponGroupConfig.#groupId(target)].milestones.splice(parseInt(target.dataset.index), 1);
    this.render();
  }

  // --- Save ---

  static async #onSubmit(event, form, formData) {
    this.#syncFromForm(formData);
    await game.settings.set(MODULE_ID, "weaponGroups", this._groups);
    ui.notifications.info("Weapon/Spell Groups saved.");
  }
}
