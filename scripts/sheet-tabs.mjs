// Sheet Tabs — registers module tabs natively on the dnd5e character sheet
//
// Tabs are added to CharacterActorSheet.TABS / PARTS at init so dnd5e renders the nav button
// and an empty panel itself. This matters in dnd5e 6.x: _getTabs() resets tabGroups.primary to
// the first tab whenever the active tab isn't in TABS, so DOM-injected tabs lost focus on every
// re-render. Each feature fills its panel from the render hook via getSheetTabPanel().

const MODULE_ID = "the-spire";
const TAB_TEMPLATE = `modules/${MODULE_ID}/templates/sheet-tab.hbs`;

export function registerSheetTab({ id, label, icon }) {
  const Sheet = dnd5e.applications.actor.CharacterActorSheet;
  if (Sheet.TABS.some(t => t.tab === id)) return;
  Sheet.TABS.push({ tab: id, label, icon });
  Sheet.PARTS[id] = {
    container: { classes: ["tab-body"], id: "tabs" },
    template: TAB_TEMPLATE,
    scrollable: [""],
  };
}

// The panel element for a registered tab, or null (e.g. limited sheets render LIMITED_PARTS).
export function getSheetTabPanel(element, id) {
  return element.querySelector(`[data-application-part="${id}"]`);
}
