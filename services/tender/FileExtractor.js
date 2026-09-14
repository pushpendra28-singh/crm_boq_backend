const fs = require("fs");
const path = require("path");

/**
 * Extract readable plain text from an uploaded file.
 *
 * Supported formats:
 * - .txt
 * - .pdf
 * - .doc
 * - .docx
 * - .xlsx
 * - .xls
 * - .csv
 *
 * Responsibility of this service:
 *
 * FILE
 *   ↓
 * READ / PARSE
 *   ↓
 * PLAIN TEXT
 *
 * This service intentionally contains NO BOQ-specific logic.
 *
 * It does not decide:
 * - project type
 * - work categories
 * - columns
 * - rows
 * - pricing
 * - scope
 *
 * Those responsibilities belong to TenderAIService.
 *
 * Return format:
 *
 * {
 *   text: string,
 *   error: string | null
 * }
 */


/* ═══════════════════════════════════════════════════════════════
   BASIC HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * Confirm file exists before trying to parse it.
 */
const validateFileExists = (filePath) => {
  if (!filePath) {
    return {
      valid: false,
      error: "File path is missing.",
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      error: "Uploaded file could not be found.",
    };
  }

  return {
    valid: true,
    error: null,
  };
};


/**
 * Normalise extracted text without destroying document structure.
 *
 * We intentionally preserve line breaks because:
 * - table-like data may depend on row boundaries,
 * - document headings matter,
 * - AI analysis benefits from structure.
 */
const normalizeText = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
};


/**
 * Convert a primitive spreadsheet cell value into readable text.
 */
const stringifyCellValue = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "boolean") {
    return value
      ? "TRUE"
      : "FALSE";
  }

  return String(value).trim();
};


/* ═══════════════════════════════════════════════════════════════
   TXT EXTRACTION
═══════════════════════════════════════════════════════════════ */

const extractTxt = async (
  filePath
) => {
  const text =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const normalized =
    normalizeText(text);

  if (!normalized) {
    return {
      text: "",
      error:
        "TXT file appears empty.",
    };
  }

  return {
    text:
      normalized,

    error:
      null,
  };
};


/* ═══════════════════════════════════════════════════════════════
   PDF EXTRACTION
═══════════════════════════════════════════════════════════════ */

const extractPdf = async (
  filePath
) => {
  const pdfParse =
    require("pdf-parse");

  const buffer =
    fs.readFileSync(
      filePath
    );

  const data =
    await pdfParse(
      buffer
    );

  const text =
    normalizeText(
      data?.text
    );

  if (!text) {
    return {
      text: "",

      error:
        "PDF appears to be image-based or contains no extractable text.",
    };
  }

  return {
    text,

    error:
      null,
  };
};


/* ═══════════════════════════════════════════════════════════════
   DOC / DOCX EXTRACTION
═══════════════════════════════════════════════════════════════ */

const extractWord = async (
  filePath,
  extension
) => {
  const mammoth =
    require("mammoth");

  /*
   * Mammoth is designed primarily for DOCX.
   *
   * We retain .doc handling because your previous application
   * already accepted it.
   *
   * If a legacy binary .doc cannot be parsed by Mammoth,
   * the catch block in extractText will return a clear error.
   */
  const result =
    await mammoth.extractRawText({
      path:
        filePath,
    });

  const text =
    normalizeText(
      result?.value
    );

  if (!text) {
    return {
      text: "",

      error:
        `${extension.toUpperCase()} file appears empty or unreadable.`,
    };
  }

  return {
    text,

    error:
      null,
  };
};


/* ═══════════════════════════════════════════════════════════════
   XLSX / XLS EXTRACTION
═══════════════════════════════════════════════════════════════ */

const extractSpreadsheet = async (
  filePath
) => {
  const XLSX =
    require("xlsx");

  /*
   * cellDates:
   * preserve spreadsheet date values when possible.
   *
   * raw:
   * true keeps original numeric values rather than
   * converting everything prematurely to formatted text.
   */
  const workbook =
    XLSX.readFile(
      filePath,
      {
        cellDates:
          true,

        raw:
          true,
      }
    );

  if (
    !workbook ||
    !Array.isArray(
      workbook.SheetNames
    ) ||
    workbook.SheetNames.length === 0
  ) {
    return {
      text: "",

      error:
        "Spreadsheet contains no readable worksheets.",
    };
  }

  const output = [];

  /*
   * Read every worksheet.
   *
   * We do NOT assume:
   * - first sheet only,
   * - fixed BOQ column names,
   * - fixed rows,
   * - fixed project format.
   */
  for (
    const sheetName
    of workbook.SheetNames
  ) {
    const worksheet =
      workbook.Sheets[
        sheetName
      ];

    if (!worksheet) {
      continue;
    }

    /*
     * header: 1
     * gives us arrays instead of guessing object keys.
     *
     * defval:
     * preserves empty cells as empty strings.
     *
     * raw:
     * keeps values close to their actual spreadsheet representation.
     */
    const rows =
      XLSX.utils.sheet_to_json(
        worksheet,
        {
          header:
            1,

          defval:
            "",

          raw:
            true,

          blankrows:
            false,
        }
      );

    const readableRows = [];

    for (const row of rows) {
      if (!Array.isArray(row)) {
        continue;
      }

      const cells =
        row.map(
          stringifyCellValue
        );

      /*
       * Remove only trailing empty cells.
       *
       * Middle empty cells are intentionally preserved because
       * they represent actual spreadsheet column positions.
       */
      while (
        cells.length > 0 &&
        cells[
          cells.length - 1
        ] === ""
      ) {
        cells.pop();
      }

      /*
       * Skip completely blank rows.
       */
      if (
        cells.length === 0 ||
        cells.every(
          (cell) =>
            cell === ""
        )
      ) {
        continue;
      }

      /*
       * Tab-separated representation works well for AI analysis:
       *
       * Column A<TAB>Column B<TAB>Column C
       */
      readableRows.push(
        cells.join("\t")
      );
    }

    if (
      readableRows.length === 0
    ) {
      continue;
    }

    output.push(
      [
        `===== SHEET: ${sheetName} =====`,
        ...readableRows,
      ].join("\n")
    );
  }

  const text =
    normalizeText(
      output.join(
        "\n\n"
      )
    );

  if (!text) {
    return {
      text: "",

      error:
        "Spreadsheet appears empty or contains no readable cell data.",
    };
  }

  return {
    text,

    error:
      null,
  };
};


