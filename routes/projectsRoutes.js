"use strict";

const express = require("express");
const router = express.Router();
const controller = require("../controllers/projectsController");

// ✅ Direct import (no dynamic loading)
const { protect, requirePermission } = require("../middleware/authMiddleware");

/* ─────────────────────────────────────────────────────────────
   Permission wrapper (clean + safe)
───────────────────────────────────────────────────────────── */
const perm = (...permissions) => requirePermission(...permissions);

/* ══════════════════════════════════════════════════════════════
   ⚠️ IMPORTANT:
   Static routes MUST come before dynamic (:id) routes
══════════════════════════════════════════════════════════════ */

/* ── Stats ── */
router.get(
  "/stats/overview",
  protect,
  perm("view_projects"),
  controller.getStats
);

/* ── Engineers ── */
router.get(
  "/engineers",
  protect,
  perm("view_projects"),
  controller.getEngineers
);

/* ── Collection ── */
router.get(
  "/",
  protect,
  perm("view_projects"),
  controller.listProjects
);

router.post(
  "/",
  protect,
  perm("create_projects"),
  controller.createProject
);

/* ── Single Project ── */
router.get(
  "/:id",
  protect,
  perm("view_projects"),
  controller.getProject
);

router.put(
  "/:id",
  protect,
  perm("edit_projects"),
  controller.updateProject
);

router.delete(
  "/:id",
  protect,
  perm("delete_projects"),
  controller.deleteProject
);

/* ── Status ── */
router.put(
  "/:id/status",
  protect,
  perm("edit_projects"),
  controller.updateStatus
);

/* ── Milestones ── */
router.post(
  "/:id/milestones",
  protect,
  perm("edit_projects"),
  controller.addMilestone
);

router.put(
  "/:id/milestones/:mid",
  protect,
  perm("edit_projects"),
  controller.updateMilestone
);

router.delete(
  "/:id/milestones/:mid",
  protect,
  perm("edit_projects"),
  controller.deleteMilestone
);

/* ── Check-ins ── */
router.post(
  "/:id/checkins",
  protect,
  perm("edit_projects"),
  controller.addCheckIn
);

/* ── Documents ── */
router.post(
  "/:id/documents",
  protect,
  perm("edit_projects"),
  controller.addDocument
);

router.delete(
  "/:id/documents/:did",
  protect,
  perm("edit_projects"),
  controller.deleteDocument
);

/* ── Notifications ── */
router.post(
  "/:id/notify",
  protect,
  perm("edit_projects"),
  controller.sendNotification
);

/* ── Certificate ── */
router.post(
  "/:id/certificate",
  protect,
  perm("edit_projects"),
  controller.generateCertificate
);

module.exports = router;