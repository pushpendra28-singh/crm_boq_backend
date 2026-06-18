// const {
//   Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
//   AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
//   VerticalAlign, LevelFormat, PageNumber, Header, Footer,
// } = require("docx");

// /* ═══════════════════════════════════════════════════════════════
//    THEME CONSTANTS
// ═══════════════════════════════════════════════════════════════ */
// const COLOR = {
//   primary: "1B5E20",      // dark green
//   secondary: "2E7D32",    // medium green
//   accent: "4CAF50",       // light green
//   headerBg: "E8F5E9",     // very light green
//   tableHeader: "1B5E20",  // dark green for table headers
//   tableAlt: "F1F8E9",     // alternating row
//   border: "A5D6A7",       // green border
//   text: "212121",
//   muted: "616161",
//   white: "FFFFFF",
// };

// const cellBorder = (color = COLOR.border) => ({
//   top:    { style: BorderStyle.SINGLE, size: 1, color },
//   bottom: { style: BorderStyle.SINGLE, size: 1, color },
//   left:   { style: BorderStyle.SINGLE, size: 1, color },
//   right:  { style: BorderStyle.SINGLE, size: 1, color },
// });

// /* ═══════════════════════════════════════════════════════════════
//    HELPER BUILDERS
// ═══════════════════════════════════════════════════════════════ */
// const spacer = (pts = 80) =>
//   new Paragraph({ children: [new TextRun("")], spacing: { after: pts } });

// const sectionHeading = (text) =>
//   new Paragraph({
//     children: [new TextRun({ text, bold: true, size: 26, color: COLOR.primary, font: "Arial" })],
//     spacing: { before: 280, after: 120 },
//     border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.accent, space: 2 } },
//   });

// const bodyText = (text, opts = {}) =>
//   new Paragraph({
//     children: [
//       new TextRun({
//         text,
//         size: 22,
//         font: "Arial",
//         color: opts.muted ? COLOR.muted : COLOR.text,
//         bold: opts.bold || false,
//         italics: opts.italic || false,
//       }),
//     ],
//     spacing: { after: opts.spacingAfter ?? 60 },
//   });

// const bulletItem = (text) => ({
//   children: [new TextRun({ text, size: 22, font: "Arial", color: COLOR.text })],
//   numbering: { reference: "bullets", level: 0 },
//   spacing: { after: 40 },
// });

// /* ─── BOQ Table builder ─── */
// const boqTable = (rows) => {
//   // Columns: No. | Description | Unit | Qty | Notes
//   const COL_WIDTHS = [600, 3600, 800, 800, 2160]; // = 7960 total (content width minus margins)
//   const HEADERS = ["No.", "Description", "Unit", "Est. Qty", "Specifications / Notes"];

//   const headerRow = new TableRow({
//     tableHeader: true,
//     children: HEADERS.map((h, i) =>
//       new TableCell({
//         width: { size: COL_WIDTHS[i], type: WidthType.DXA },
//         borders: cellBorder(COLOR.secondary),
//         shading: { fill: COLOR.tableHeader, type: ShadingType.CLEAR },
//         margins: { top: 80, bottom: 80, left: 100, right: 100 },
//         verticalAlign: VerticalAlign.CENTER,
//         children: [
//           new Paragraph({
//             alignment: AlignmentType.CENTER,
//             children: [
//               new TextRun({ text: h, bold: true, size: 20, font: "Arial", color: COLOR.white }),
//             ],
//           }),
//         ],
//       })
//     ),
//   });

//   const dataRows = rows.map((row, idx) =>
//     new TableRow({
//       children: row.map((cell, ci) =>
//         new TableCell({
//           width: { size: COL_WIDTHS[ci], type: WidthType.DXA },
//           borders: cellBorder(COLOR.border),
//           shading: {
//             fill: idx % 2 === 0 ? COLOR.white : COLOR.tableAlt,
//             type: ShadingType.CLEAR,
//           },
//           margins: { top: 60, bottom: 60, left: 100, right: 100 },
//           verticalAlign: VerticalAlign.CENTER,
//           children: [
//             new Paragraph({
//               alignment: ci === 0 || ci === 2 || ci === 3 ? AlignmentType.CENTER : AlignmentType.LEFT,
//               children: [
//                 new TextRun({ text: String(cell || "—"), size: 20, font: "Arial", color: COLOR.text }),
//               ],
//             }),
//           ],
//         })
//       ),
//     })
//   );

