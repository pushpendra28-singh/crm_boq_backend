/**
 * chatinterview.js
 * Core AI conversation logic for the proposal interview system.
 *
 * Handles:
 *  - Starting a new conversation (opening message)
 *  - Generating dynamic follow-up questions based on industry/context
 *  - Returning structured AI response: { reply, extracted, completed, missingFields }
 *  - Document + chat flow (Flow 2)
 *
 * Uses Anthropic SDK. Reuses extractionPrompt for JSON extraction.
 */

const Anthropic = require("@anthropic-ai/sdk");
const {
  buildExtractionMessages,
  parseExtractionResponse,
  mergeExtractedData,
  checkCompletion,
} = require("./extractionPrompt");
const {
  buildContextWindow,
  buildDocumentContext,
} = require("./conversationManager");

// ── Anthropic client ──────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const AI_MODEL = "claude-3-5-haiku-20241022"; // Fast, cost-effective for chat

// ── System prompt for interview ───────────────────────────────────────────────

const INTERVIEW_SYSTEM_PROMPT = `
You are Wheedle AI, a friendly and professional proposal assistant.
Your goal is to gather all information needed to generate a business proposal through natural conversation.

BEHAVIOR RULES:
1. Ask ONE focused question at a time — never multiple questions in a single message.
2. Keep responses concise (2-4 sentences max for most replies).
3. Be conversational and professional, not robotic.
4. After the user answers, acknowledge briefly, then ask the next most relevant question.
5. Dynamically adapt your questions based on the INDUSTRY detected from context:
   - Solar/Energy: capacity, roof vs ground, electricity bill, subsidy eligibility, timeline, budget
   - IT/Software: number of users, key features, tech stack preference, deployment (cloud/on-premise), timeline, budget
   - Construction: area/sqft, type of construction, materials preference, local regulations, timeline, budget
   - Healthcare: type of service, regulatory compliance needs, number of beds/staff, equipment, timeline, budget
   - Real Estate: property type, area, location, number of units, amenities, timeline, budget
   - General: scope of work, deliverables, success criteria, timeline, budget
6. Do NOT ask for information the user has already provided.
7. Once you have: client info, business type, project scope, timeline, and budget — respond with:
   "I have everything I need to create your proposal! Click 'Generate Proposal' to proceed."
   and set completed = true in your JSON.

RESPONSE FORMAT:
You MUST respond with ONLY this JSON structure (no extra text, no markdown):
{
  "reply": "Your conversational response here",
  "extracted": {
    "fieldName": "value extracted from this specific message (only new data)"
  },
  "completed": false,
  "missingFields": ["list", "of", "still", "missing", "required", "fields"]
}

Required fields to collect: clientName, businessType, proposalType, projectSummary, budget, timeline
`.trim();

const DOCUMENT_SYSTEM_PROMPT = `
You are Wheedle AI, a professional proposal assistant with document analysis capabilities.
The user has uploaded a requirement document. Your job is to:
1. Analyze the document + user's message
2. Extract all proposal-relevant information
3. Ask ONE clarification question if critical information is missing
4. Or confirm readiness to generate if information is sufficient

RESPONSE FORMAT (ONLY this JSON, no other text):
{
  "reply": "Your response acknowledging the document and either asking a clarification or confirming readiness",
  "extracted": {
    "fieldName": "extracted value"
  },
  "completed": false,
  "missingFields": ["fields", "still", "needed"]
}

Be specific about what you found in the document and what (if anything) is still needed.
`.trim();

// ── Opening message ───────────────────────────────────────────────────────────

/**
 * Generate the AI's opening message for a new interview session.
 */
async function getOpeningMessage() {
  return {
    reply: "Hi! I'm Wheedle AI, and I'll help you create a professional proposal. To get started — tell me about your project. What kind of work or service are you proposing?",
    extracted: {},
    completed: false,
    missingFields: ["clientName", "businessType", "proposalType", "projectSummary", "budget", "timeline"],
  };
}

// ── Process interview message ─────────────────────────────────────────────────

/**
 * Process a user message in interview mode (Flow 1).
 *
 * @param {Array}  allMessages    - Full message history from DB
 * @param {string} userMessage    - The new user message
 * @param {object} currentExtracted - Currently extracted data from DB
 * @returns {Promise<{ reply, extracted, completed, missingFields }>}
 */
