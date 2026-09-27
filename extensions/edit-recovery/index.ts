import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MARKER = "[edit-recovery]";

export function recoveryHint(text: string): string | undefined {
  // Classify the leading tool result, never error words in a trailing test log.
  if (text.startsWith("Successfully replaced") && text.includes("[then_run:failed]"))
    return "The file was already modified. Diagnose the separate command against the current file; do not replay this edit.";
  if (text.startsWith('Validation failed for tool "edit"') || text.startsWith("Edit tool input is invalid"))
    return 'Rebuild the arguments as {path, edits: [{oldText, newText}]}: edits must be a non-empty array of objects with string fields. Fix the argument structure, not the file; do not repeat a stringified or truncated edits value.';
  if (text.startsWith("Could not find"))
    return "Read the target span now and copy its exact live text, including whitespace, into a minimal unique oldText. Do not reconstruct it from a summary or search output.";
  if (/^Found \d+ occurrences/.test(text))
    return "Read the matching spans and add the smallest distinguishing function/test name or neighboring lines to oldText.";
  if (/^edits\[\d+\] and edits\[\d+\] overlap/.test(text))
    return "Merge changes to the same region into one edit. All oldText regions must be disjoint in the original file, not intermediate replacements.";
  if (text.startsWith("No changes made"))
    return "Compare the intended result with the current file. If already correct, run verification rather than replaying an unchanged edit.";
  if (text.startsWith("Could not edit file:") && text.includes("ENOENT"))
    return "Resolve the target path against the active cwd/worktree before retrying.";
}

export default function editRecovery(pi: ExtensionAPI) {
  // Validation runs BEFORE tool_call in Pi 0.85.1. This hook can enforce
  // separation of tests, but cannot intercept malformed schema arguments.
  pi.on("tool_call", (event) => {
    if (event.toolName !== "edit") return;
    if (Object.prototype.hasOwnProperty.call(event.input, "then_run")) {
      return { block: true, reason: `${MARKER} Remove then_run and resubmit the edit alone. No edit was executed by this blocked call. Run verification separately after the edit succeeds.` };
    }
  });

  // message_end also receives preflight/validation failures, unlike tool_result.
  // Append one bounded hint; preserve the original error, flags and diff/details.
  pi.on("message_end", ({ message }) => {
    if (message.role !== "toolResult" || message.toolName !== "edit" || !message.isError) return;
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (text.includes(MARKER)) return;
    const hint = recoveryHint(text);
    if (!hint) return;
    return { message: { ...message, content: [...message.content, { type: "text", text: `${MARKER} ${hint}` }] } };
  });
}