//   return new Table({
//     width: { size: 7960, type: WidthType.DXA },
//     columnWidths: COL_WIDTHS,
//     rows: [headerRow, ...dataRows],
//   });
// };

// /* ─── Key-Value info table ─── */
// const infoTable = (pairs) => {
//   const rows = pairs.map(([key, val]) =>
//     new TableRow({
//       children: [
//         new TableCell({
//           width: { size: 2400, type: WidthType.DXA },
//           borders: cellBorder(COLOR.border),
//           shading: { fill: COLOR.headerBg, type: ShadingType.CLEAR },
//           margins: { top: 60, bottom: 60, left: 120, right: 80 },
//           children: [
//             new Paragraph({
//               children: [new TextRun({ text: key, bold: true, size: 21, font: "Arial", color: COLOR.primary })],
//             }),
//           ],
//         }),
//         new TableCell({
//           width: { size: 5560, type: WidthType.DXA },
//           borders: cellBorder(COLOR.border),
//           shading: { fill: COLOR.white, type: ShadingType.CLEAR },
//           margins: { top: 60, bottom: 60, left: 120, right: 80 },
//           children: [
//             new Paragraph({
//               children: [new TextRun({ text: val || "—", size: 21, font: "Arial", color: COLOR.text })],
//             }),
//           ],
//         }),
//       ],
//     })
//   );

//   return new Table({
//     width: { size: 7960, type: WidthType.DXA },
//     columnWidths: [2400, 5560],
//     rows,
//   });
// };

// /* ═══════════════════════════════════════════════════════════════
//    MARKDOWN → DOCX PARSER
//    Converts the AI-generated markdown BOQ into docx elements
// ═══════════════════════════════════════════════════════════════ */
// const parseMarkdownToDocx = (markdown) => {
//   const lines = markdown.split("\n");
//   const elements = [];
//   let inBOQSection = false;
//   let boqRows = [];
//   let boqGroupTitle = null;

//   const flushBOQ = () => {
//     if (boqRows.length > 0) {
//       if (boqGroupTitle) {
//         elements.push(bodyText(boqGroupTitle, { bold: true, spacingAfter: 80 }));
//         boqGroupTitle = null;
//       }
//       elements.push(boqTable(boqRows));
//       elements.push(spacer(120));
//       boqRows = [];
//     }
//   };

//   for (let i = 0; i < lines.length; i++) {
//     const line = lines[i];
//     const trimmed = line.trim();

//     if (!trimmed) { elements.push(spacer(40)); continue; }

//     // Section headings
//     if (trimmed.startsWith("## ")) {
//       flushBOQ();
//       inBOQSection = trimmed.toLowerCase().includes("bill of quantities") || trimmed.toLowerCase().includes("boq");
//       elements.push(spacer(60));
//       elements.push(sectionHeading(trimmed.replace(/^## /, "")));
//       continue;
//     }

//     if (trimmed.startsWith("# ")) {
//       flushBOQ();
//       elements.push(
//         new Paragraph({
//           children: [new TextRun({ text: trimmed.replace(/^# /, ""), bold: true, size: 30, font: "Arial", color: COLOR.primary })],
//           spacing: { before: 200, after: 160 },
//         })
//       );
//       continue;
//     }

//     // BOQ section: detect pipe-separated table rows
//     if (inBOQSection && trimmed.includes("|")) {
//       // Skip divider rows like |---|---|
//       if (/^\|[\s\-|]+\|$/.test(trimmed)) continue;

//       const cells = trimmed
//         .split("|")
//         .map((c) => c.trim())
//         .filter((c) => c.length > 0);

//       // If looks like a header row, skip (we generate our own)
//       const isHeader = cells.some((c) =>
//         ["item", "description", "unit", "qty", "notes", "no."].includes(c.toLowerCase())
//       );
//       if (isHeader) continue;

