const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  protect,
} = require("../middleware/authMiddleware");

const {
  startTender,
  sendMessage,
  createFromDoc,
  getAllTenders,
  getTenderById,
  updateStatus,
  downloadDocx,
  downloadXlsx,
  getVendors,
  sendToVendor,

  // Backward-compatible multi-work routes
  startMultiSession,
  multiMessage,
  multiFromDoc,
  downloadMultiDocx,
  downloadMultiXlsx,
} = require("../controllers/tenderController");


/* ═══════════════════════════════════════════════════════════════
   UPLOAD DIRECTORY
═══════════════════════════════════════════════════════════════ */

/*
 * Existing upload location remains:
 *
 * uploads/
 *
 * We only make sure the folder exists so Multer does not fail
 * when the application is started on a fresh machine/server.
 */

const uploadDir = path.resolve(
  process.cwd(),
  "uploads"
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true,
  });
}


/* ═══════════════════════════════════════════════════════════════
   MULTER STORAGE
═══════════════════════════════════════════════════════════════ */

const storage = multer.diskStorage({
  destination: (
    req,
    file,
    cb
  ) => {
    cb(
      null,
      uploadDir
    );
  },

  filename: (
    req,
    file,
    cb
  ) => {
    /*
     * Keep the original extension because fileExtractor
     * determines parser from the extension.
     */

    const extension =
      path
        .extname(
          file.originalname
        )
        .toLowerCase();

    /*
     * Random suffix prevents filename collisions when
     * multiple uploads happen in the same millisecond.
     */
    const uniqueSuffix =
      `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;

    cb(
      null,
      `tender_${uniqueSuffix}${extension}`
    );
  },
});


/* ═══════════════════════════════════════════════════════════════
   ALLOWED UPLOAD TYPES
═══════════════════════════════════════════════════════════════ */

/*
 * IMPORTANT:
 *
 * Existing accepted extensions are preserved.
 *
 * Current fileExtractor supports:
 *
 * .pdf
 * .doc
 * .docx
 * .txt
 *
 * .xlsx / .xls / .csv are intentionally NOT removed here,
 * because removing them would change existing API behaviour.
 *
 * We will add their extraction support inside fileExtractor.js.
 */

const ALLOWED_EXTENSIONS =
  new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".txt",
    ".xlsx",
    ".xls",
    ".csv",
  ]);


/* ═══════════════════════════════════════════════════════════════
   MULTER CONFIGURATION
═══════════════════════════════════════════════════════════════ */

const upload = multer({
  storage,

  /*
   * Existing 10 MB limit preserved.
   */
  limits: {
    fileSize:
      10 * 1024 * 1024,
  },

  fileFilter: (
    req,
    file,
    cb
  ) => {
    const extension =
      path
        .extname(
          file.originalname
        )
        .toLowerCase();

    if (
      ALLOWED_EXTENSIONS.has(
        extension
      )
    ) {
      return cb(
        null,
        true
      );
    }

    return cb(
      new Error(
        "Only PDF, DOC, DOCX, TXT, XLSX, XLS, CSV allowed."
      )
    );
  },
});


/* ═══════════════════════════════════════════════════════════════
   ROUTES
═══════════════════════════════════════════════════════════════ */

/*
 * IMPORTANT ROUTING RULE
 * ---------------------------------------------------------------
 *
 * Specific/static routes are declared BEFORE generic /:id routes.
 *
 * No API URL has been changed.
 * No HTTP method has been changed.
 * No upload field name has been changed.
 * No auth middleware has been removed.
 */


/* ═══════════════════════════════════════════════════════════════
   STANDARD TENDER — STATIC ROUTES
═══════════════════════════════════════════════════════════════ */

/*
 * POST
 * /api/tender/start
 */

router.post(
  "/start",
  protect,
  startTender
);


/*
 * POST
 * /api/tender/from-doc
 *
 * Frontend FormData field:
 *
 * doc
 */

router.post(
  "/from-doc",
  protect,
  upload.single("doc"),
  createFromDoc
);


/*
 * GET
 * /api/tender/vendors
 *
 * MUST remain before /:id.
 */

router.get(
  "/vendors",
  protect,
  getVendors
);


/*
 * GET
 * /api/tender
 */

router.get(
  "/",
  protect,
  getAllTenders
);


/* ═══════════════════════════════════════════════════════════════
   MULTI-WORK / LEGACY COMPATIBILITY ROUTES
═══════════════════════════════════════════════════════════════ */

/*
 * These endpoints remain available so existing frontend
 * implementations do not break.
 *
 * Internally the updated controller now delegates them to
 * the SAME universal TenderAIService.
 *
 * Therefore:
 *
 * standard flow
 * multi flow
 *
 * both use the same dynamic BOQ intelligence.
 */


/*
 * POST
 * /api/tender/multi/start
 */

router.post(
  "/multi/start",
  protect,
  startMultiSession
);


/*
 * POST
 * /api/tender/multi/from-doc
 *
 * Frontend FormData field remains:
 *
 * doc
 */

router.post(
  "/multi/from-doc",
  protect,
  upload.single("doc"),
  multiFromDoc
);


/*
 * POST
 * /api/tender/multi/:id/message
 */

router.post(
  "/multi/:id/message",
  protect,
  multiMessage
);


/*
 * GET
 * /api/tender/multi/:id/download-xlsx
 *
 * Primary Excel download.
 */

router.get(
  "/multi/:id/download-xlsx",
  protect,
  downloadMultiXlsx
);


/*
 * GET
 * /api/tender/multi/:id/download-docx
 *
 * Backward-compatible endpoint.
 *
 * Controller currently delegates this to Excel generation.
 */

router.get(
  "/multi/:id/download-docx",
  protect,
  downloadMultiDocx
);


/* ═══════════════════════════════════════════════════════════════
   STANDARD TENDER — PARAMETERIZED ROUTES
═══════════════════════════════════════════════════════════════ */

/*
 * These routes intentionally come AFTER:
 *
 * /vendors
 * /multi/*
 *
 * so generic :id matching cannot interfere with more
 * specific routes.
 */


/*
 * GET
 * /api/tender/:id/download-xlsx
 *
 * This is the primary endpoint currently called by frontend:
 *
 * GET /api/tender/{tenderId}/download-xlsx
 */

router.get(
  "/:id/download-xlsx",
  protect,
  downloadXlsx
);


/*
 * GET
 * /api/tender/:id/download-docx
 *
 * Existing alias preserved.
 */

router.get(
  "/:id/download-docx",
  protect,
  downloadDocx
);


/*
 * POST
 * /api/tender/:id/message
 */

router.post(
  "/:id/message",
  protect,
  sendMessage
);


/*
 * PATCH
 * /api/tender/:id/status
 */

router.patch(
  "/:id/status",
  protect,
  updateStatus
);


/*
 * POST
 * /api/tender/:id/send
 *
 * Existing multipart field name preserved:
 *
 * customDoc
 */

router.post(
  "/:id/send",
  protect,
  upload.single(
    "customDoc"
  ),
  sendToVendor
);


/*
 * GET
 * /api/tender/:id
 *
 * Keep generic ID lookup LAST.
 */

router.get(
  "/:id",
  protect,
  getTenderById
);


/* ═══════════════════════════════════════════════════════════════
   EXPORT
═══════════════════════════════════════════════════════════════ */

module.exports = router;



// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// const path = require("path");
// const { protect } = require("../middleware/authMiddleware");
// const {
//   startTender, sendMessage, createFromDoc,
//   getAllTenders, getTenderById, updateStatus,
//   downloadDocx, downloadXlsx, getVendors, sendToVendor,
//   startMultiSession, multiMessage, multiFromDoc,
//   downloadMultiDocx, downloadMultiXlsx,
// } = require("../controllers/tenderController");

// /* ── Multer ── */
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, "uploads/"),
//   filename: (req, file, cb) => cb(null, `tender_${Date.now()}${path.extname(file.originalname)}`),
// });
// const upload = multer({
//   storage,
//   limits: { fileSize: 10 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     const allowed = [".pdf", ".doc", ".docx", ".txt", ".xlsx", ".xls",".csv"];
//     allowed.includes(path.extname(file.originalname).toLowerCase())
//       ? cb(null, true)
//       : cb(new Error("Only PDF, DOC, DOCX, TXT, XLSX, XLS, CSV allowed."));
//   },
// });

// /* ── Routes — all existing routes preserved ── */
// router.post("/start",                  protect, startTender);
// router.post("/from-doc",               protect, upload.single("doc"), createFromDoc);
// router.get("/vendors",                 protect, getVendors);           // ← MUST be before /:id
// router.get("/",                        protect, getAllTenders);
// router.get("/:id",                     protect, getTenderById);
// router.get("/:id/download-xlsx",       protect, downloadXlsx);         // ← primary (Excel)
// router.get("/:id/download-docx",       protect, downloadDocx);         // ← alias → also serves Excel now
// router.post("/:id/message",            protect, sendMessage);
// router.patch("/:id/status",            protect, updateStatus);
// router.post("/:id/send",               protect, upload.single("customDoc"), sendToVendor);

// /* ── Multi-work routes (kept for backward compat) ── */
// router.post("/multi/start",            protect, startMultiSession);
// router.post("/multi/:id/message",      protect, multiMessage);
// router.post("/multi/from-doc",         protect, upload.single("doc"), multiFromDoc);
// router.get("/multi/:id/download-docx", protect, downloadMultiDocx);    // → Excel now
// router.get("/multi/:id/download-xlsx", protect, downloadMultiXlsx);

// module.exports = router;
















