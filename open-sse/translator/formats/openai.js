// OpenAI helper functions for translator
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES } from "../schema/index.js";

// Re-export valid-type lists (moved to schema/blocks.js) to keep existing importers working.
export { VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES };

// Chat Completions `image_url.detail` enum. Cursor and other clients may send
// extra keys (e.g. `dimensions`) that strict OpenAI-compatible gateways reject.
const OPENAI_IMAGE_DETAIL = new Set(["auto", "low", "high"]);

function sanitizeImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "object" || Array.isArray(imageUrl)) return imageUrl;
  const out = {};
  if (typeof imageUrl.url === "string") out.url = imageUrl.url;
  if (OPENAI_IMAGE_DETAIL.has(imageUrl.detail)) out.detail = imageUrl.detail;
  return out;
}

// Request-message tool_calls are `{id,type,function}` (or custom). `index` is a
// streaming-delta field that Cursor/SDKs echo into history; strict upstreams 400.
function sanitizeToolCall(tc) {
  if (!tc || typeof tc !== "object") return tc;
  const out = {};
  if (tc.id != null) out.id = tc.id;
  if (tc.type) out.type = tc.type;
  if (tc.function && typeof tc.function === "object") {
    const fn = {};
    if (tc.function.name != null) fn.name = tc.function.name;
    if (tc.function.arguments != null) fn.arguments = tc.function.arguments;
    out.function = fn;
  }
  if (tc.custom && typeof tc.custom === "object") out.custom = tc.custom;
  return out;
}

// Filter messages to OpenAI standard format
// Remove: thinking, redacted_thinking, signature, and other non-OpenAI blocks
// opts.preserveCacheControl: keep cache_control on content blocks (e.g. for DashScope/alicode)
export function filterToOpenAIFormat(body, opts = {}) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  const keepCache = !!opts.preserveCacheControl;

  function stripBlock(block) {
    const { signature, cache_control, ...rest } = block;
    return keepCache && cache_control ? { ...rest, cache_control } : rest;
  }

  function sanitizeContentBlock(block) {
    const next = stripBlock(block);
    if (next.type === OPENAI_BLOCK.IMAGE_URL && next.image_url != null) {
      next.image_url = sanitizeImageUrl(next.image_url);
    }
    return next;
  }

  const normalized = [];
  const pendingImages = [];

  // Chat Completions allows image parts on user messages only, but Cursor returns
  // them inside `role: "tool"` results (ReadFile). Strict gateways 400 with
  // "image ... parts are valid only for user messages". Stash those parts and
  // re-emit them as a user turn once the tool-result run is over, so the model
  // still receives the images.
  function flushPendingImages() {
    if (pendingImages.length === 0) return;
    normalized.push({ role: ROLE.USER, content: pendingImages.splice(0) });
  }

  for (let msg of body.messages) {
    // Normalize developer role to system (many providers don't support developer)
    if (msg.role === ROLE.DEVELOPER) msg = { ...msg, role: ROLE.SYSTEM };

    if (Array.isArray(msg.tool_calls)) {
      msg = { ...msg, tool_calls: msg.tool_calls.map(sanitizeToolCall) };
    }

    // Move image parts out of tool messages; keep the remaining blocks in place.
    if (msg.role === ROLE.TOOL) {
      if (Array.isArray(msg.content)) {
        const textParts = [];
        for (const block of msg.content) {
          if (block?.type === OPENAI_BLOCK.IMAGE_URL) {
            pendingImages.push(sanitizeContentBlock(block));
          } else {
            textParts.push(block);
          }
        }
        msg = {
          ...msg,
          content: textParts.length > 0 ? textParts : [{ type: OPENAI_BLOCK.TEXT, text: "" }],
        };
      }
      normalized.push(msg);
      continue;
    }

    flushPendingImages();

    // Handle string content
    if (typeof msg.content === "string") {
      normalized.push(msg);
      continue;
    }

    // Handle array content
    if (Array.isArray(msg.content)) {
      const filteredContent = [];

      for (const block of msg.content) {
        // Skip thinking blocks
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;

        // Only keep valid OpenAI content types
        if (VALID_OPENAI_CONTENT_TYPES.includes(block.type)) {
          filteredContent.push(sanitizeContentBlock(block));
        } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
          // Convert tool_use to tool_calls format (handled separately)
          continue;
        } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
          // Keep tool_result but clean it
          filteredContent.push(stripBlock(block));
        }
      }
      
      // If all content was filtered, add empty text — unless this is a tool-call
      // assistant turn, where OpenAI expects content: null rather than "".
      if (filteredContent.length === 0) {
        if (msg.tool_calls) {
          normalized.push({ ...msg, content: null });
          continue;
        }
        filteredContent.push({ type: OPENAI_BLOCK.TEXT, text: "" });
      }
      
      normalized.push({ ...msg, content: filteredContent });
      continue;
    }
    
    normalized.push(msg);
  }

  flushPendingImages();
  body.messages = normalized;
  
  // Filter out messages with only empty text (but NEVER filter tool messages)
  body.messages = body.messages.filter(msg => {
    // Always keep tool messages
    if (msg.role === ROLE.TOOL) return true;
    // Always keep assistant messages with tool_calls
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) return true;
    
    if (typeof msg.content === "string") return msg.content.trim() !== "";
    if (Array.isArray(msg.content)) {
      return msg.content.some(b => 
        (b.type === OPENAI_BLOCK.TEXT && b.text?.trim()) ||
        b.type !== OPENAI_BLOCK.TEXT
      );
    }
    return true;
  });

  // Remove empty tools array (some providers like QWEN reject it)
  if (body.tools && Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
  }

  // Normalize tools to OpenAI format (from Claude, Gemini, etc.)
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    body.tools = body.tools.map(tool => {
      // Already OpenAI format
      if (tool.type === OPENAI_BLOCK.FUNCTION && tool.function) return tool;
      
      // Claude format: {name, description, input_schema}
      if (tool.name && (tool.input_schema || tool.description)) {
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: tool.name,
            description: String(tool.description || ""),
            parameters: tool.input_schema || { type: "object", properties: {} }
          }
        };
      }
      
      // Gemini format: {functionDeclarations: [{name, description, parameters}]}
      if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations.map(fn => ({
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: fn.name,
            description: String(fn.description || ""),
            parameters: fn.parameters || { type: "object", properties: {} }
          }
        }));
      }
      
      return tool;
    }).flat();
  }

  // Normalize tool_choice to OpenAI format
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const choice = body.tool_choice;
    // Claude format: {type: "auto|any|tool", name?: "..."}
    if (choice.type === "auto") {
      body.tool_choice = "auto";
    } else if (choice.type === "any") {
      body.tool_choice = "required";
    } else if (choice.type === "tool" && choice.name) {
      body.tool_choice = { type: OPENAI_BLOCK.FUNCTION, function: { name: choice.name } };
    }
  }

  return body;
}

