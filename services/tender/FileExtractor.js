const fs   = require("fs");
const path = require("path");

/**
 * Extract plain text from an uploaded file.
 * Supports: .pdf, .docx, .doc, .txt
 * Returns: { text: string, error: string|null }
 */
const extractText = async (filePath, originalName) => {
  const ext = path.extname(originalName || filePath).toLowerCase();

  try {
    /* ── TXT ── */
    if (ext === ".txt") {
      const text = fs.readFileSync(filePath, "utf8");
      return { text: text.trim(), error: null };
    }

    /* ── PDF ── */
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const buffer   = fs.readFileSync(filePath);
      const data     = await pdfParse(buffer);
      const text     = data.text?.trim() || "";
      if (!text) return { text: "", error: "PDF appears to be image-based (no extractable text)." };
      return { text, error: null };
    }

    /* ── DOCX / DOC ── */
    if (ext === ".docx" || ext === ".doc") {
      const mammoth = require("mammoth");
      const result  = await mammoth.extractRawText({ path: filePath });
      const text    = result.value?.trim() || "";
      if (!text) return { text: "", error: "DOCX appears empty or unreadable." };
      return { text, error: null };
    }

    return { text: "", error: `Unsupported file type: ${ext}` };
  } catch (err) {
    console.error("extractText error:", err.message);
    return { text: "", error: `Could not read file: ${err.message}` };
  }
};

module.exports = { extractText };