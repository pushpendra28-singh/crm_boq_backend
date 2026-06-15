const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ═══════════════════════════════════════════════════════════════
   SYSTEM PROMPT  (unchanged — drives the manual Q&A flow)
═══════════════════════════════════════════════════════════════ */
const SYSTEM_PROMPT = `You are a professional Requirements Analyst. Your task is to gather enough information to create a detailed BOQ (Bill of Quantities / Requirements Document) for a project.

STRICT RULES:
1. You ask questions in GROUPED blocks — not one by one. Each block covers multiple related unknowns in a single message.
2. You ask AT MOST 2 question rounds total. After round 2 (or earlier if you have enough info), you MUST output the token ##READY_TO_GENERATE## on its own line.
3. In Round 1: Based on the user's description, ask a grouped block of 3–5 critical clarifying questions covering: scope, quantities/scale, budget range, timeline, quality/specification level, and location/site details relevant to the project type.
4. In Round 2 (only if needed): Ask only 1–3 remaining critical questions you still need. If you have enough after Round 1, skip Round 2 and output ##READY_TO_GENERATE## immediately.
5. Format your question blocks as a numbered list — clean, scannable, easy to answer.
6. Be concise and professional. No filler phrases.
7. Adapt questions intelligently to the project type (construction questions differ from IT questions, interior differs from landscaping, etc.).

QUESTION BLOCK FORMAT:
"To create your BOQ accurately, please answer:

1. [Question about scope/scale/quantities]
2. [Question about budget or cost bracket]
3. [Question about timeline/deadline]
4. [Question about specifications/quality level]
5. [Question about location/site/vendor requirements — if relevant]"`;

/* ═══════════════════════════════════════════════════════════════
   BOQ GENERATION PROMPT  (manual chat flow — unchanged)
═══════════════════════════════════════════════════════════════ */
const buildBOQPrompt = (history) => {
  const conversation = history
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "CLIENT" : "ANALYST"}: ${m.content}`)
    .join("\n\n");

  return `You are a senior quantity surveyor and technical writer. Based on the requirements gathered below, create a comprehensive, professional BOQ (Bill of Quantities) and Requirements Document.

REQUIREMENTS GATHERED:
${conversation}

Generate a detailed BOQ document with the following structure. Be SPECIFIC — use real units, quantities, and specifications based on what the client told you. Fill in reasonable professional estimates where exact figures were not provided, clearly marking them as "estimated".

## 1. PROJECT OVERVIEW
- Project Title
- Project Type & Category
- Client / Organization
- Project Location
- Prepared Date: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
- Document Reference: BOQ-${Date.now().toString().slice(-6)}

## 2. EXECUTIVE SUMMARY
[2–3 paragraph professional summary of the project, its objectives, and scope]

## 3. SCOPE OF WORK
[Detailed bullet-point breakdown of all work to be performed, organized by work category]

## 4. BILL OF QUANTITIES (BOQ)
[Create a structured table-friendly list with this format for EACH line item:]
ITEM NO. | DESCRIPTION | UNIT | ESTIMATED QTY | SPECIFICATION/NOTES

Group items by work category (e.g., Civil Works, Electrical Works, Finishing Works, etc.)
Include at minimum 10–15 line items based on the project type.

## 5. MATERIAL SPECIFICATIONS
[For each major material category, specify: quality grade, brand recommendations if applicable, standards to comply with]

## 6. TECHNICAL REQUIREMENTS
[Any technical standards, certifications, compliance requirements, drawings/design requirements]

## 7. TIMELINE & MILESTONES
[Phase-wise timeline with estimated durations]

## 8. BUDGET ESTIMATE SUMMARY
[Category-wise budget breakdown as provided/estimated]

## 9. VENDOR REQUIREMENTS
[What the vendor/contractor must provide: experience, certifications, insurance, warranties, etc.]

## 10. TERMS & CONDITIONS FOR QUOTATION
- Quotation validity period
- Payment terms
- Penalty clauses
- Warranty requirements
- Submission deadline

## 11. SUBMISSION INSTRUCTIONS
[How vendors should submit their proposals, format, contact details placeholders]

---
Use ## for section headers and structured lists. Be thorough, precise, and professional. This document will be sent to vendors for quoting.`;
};

