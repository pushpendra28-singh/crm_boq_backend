/**
 * generateBOQExcel.js
 * Production-level multi-work BOQ Excel generator.
 * Sheets: COVER, SUMMARY, + one sheet per work category.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/* ── Parse AI markdown ──────────────────────────────────────────────────── */
function parseMarkdown(markdown) {
  const lines = markdown.split("\n");
  const result = { title: "Multi-Work BOQ", meta: {}, summary: "", works: [], terms: [] };

  let section = null;
  let currentWork = null;
  let summaryLines = [];
  let termsLines = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;

    if (t.startsWith("## ")) {
      const h = t.replace(/^##\s+/, "").toLowerCase();
      if (h.match(/project.?overview|^\d+\.\s*project/)) section = "meta";
      else if (h.match(/executive.?summary|^summary/)) section = "summary";
      else if (h.match(/bill.?of.?quantities|boq|scope.?of.?work|work.?items|work.?categor|work.?detail/)) section = "boq";
      else if (h.match(/terms|condition|submission/)) section = "terms";
      else section = "other";
      continue;
    }

    if (t.startsWith("# ")) {
      result.title = t.replace(/^#\s+/, "").replace(/\*\*/g, "").trim();
      continue;
    }

    if (section === "boq") {
      const isSub = t.startsWith("### ") || (t.startsWith("**") && t.endsWith("**") && !t.includes("|"));
      if (isSub) {
        const name = t.replace(/^###\s+/, "").replace(/\*\*/g, "").trim();
        currentWork = { name, items: [] };
        result.works.push(currentWork);
        continue;
      }
      if (t.includes("|")) {
        if (/^\|[\s\-|:]+\|$/.test(t)) continue;
        const cells = t.split("|").map(c => c.trim()).filter(Boolean);
        const isHeader = cells.some(c => ["item","description","unit","qty","no.","sno","notes","spec"].includes(c.toLowerCase()));
        if (isHeader) continue;
        if (!currentWork) { currentWork = { name: "General Works", items: [] }; result.works.push(currentWork); }
        currentWork.items.push({ sno: cells[0]||"", description: cells[1]||"", unit: cells[2]||"Lot", qty: cells[3]||"1", specs: cells[4]||cells[5]||"" });
        continue;
      }
      if (/^\d+[\.\)]\s/.test(t)) {
        if (!currentWork) { currentWork = { name: "General Works", items: [] }; result.works.push(currentWork); }
        const parts = t.split(/\s*[-–|]\s*/);
        currentWork.items.push({
          sno: (t.match(/^\d+/)||[""])[0],
          description: (parts[0]||"").replace(/^\d+[\.\)]\s*/,"").trim(),
          unit: parts[1]||"Lot", qty: parts[2]||"1", specs: parts[3]||""
        });
        continue;
      }
    }

    if (section === "meta" && t.includes(":")) {
      const ci = t.indexOf(":");
      const key = t.slice(0, ci).replace(/[-*•\d\.]/g,"").trim();
      const val = t.slice(ci+1).trim().replace(/\*\*/g,"");
      if (key && key.length < 50) {
        result.meta[key] = val;
        if (key.toLowerCase().includes("title")) result.title = val;
      }
    }
    if (section === "summary") summaryLines.push(t.replace(/\*\*/g,""));
    if (section === "terms") termsLines.push(t.replace(/^[-*•]\s*/,"").replace(/\*\*/g,""));
  }

  result.summary = summaryLines.join(" ");
  result.terms = termsLines.filter(Boolean);
  if (result.works.length === 0) result.works.push({ name: "Bill of Quantities", items: [] });
  return result;
}

