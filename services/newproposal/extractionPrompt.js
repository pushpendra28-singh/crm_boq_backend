/**
 * extractionPrompt.js
 * Builds prompts that instruct the AI to extract structured proposal data
 * from conversation history. Returns a clean JSON object.
 *
 * Separation of concerns:
 *   - extractionPrompt.js  → WHAT to extract (schema + prompt)
 *   - chatinterview.js     → HOW to drive the conversation
 *   - conversationManager.js → memory / context management
 */

// ── Required fields for "completion" ─────────────────────────────────────────

const REQUIRED_FIELDS = [
  "clientName",
  "businessType",
  "proposalType",
  "projectSummary",
  "budget",
  "timeline",
];

// ── System prompt for extraction ──────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `
You are a data extraction engine for a proposal management system.
Your ONLY job is to read a conversation and extract structured proposal data.

Return ONLY valid JSON. No explanations, no markdown, no code fences.
If a field cannot be determined from the conversation, use null.

EXTRACTION RULES:
- budgetNumeric: convert verbal budgets to numbers. "10 lakh" = 1000000, "5k" = 5000, "$50,000" = 50000
- timeline: extract duration or dates ("3 months", "Q2 2025", "by December")
- businessType: infer from context if not stated (Solar Energy, IT Services, Construction, Healthcare, etc.)
- proposalType: default to "Sales Proposal" if unclear
- amc: true if user mentions annual maintenance, AMC, support contract
- tone: extract if user specifies ("premium", "formal", "standard")
- services: array of service names mentioned
- requirements: array of specific requirements/features mentioned

Output this exact JSON structure (all fields optional, use null for unknown):
{
  "clientName": null,
  "clientEmail": null,
  "clientPhone": null,
  "clientCompany": null,
  "clientAddress": null,
  "businessType": null,
  "proposalType": null,
  "proposalTitle": null,
  "industry": null,
  "projectSummary": null,
  "services": [],
  "currency": null,
  "budget": null,
  "budgetNumeric": null,
  "lineItems": [],
  "discount": null,
  "taxRate": null,
  "paymentTerms": null,
  "startDate": null,
  "endDate": null,
  "timeline": null,
  "milestones": [],
  "scope": null,
  "requirements": [],
  "amc": null,
  "tone": null,
  "extras": {}
}
`.trim();

// ── Build extraction prompt ───────────────────────────────────────────────────

/**
 * Build the messages array for an extraction call.
 * Includes conversation history + document content if any.
 *
 * @param {Array}  messages      - Array of {role, content} objects
 * @param {string} documentText  - Extracted document text (optional)
 * @returns {object} { systemPrompt, userMessage }
 */
function buildExtractionMessages(messages, documentText = "") {
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "USER" : "AI"}: ${m.content}`)
    .join("\n");

  let userMessage = `Extract all proposal information from this conversation:\n\n${conversationText}`;

  if (documentText && documentText.trim()) {
    userMessage += `\n\n--- UPLOADED DOCUMENT CONTENT ---\n${documentText}\n--- END DOCUMENT ---\n`;
    userMessage += "\nAlso extract any relevant information from the document above.";
  }

  return {
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage,
  };
}

// ── Completion checker ────────────────────────────────────────────────────────

/**
 * Evaluate extracted data and determine which required fields are missing.
 *
 * @param {object} extracted - The parsed extraction result
 * @returns {{ completed: boolean, missingFields: string[] }}
 */
function checkCompletion(extracted) {
  const missingFields = REQUIRED_FIELDS.filter((field) => {
    const val = extracted[field];
    if (val === null || val === undefined) return true;
    if (typeof val === "string" && val.trim() === "") return true;
    return false;
  });

  return {
    completed: missingFields.length === 0,
    missingFields,
  };
}

// ── Parse AI extraction response ──────────────────────────────────────────────

/**
 * Safely parse a JSON string returned by the extraction AI.
 * Strips markdown code fences if the model adds them.
 *
 * @param {string} rawText
 * @returns {object} Parsed extraction object
 */
function parseExtractionResponse(rawText) {
  let text = rawText.trim();

  // Strip markdown fences
  text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract the first JSON object from the text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // Return empty object on total failure — do not crash
        console.error("[extractionPrompt] Failed to parse extraction response:", text.slice(0, 200));
        return {};
      }
    }
    return {};
  }
}

// ── Merge extracted data (partial updates) ────────────────────────────────────

/**
 * Deep-merge new extraction into existing extracted data.
 * Only updates fields that have a non-null value in `newData`.
 *
 * @param {object} existing - Current extractedData from DB
 * @param {object} newData  - Freshly extracted data
 * @returns {object}        - Merged result
 */
function mergeExtractedData(existing = {}, newData = {}) {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(newData)) {
    if (value === null || value === undefined) continue;

    // Arrays: append new unique values
    if (Array.isArray(value)) {
      if (!Array.isArray(merged[key])) {
        merged[key] = value;
      } else if (value.length > 0) {
        // For simple string arrays, deduplicate
        if (typeof value[0] === "string") {
          merged[key] = [...new Set([...merged[key], ...value])];
        } else {
          // For object arrays (lineItems, milestones), replace
          merged[key] = value;
        }
      }
      continue;
    }

    // Strings/numbers: only overwrite if existing is empty/null
    if (typeof value === "string" && value.trim() === "") continue;
    merged[key] = value;
  }

  return merged;
}

module.exports = {
  buildExtractionMessages,
  checkCompletion,
  parseExtractionResponse,
  mergeExtractedData,
  REQUIRED_FIELDS,
  EXTRACTION_SYSTEM_PROMPT,
};