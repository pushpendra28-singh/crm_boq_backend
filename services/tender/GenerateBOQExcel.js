/**
 * generateBOQExcel.js
 * Generates a professional multi-work BOQ Excel file from AI-generated markdown.
 * Uses ExcelJS for rich formatting — borders, colors, merged cells, auto-width.
 *
 * Returns a Buffer (xlsx bytes) so the controller can stream it directly.
 */

const ExcelJS = require("exceljs");

/* ─── Color palette ──────────────────────────────────────────── */
const COLORS = {
  // Header / title
  titleBg:       "1A3C5E",   // dark navy
  titleFg:       "FFFFFF",
  // Work-type section header
  sectionBg:     "2E7D32",   // dark green
  sectionFg:     "FFFFFF",
  // Column headers inside each BOQ table
  colHeaderBg:   "1565C0",   // deep blue
  colHeaderFg:   "FFFFFF",
  // Alternating row tints
  rowEven:       "EAF4FB",
  rowOdd:        "FFFFFF",
  // Summary sheet
  summaryHeader: "37474F",   // dark slate
  summaryFg:     "FFFFFF",
  grandTotalBg:  "E65100",   // deep orange
  grandTotalFg:  "FFFFFF",
  // Subtotal row
  subtotalBg:    "FFF9C4",   // light yellow
  subtotalFg:    "000000",
  // Border
  border:        "BDBDBD",
};

/* ─── Fonts ──────────────────────────────────────────────────── */
const FONT = {
  title:      { name: "Arial", size: 14, bold: true, color: { argb: "FF" + COLORS.titleFg } },
  section:    { name: "Arial", size: 11, bold: true, color: { argb: "FF" + COLORS.sectionFg } },
  colHeader:  { name: "Arial", size: 9,  bold: true, color: { argb: "FF" + COLORS.colHeaderFg } },
  body:       { name: "Arial", size: 9 },
  bodyBold:   { name: "Arial", size: 9,  bold: true },
  subtotal:   { name: "Arial", size: 9,  bold: true, color: { argb: "FF" + COLORS.subtotalFg } },
  grandTotal: { name: "Arial", size: 10, bold: true, color: { argb: "FF" + COLORS.grandTotalFg } },
  meta:       { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } },
};

/* ─── Thin border helper ─────────────────────────────────────── */
const thinBorder = () => ({
  top:    { style: "thin", color: { argb: "FF" + COLORS.border } },
  left:   { style: "thin", color: { argb: "FF" + COLORS.border } },
  bottom: { style: "thin", color: { argb: "FF" + COLORS.border } },
  right:  { style: "thin", color: { argb: "FF" + COLORS.border } },
});

const mediumBorder = () => ({
  top:    { style: "medium", color: { argb: "FF" + COLORS.border } },
  left:   { style: "medium", color: { argb: "FF" + COLORS.border } },
  bottom: { style: "medium", color: { argb: "FF" + COLORS.border } },
  right:  { style: "medium", color: { argb: "FF" + COLORS.border } },
});

/* ─── Fill helper ────────────────────────────────────────────── */
const solidFill = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });

/* ─── Alignment shortcuts ────────────────────────────────────── */
const centerMiddle = { horizontal: "center", vertical: "middle", wrapText: true };
const leftMiddle   = { horizontal: "left",   vertical: "middle", wrapText: true };
const rightMiddle  = { horizontal: "right",  vertical: "middle", wrapText: true };

/* ─── Number format ──────────────────────────────────────────── */
const INR_FORMAT  = '₹#,##0.00;(₹#,##0.00);"-"';
const NUM_FORMAT  = '#,##0.00;(#,##0.00);"-"';

/* ════════════════════════════════════════════════════════════════
   PARSER — converts AI markdown into structured data
════════════════════════════════════════════════════════════════ */

/**
 * Parse the markdown BOQ into:
 *   overview: { title, location, area, quality, preparedDate, ref, worksCovered }
 *   workSections: [{ name, scope[], rows[], specs[], timeline }]
 *   summaryRows: [{ category, itemCount, amount }]
 */
function parseMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);

  // ── Overview extraction ──
  const overview = {
    title:        extractField(markdown, "Project Title"),
    location:     extractField(markdown, "Location"),
    area:         extractField(markdown, "Total Scale") || extractField(markdown, "Area"),
    quality:      extractField(markdown, "Quality Level"),
    preparedDate: extractField(markdown, "Prepared Date"),
    ref:          extractField(markdown, "Document Reference"),
    worksCovered: extractField(markdown, "Works Covered"),
  };

  // ── Work sections ──
  const workSections = [];
  let currentSection = null;
  let inBOQ = false;
  let inScope = false;
  let inSpecs = false;
  let inTimeline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect work-type section header: ## WORK TYPE — REQUIREMENTS & BOQ
    // But skip PROJECT OVERVIEW, EXECUTIVE SUMMARY, SCOPE, SUMMARY TABLE, TERMS, VENDOR
    if (/^##\s+/.test(line) && !isMeta(line)) {
      if (currentSection) workSections.push(currentSection);
      const name = line.replace(/^##\s+/, "")
        .replace(/\s*[—–-]+\s*(REQUIREMENTS\s*&\s*BOQ|BOQ)?/i, "")
        .trim();
      currentSection = { name, scope: [], rows: [], specs: [], timeline: "" };
      inBOQ = false; inScope = false; inSpecs = false; inTimeline = false;
      continue;
    }

    if (!currentSection) continue;

    // Sub-section markers
    if (/^###\s+Scope/i.test(line))          { inScope = true;  inBOQ = false; inSpecs = false; inTimeline = false; continue; }
    if (/^###\s+Bill of Quantities/i.test(line)) { inBOQ = true; inScope = false; inSpecs = false; inTimeline = false; continue; }
    if (/^###\s+Technical Spec/i.test(line)) { inSpecs = true;  inBOQ = false; inScope = false; inTimeline = false; continue; }
    if (/^###\s+Timeline/i.test(line))       { inTimeline = true; inBOQ = false; inScope = false; inSpecs = false; continue; }

    // Scope bullets
    if (inScope && /^[-*]\s+/.test(line)) {
      currentSection.scope.push(line.replace(/^[-*]\s+/, "").trim());
    }

    // BOQ table rows
    if (inBOQ && line.startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length >= 5) {
        // Skip header and separator rows
        const isSeparator = cells.every(c => /^[-:]+$/.test(c));
        const isHeader    = cells.some(c => /sl\s*no|item\s*desc|unit\s*rate/i.test(c));
        if (!isSeparator && !isHeader) {
          const [slNo, desc, unit, qty, rate, amount] = cells;
          if (desc && desc.length > 1) {
            currentSection.rows.push({
              slNo:   slNo   || "",
              desc:   desc   || "",
              unit:   unit   || "",
              qty:    parseAmount(qty),
              rate:   parseAmount(rate),
              amount: parseAmount(amount),
            });
          }
        }
      }
    }

    // Specs
    if (inSpecs && line.length > 2) {
      currentSection.specs.push(line.replace(/^[-*]\s+/, "").trim());
    }

    // Timeline
    if (inTimeline && line.length > 2 && !line.startsWith("#")) {
      currentSection.timeline += (currentSection.timeline ? " " : "") + line.replace(/^[-*]\s+/, "").trim();
    }
  }

  if (currentSection) workSections.push(currentSection);

  // ── Summary rows ──
  const summaryRows = extractSummaryRows(markdown);

  return { overview, workSections: workSections.filter(s => s.rows.length > 0), summaryRows };
}

function isMeta(line) {
  return /PROJECT OVERVIEW|EXECUTIVE SUMMARY|SCOPE OF WORK|SUMMARY TABLE|TERMS|VENDOR SUBMISSION|CONSOLIDATED/i.test(line);
}

function extractField(text, label) {
  const re = new RegExp(`${label}[:\\s*]+([^\\n\\r]+)`, "i");
  const m  = text.match(re);
  if (!m) return "";
  return m[1].replace(/\*\*/g, "").replace(/^[-:]\s*/, "").trim();
}

function parseAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[₹,\s(est\.)]/gi, "").replace(/[()]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function extractSummaryRows(markdown) {
  const rows = [];
  const summaryMatch = markdown.match(/##\s*SUMMARY TABLE[\s\S]*?(?=##|$)/i);
  if (!summaryMatch) return rows;

  const tableLines = summaryMatch[0].split(/\r?\n/).filter(l => l.includes("|"));
  for (const line of tableLines) {
    const cells = line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 3) continue;
    const isSep    = cells.every(c => /^[-:*\s]+$/.test(c));
    const isHeader = cells.some(c => /work cat|no\.|#/i.test(c));
    if (isSep || isHeader) continue;

    const [, category, itemCount, amount] = cells.length >= 4
      ? ["", cells[1], cells[2], cells[3]]
      : ["", cells[0], cells[1], cells[2]];

    if (category && !/grand total/i.test(category)) {
      rows.push({ category: category.replace(/\*\*/g, "").trim(), itemCount: itemCount?.trim() || "", amount: parseAmount(amount) });
    }
  }
  return rows;
}

/* ════════════════════════════════════════════════════════════════
   EXCEL BUILDER
════════════════════════════════════════════════════════════════ */

/**
 * @param {string} markdown  — AI-generated BOQ markdown
 * @param {string} title     — Project title (fallback)
 * @returns {Promise<Buffer>}
 */
async function generateBOQExcel(markdown, title = "Multi-Work BOQ") {
  const { overview, workSections, summaryRows } = parseMarkdown(markdown);
  const projectTitle = overview.title || title;

  const wb = new ExcelJS.Workbook();
  wb.creator  = "BOQ Assistant";
  wb.created  = new Date();
  wb.modified = new Date();

  // ── 1. Cover / Summary Sheet ──────────────────────────────────
  buildCoverSheet(wb, overview, workSections, summaryRows, projectTitle);

  // ── 2. One sheet per work type ────────────────────────────────
  for (const section of workSections) {
    buildWorkSheet(wb, section, overview, projectTitle);
  }

  // ── 3. Return buffer ──────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* ── Cover / Summary Sheet ────────────────────────────────────── */
function buildCoverSheet(wb, overview, workSections, summaryRows, projectTitle) {
  const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF1A3C5E" } } });

  // Column widths
  ws.columns = [
    { width: 5  },   // A - #
    { width: 42 },   // B - Work Category
    { width: 14 },   // C - No. of Items
    { width: 22 },   // D - Estimated Amount
  ];

  let row = 1;

  // ── Project title banner ──
  const titleRow = ws.getRow(row);
  titleRow.height = 36;
  const titleCell = ws.getCell(`A${row}`);
  titleCell.value     = projectTitle.toUpperCase();
  titleCell.font      = { ...FONT.title };
  titleCell.fill      = solidFill(COLORS.titleBg);
  titleCell.alignment = centerMiddle;
  ws.mergeCells(`A${row}:D${row}`);
  row++;

  // ── Sub-title ──
  const subRow = ws.getRow(row);
  subRow.height = 18;
  const subCell = ws.getCell(`A${row}`);
  subCell.value     = "MULTI-WORK BILL OF QUANTITIES (BOQ)";
  subCell.font      = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  subCell.fill      = solidFill("2E4057");
  subCell.alignment = centerMiddle;
  ws.mergeCells(`A${row}:D${row}`);
  row++;

  row++; // blank

  // ── Overview block ──
  const metaFields = [
    ["Location",          overview.location],
    ["Total Area / Scale",overview.area],
    ["Quality Level",     overview.quality],
    ["Prepared Date",     overview.preparedDate],
    ["Document Ref",      overview.ref],
    ["Works Covered",     overview.worksCovered],
  ].filter(([, v]) => v);

  for (const [label, value] of metaFields) {
    const r = ws.getRow(row);
    r.height = 15;
    const lc = ws.getCell(`A${row}`);
    lc.value     = label;
    lc.font      = FONT.bodyBold;
    lc.alignment = leftMiddle;
    ws.mergeCells(`A${row}:B${row}`);

    const vc = ws.getCell(`C${row}`);
    vc.value     = value;
    vc.font      = FONT.body;
    vc.alignment = leftMiddle;
    ws.mergeCells(`C${row}:D${row}`);
    row++;
  }

  row++; // blank

  // ── Summary table header ──
  const headerRow = ws.getRow(row);
  headerRow.height = 22;
  ["#", "Work Category", "No. of Items", "Estimated Amount (₹)"].forEach((h, idx) => {
    const col = ["A", "B", "C", "D"][idx];
    const c   = ws.getCell(`${col}${row}`);
    c.value     = h;
    c.font      = FONT.colHeader;
    c.fill      = solidFill(COLORS.summaryHeader);
    c.alignment = centerMiddle;
    c.border    = thinBorder();
  });
  row++;

  // ── Build rows from parsed summary or from workSections ──
  const sRows = summaryRows.length > 0
    ? summaryRows
    : workSections.map(s => ({
        category:  s.name,
        itemCount: String(s.rows.length),
        amount:    calcTotal(s.rows),
      }));

  let grandTotal = 0;
  sRows.forEach((sr, i) => {
    const r      = ws.getRow(row);
    r.height     = 18;
    const isEven = i % 2 === 0;
    const fillBg = isEven ? COLORS.rowEven : COLORS.rowOdd;

    const cells = [
      { col: "A", val: i + 1,            align: centerMiddle, fmt: null },
      { col: "B", val: sr.category,      align: leftMiddle,   fmt: null },
      { col: "C", val: Number(sr.itemCount) || sr.rows?.length || "", align: centerMiddle, fmt: null },
      { col: "D", val: sr.amount || 0,   align: rightMiddle,  fmt: INR_FORMAT },
    ];

    cells.forEach(({ col, val, align, fmt }) => {
      const c       = ws.getCell(`${col}${row}`);
      c.value       = val;
      c.font        = FONT.body;
      c.fill        = solidFill(fillBg);
      c.alignment   = align;
      c.border      = thinBorder();
      if (fmt) c.numFmt = fmt;
    });

    if (typeof sr.amount === "number") grandTotal += sr.amount;
    row++;
  });

  // ── Grand Total row ──
  const gtRow = ws.getRow(row);
  gtRow.height = 24;
  ws.mergeCells(`A${row}:C${row}`);
  const gtLabelCell = ws.getCell(`A${row}`);
  gtLabelCell.value     = "GRAND TOTAL";
  gtLabelCell.font      = FONT.grandTotal;
  gtLabelCell.fill      = solidFill(COLORS.grandTotalBg);
  gtLabelCell.alignment = centerMiddle;
  gtLabelCell.border    = mediumBorder();

  const gtAmtCell = ws.getCell(`D${row}`);
  gtAmtCell.value     = grandTotal;
  gtAmtCell.font      = FONT.grandTotal;
  gtAmtCell.fill      = solidFill(COLORS.grandTotalBg);
  gtAmtCell.alignment = rightMiddle;
  gtAmtCell.numFmt    = INR_FORMAT;
  gtAmtCell.border    = mediumBorder();
  row++;

  row++; // blank

  // ── Sheet index / navigation note ──
  const noteCell = ws.getCell(`A${row}`);
  noteCell.value     = `This workbook contains ${workSections.length} work-type sheet(s). See tabs below for item-wise details.`;
  noteCell.font      = FONT.meta;
  noteCell.alignment = leftMiddle;
  ws.mergeCells(`A${row}:D${row}`);
}

/* ── Per-work-type Sheet ─────────────────────────────────────── */
function buildWorkSheet(wb, section, overview, projectTitle) {
  // Truncate sheet name to 31 chars (Excel limit)
  const sheetName = section.name.replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31);
  const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: "FF2E7D32" } } });

  // 6 columns: Sl No | Item Description | Unit | Qty | Unit Rate (₹) | Amount (₹)
  ws.columns = [
    { width: 7  },   // A - Sl No
    { width: 55 },   // B - Item Description
    { width: 10 },   // C - Unit
    { width: 10 },   // D - Qty
    { width: 16 },   // E - Unit Rate (₹)
    { width: 18 },   // F - Amount (₹)
  ];

  let row = 1;

  // ── Title banner ──
  const titleRow = ws.getRow(row);
  titleRow.height = 32;
  const titleCell = ws.getCell(`A${row}`);
  titleCell.value     = projectTitle.toUpperCase();
  titleCell.font      = { ...FONT.title };
  titleCell.fill      = solidFill(COLORS.titleBg);
  titleCell.alignment = centerMiddle;
  ws.mergeCells(`A${row}:F${row}`);
  row++;

  // ── Work type section header ──
  const secRow = ws.getRow(row);
  secRow.height = 24;
  const secCell = ws.getCell(`A${row}`);
  secCell.value     = section.name.toUpperCase() + " — BILL OF QUANTITIES";
  secCell.font      = FONT.section;
  secCell.fill      = solidFill(COLORS.sectionBg);
  secCell.alignment = centerMiddle;
  ws.mergeCells(`A${row}:F${row}`);
  row++;

  // ── Meta info row ──
  if (overview.preparedDate || overview.ref) {
    const metaRow = ws.getRow(row);
    metaRow.height = 14;
    const mc = ws.getCell(`A${row}`);
    mc.value     = [`Date: ${overview.preparedDate}`, `Ref: ${overview.ref}`, `Location: ${overview.location}`].filter(Boolean).join("   |   ");
    mc.font      = FONT.meta;
    mc.alignment = leftMiddle;
    ws.mergeCells(`A${row}:F${row}`);
    row++;
  }

  row++; // blank

  // ── Scope block ──
  if (section.scope.length > 0) {
    const scopeHeaderCell = ws.getCell(`A${row}`);
    scopeHeaderCell.value     = "SCOPE OF WORK";
    scopeHeaderCell.font      = { name: "Arial", size: 9, bold: true, color: { argb: "FF1A3C5E" } };
    scopeHeaderCell.fill      = solidFill("E3F2FD");
    scopeHeaderCell.alignment = leftMiddle;
    scopeHeaderCell.border    = thinBorder();
    ws.mergeCells(`A${row}:F${row}`);
    row++;

    for (const scopeLine of section.scope) {
      const r  = ws.getRow(row);
      r.height = 14;
      const c  = ws.getCell(`A${row}`);
      c.value     = "• " + scopeLine;
      c.font      = FONT.body;
      c.alignment = { ...leftMiddle, indent: 1 };
      ws.mergeCells(`A${row}:F${row}`);
      row++;
    }
    row++; // blank
  }

  // ── BOQ table column headers ──
  const headers = ["Sl No", "Item Description", "Unit", "Qty", "Unit Rate (₹)", "Amount (₹)"];
  const hRow    = ws.getRow(row);
  hRow.height   = 22;
  headers.forEach((h, i) => {
    const col = ["A", "B", "C", "D", "E", "F"][i];
    const c   = ws.getCell(`${col}${row}`);
    c.value     = h;
    c.font      = FONT.colHeader;
    c.fill      = solidFill(COLORS.colHeaderBg);
    c.alignment = centerMiddle;
    c.border    = thinBorder();
  });
  row++;

  // ── BOQ rows ──
  let subtotal = 0;
  section.rows.forEach((item, idx) => {
    const r      = ws.getRow(row);
    r.height     = 30;
    const isEven = idx % 2 === 0;
    const fillBg = isEven ? COLORS.rowEven : COLORS.rowOdd;

    // Compute amount if not provided by AI
    const computedAmount = (item.qty && item.rate) ? item.qty * item.rate : item.amount;

    const cells = [
      { col: "A", val: item.slNo || idx + 1, align: centerMiddle, fmt: null },
      { col: "B", val: item.desc,             align: leftMiddle,   fmt: null },
      { col: "C", val: item.unit || "",       align: centerMiddle, fmt: null },
      { col: "D", val: item.qty  || "",       align: rightMiddle,  fmt: item.qty  ? NUM_FORMAT : null },
      { col: "E", val: item.rate || "",       align: rightMiddle,  fmt: item.rate ? INR_FORMAT : null },
      { col: "F", val: computedAmount || "",  align: rightMiddle,  fmt: computedAmount ? INR_FORMAT : null },
    ];

    cells.forEach(({ col, val, align, fmt }) => {
      const c     = ws.getCell(`${col}${row}`);
      c.value     = val;
      c.font      = FONT.body;
      c.fill      = solidFill(fillBg);
      c.alignment = align;
      c.border    = thinBorder();
      if (fmt) c.numFmt = fmt;
    });

    if (typeof computedAmount === "number") subtotal += computedAmount;
    row++;
  });

  // ── Subtotal row ──
  const stRow = ws.getRow(row);
  stRow.height = 20;
  ws.mergeCells(`A${row}:E${row}`);
  const stLabel = ws.getCell(`A${row}`);
  stLabel.value     = `SUBTOTAL — ${section.name}`;
  stLabel.font      = FONT.subtotal;
  stLabel.fill      = solidFill(COLORS.subtotalBg);
  stLabel.alignment = rightMiddle;
  stLabel.border    = thinBorder();

  const stAmt = ws.getCell(`F${row}`);
  stAmt.value     = subtotal;
  stAmt.font      = FONT.subtotal;
  stAmt.fill      = solidFill(COLORS.subtotalBg);
  stAmt.alignment = rightMiddle;
  stAmt.numFmt    = INR_FORMAT;
  stAmt.border    = thinBorder();
  row++;

  row++; // blank

  // ── Technical specifications ──
  if (section.specs.length > 0) {
    const specHeaderCell = ws.getCell(`A${row}`);
    specHeaderCell.value     = "TECHNICAL SPECIFICATIONS";
    specHeaderCell.font      = { name: "Arial", size: 9, bold: true, color: { argb: "FF1A3C5E" } };
    specHeaderCell.fill      = solidFill("E8EAF6");
    specHeaderCell.alignment = leftMiddle;
    specHeaderCell.border    = thinBorder();
    ws.mergeCells(`A${row}:F${row}`);
    row++;

    for (const spec of section.specs.slice(0, 10)) {  // cap at 10 spec lines
      if (!spec.trim()) continue;
      const r  = ws.getRow(row);
      r.height = 14;
      const c  = ws.getCell(`A${row}`);
      c.value     = "• " + spec;
      c.font      = FONT.body;
      c.alignment = leftMiddle;
      ws.mergeCells(`A${row}:F${row}`);
      row++;
    }
    row++;
  }

  // ── Timeline ──
  if (section.timeline) {
    const tlCell = ws.getCell(`A${row}`);
    tlCell.value     = "TIMELINE: " + section.timeline;
    tlCell.font      = FONT.meta;
    tlCell.alignment = leftMiddle;
    ws.mergeCells(`A${row}:F${row}`);
    row++;
  }

  // ── Freeze panes below title+section header ──
  ws.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];

  // ── Print settings ──
  ws.pageSetup = {
    paperSize:        9,  // A4
    orientation:      "landscape",
    fitToPage:        true,
    fitToWidth:       1,
    fitToHeight:      0,
    printTitlesRow:   "1:4",
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = {
    oddHeader: `&C&"Arial,Bold"&10${projectTitle}`,
    oddFooter: `&L&"Arial"&8${section.name}&R&"Arial"&8Page &P of &N`,
  };
}

/* ── Helper: sum amount column ───────────────────────────────── */
function calcTotal(rows) {
  return rows.reduce((acc, r) => {
    const a = typeof r.amount === "number" ? r.amount
            : (r.qty && r.rate)            ? r.qty * r.rate
            : 0;
    return acc + a;
  }, 0);
}

module.exports = { generateBOQExcel };