/* ═══════════════════════════════════════════════════════════════
   CSV EXTRACTION
═══════════════════════════════════════════════════════════════ */

const extractCsv = async (
  filePath
) => {
  /*
   * Read raw CSV text directly.
   *
   * We intentionally do NOT convert CSV into a predefined BOQ schema.
   *
   * The AI service will analyse the actual columns/content.
   */
  const raw =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const text =
    normalizeText(raw);

  if (!text) {
    return {
      text: "",

      error:
        "CSV file appears empty.",
    };
  }

  return {
    text,

    error:
      null,
  };
};


/* ═══════════════════════════════════════════════════════════════
   MAIN EXTRACTOR
═══════════════════════════════════════════════════════════════ */

const extractText = async (
  filePath,
  originalName
) => {
  /*
   * Prefer original uploaded filename for extension detection.
   *
   * Fallback:
   * stored file path.
   */
  const sourceName =
    originalName ||
    filePath ||
    "";

  const ext =
    path
      .extname(
        sourceName
      )
      .toLowerCase();

  try {
    /* ─────────────────────────────────────────────────────────
       FILE VALIDATION
    ───────────────────────────────────────────────────────── */

    const validation =
      validateFileExists(
        filePath
      );

    if (!validation.valid) {
      return {
        text: "",

        error:
          validation.error,
      };
    }


    /* ─────────────────────────────────────────────────────────
       TXT
    ───────────────────────────────────────────────────────── */

    if (ext === ".txt") {
      return await extractTxt(
        filePath
      );
    }


    /* ─────────────────────────────────────────────────────────
       PDF
    ───────────────────────────────────────────────────────── */

    if (ext === ".pdf") {
      return await extractPdf(
        filePath
      );
    }


    /* ─────────────────────────────────────────────────────────
       DOC / DOCX
    ───────────────────────────────────────────────────────── */

    if (
      ext === ".docx" ||
      ext === ".doc"
    ) {
      return await extractWord(
        filePath,
        ext
      );
    }


    /* ─────────────────────────────────────────────────────────
       XLSX / XLS
    ───────────────────────────────────────────────────────── */

    if (
      ext === ".xlsx" ||
      ext === ".xls"
    ) {
      return await extractSpreadsheet(
        filePath
      );
    }


    /* ─────────────────────────────────────────────────────────
       CSV
    ───────────────────────────────────────────────────────── */

    if (ext === ".csv") {
      return await extractCsv(
        filePath
      );
    }


    /* ─────────────────────────────────────────────────────────
       UNSUPPORTED FORMAT
    ───────────────────────────────────────────────────────── */

    return {
      text: "",

      error:
        `Unsupported file type: ${ext || "unknown"}`,
    };
  } catch (err) {
    console.error(
      "extractText error:",
      err
    );

    return {
      text: "",

      error:
        `Could not read file: ${
          err?.message ||
          "Unknown extraction error"
        }`,
    };
  }
};


/* ═══════════════════════════════════════════════════════════════
   EXPORT
═══════════════════════════════════════════════════════════════ */

module.exports = {
  extractText,
};


// const fs   = require("fs");
// const path = require("path");

// /**
//  * Extract plain text from an uploaded file.
//  * Supports: .pdf, .docx, .doc, .txt
//  * Returns: { text: string, error: string|null }
//  */
// const extractText = async (filePath, originalName) => {
//   const ext = path.extname(originalName || filePath).toLowerCase();

//   try {
//     /* ── TXT ── */
//     if (ext === ".txt") {
//       const text = fs.readFileSync(filePath, "utf8");
//       return { text: text.trim(), error: null };
//     }

//     /* ── PDF ── */
//     if (ext === ".pdf") {
//       const pdfParse = require("pdf-parse");
//       const buffer   = fs.readFileSync(filePath);
//       const data     = await pdfParse(buffer);
//       const text     = data.text?.trim() || "";
//       if (!text) return { text: "", error: "PDF appears to be image-based (no extractable text)." };
//       return { text, error: null };
//     }

//     /* ── DOCX / DOC ── */
//     if (ext === ".docx" || ext === ".doc") {
//       const mammoth = require("mammoth");
//       const result  = await mammoth.extractRawText({ path: filePath });
//       const text    = result.value?.trim() || "";
//       if (!text) return { text: "", error: "DOCX appears empty or unreadable." };
//       return { text, error: null };
//     }

//     return { text: "", error: `Unsupported file type: ${ext}` };
//   } catch (err) {
//     console.error("extractText error:", err.message);
//     return { text: "", error: `Could not read file: ${err.message}` };
//   }
// };

// module.exports = { extractText };