/* ── Python script builder ──────────────────────────────────────────────── */
function buildPythonScript(dataPath, outputPath) {
  return `
import json, re, openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import datetime

with open(${JSON.stringify(dataPath)}, "r", encoding="utf-8") as f:
    data = json.load(f)

wb = openpyxl.Workbook()
wb.remove(wb.active)

C_PRIMARY    = "1B5E20"
C_SECONDARY  = "2E7D32"
C_ACCENT     = "4CAF50"
C_LIGHT      = "E8F5E9"
C_LIGHTER    = "F1F8E9"
C_WHITE      = "FFFFFF"
C_BODY       = "212121"
C_MUTED      = "616161"
C_ORANGE     = "BF360C"
C_GOLD       = "F57F17"

def fill(c): return PatternFill("solid", fgColor=c)
def fn(bold=False, size=10, color=C_BODY, italic=False):
    return Font(name="Arial", bold=bold, size=size, color=color, italic=italic)
def side(style="thin", color="BDBDBD"): return Side(style=style, color=color)
def bdr(style="thin", color="BDBDBD"):
    s = side(style, color)
    return Border(left=s, right=s, top=s, bottom=s)
def aln(h="center", wrap=True): return Alignment(horizontal=h, vertical="center", wrap_text=wrap)

THIN   = bdr()
MEDIUM = bdr("medium", C_PRIMARY)

def safe_name(name):
    name = re.sub(r'[\\\\/*?\\[\\]:]', '', str(name))
    return name[:31]

# ── COVER ──────────────────────────────────────────────────────────────────
cov = wb.create_sheet("COVER")
cov.sheet_view.showGridLines = False
for col, w in zip("ABCDE", [3, 30, 50, 3, 3]):
    cov.column_dimensions[col].width = w

# Top band
for r in range(1, 5):
    for col in "ABCDE":
        cov[f"{col}{r}"].fill = fill(C_PRIMARY)
    cov.row_dimensions[r].height = 10

# Main title
cov.merge_cells("B5:C5")
c = cov["B5"]
c.value = "BILL OF QUANTITIES"
c.font = Font(name="Arial", bold=True, size=26, color=C_PRIMARY)
c.alignment = aln()
cov.row_dimensions[5].height = 46

cov.merge_cells("B6:C6")
c = cov["B6"]
c.value = "MULTI-WORK PROJECT BOQ & REQUIREMENTS DOCUMENT"
c.font = Font(name="Arial", bold=True, size=11, color=C_SECONDARY, italic=True)
c.alignment = aln()
cov.row_dimensions[6].height = 20

# Accent bar
cov.merge_cells("B7:C7")
cov["B7"].fill = fill(C_ACCENT)
cov.row_dimensions[7].height = 5

cov.row_dimensions[8].height = 12

# Project name
cov.merge_cells("B9:C9")
c = cov["B9"]
c.value = str(data.get("title","Project BOQ")).upper()
c.font = Font(name="Arial", bold=True, size=15, color=C_BODY)
c.alignment = aln()
cov.row_dimensions[9].height = 30

cov.row_dimensions[10].height = 10

# Meta table
meta = data.get("meta", {})
doc_ref = "BOQ-" + datetime.now().strftime("%Y%m%d%H%M")
now = datetime.now()
date_str = f"{now.day} {now.strftime('%B %Y')}"

meta_rows = []
for k, v in meta.items():
    if k.lower() not in ["project title", "title"]:
        meta_rows.append((k, str(v)))
meta_rows += [
    ("Document Reference", doc_ref),
    ("Prepared On",        date_str),
    ("Status",             "DRAFT — For Vendor Quotation"),
    ("Confidential",       "Yes — Do not distribute without authorization"),
]

row = 11
for k, v in meta_rows:
    cov.row_dimensions[row].height = 22
    kb = cov.cell(row, 2, k)
    kb.font = fn(bold=True, size=10, color=C_PRIMARY)
    kb.fill = fill(C_LIGHT)
    kb.border = bdr("thin", C_ACCENT)
    kb.alignment = aln("left")

    vb = cov.cell(row, 3, v)
    vb.font = fn(size=10)
    vb.border = THIN
    vb.alignment = aln("left")
    row += 1

cov.row_dimensions[row].height = 12
row += 1

# Work categories index
works = data.get("works", [])
cov.merge_cells(f"B{row}:C{row}")
c = cov.cell(row, 2, "WORK CATEGORIES INCLUDED IN THIS BOQ")
c.font = fn(bold=True, size=10, color=C_SECONDARY)
c.alignment = aln("left")
cov.row_dimensions[row].height = 20
row += 1

for idx, work in enumerate(works, 1):
    cov.row_dimensions[row].height = 18
    nb = cov.cell(row, 2, f"  {idx}.")
    nb.font = fn(bold=True, color=C_PRIMARY)
    nb.alignment = aln("left")
    wc = cov.cell(row, 3, work["name"])
    wc.font = fn(size=10)
    wc.alignment = aln("left")
    row += 1

row += 1
c = cov.cell(row, 2, "This document is intended for qualified vendors only. Confidential & Proprietary.")
c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
cov.merge_cells(f"B{row}:C{row}")

row += 2
for r2 in range(row, row+3):
    for col in "ABCDE":
        cov[f"{col}{r2}"].fill = fill(C_PRIMARY)
    cov.row_dimensions[r2].height = 8

# ── SUMMARY ────────────────────────────────────────────────────────────────
smry = wb.create_sheet("SUMMARY")
smry.sheet_view.showGridLines = False
for col, w in zip("ABCDEFGH", [3, 6, 38, 14, 18, 22, 10, 3]):
    smry.column_dimensions[col].width = w

smry.merge_cells("B1:G1")
c = smry["B1"]
c.value = "BILL OF QUANTITIES — PROJECT SUMMARY"
c.font = Font(name="Arial", bold=True, size=13, color=C_WHITE)
c.fill = fill(C_PRIMARY)
c.alignment = aln()
smry.row_dimensions[1].height = 34

smry.merge_cells("B2:G2")
c = smry["B2"]
c.value = data.get("title","")
c.font = Font(name="Arial", bold=True, size=10, color=C_PRIMARY, italic=True)
c.alignment = aln()
smry.row_dimensions[2].height = 18

smry.row_dimensions[3].height = 6

# Table header
hdrs = ["S.No.", "Work Category", "No. of Items", "Est. Amount (INR)", "Sheet Reference", "Remarks"]
h_cols = "BCDEFG"
row = 4
smry.row_dimensions[row].height = 28
for col, h in zip(h_cols, hdrs):
    c = smry[f"{col}{row}"]
    c.value = h
    c.font = fn(bold=True, size=10, color=C_WHITE)
    c.fill = fill(C_SECONDARY)
    c.alignment = aln()
    c.border = bdr("medium", C_PRIMARY)

# Work rows + formula links to subtotals on each sheet
row = 5
total_cells = []
for idx, work in enumerate(works, 1):
    smry.row_dimensions[row].height = 22
    alt = C_LIGHTER if idx % 2 == 0 else C_WHITE
    sname = safe_name(work["name"])
    n_items = len(work.get("items",[]))
    subtotal_row = 4 + n_items + 1  # row 4 is header, data starts at 5

    cells_data = [
        (f"B{row}", str(idx),          aln()),
        (f"C{row}", work["name"],       aln("left")),
        (f"D{row}", n_items,            aln()),
        (f"E{row}", f"='{sname}'!G{subtotal_row}", aln("right")),
        (f"F{row}", sname,              aln()),
        (f"G{row}", "",                 aln()),
    ]
    for addr, val, al in cells_data:
        c = smry[addr]
        c.value = val
        c.fill = fill(alt)
        c.border = THIN
        c.alignment = al
        c.font = fn(size=10)
        if "E" in addr:
            c.number_format = "#,##0.00"
    total_cells.append(f"E{row}")
    row += 1

# Grand total
smry.row_dimensions[row].height = 30
smry.merge_cells(f"B{row}:D{row}")
c = smry[f"B{row}"]
c.value = "GRAND TOTAL (All Works Combined)"
c.font = Font(name="Arial", bold=True, size=11, color=C_WHITE)
c.fill = fill(C_PRIMARY)
c.alignment = aln()
c.border = MEDIUM

amt = smry[f"E{row}"]
amt.value = "=" + "+".join(total_cells) if total_cells else 0
amt.font = Font(name="Arial", bold=True, size=11, color=C_WHITE)
amt.fill = fill(C_PRIMARY)
amt.number_format = "#,##0.00"
amt.alignment = aln("right")
amt.border = MEDIUM

for col in "FG":
    c = smry[f"{col}{row}"]
    c.fill = fill(C_PRIMARY)
    c.border = MEDIUM

row += 2
c = smry.cell(row, 2, "Note: All quantities are estimated. Vendors must fill Unit Rate on respective sheets. All amounts auto-calculate.")
c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
smry.merge_cells(f"B{row}:G{row}")

smry.freeze_panes = smry["B5"]
smry.page_setup.orientation = "landscape"
smry.page_setup.fitToPage = True

# ── INDIVIDUAL WORK SHEETS ─────────────────────────────────────────────────
for work in works:
    ws_name = safe_name(work["name"])
    ws = wb.create_sheet(ws_name)
    ws.sheet_view.showGridLines = False

    # B=sno, C=description, D=unit, E=qty, F=unit_rate, G=amount, H=specs
    col_ws = [3, 8, 44, 12, 12, 18, 18, 32, 3]
    for i, w in enumerate(col_ws, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # Sheet header
    ws.merge_cells("B1:H1")
    c = ws["B1"]
    c.value = f"BOQ — {work['name'].upper()}"
    c.font = Font(name="Arial", bold=True, size=13, color=C_WHITE)
    c.fill = fill(C_PRIMARY)
    c.alignment = aln()
    ws.row_dimensions[1].height = 34

    ws.merge_cells("B2:H2")
    c = ws["B2"]
    c.value = f"Project: {data.get('title','')}    |    Work Category: {work['name']}"
    c.font = Font(name="Arial", bold=True, size=9, color=C_SECONDARY, italic=True)
    c.alignment = aln()
    ws.row_dimensions[2].height = 16

    ws.merge_cells("B3:H3")
    c = ws["B3"]
    prepared_date = f"{datetime.now().day} {datetime.now().strftime('%B %Y')}"
    c.value = f"Prepared: {prepared_date}    |    Status: DRAFT — For Vendor Quotation    |    Fill highlighted Unit Rate cells"
    c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
    c.alignment = aln()
    ws.row_dimensions[3].height = 14

    # Column headers
    col_hdrs = ["S.No.", "Item Description", "Unit", "Est. Qty", "Unit Rate (INR)", "Amount (INR)", "Specifications / Notes"]
    tbl_cols = "BCDEFGH"
    row = 4
    ws.row_dimensions[row].height = 30
    for col, h in zip(tbl_cols, col_hdrs):
        c = ws[f"{col}{row}"]
        c.value = h
        c.font = fn(bold=True, size=10, color=C_WHITE)
        c.fill = fill(C_SECONDARY)
        c.alignment = aln()
        c.border = bdr("medium", C_PRIMARY)

    items = work.get("items", [])
    row = 5
    for idx, item in enumerate(items):
        ws.row_dimensions[row].height = 20
        alt = C_LIGHTER if idx % 2 == 0 else C_WHITE

        # Parse qty safely
        try:
            qty_val = float(str(item.get("qty","1")).replace(",","").strip() or "1")
        except:
            qty_val = 1

        cells_data = [
            (f"B{row}", str(item.get("sno", idx+1)), aln()),
            (f"C{row}", str(item.get("description","")), aln("left")),
            (f"D{row}", str(item.get("unit","Lot")), aln()),
            (f"E{row}", qty_val, aln()),
            (f"F{row}", None, aln()),
            (f"G{row}", f"=IF(OR(F{row}=\"\",F{row}=0),\"\",E{row}*F{row})", aln("right")),
            (f"H{row}", str(item.get("specs","")), aln("left")),
        ]

        for addr, val, al in cells_data:
            c = ws[addr]
            if val is not None:
                c.value = val
            c.fill = fill(alt)
            c.border = THIN
            c.alignment = al
            c.font = fn(size=10)
            if "F" in addr or "G" in addr:
                c.number_format = "#,##0.00"
            if "F" in addr:
                # Highlight vendor-fill cells
                c.fill = PatternFill("solid", fgColor="FFFDE7")
                c.font = Font(name="Arial", size=10, color="E65100")
        row += 1

    # Subtotal row
    ws.row_dimensions[row].height = 28
    ws.merge_cells(f"B{row}:E{row}")
    c = ws[f"B{row}"]
    c.value = f"SUB-TOTAL — {work['name']}"
    c.font = Font(name="Arial", bold=True, size=10, color=C_WHITE)
    c.fill = fill(C_SECONDARY)
    c.alignment = aln()
    c.border = MEDIUM

    ws[f"F{row}"].fill = fill(C_SECONDARY)
    ws[f"F{row}"].border = MEDIUM

    amt = ws[f"G{row}"]
    amt.value = f"=IFERROR(SUM(G5:G{row-1}),0)" if items else 0
    amt.font = Font(name="Arial", bold=True, size=10, color=C_WHITE)
    amt.fill = fill(C_SECONDARY)
    amt.number_format = "#,##0.00"
    amt.alignment = aln("right")
    amt.border = MEDIUM

    ws[f"H{row}"].fill = fill(C_SECONDARY)
    ws[f"H{row}"].border = MEDIUM

    row += 2
    c = ws.cell(row, 2, "▶  Please fill in Unit Rate (Column F — highlighted in yellow) to auto-calculate Amount (Column G). All totals flow to SUMMARY sheet automatically.")
    c.font = Font(name="Arial", size=8, color=C_MUTED, italic=True)
    ws.merge_cells(f"B{row}:H{row}")

    ws.freeze_panes = ws["C5"]
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1

wb.save(${JSON.stringify(outputPath)})
print("OK")
`;
}

