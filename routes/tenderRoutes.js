const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { protect } = require("../middleware/authMiddleware");
const {
  startTender, sendMessage, createFromDoc,
  getAllTenders, getTenderById, updateStatus,
  downloadDocx, downloadXlsx, getVendors, sendToVendor,
  startMultiSession, multiMessage, multiFromDoc,
  downloadMultiDocx, downloadMultiXlsx,
} = require("../controllers/tenderController");

/* ── Multer ── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `tender_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx", ".txt"];
    allowed.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error("Only PDF, DOC, DOCX, TXT allowed."));
  },
});

/* ── Routes — all existing routes preserved ── */
router.post("/start",                  protect, startTender);
router.post("/from-doc",               protect, upload.single("doc"), createFromDoc);
router.get("/vendors",                 protect, getVendors);           // ← MUST be before /:id
router.get("/",                        protect, getAllTenders);
router.get("/:id",                     protect, getTenderById);
router.get("/:id/download-xlsx",       protect, downloadXlsx);         // ← primary (Excel)
router.get("/:id/download-docx",       protect, downloadDocx);         // ← alias → also serves Excel now
router.post("/:id/message",            protect, sendMessage);
router.patch("/:id/status",            protect, updateStatus);
router.post("/:id/send",               protect, upload.single("customDoc"), sendToVendor);

/* ── Multi-work routes (kept for backward compat) ── */
router.post("/multi/start",            protect, startMultiSession);
router.post("/multi/:id/message",      protect, multiMessage);
router.post("/multi/from-doc",         protect, upload.single("doc"), multiFromDoc);
router.get("/multi/:id/download-docx", protect, downloadMultiDocx);    // → Excel now
router.get("/multi/:id/download-xlsx", protect, downloadMultiXlsx);

module.exports = router;
















// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// const path = require("path");
// const { protect, requirePermission } = require("../middleware/authMiddleware");
// const {
//   startTender, sendMessage, createFromDoc,
//   getAllTenders, getTenderById, updateStatus, downloadDocx, getVendors, sendToVendor,
// } = require("../controllers/tenderController");
// const {
//   startMultiSession, multiMessage, multiFromDoc,
//   downloadMultiDocx, downloadMultiXlsx,
// } = require("../controllers/tenderController");


// /* ── Multer ── */
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, "uploads/"),
//   filename: (req, file, cb) =>
//     cb(null, `tender_${Date.now()}${path.extname(file.originalname)}`),
// });
// const upload = multer({
//   storage,
//   limits: { fileSize: 10 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     const allowed = [".pdf", ".doc", ".docx", ".txt"];
//     allowed.includes(path.extname(file.originalname).toLowerCase())
//       ? cb(null, true)
//       : cb(new Error("Only PDF, DOC, DOCX, TXT allowed."));
//   },
// });

// /* ── Routes (all existing routes unchanged, one new added) ── */
// router.post("/start",             protect, startTender);
// router.post("/from-doc",          protect, upload.single("doc"), createFromDoc);
// router.get("/vendors",            protect, getVendors);          // ← MUST be before /:id
// router.get("/",                   protect, getAllTenders);
// router.get("/:id",                protect, getTenderById);
// router.get("/:id/download-docx",  protect, downloadDocx);
// router.post("/:id/message",       protect, sendMessage);
// router.patch("/:id/status",       protect, updateStatus);
// router.post("/:id/send",          protect, upload.single("customDoc"), sendToVendor);

// router.post("/multi/start",              protect, startMultiSession);
// router.post("/multi/from-doc",           protect, upload.single("doc"), multiFromDoc);
// router.get( "/multi/:id/download-docx",  protect, downloadMultiDocx);
// router.get( "/multi/:id/download-xlsx",  protect, downloadMultiXlsx);
// router.post("/multi/:id/message",        protect, multiMessage);

// module.exports = router;