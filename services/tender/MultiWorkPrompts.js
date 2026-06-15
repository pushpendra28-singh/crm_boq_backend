/**
 * MULTI-WORK BOQ — AI Prompt Logic
 * Drop-in replacement for the prompt/chat functions in your existing aiService.js
 * All other exports (chat, generateProposal, generateProposalFromPrompt) remain unchanged.
 * Only the MULTI-WORK flow is added here.
 */

/* ═══════════════════════════════════════════════════════════════
   SYSTEM PROMPT — Multi-Work Requirements Collector
   Strategy: 2 rounds max, grouped questions, minimal friction.
   Round 1 → project-level + identify all work types
   Round 2 → fill gaps per work type if needed, then READY
═══════════════════════════════════════════════════════════════ */
const MULTI_WORK_SYSTEM_PROMPT = `You are a professional Requirements Analyst specializing in multi-scope BOQ documents.

Your goal: collect enough information to generate a comprehensive BOQ covering MULTIPLE work types in a single document.

STRICT RULES:
1. Ask questions in GROUPED blocks — never one at a time.
2. MAX 2 question rounds. After round 2 (or earlier if sufficient), output ##READY_TO_GENERATE## on its own line.
3. Round 1: Ask 4–6 grouped questions covering:
   - Project name, location, total area/scale
   - List of ALL work types required (e.g. civil, flooring, electrical, CCTV, plumbing, painting, HVAC, etc.)
   - Overall budget range (total or per-work)
   - Timeline / deadline
   - Quality/specification level (economy / standard / premium)
4. Round 2 (only if gaps remain): Ask work-type-specific follow-ups in ONE grouped block. If round 1 gave enough, skip round 2 and output ##READY_TO_GENERATE## immediately.
5. Format questions as a clean numbered list. Be concise and professional.
6. Adapt intelligently — a building project asks about floors/structure; an IT project asks about servers/cabling.
7. After collecting info, confirm the works list back to the user before outputting ##READY_TO_GENERATE##.

QUESTION BLOCK FORMAT:
"To build your multi-work BOQ accurately, please answer:

1. [Project name, location, total built-up area or scale]
2. [List ALL work types needed — be specific]
3. [Budget: overall or per work category]
4. [Timeline / completion deadline]
5. [Quality level: Economy / Standard / Premium / as per spec]
6. [Any specific brands, standards, or compliance requirements?]"`;

/* ═══════════════════════════════════════════════════════════════
   MULTI-WORK BOQ GENERATION PROMPT
   Generates structured markdown that both DOCX and XLSX parsers can consume.
   Each work type gets its own ## section with a pipe-delimited BOQ table.
═══════════════════════════════════════════════════════════════ */
const buildMultiWorkBOQPrompt = (history) => {
  const conversation = history
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "CLIENT" : "ANALYST"}: ${m.content}`)
    .join("\n\n");

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
  const ref = `BOQ-${Date.now().toString().slice(-6)}`;

  return `You are a senior quantity surveyor. Based on the requirements below, generate a comprehensive multi-work BOQ document.

REQUIREMENTS GATHERED:
${conversation}

OUTPUT RULES (CRITICAL — follow exactly):
1. Each work type must be a separate ## section with its own BOQ table.
2. BOQ tables must use PIPE-DELIMITED format with exactly 6 columns: Sl No | Item Description | Unit | Qty | Unit Rate (₹) | Amount (₹)
3. For Unit Rate and Amount: use realistic market estimates for India. Mark as "(est.)" if not specified by client.
4. Include at least 8–15 line items per work type based on realistic scope.
5. At the end, include a ## SUMMARY TABLE section with one row per work type showing subtotal amounts.
6. Use ## for section headers, | for table columns, and - for bullet lists.
7. Project Title in Section 1 must be a clean professional name.

Generate the full document now:

## 1. PROJECT OVERVIEW
- Project Title: [clean name]
- Location: [from conversation]
- Total Scale / Area: [from conversation]
- Quality Level: [from conversation]
- Prepared By: Requirements BOQ System
- Prepared Date: ${today}
- Document Reference: ${ref}
- Works Covered: [list all work types]

## 2. EXECUTIVE SUMMARY
[2–3 paragraphs: project background, scope, objectives]

## 3. SCOPE OF WORK — CONSOLIDATED
[Bullet list of all work categories and brief scope for each]

---
[For EACH work type, repeat the following block:]

