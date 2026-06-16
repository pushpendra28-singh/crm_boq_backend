const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ═══════════════════════════════════════════════════════════════
   SYSTEM PROMPT — now gathers MULTI-WORK requirements
   Collects all sub-works in one chat, generates structured BOQ
═══════════════════════════════════════════════════════════════ */
const SYSTEM_PROMPT = `You are a professional Requirements Analyst specializing in multi-work construction and infrastructure projects. Your task is to gather enough information to create a detailed, multi-section BOQ (Bill of Quantities) covering ALL work categories in a single Excel document.

STRICT RULES:
1. Ask questions in GROUPED blocks — not one by one. Each block covers multiple unknowns together.
2. You ask AT MOST 2 question rounds total. After round 2 (or if you have enough info after round 1), output ##READY_TO_GENERATE## on its own line.
3. In Round 1: Ask grouped questions covering:
   - What is the project? (type, location, total area/scale)
   - What are ALL the work categories involved? (prompt examples: civil, electrical, HVAC, CCTV, flooring, furniture, plumbing, fire safety, networking, IT, painting, etc.)
   - Budget range and timeline
   - Quality/specification level (basic / standard / premium)
4. In Round 2 (if needed): Ask only specific follow-up questions per major work category they listed (quantities, brands, standards).
5. Format questions as a numbered list — clean, scannable, easy to answer.
6. Be concise and professional. No filler phrases.

QUESTION BLOCK FORMAT:
"To create your complete multi-work BOQ accurately, please answer:

1. [Project type, location, and total scale/area]
2. [List ALL work categories you need included — e.g. electrical, CCTV, plumbing, flooring, furniture, civil, HVAC, networking, etc.]
3. [Budget range — total or per category if known]
4. [Timeline/deadline for the project]
5. [Specification level: Basic / Standard / Premium, and any specific brands/standards required]"`;

/* ═══════════════════════════════════════════════════════════════
   MULTI-WORK BOQ GENERATION PROMPT
═══════════════════════════════════════════════════════════════ */
const buildBOQPrompt = (history) => {
  const conversation = history
    .filter(m => m.role !== "system")
    .map(m => `${m.role === "user" ? "CLIENT" : "ANALYST"}: ${m.content}`)
    .join("\n\n");

  return `You are a senior quantity surveyor specializing in multi-work construction/infrastructure projects. Based on the requirements gathered, create a comprehensive multi-work BOQ (Bill of Quantities) structured for Excel export.

REQUIREMENTS GATHERED:
${conversation}

CRITICAL OUTPUT FORMAT RULES:
1. Use ## for main section headings, ### for EACH work category inside the BOQ section.
2. Under each ### work category, provide a pipe-delimited table of line items.
3. Include ALL work categories mentioned by the client. Each becomes its own section.
4. Be SPECIFIC with quantities, units, and specifications.
5. Mark estimates clearly with "(est.)".

Generate the BOQ with this EXACT structure:

## 1. PROJECT OVERVIEW
- Project Title: [clean professional name]
- Project Type & Category: [multi-work construction/renovation/etc.]
- Client / Organization: [as mentioned or "As Specified"]
- Project Location: [as mentioned]
- Total Project Area: [if mentioned]
- Specification Level: [Basic/Standard/Premium]
- Prepared Date: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
- Document Reference: BOQ-${Date.now().toString().slice(-6)}

## 2. EXECUTIVE SUMMARY
[2–3 paragraph summary covering all work categories, project scope, and objectives]

## 3. BILL OF QUANTITIES (BOQ)

[For EACH work category mentioned by the client, create a subsection:]

### [Work Category Name — e.g. Electrical Works]
| S.No. | Item Description | Unit | Est. Qty | Specifications / Notes |
|-------|-----------------|------|----------|------------------------|
| 1 | [item] | [unit] | [qty] | [specs] |
[minimum 5-8 items per category]

### [Next Work Category — e.g. CCTV & Security]
| S.No. | Item Description | Unit | Est. Qty | Specifications / Notes |
|-------|-----------------|------|----------|------------------------|
| 1 | [item] | [unit] | [qty] | [specs] |

[Continue for ALL work categories — do NOT skip any mentioned by client]

## 4. MATERIAL SPECIFICATIONS
[Per category: quality grade, brands, standards]

## 5. TIMELINE & MILESTONES
[Phase-wise with durations per work category if possible]

## 6. BUDGET ESTIMATE SUMMARY
[Category-wise estimated budget breakdown]

## 7. VENDOR REQUIREMENTS
[Required qualifications, certifications, warranties per work category]

## 8. TERMS & CONDITIONS
- Quotation validity: 30 days
- Payment terms: As per project agreement
- Warranty: Minimum 1 year on workmanship, as per manufacturer on materials
- Submission: Itemized quotation with make/model for each line item

Be thorough and professional. Every work category must have its own ### subsection with a complete pipe table. This feeds directly into Excel sheet generation.`;
};