//       // Pad/trim to 5 columns: No | Desc | Unit | Qty | Notes
//       const row = [
//         cells[0] || "",
//         cells[1] || "",
//         cells[2] || "",
//         cells[3] || "",
//         cells[4] || cells[5] || "",
//       ];
//       boqRows.push(row);
//       continue;
//     }

//     // BOQ section: detect non-pipe line items (e.g. "1. Excavation work - 100 cubic meters")
//     if (inBOQSection && /^\d+[\.\)]\s/.test(trimmed)) {
//       const parts = trimmed.split(/\s*[-–|]\s*/);
//       boqRows.push([
//         trimmed.match(/^\d+/)?.[0] || "",
//         parts[0]?.replace(/^\d+[\.\)]\s*/, "") || trimmed,
//         parts[1] || "Lot",
//         parts[2] || "1",
//         parts[3] || "",
//       ]);
//       continue;
//     }

//     // Flush BOQ when leaving BOQ section
//     if (inBOQSection && !trimmed.includes("|") && !/^\d+[\.\)]/.test(trimmed)) {
//       flushBOQ();
//       inBOQSection = false;
//     }

//     // Bold category labels inside BOQ (e.g. "**Civil Works**")
//     if (inBOQSection && /^\*\*.+\*\*$/.test(trimmed)) {
//       flushBOQ();
//       boqGroupTitle = trimmed.replace(/\*\*/g, "");
//       continue;
//     }

//     // Bullet points
//     if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
//       const text = trimmed.replace(/^[-*]\s/, "");
//       elements.push(new Paragraph({ ...bulletItem(text) }));
//       continue;
//     }

//     // Numbered list
//     if (/^\d+\.\s/.test(trimmed) && !inBOQSection) {
//       elements.push(
//         new Paragraph({
//           numbering: { reference: "numbers", level: 0 },
//           children: [new TextRun({ text: trimmed.replace(/^\d+\.\s/, ""), size: 22, font: "Arial", color: COLOR.text })],
//           spacing: { after: 50 },
//         })
//       );
//       continue;
//     }

//     // Bold inline text
//     if (/\*\*.+\*\*/.test(trimmed)) {
//       const parts = trimmed.split(/\*\*(.+?)\*\*/g);
//       elements.push(
//         new Paragraph({
//           children: parts.map((part, pi) =>
//             new TextRun({
//               text: part,
//               bold: pi % 2 === 1,
//               size: 22,
//               font: "Arial",
//               color: COLOR.text,
//             })
            
//           ),
//           spacing: { after: 60 },
//         })
//       );
//       continue;
//     }

//     // Key: Value lines (e.g. "- **Project Title**: Office Renovation")
//     if (trimmed.includes(":")) {
//       const colonIdx = trimmed.indexOf(":");
//       const key = trimmed.slice(0, colonIdx).replace(/[-*]/g, "").trim();
//       const val = trimmed.slice(colonIdx + 1).trim();
    
//       if (key && val && key.length < 40) {
//         elements.push(
//           new Paragraph({
//             children: [
//               new TextRun({ text: key + ": ", bold: true, size: 22, font: "Arial", color: COLOR.primary }),
//               new TextRun({ text: val, size: 22, font: "Arial", color: COLOR.text }),
//             ],
//             spacing: { after: 50 },
//           })
//         );
//         continue;
//       }
//     }

//     // Regular paragraph
//     elements.push(bodyText(trimmed));
//   }

//   flushBOQ(); // flush any remaining BOQ rows
//   return elements;
// };

// /* ═══════════════════════════════════════════════════════════════
//    COVER PAGE
// ═══════════════════════════════════════════════════════════════ */
// const buildCoverPage = (title) => {
//   const docRef = `BOQ-${Date.now().toString().slice(-6)}`;
//   const dateStr = new Date().toLocaleDateString("en-IN", {
//     day: "numeric", month: "long", year: "numeric",
//   });

//   return [
//     spacer(600),
//     new Paragraph({
        