## [WORK TYPE NAME] — REQUIREMENTS & BOQ

### Scope
[3–5 bullet points specific to this work type]

### Bill of Quantities
| Sl No | Item Description | Unit | Qty | Unit Rate (₹) | Amount (₹) |
|-------|-----------------|------|-----|--------------|------------|
| 1 | [item] | [unit] | [qty] | [rate] | [amount] |
... (minimum 8 rows per work type)

### Technical Specifications
[Key specs, standards, brands for this work type]

### Timeline
[Duration estimate for this work type]

---
[Repeat block for each work type]
---

## SUMMARY TABLE

| # | Work Category | No. of Items | Estimated Amount (₹) |
|---|--------------|-------------|----------------------|
| 1 | [Work 1] | [count] | [subtotal] |
...
| | **GRAND TOTAL** | | **[total]** |

## TERMS & CONDITIONS
- All rates inclusive of material, labour, and installation unless noted
- Quantities are estimated; final measurement on actual work
- Validity: 30 days from quotation date
- Payment: As per mutually agreed milestone schedule
- Warranty: Minimum 1 year on all workmanship

## VENDOR SUBMISSION INSTRUCTIONS
- Submit itemised quotation matching this BOQ format
- Include GST breakup separately
- Attach company profile and past project references
- Submission deadline: [To be specified by client]`;
};

/* ═══════════════════════════════════════════════════════════════
   MULTI-WORK DOC-FLOW PROMPT
   Used when user uploads a document + optional prompt
═══════════════════════════════════════════════════════════════ */
const buildMultiWorkDocBOQPrompt = (userPrompt, docFileName, docText) => {
  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });
  const ref = `BOQ-${Date.now().toString().slice(-6)}`;

  const docSection = docText && docText.trim().length > 50
    ? `UPLOADED DOCUMENT ("${docFileName}"):\n---\n${docText.slice(0, 12000)}${docText.length > 12000 ? "\n[truncated]" : ""}\n---`
    : `NOTE: File "${docFileName}" could not be read. Use user prompt as sole source.`;

  const promptSection = userPrompt && userPrompt.trim()
    ? `USER REQUIREMENTS (treat as PRIMARY):\n"${userPrompt.trim()}"`
    : `USER REQUIREMENTS: None provided.`;

  return `You are a senior quantity surveyor. Generate a comprehensive multi-work BOQ from the sources below.

${docSection}

${promptSection}

OUTPUT RULES (CRITICAL):
1. Each work type = separate ## section with its own pipe-delimited BOQ table.
2. BOQ table columns (exactly 6): Sl No | Item Description | Unit | Qty | Unit Rate (₹) | Amount (₹)
3. Use realistic Indian market rates. Mark estimates as "(est.)".
4. Minimum 8–15 line items per work type.
5. End with ## SUMMARY TABLE.
6. Prepared Date: ${today} | Ref: ${ref}

Generate the full document with this structure:

## 1. PROJECT OVERVIEW
- Project Title:
- Location:
- Total Scale / Area:
- Quality Level:
- Prepared Date: ${today}
- Document Reference: ${ref}
- Works Covered:

## 2. EXECUTIVE SUMMARY
[2–3 paragraphs]

## 3. SCOPE OF WORK — CONSOLIDATED
[Bullet list]

---
[For EACH work type found in sources:]

## [WORK TYPE] — REQUIREMENTS & BOQ

### Scope
[bullets]

### Bill of Quantities
| Sl No | Item Description | Unit | Qty | Unit Rate (₹) | Amount (₹) |
|-------|-----------------|------|-----|--------------|------------|
[rows...]

### Technical Specifications
[specs]

### Timeline
[duration]

---

## SUMMARY TABLE
| # | Work Category | No. of Items | Estimated Amount (₹) |
|---|--------------|-------------|----------------------|
[rows...]
| | **GRAND TOTAL** | | **[total]** |

## TERMS & CONDITIONS
- All rates inclusive of material, labour, installation unless noted
- Quantities estimated; final on actual measurement
- Validity: 30 days | Warranty: 1 year on workmanship

## VENDOR SUBMISSION INSTRUCTIONS
- Submit itemised quotation matching BOQ format
- Include GST breakup separately
- Attach company profile and references`;
};

module.exports = {
  MULTI_WORK_SYSTEM_PROMPT,
  buildMultiWorkBOQPrompt,
  buildMultiWorkDocBOQPrompt,
};