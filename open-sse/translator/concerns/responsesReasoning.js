// Responses API rejects top-level `reasoning_effort` ("Unsupported parameter").
// Effort belongs in `reasoning.effort`, merged with any existing reasoning object
// so summary / other knobs survive.

function isReasoningObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Move a flat `reasoning_effort` into `reasoning.effort`.
 * Existing reasoning fields (summary, etc.) are kept. A flat effort wins over
 * `reasoning.effort` when both are set. `summary: "auto"` is added only when
 * the flat field is what created the object and no summary was already present.
 * Mutates and returns body.
 */
export function nestResponsesReasoning(body) {
  if (!body || typeof body !== "object") return body;

  const flat = body.reasoning_effort;
  const hasFlat = typeof flat === "string" ? flat !== "" : flat !== undefined && flat !== null && flat !== "";
  const existing = isReasoningObject(body.reasoning) ? body.reasoning : null;

  if (!hasFlat && !existing) {
    if (flat === "" || flat === null) delete body.reasoning_effort;
    return body;
  }

  const reasoning = existing ? { ...existing } : {};
  if (hasFlat) reasoning.effort = flat;
  if (hasFlat && reasoning.summary == null) reasoning.summary = "auto";
  body.reasoning = reasoning;
  delete body.reasoning_effort;
  return body;
}