//       alignment: AlignmentType.CENTER,
//       children: [
//         new TextRun({ text: "BILL OF QUANTITIES", bold: true, size: 48, font: "Arial", color: COLOR.primary }),
//       ],
//       spacing: { after: 120 },
//     }),
//     new Paragraph({
//       alignment: AlignmentType.CENTER,
//       children: [
//         new TextRun({ text: "& REQUIREMENTS DOCUMENT", bold: true, size: 36, font: "Arial", color: COLOR.secondary }),
//       ],
//       spacing: { after: 320 },
//       border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.accent, space: 4 } },
//     }),
//     spacer(240),
//     new Paragraph({
//       alignment: AlignmentType.CENTER,
//       children: [
//         new TextRun({
//           text: (title || "Project Requirements").toUpperCase(),
//           bold: true, size: 30, font: "Arial", color: COLOR.text,
//         }),
//       ],
//       spacing: { after: 480 },
//     }),
//     spacer(200),
//     infoTable([
//       ["Document Ref.", docRef],
//       ["Prepared On",   dateStr],
//       ["Status",        "DRAFT — For Vendor Quotation"],
//       ["Confidential",  "Yes — Do not distribute without authorization"],
//     ]),
//     spacer(600),
//     new Paragraph({
//       alignment: AlignmentType.CENTER,
//       children: [
//         new TextRun({ text: "This document is intended for qualified vendors only.", size: 18, font: "Arial", color: COLOR.muted, italics: true }),
//       ],
//     }),
//   ];
// };

// /* ═══════════════════════════════════════════════════════════════
//    MAIN EXPORT
// ═══════════════════════════════════════════════════════════════ */
// const generateBOQDocx = async (markdownContent, title = "BOQ") => {
//   const coverChildren = buildCoverPage(title);
//   const bodyChildren = parseMarkdownToDocx(markdownContent);

//   const doc = new Document({
//     numbering: {
//       config: [
//         {
//           reference: "bullets",
//           levels: [{
//             level: 0, format: LevelFormat.BULLET, text: "•",
//             alignment: AlignmentType.LEFT,
//             style: { paragraph: { indent: { left: 560, hanging: 280 } } },
//           }],
//         },
//         {
//           reference: "numbers",
//           levels: [{
//             level: 0, format: LevelFormat.DECIMAL, text: "%1.",
//             alignment: AlignmentType.LEFT,
//             style: { paragraph: { indent: { left: 560, hanging: 280 } } },
//           }],
//         },
//       ],
//     },
//     styles: {
//       default: {
//         document: { run: { font: "Arial", size: 22, color: COLOR.text } },
//       },
//     },
//     sections: [
//       // ── COVER PAGE ──
//       {
//         properties: {
//           page: {
//             size: { width: 11906, height: 16838 }, // A4
//             margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
//           },
//         },
//         children: coverChildren,
//       },
//       // ── BOQ BODY ──
//       {
//         properties: {
//           page: {
//             size: { width: 11906, height: 16838 }, // A4
//             margin: { top: 1200, right: 1100, bottom: 1200, left: 1100 },
//           },
//         },
//         headers: {
//           default: new Header({
//             children: [
//               new Paragraph({
//                 children: [
//                   new TextRun({ text: "BOQ & REQUIREMENTS DOCUMENT  |  ", bold: true, size: 18, font: "Arial", color: COLOR.primary }),
//                   new TextRun({ text: (title || "Project").slice(0, 60).toUpperCase(), size: 18, font: "Arial", color: COLOR.muted }),
//                 ],
//                 border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.accent, space: 2 } },
//                 spacing: { after: 80 },
//               }),
//             ],
//           }),
//         },
//         footers: {
//           default: new Footer({
//             children: [
//               new Paragraph({
//                 children: [
//                   new TextRun({ text: "CONFIDENTIAL — For Vendor Use Only  |  Page ", size: 18, font: "Arial", color: COLOR.muted }),
//                   new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Arial", color: COLOR.muted }),
//                   new TextRun({ text: " of ", size: 18, font: "Arial", color: COLOR.muted }),
//                   new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, font: "Arial", color: COLOR.muted }),
//                 ],
//                 alignment: AlignmentType.RIGHT,
//                 border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.accent, space: 2 } },
//                 spacing: { before: 80 },
//               }),
//             ],
//           }),
//         },
//         children: bodyChildren,
//       },
//     ],
//   });

//   return await Packer.toBuffer(doc);
// };

// module.exports = { generateBOQDocx };