/* ═══════════════════════════════════════════════════════════════
   DOC FLOW PROMPT — Multi-work from uploaded document
═══════════════════════════════════════════════════════════════ */
const buildDocBOQPrompt = (userPrompt, docFileName, docText) => {
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const ref = `BOQ-${Date.now().toString().slice(-6)}`;

  const docSection = docText && docText.trim().length > 50
    ? `UPLOADED DOCUMENT CONTENT ("${docFileName}"):
---
${docText.slice(0, 12000)}${docText.length > 12000 ? "\n\n[Document truncated]" : ""}
---`
    : `NOTE: Uploaded file ("${docFileName}") could not be read. Use the user prompt as the sole source.`;

  const promptSection = userPrompt && userPrompt.trim()
    ? `USER'S PROJECT DESCRIPTION (treat as PRIMARY requirements):\n"${userPrompt.trim()}"`
    : `USER'S DESCRIPTION: None provided.`;

  return `You are a senior quantity surveyor specializing in multi-work construction/infrastructure projects.

Create a comprehensive MULTI-WORK BOQ structured for Excel export. Identify ALL distinct work categories from the sources below and create a separate BOQ section for each.

INSTRUCTIONS:
1. Extract every distinct work category from both sources (e.g. electrical, CCTV, plumbing, civil, flooring, furniture, HVAC, networking, fire safety, painting, etc.)
2. Each work category MUST become its own ### subsection with a full pipe-table of line items.
3. Use actual figures/specs from the document. Estimate clearly with "(est.)" where not specified.
4. The Project Title must be a clean professional name.

${docSection}

${promptSection}

Generate with this EXACT structure:

## 1. PROJECT OVERVIEW
- Project Title: [clean name]
- Project Type & Category: Multi-Work Project
- Client / Organization: [from doc or "As Specified"]
- Project Location: [from doc or "As Specified"]
- Total Area/Scale: [from doc or "(est.)"]
- Prepared Date: ${today}
- Document Reference: ${ref}

## 2. EXECUTIVE SUMMARY
[2–3 paragraphs covering all identified work categories and project scope]

## 3. BILL OF QUANTITIES (BOQ)

### [Work Category 1 — e.g. Civil & Structural Works]
| S.No. | Item Description | Unit | Est. Qty | Specifications / Notes |
|-------|-----------------|------|----------|------------------------|
| 1 | [item] | [unit] | [qty] | [specs] |
[5-10 items minimum]

### [Work Category 2 — e.g. Electrical Works]
| S.No. | Item Description | Unit | Est. Qty | Specifications / Notes |
|-------|-----------------|------|----------|------------------------|
[items...]

[Continue for EVERY identified work category]

## 4. MATERIAL SPECIFICATIONS
[Per category specifications]

## 5. TIMELINE & MILESTONES
[Phase-wise plan]

## 6. BUDGET ESTIMATE SUMMARY
[Category-wise budget]

## 7. VENDOR REQUIREMENTS
[Qualifications, certifications, warranties]

## 8. TERMS & CONDITIONS
- Quotation validity: 30 days
- Payment terms: As per agreement
- Warranty: Minimum 1 year workmanship
- Submission: Itemized quotation with make/model

Every work category must have its own ### subsection with pipe table. Be thorough.`;
};

/* ═══════════════════════════════════════════════════════════════
   EXPORTS — same interface as before
═══════════════════════════════════════════════════════════════ */
const chat = async (conversationHistory, userMessage) => {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", messages, temperature: 0.5, max_tokens: 700,
  });
  const aiMessage = response.choices[0].message.content.trim();
  const isReady = aiMessage.includes("##READY_TO_GENERATE##");
  const displayMessage = aiMessage.replace("##READY_TO_GENERATE##", "").trim();
  return { aiMessage: displayMessage, isReady };
};

const generateProposal = async (conversationHistory) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: buildBOQPrompt(conversationHistory) }],
    temperature: 0.3, max_tokens: 4000,
  });
  return response.choices[0].message.content.trim();
};

const generateProposalFromPrompt = async (userPrompt, docFileName, docText = "") => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: buildDocBOQPrompt(userPrompt, docFileName, docText) }],
    temperature: 0.3, max_tokens: 4500,
  });
  return response.choices[0].message.content.trim();
};

module.exports = { chat, generateProposal, generateProposalFromPrompt };