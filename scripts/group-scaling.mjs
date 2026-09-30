// Group Scaling — applies a weapon/spell group's per-level bonuses to activity data
//
// Rather than patching rolls, the bonuses are written into the activity's prepared data, so
// everything dnd5e derives from it picks them up: range/duration/target labels, measured
// template size, effect durations, the save DC on chat cards and save buttons.
//
// Range, duration and target values are formula strings that dnd5e's field prepareData()
// evaluates and then builds labels from (labels are only set if empty). So we wrap those static
// prepareData functions and extend the formula *before* evaluation. dnd5e calls them as
// `RangeField.prepareData.call(activity, …)`, so replacing the static property is enough.
// Activity data is rebuilt from source on every prepare, so bonuses never stack.

import { getActivityGroup, getGroupScaling, getSpellSaveDcBonus } from "./group-data.mjs";

export function initGroupScaling() {
  const { BaseActivityData } = dnd5e.dataModels.activity;
  const { RangeField, DurationField, TargetField } = dnd5e.dataModels.shared;

  wrapFieldPrep(RangeField, BaseActivityData, applyRangeBonus);
  wrapFieldPrep(DurationField, BaseActivityData, applyDurationBonus);
  wrapFieldPrep(TargetField, BaseActivityData, applyTargetBonus);

  const SaveActivity = CONFIG.DND5E.activityTypes.save.documentClass;
  const origSaveFinal = SaveActivity.prototype.prepareFinalData;
  SaveActivity.prototype.prepareFinalData = function (rollData) {
    origSaveFinal.call(this, rollData);
    applySaveDcBonus(this);
  };
}

// Items also call these field functions for their own labels — only touch activities.
function wrapFieldPrep(Field, BaseActivityData, apply) {
  const orig = Field.prepareData;
  Field.prepareData = function (rollData, labels) {
    if (this instanceof BaseActivityData) {
      const info = getActivityGroup(this);
      if (info?.level > 0) apply(this, getGroupScaling(info.group), info.level);
    }
    return orig.call(this, rollData, labels);
  };
}

// Extend a formula-string field with a trailing term, e.g. "60" → "60 + 10".
function extendFormula(obj, key, term) {
  if (!obj[key]) return;
  obj[key] = `${obj[key]} ${term}`;
}

function applyRangeBonus(activity, scaling, level) {
  const range = activity.range;
  if (!(scaling.range > 0) || !(range.units in CONFIG.DND5E.movementUnits)) return;
  extendFormula(range, "value", `+ ${scaling.range * level}`);
}

function applyDurationBonus(activity, scaling, level) {
  const duration = activity.duration;
  if (!(scaling.duration > 0) || !(duration.units in CONFIG.DND5E.scalarTimePeriods)) return;
  if (duration.value) duration.value = `(${duration.value}) * ${1 + scaling.duration * level}`;
}

function applyTargetBonus(activity, scaling, level) {
  const { template, affects } = activity.target;
  if (scaling.area > 0 && template.type) extendFormula(template, "size", `+ ${scaling.area * level}`);
  // Only raises an explicit count ("1 creature" → "2 creatures"); "any/every" stays as-is.
  if (scaling.targets > 0) extendFormula(affects, "count", `+ ${scaling.targets * level}`);
}

// Save DC is computed directly in SaveActivity.prepareFinalData (no field helper), so add
// on top of the finished value and rebuild its label the same way dnd5e does.
function applySaveDcBonus(activity) {
  const info = getActivityGroup(activity);
  const bonus = info ? getSpellSaveDcBonus(info.level) : 0;
  if (!bonus || !activity.save.dc.value) return;

  activity.save.dc.value += bonus;
  const ability = activity.save.dc.calculation ? activity.ability : null;
  activity.labels.save = game.i18n.format("DND5E.SaveDC", {
    dc: activity.save.dc.value,
    ability: CONFIG.DND5E.abilities[ability]?.label ?? "",
  });
}