async function processInterviewMessage(allMessages, userMessage, currentExtracted = {}) {
  // Build context window (respects token limits)
  const contextMessages = buildContextWindow(allMessages);

  // Add the new user message
  const messages = [
    ...contextMessages,
    { role: "user", content: userMessage },
  ];

  // Call AI for conversational reply + extraction
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 600,
    system: INTERVIEW_SYSTEM_PROMPT,
    messages,
  });

  const rawText = response.content[0]?.text || "";
  const parsed = safeParseAIResponse(rawText);

  // Merge extracted data with existing
  const mergedExtracted = mergeExtractedData(currentExtracted, parsed.extracted || {});
  const { completed, missingFields } = checkCompletion(mergedExtracted);

  return {
    reply: parsed.reply || "Could you tell me more about your project?",
    extracted: parsed.extracted || {},
    completed: parsed.completed || completed,
    missingFields: parsed.missingFields || missingFields,
  };
}

// ── Process document + chat message ──────────────────────────────────────────

/**
 * Process a message that includes document context (Flow 2).
 *
 * @param {Array}  allMessages    - Full message history
 * @param {string} userMessage    - User's chat message
 * @param {Array}  documents      - Uploaded documents array from DB
 * @param {object} currentExtracted - Currently extracted data
 * @returns {Promise<{ reply, extracted, completed, missingFields }>}
 */
async function processDocumentMessage(allMessages, userMessage, documents, currentExtracted = {}) {
  const documentContext = buildDocumentContext(documents);

  // Build context window with document
  const contextMessages = buildContextWindow(allMessages, documentContext);

  const messages = [
    ...contextMessages,
    { role: "user", content: userMessage },
  ];

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 800,
    system: DOCUMENT_SYSTEM_PROMPT,
    messages,
  });

  const rawText = response.content[0]?.text || "";
  const parsed = safeParseAIResponse(rawText);

  // Run a separate extraction pass over the document content for structured data
  const docExtracted = await extractFromDocument(documentContext, userMessage);

  // Merge: document extraction + conversation extraction + existing
  const mergedExtracted = mergeExtractedData(
    mergeExtractedData(currentExtracted, docExtracted),
    parsed.extracted || {}
  );

  const { completed, missingFields } = checkCompletion(mergedExtracted);

  return {
    reply: parsed.reply || "I've analyzed your document. Let me ask a quick clarification...",
    extracted: { ...docExtracted, ...(parsed.extracted || {}) },
    completed: parsed.completed || completed,
    missingFields: parsed.missingFields || missingFields,
  };
}

// ── Document-only extraction ──────────────────────────────────────────────────

/**
 * Run a structured extraction pass on document + user prompt.
 * Returns cleaned extracted data object.
 */
async function extractFromDocument(documentText, userPrompt = "") {
  try {
    const { systemPrompt, userMessage } = buildExtractionMessages(
      userPrompt ? [{ role: "user", content: userPrompt }] : [],
      documentText
    );

    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const rawText = response.content[0]?.text || "";
    return parseExtractionResponse(rawText);
  } catch (err) {
    console.error("[chatinterview] Document extraction failed:", err.message);
    return {};
  }
}

// ── Full extraction pass ──────────────────────────────────────────────────────

/**
 * Run a full extraction pass over the entire conversation history.
 * Called when user hits "Generate Proposal" to finalize extractedData.
 *
 * @param {Array}  messages   - Full message history
 * @param {string} docContext - Document context (if any)
 * @returns {Promise<object>} - Extracted data
 */
async function runFullExtraction(messages, docContext = "") {
  try {
    const { systemPrompt, userMessage } = buildExtractionMessages(messages, docContext);

    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    return parseExtractionResponse(response.content[0]?.text || "");
  } catch (err) {
    console.error("[chatinterview] Full extraction failed:", err.message);
    return {};
  }
}

// ── Safe JSON parser ──────────────────────────────────────────────────────────

/**
 * Safely parse AI response that should be JSON.
 * Returns a safe fallback if parsing fails (never crashes).
 */
function safeParseAIResponse(rawText) {
  try {
    let text = rawText.trim();
    text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(text);
  } catch {
    // Fallback: extract JSON object from text
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // Last resort: return a plain text reply
        return {
          reply: rawText.slice(0, 500),
          extracted: {},
          completed: false,
          missingFields: [],
        };
      }
    }
    return {
      reply: rawText.slice(0, 500) || "I couldn't process that. Could you rephrase?",
      extracted: {},
      completed: false,
      missingFields: [],
    };
  }
}

module.exports = {
  getOpeningMessage,
  processInterviewMessage,
  processDocumentMessage,
  runFullExtraction,
};