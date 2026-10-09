import { createHash } from "node:crypto";

// Auto keys are a hash of the stable conversation prefix, never raw content.
// Providers that already key their own prompt cache / session (Codex session id,
// Grok CLI, OpenCode) must not inherit this key — see translateRequest.
export const PROMPT_CACHE_KEY_PREFIX = "9r-";
const HASH_HEX_LEN = 32;

// These executors treat prompt_cache_key as a session id or inject their own.
const SESSION_OWNED_CACHE_KEY = new Set([
  "codex",
  "grok-cli",
  "opencode",
  "opencode-go",
  "opencode-zen",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function pushInstruction(parts, content) {
  if (content === undefined) return;
  parts.push(content ?? null);
}

function collectInstructions(body) {
  const parts = [];
  if (typeof body.instructions === "string") parts.push(body.instructions);

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg?.role === "system" || msg?.role === "developer") pushInstruction(parts, msg.content);
    }
  }

  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item?.type && item.type !== "message") continue;
      if (item?.role === "system" || item?.role === "developer") pushInstruction(parts, item.content);
    }
  }

  return parts;
}

function firstUserContent(body) {
  if (Array.isArray(body.messages)) {
    const user = body.messages.find((msg) => msg?.role === "user");
    if (user) return user.content ?? null;
  }

  if (typeof body.input === "string") return body.input;

  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item?.type && item.type !== "message") continue;
      if (item?.role === "user") return item.content ?? null;
    }
  }

  return undefined;
}

export function isGeneratedPromptCacheKey(value) {
  return typeof value === "string" && value.startsWith(PROMPT_CACHE_KEY_PREFIX);
}

/**
 * sha256 (hex, 32 chars) of canonical JSON
 * [system/developer instructions, tools, first user message content].
 * Returns null when there is no user message — callers must skip the field.
 */
export function buildStablePromptCacheKey(body) {
  if (!body || typeof body !== "object") return null;
  const user = firstUserContent(body);
  if (user === undefined) return null;

  const payload = canonicalize([
    collectInstructions(body),
    body.tools ?? null,
    user,
  ]);
  const hex = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, HASH_HEX_LEN);
  return `${PROMPT_CACHE_KEY_PREFIX}${hex}`;
}

/**
 * Keep a client-provided key. Otherwise attach one stable key for this
 * conversation prefix. Hashes once. No-op when there is no user message.
 */
export function ensurePromptCacheKey(body) {
  if (!body || typeof body !== "object") return body;
  if (body.prompt_cache_key !== undefined && body.prompt_cache_key !== null && body.prompt_cache_key !== "") {
    return body;
  }
  const key = buildStablePromptCacheKey(body);
  if (key) body.prompt_cache_key = key;
  return body;
}

export function shouldAttachStablePromptCacheKey(provider, targetFormat) {
  if (targetFormat !== "openai-responses" && targetFormat !== "openai-response") return false;
  if (SESSION_OWNED_CACHE_KEY.has(provider)) return false;
  return true;
}

export function stripGeneratedPromptCacheKey(body) {
  if (!body || typeof body !== "object") return body;
  if (isGeneratedPromptCacheKey(body.prompt_cache_key)) delete body.prompt_cache_key;
  return body;
}
