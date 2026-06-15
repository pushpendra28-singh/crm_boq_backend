/**
 * documentParser.js
 * Parses uploaded documents (PDF, DOC, DOCX, TXT) and extracts clean plain text.
 * Returns normalized text that can be passed to AI prompts.
 *
 * Dependencies:
 *   npm install pdf-parse mammoth
 */

const fs = require("fs");
const path = require("path");

// ── Parser implementations ────────────────────────────────────────────────────

/**
 * Parse PDF file → plain text
 */
async function parsePdf(filePath) {
  try {
    const pdfParse = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return cleanText(data.text);
  } catch (err) {
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
}

/**
 * Parse DOC / DOCX file → plain text
 * Uses mammoth (handles both .doc and .docx well)
 */
async function parseDocx(filePath) {
  try {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value);
  } catch (err) {
    throw new Error(`DOC/DOCX parsing failed: ${err.message}`);
  }
}

/**
 * Parse TXT file → plain text
 */
async function parseTxt(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return cleanText(content);
  } catch (err) {
    throw new Error(`TXT parsing failed: ${err.message}`);
  }
}

// ── Text cleaner ──────────────────────────────────────────────────────────────

/**
 * Remove excessive whitespace, normalize line endings, truncate if too large.
 */
function cleanText(raw) {
  if (!raw) return "";

  let text = raw
    .replace(/\r\n/g, "\n")         // normalize line endings
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")             // tabs → spaces
    .replace(/[ \t]+/g, " ")         // collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n")      // max 2 consecutive blank lines
    .trim();

  // Truncate to ~12,000 chars to stay within prompt token budgets
  const MAX_CHARS = 12000;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n[Document truncated for processing...]";
  }

  return text;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Parse a document from disk and return extracted text.
 *
 * @param {string} filePath  - Absolute path to the file
 * @param {string} mimeType  - MIME type of the file
 * @returns {Promise<string>} - Extracted plain text
 */
async function parseDocument(filePath, mimeType) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  switch (mimeType) {
    case "application/pdf":
      return await parsePdf(filePath);

    case "application/msword":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return await parseDocx(filePath);

    case "text/plain":
      return await parseTxt(filePath);

    default:
      throw new Error(`Unsupported MIME type for parsing: ${mimeType}`);
  }
}

/**
 * Parse from multer file object directly (convenience wrapper).
 *
 * @param {object} multerFile - req.file from multer
 * @returns {Promise<string>}
 */
async function parseUploadedFile(multerFile) {
  return parseDocument(multerFile.path, multerFile.mimetype);
}

module.exports = {
  parseDocument,
  parseUploadedFile,
  cleanText,
};