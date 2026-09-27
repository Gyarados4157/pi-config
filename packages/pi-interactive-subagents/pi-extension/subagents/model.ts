const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/i;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export function thinkingSuffix(model: string | undefined | null): ThinkingLevel | undefined {
  const match = model?.match(THINKING_SUFFIX);
  return match?.[1].toLowerCase() as ThinkingLevel | undefined;
}

export function stripThinkingSuffix(model: string): string {
  return model.replace(THINKING_SUFFIX, "");
}

export function isInheritModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const base = stripThinkingSuffix(model).trim().toLowerCase();
  return base === "inherit" || base === "parent" || base === "same";
}

export function isQualifiedModel(model: string | undefined | null): boolean {
  if (!model) return false;
  return stripThinkingSuffix(model).includes("/");
}

export function pinSpawnModel(
  _requested: string | undefined | null,
  overlay: string | undefined | null,
): string | undefined {
  // Overlay always pins the child. Spawn `model` (inherit, parent session
  // ids like DDDD/gpt-6-astra, bare names) is ignored — never copy the parent.
  return overlay || undefined;
}

export function resolveEffectiveModel(
  params: { model?: string },
  agentDefs: { model?: string } | null,
): string | undefined {
  return pinSpawnModel(params.model, agentDefs?.model);
}

/** An explicit thinking suffix on the spawn request overrides the profile. */
export function resolveEffectiveThinking(
  params: { model?: string },
  agentDefs: { thinking?: string } | null,
): string | undefined {
  return thinkingSuffix(params.model) ?? agentDefs?.thinking;
}
