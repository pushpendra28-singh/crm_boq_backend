"use strict";
const {
  onlyAssignedProject,
} = require("../middleware/projectScopeMiddleware");

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  ASSIGNED PROJECTS ROUTE  —  /api/my-projects
 *  ───────────────────────────────────────────────────────────────────────────
 *  Uses the SEPARATE "assigned_projects" permission set so that granting
 *  "view_assigned_projects" does NOT automatically expose the full
 *  /api/projects (all projects) module.
 *
 *  Permission mapping:
 *    view_assigned_projects   → list / detail  (GET routes)
 *    edit_assigned_projects   → not used here (handled inside ProjectDetail)
 *    delete_assigned_projects → not used here (handled inside ProjectDetail)
 *
 *  Register in your main app.js / server.js like:
 *    const myProjectsRouter = require("./routes/assignedProjectsRoute");
 *    app.use("/api/my-projects", myProjectsRouter);
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/assignedProjectsController");

const { protect, requirePermission } = require("../middleware/authMiddleware");

/* ─── All routes require authentication + view_projects permission ─── */

/*
 * GET /api/my-projects/count
 * Used on login / dashboard mount to decide if the sidebar
 * item "My Assigned Projects" should be visible at all.
 ** Requires view_assigned_projects (NOT view_projects).
 */
router.get(
  "/count",
  protect,
  requirePermission("view_assigned_projects"),
  controller.getAssignedCount
);

/*
 * GET /api/my-projects/stats
 * Mini stats scoped to the logged-in admin's assigned projects.
 */
router.get(
  "/stats",
  protect,
  requirePermission("view_assigned_projects"),
  controller.getAssignedStats
);

/*
 * GET /api/my-projects
 * Paginated list — only projects assigned to the logged-in admin.
 */
router.get(
  "/",
  protect,
  requirePermission("view_assigned_projects"),
  controller.listAssignedProjects
);

/*
 * GET /api/my-projects/:id
 * Single project detail — 404 if not assigned to this admin.
 */
router.get(
  "/:id",
  protect,
  requirePermission("view_assigned_projects"),
   onlyAssignedProject,
  controller.getAssignedProject
);
router.put(
  "/:id/status",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.updateAssignedProjectStatus
);

router.post(
  "/:id/checkins",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.addAssignedCheckIn
);

router.post(
  "/:id/documents",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.addAssignedDocument
);


router.delete(
  "/:id/documents/:did",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.deleteAssignedDocument
);


router.post(
  "/:id/milestones",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.addAssignedMilestone
);


router.put(
  "/:id/milestones/:mid",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.updateAssignedMilestone
);


router.delete(
  "/:id/milestones/:mid",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.deleteAssignedMilestone
);

router.post(
  "/:id/notify",
  protect,
  requirePermission("edit_assigned_projects"),
  onlyAssignedProject,
  controller.sendAssignedNotification
);

module.exports = router;