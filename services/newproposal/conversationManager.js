/**
 * conversationManager.js
 * Manages conversation memory, context window limits, and history compression.
 *
 * Responsibilities:
 *  - Build message arrays for AI calls (respecting token limits)
 *  - Estimate token counts
 *  - Compress old history to a summary when context grows large
 *  - Format conversation for different AI call types (chat vs extraction)
 */

// ── Token estimation ──────────────────────────────────────────────────────────

const AVG_CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_TOKENS = 6000;   // Leave room for AI response + system prompt
const COMPRESS_THRESHOLD = 5000;   // Trigger compression above this

/**
 * Rough token estimate from text length.
 */
function estimateTokens(text = "") {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

/**
 * Estimate total tokens in a messages array.
 */
function estimateConversationTokens(messages = []) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// ── Context building ──────────────────────────────────────────────────────────

/**
 * Build a context-safe message array for AI calls.
 *
 * Strategy:
 *  1. Always include the first 2 messages (session opener)
 *  2. Always include the last N messages (recent context)
 *  3. If still over budget, add a compressed summary in the middle
 *
 * @param {Array}  allMessages      - Full message history from DB
 * @param {string} documentContext  - Pre-extracted document text (optional)
 * @param {number} maxTokens        - Token budget for the history window
 * @returns {Array} messages ready to send to AI
 */
function buildContextWindow(allMessages = [], documentContext = "", maxTokens = MAX_CONTEXT_TOKENS) {
  if (!allMessages.length) return [];

  const docTokens = estimateTokens(documentContext);
  const budgetForMessages = maxTokens - docTokens - 200; // 200 buffer

  // If conversation is short enough, return everything
  const totalTokens = estimateConversationTokens(allMessages);
  if (totalTokens <= budgetForMessages) {
    return formatMessages(allMessages, documentContext);
  }

  // Otherwise: keep first 2 + last 8 messages
  const first = allMessages.slice(0, 2);
  const last = allMessages.slice(-8);

  // De-duplicate (first and last might overlap for short conversations)
  const combined = dedupeMessages([...first, ...last]);
  return formatMessages(combined, documentContext);
}

/**
 * Format messages for Anthropic API (role + content).
 * Optionally prepend document context to the first user message.
 */
function formatMessages(messages, documentContext = "") {
  if (!messages.length) return [];

  const formatted = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Prepend document context to earliest user message in this window
  if (documentContext && documentContext.trim()) {
    const firstUserIdx = formatted.findIndex((m) => m.role === "user");
    if (firstUserIdx !== -1) {
      formatted[firstUserIdx] = {
        ...formatted[firstUserIdx],
        content: `[REQUIREMENT DOCUMENT]\n${documentContext}\n\n[USER MESSAGE]\n${formatted[firstUserIdx].content}`,
      };
    }
  }

  return formatted;
}

/**
 * Remove duplicate messages (by content hash) keeping order.
 */
function dedupeMessages(messages) {
  const seen = new Set();
  return messages.filter((m) => {
    const key = `${m.role}:${m.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Conversation summary (compression) ───────────────────────────────────────

/**
 * Build a prompt to summarize the early part of a long conversation.
 * The summary is injected as a synthetic "context" message.
 *
 * @param {Array} messages - Messages to summarize
 * @returns {object} Anthropic message with summary request
 */
function buildSummaryRequest(messages) {
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n");

  return {
    role: "user",
    content: `Summarize the key facts discussed so far in this proposal conversation, keeping all client details, requirements, budget, timeline, and scope information:\n\n${conversationText}\n\nProvide a concise factual summary (max 300 words).`,
  };
}

// ── Document context helper ───────────────────────────────────────────────────

/**
 * Get the combined text from all documents in a conversation session.
 *
 * @param {Array} documents - Array of uploadedDocumentSchema objects from DB
 * @returns {string}
 */
function buildDocumentContext(documents = []) {
  if (!documents || !documents.length) return "";

  return documents
    .filter((d) => d.extractedText && d.extractedText.trim())
    .map((d) => `--- Document: ${d.originalName} ---\n${d.extractedText}`)
    .join("\n\n");
}

// ── Update token estimate ─────────────────────────────────────────────────────

/**
 * Recalculate and return the total estimated token count for a session.
 */
function recalculateTokenCount(messages = [], documents = []) {
  const msgTokens = estimateConversationTokens(messages);
  const docTokens = documents.reduce(
    (sum, d) => sum + estimateTokens(d.extractedText || ""),
    0
  );
  return msgTokens + docTokens;
}

module.exports = {
  buildContextWindow,
  buildDocumentContext,
  buildSummaryRequest,
  recalculateTokenCount,
  estimateTokens,
  estimateConversationTokens,
  MAX_CONTEXT_TOKENS,
  COMPRESS_THRESHOLD,
};