const express = require("express");
const router = express.Router();

// ─── Auth middleware ──────────────────────────────────────────────────────────
// Your authMiddleware exports: { protect, requireRole, requirePermission, requireAnyPermission }
const { protect } = require("../middleware/authMiddleware");

// ─── Controllers ──────────────────────────────────────────────────────────────
const {
  getLeads,
  getLeadById,
  getLeadStats,
  createLead,
  webhookLead,
  updateLeadStatus,
  assignLead,
  addNote,
  mergeLeads,
  deleteLead,
  getQualifiedLeads,
} = require("../controllers/leadController");

// ─── Public webhook endpoints (no auth — called by Google/Meta/Landing pages) ─
//   POST /api/leads/webhook/google   → Google Ads Lead Form Extension
//   POST /api/leads/webhook/meta     → Meta Lead Ads webhook
//   POST /api/leads/webhook/landing  → Generic landing page / any form builder
router.post("/leads/webhook/:provider", webhookLead);

// ─── Protected routes (auth token required) ───────────────────────────────────
// NOTE: static paths (/stats, /merge) must come BEFORE param paths (/:id)
// to prevent Express matching the literal word as an :id value.

// PUBLIC WEBSITE FORM SAVE
router.post("/leads/public", createLead);
router.get("/leads/stats",        protect, getLeadStats);
router.get("/leads",              protect, getLeads);
router.get(
  "/leads/qualified",
  protect,
  getQualifiedLeads
);
router.get("/leads/:id",          protect, getLeadById);
router.post("/leads",             protect, createLead);
router.post("/leads/merge",       protect, mergeLeads);
router.post("/leads/:id/notes",   protect, addNote);
router.patch("/leads/:id/status", protect, updateLeadStatus);
router.patch("/leads/:id/assign", protect, assignLead);

router.delete("/leads/:id",       protect, deleteLead);


module.exports = router;