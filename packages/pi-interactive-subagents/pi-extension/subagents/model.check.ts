import { isInheritModel, pinSpawnModel, resolveEffectiveModel } from "./model.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(isInheritModel("inherit"), "inherit");
assert(isInheritModel("inherit:medium"), "inherit:medium");
assert(isInheritModel("parent"), "parent");
assert(!isInheritModel("DDDD/gpt-5.6-luna"), "real model is not inherit");

const inherit = resolveEffectiveModel({ model: "inherit" }, { model: "DDDD/gpt-5.6-luna" });
assert(inherit === "DDDD/gpt-5.6-luna", `inherit -> overlay, got ${inherit}`);

const inheritThinking = resolveEffectiveModel(
  { model: "inherit:medium" },
  { model: "DDDD/muse-spark-1.3-contributor" },
);
assert(
  inheritThinking === "DDDD/muse-spark-1.3-contributor",
  `inherit:medium -> overlay, got ${inheritThinking}`,
);

const inheritNoOverlay = resolveEffectiveModel({ model: "inherit" }, {});
assert(inheritNoOverlay === undefined, `inherit without overlay -> undefined, got ${inheritNoOverlay}`);

const overlay = resolveEffectiveModel({}, { model: "DDDD/gpt-5.6-luna" });
assert(overlay === "DDDD/gpt-5.6-luna", `no override -> agent overlay, got ${overlay}`);

const bare = resolveEffectiveModel(
  { model: "gpt-5-mini" },
  { model: "DDDD/muse-spark-1.3-contributor" },
);
assert(bare === "DDDD/muse-spark-1.3-contributor", `bare gpt-5-mini ignored, got ${bare}`);

const bareThinking = resolveEffectiveModel(
  { model: "gpt-5-mini:medium" },
  { model: "DDDD/muse-spark-1.3-contributor" },
);
assert(
  bareThinking === "DDDD/muse-spark-1.3-contributor",
  `bare gpt-5-mini:medium ignored, got ${bareThinking}`,
);

const parentAstra = resolveEffectiveModel(
  { model: "DDDD/gpt-6-astra:max" },
  { model: "DDDD/gpt-5.6-luna" },
);
assert(parentAstra === "DDDD/gpt-5.6-luna", `parent astra ignored, got ${parentAstra}`);

const qualified = resolveEffectiveModel(
  { model: "DDDD/gpt-5.6-luna:max" },
  { model: "DDDD/muse-spark-1.3-contributor" },
);
assert(qualified === "DDDD/muse-spark-1.3-contributor", `qualified spawn ignored, got ${qualified}`);

const resumeInherit = pinSpawnModel("inherit", "DDDD/muse-spark-1.3-contributor");
assert(
  resumeInherit === "DDDD/muse-spark-1.3-contributor",
  `resume inherit loadout -> overlay, got ${resumeInherit}`,
);
const resumeInheritThinking = pinSpawnModel("inherit:medium", "DDDD/gpt-5.6-sol");
assert(
  resumeInheritThinking === "DDDD/gpt-5.6-sol",
  `resume inherit:medium loadout -> overlay, got ${resumeInheritThinking}`,
);

console.log("ok");
