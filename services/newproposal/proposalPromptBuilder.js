exports.buildProposalPrompt = (p) => {
  return `
Generate a PREMIUM BUSINESS PROPOSAL in professional HTML format.

Business Type:
${p.businessType}

Proposal Type:
${p.proposalType}

Client:
${p.clientName}
${p.clientCompany}

Proposal Title:
${p.proposalTitle}

Project Summary:
${p.projectSummary}

Services:
${p.services
  ?.map(
    (s) =>
      `${s.name} - ${s.description}`
  )
  .join("\n")}

Pricing:
${p.lineItems
  ?.map(
    (i) =>
      `${i.description}
Qty:${i.qty}
Price:${i.unitPrice}`
  )
  .join("\n")}

Timeline:
Start: ${p.startDate}
End: ${p.endDate}

Milestones:
${p.milestones
  ?.map(
    (m) =>
      `${m.title}
${m.description}`
  )
  .join("\n")}

IMPORTANT:

Generate PROFESSIONAL CLIENT READY proposal.

Use HTML.

Must include:

- Cover title
- Executive Summary
- Business Overview
- Problem Statement
- Proposed Solution
- Scope Of Work
- Services
- Pricing Table
- Timeline
- Benefits / ROI
- Terms
- Closing

Formatting Rules:

Use:

<h1>
<h2>
<p>
<ul>
<li>
<table>

Use premium unicode icons.

Examples:

✔
⭐
📈
💡
🚀
📌

Requirements:

- Clean spacing
- Bullet points
- Short readable paragraphs
- Pricing in table
- Timeline in list/table
- Client friendly language
- Professional consulting style
- Do NOT return markdown
- Return VALID HTML ONLY
`;
};