/* ═══════════════════════════════════════════════════════════════
   DOC FLOW PROMPT
   KEY FIX: now receives actual extracted document text.
   The prompt tells the AI to treat the doc as the primary source
   and the user's text prompt as supplementary context only.
═══════════════════════════════════════════════════════════════ */
const buildDocBOQPrompt = (userPrompt, docFileName, docText) => {
  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
  const ref = `BOQ-${Date.now().toString().slice(-6)}`;

  // Decide how to present the document content
  const docSection = docText && docText.trim().length > 50
    ? `UPLOADED DOCUMENT CONTENT ("${docFileName}"):
---
${docText.slice(0, 12000)}${docText.length > 12000 ? "\n\n[Document truncated — first 12,000 characters shown]" : ""}
---`
    : `NOTE: The uploaded file ("${docFileName}") could not be read or was empty. Use the user's prompt as the sole source.`;

   const promptSection = userPrompt && userPrompt.trim()
    ? `USER'S ADDITIONAL REQUIREMENTS (treat as PRIMARY — integrate all points into the BOQ):
"${userPrompt.trim()}"`
    : `USER'S ADDITIONAL REQUIREMENTS: None provided.`;

  
  return `You are a senior quantity surveyor and technical writer.

Your task is to create a comprehensive BOQ (Bill of Quantities) and Requirements Document that will be sent to vendors for quotation.

INSTRUCTIONS:
1. You have TWO equally important input sources — treat BOTH as PRIMARY. Analyze and synthesize them together.
2. UPLOADED DOCUMENT: Extract all project details, specifications, quantities, materials, scope items, timelines, and budget information directly from it.
3. USER'S ADDITIONAL REQUIREMENTS: Treat these as additional project requirements with equal weight — integrate every point mentioned into the relevant BOQ sections. Do NOT treat them as mere hints or overrides; they are real requirements that must appear in the Scope of Work, BOQ line items, Technical Requirements, and wherever else applicable.
4. Where both sources provide information on the same topic, MERGE them — do not pick one over the other. Where they conflict, prefer the more specific/detailed source.
5. Every section must reflect BOTH sources. If the user's prompt mentions specific features, technologies, integrations, or constraints, they MUST appear as explicit line items or requirements in the BOQ.
6. Where neither source specifies a value (e.g. exact quantities), make reasonable professional estimates clearly marked as "(estimated)".
7. The Project Title in Section 1 must be a clean, professional project name (e.g. "E-commerce Website Development for Wheedle") — NOT a raw instruction or file name.

${docSection}

${promptSection}

Now generate the full BOQ document with ALL of these sections:

## 1. PROJECT OVERVIEW
- Project Title: [extract from document]
- Project Type & Category: [extract or infer]
- Client / Organization: [extract or write "As per document"]
- Project Location: [extract or write "As specified"]
- Prepared Date: ${today}
- Document Reference: ${ref}

## 2. EXECUTIVE SUMMARY
[2–3 paragraphs summarizing the project based on the document — objectives, scope, and significance]

## 3. SCOPE OF WORK
[Detailed bullet-point list of ALL work items found in the document, organized by category]

## 4. BILL OF QUANTITIES (BOQ)
[Extract or derive line items from the document. Format each as:]
ITEM NO. | DESCRIPTION | UNIT | ESTIMATED QTY | SPECIFICATION/NOTES

Group by work category. Include minimum 10–15 line items. Use actual figures from the document wherever available.

## 5. MATERIAL SPECIFICATIONS
[Extract material specs from the document. Include quality grades, standards, brand recommendations]

## 6. TECHNICAL REQUIREMENTS
[Extract all technical standards, compliance needs, certifications mentioned in the document]

## 7. TIMELINE & MILESTONES
[Extract timeline information from the document. If not present, suggest a reasonable phase-wise plan]

## 8. BUDGET ESTIMATE SUMMARY
[Extract budget figures from the document. If not specified, provide category-wise estimates marked as "estimated"]

## 9. VENDOR REQUIREMENTS
[List what vendors must provide: qualifications, certifications, insurance, warranties, references]

## 10. TERMS & CONDITIONS FOR QUOTATION
- Quotation validity period
- Payment terms
- Penalty clauses
- Warranty requirements
- Submission deadline

## 11. SUBMISSION INSTRUCTIONS
[Instructions for vendors on how to submit quotations]

Use ## for section headers and bullet points for lists. Be thorough, specific, and professional.`;
};

/* ═══════════════════════════════════════════════════════════════
   EXPORTS — same interface, no route changes needed
═══════════════════════════════════════════════════════════════ */

const chat = async (conversationHistory, userMessage) => {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.5,
    max_tokens: 600,
  });

  const aiMessage    = response.choices[0].message.content.trim();
  const isReady      = aiMessage.includes("##READY_TO_GENERATE##");
  const displayMessage = aiMessage.replace("##READY_TO_GENERATE##", "").trim();

  return { aiMessage: displayMessage, isReady };
};

const generateProposal = async (conversationHistory) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: buildBOQPrompt(conversationHistory) }],
    temperature: 0.3,
    max_tokens: 3000,
  });
  return response.choices[0].message.content.trim();
};

/**
 * NOW TAKES docText as third argument.
 * Called by tenderController.createFromDoc after extracting the file.
 */
const generateProposalFromPrompt = async (userPrompt, docFileName, docText = "") => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: buildDocBOQPrompt(userPrompt, docFileName, docText) }],
    temperature: 0.3,
    max_tokens: 3500,
  });
  return response.choices[0].message.content.trim();
};

module.exports = { chat, generateProposal, generateProposalFromPrompt };