/* ── Main exported function ─────────────────────────────────────────────── */
async function generateBOQExcel(markdownContent, title = "Multi-Work BOQ") {
  const data = parseMarkdown(markdownContent);
  data.title = title || data.title;

  const tmpDir = os.tmpdir();
  const dataPath   = path.join(tmpDir, `boq_data_${Date.now()}.json`);
  const outputPath = path.join(tmpDir, `boq_out_${Date.now()}.xlsx`);
  const scriptPath = path.join(tmpDir, `boq_gen_${Date.now()}.py`);

  fs.writeFileSync(dataPath,  JSON.stringify(data, null, 2), "utf-8");
  fs.writeFileSync(scriptPath, buildPythonScript(dataPath, outputPath), "utf-8");

  try {
    execSync(`python3 "${scriptPath}"`, { timeout: 30000 });
  } catch (err) {
    try { fs.unlinkSync(dataPath); fs.unlinkSync(scriptPath); } catch {}
    throw new Error(`Excel generation failed: ${err.stderr || err.message}`);
  }

  const buffer = fs.readFileSync(outputPath);
  try { fs.unlinkSync(dataPath); fs.unlinkSync(scriptPath); fs.unlinkSync(outputPath); } catch {}
  return buffer;
}

module.exports = { generateBOQExcel };