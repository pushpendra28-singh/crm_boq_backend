const express = require("express");
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
//  SETUP NOTES:
//  1. Add to your .env:      OPENAI_API_KEY=sk-...
//  2. npm install openai
//  3. In your main app.js:   app.use("/api", proposalRoutes);
// ─────────────────────────────────────────────────────────────────────────────

const { protect } = require("../middleware/authMiddleware");

const {
  getProposals,
  getProposalById,
  getProposalStats,
  generateFromLead,
  generateManual,
  bulkGenerate,
  getGenerationStatus,
  updateProposalStatus,
  sendProposal,
  trackOpen,
  regenerateProposal,
  deleteProposal,
  getEligibleLeads,
} = require("../controllers/proposalController");

const {
  downloadProposalPDF,
  downloadProposalDOCX,
} = require("../controllers/proposalDownloadController");

// ── Public (open tracking — no auth needed) ──
router.get("/proposals/track/:token", trackOpen);

// ── Protected ──
router.get("/proposals/stats",              protect, getProposalStats);
router.get("/proposals/leads/eligible",     protect, getEligibleLeads);
router.get("/proposals",                    protect, getProposals);
router.get("/proposals/:id",                protect, getProposalById);
router.get("/proposals/:id/status",         protect, getGenerationStatus);

router.post("/proposals/generate-from-lead", protect, generateFromLead);
router.post("/proposals/generate-manual",    protect, generateManual);
router.post("/proposals/bulk-generate",      protect, bulkGenerate);
router.post("/proposals/:id/send",           protect, sendProposal);
router.post("/proposals/:id/regenerate",     protect, regenerateProposal);

router.patch("/proposals/:id/status",        protect, updateProposalStatus);
router.delete("/proposals/:id",              protect, deleteProposal);
router.get(
  "/proposals/:id/download/pdf",
  protect,
  downloadProposalPDF
);

router.get(
  "/proposals/:id/download/docx",
  protect,
  downloadProposalDOCX
);

module.exports = router;