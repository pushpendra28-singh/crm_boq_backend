"use strict";
const projectsController = require("./projectsController");

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  ASSIGNED PROJECTS CONTROLLER  —  completely separate from projectsController
 *  ───────────────────────────────────────────────────────────────────────────
 *  Purpose  : Return ONLY the projects where the currently logged-in admin
 *             is either the projectManager OR appears in assignedEngineers.
 *
 *  This file does NOT touch, import, or modify any existing project logic.
 *  It is a standalone read-only controller used exclusively by the
 *  "My Assigned Projects" module.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Project  = require("../models/Project");
const mongoose = require("mongoose");

/* ─── coerce numeric strings (needed for stats only) ─── */
const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

/* ═══════════════════════════════════════════════════════════
   HELPER — build the assignment match for the logged-in admin
   ───────────────────────────────────────────────────────────
   Matches projects where req.admin._id is:
     • the projectManager   OR
     • one of assignedEngineers
═══════════════════════════════════════════════════════════ */
const buildAssignmentMatch = (adminId) => ({
  isDeleted: false,
  $or: [
    { projectManager:    new mongoose.Types.ObjectId(adminId) },
    { assignedEngineers: new mongoose.Types.ObjectId(adminId) },
  ],
});

/* ═══════════════════════════════════════════════════════════
   GET /api/my-projects/count
   ───────────────────────────────────────────────────────────
   Used by the Dashboard on login to decide whether to show
   the "My Assigned Projects" sidebar item at all.
   Returns { count: <number> }
═══════════════════════════════════════════════════════════ */
exports.getAssignedCount = async (req, res) => {
  try {
    const count = await Project.countDocuments(
      buildAssignmentMatch(req.admin._id)
    );
    return res.json({ count });
  } catch (err) {
    console.error("[getAssignedCount]", err);
    return res.status(500).json({ message: "Failed to fetch assigned project count", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/my-projects
   ───────────────────────────────────────────────────────────
   Paginated list of projects assigned to the logged-in admin.
   Supports search, status filter, priority filter — same
   query-param contract as the main projects list so the
   existing frontend FilterBar component works as-is.
═══════════════════════════════════════════════════════════ */
exports.listAssignedProjects = async (req, res) => {
  try {
    const {
      page     = 1,
      limit    = 12,
      search   = "",
      status   = "",
      priority = "",
      sort     = "-createdAt",
    } = req.query;

    const VALID_STATUSES   = [
      "enquiry","site_survey","design","permit_pending",
      "procurement","installation","inspection","grid_connection",
      "completed","on_hold","cancelled",
    ];
    const VALID_PRIORITIES = ["low","medium","high","critical"];

    /* Base filter — only this admin's projects */
    const filter = buildAssignmentMatch(req.admin._id);

    /* Optional status / priority refinements */
    if (status   && VALID_STATUSES.includes(status))    filter.status   = status;
    if (priority && VALID_PRIORITIES.includes(priority)) filter.priority = priority;

    /* Optional search */
    if (search && search.trim()) {
      const re = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );

      const searchOr = [
        { title:            re },
        { projectId:        re },
        { "customer.name":  re },
        { "customer.city":  re },
        { "customer.phone": re },
        { tags:             re },
      ];

      /*
       * filter already has a top-level $or from buildAssignmentMatch.
       * Adding another $or would overwrite it, so we combine with $and.
       */
      filter.$and = [
        { $or: filter.$or },
        { $or: searchOr   },
      ];
      delete filter.$or;
    }

    const pageN  = Math.max(1, parseInt(page,  10) || 1);
    const limitN = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const skip   = (pageN - 1) * limitN;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitN)
        .populate("projectManager",    "name email role")
        .populate("assignedEngineers", "name email role")
        .lean(),
      Project.countDocuments(filter),
    ]);

    return res.json({
      projects,
      total,
      page:  pageN,
      pages: Math.ceil(total / limitN),
    });
  } catch (err) {
    console.error("[listAssignedProjects]", err);
    return res.status(500).json({ message: "Failed to fetch assigned projects", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/my-projects/stats
   ───────────────────────────────────────────────────────────
   Mini stats bar scoped to this admin's assigned projects only.
═══════════════════════════════════════════════════════════ */
exports.getAssignedStats = async (req, res) => {
  try {
    const now        = new Date();
    const baseMatch  = buildAssignmentMatch(req.admin._id);

    const [
      totalProjects,
      byStatus,
      avgAgg,
      overdueProjects,
    ] = await Promise.all([
      Project.countDocuments(baseMatch),

      Project.aggregate([
        { $match: baseMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),

      Project.aggregate([
        { $match: baseMatch },
        { $group: { _id: null, avg: { $avg: "$progressPercent" } } },
      ]),

      Project.countDocuments({
        ...baseMatch,
        expectedCompletionDate: { $lt: now },
        status: { $nin: ["completed", "cancelled"] },
      }),
    ]);

    return res.json({
      totalProjects,
      byStatus,
      avgProgress:     Math.round(avgAgg[0]?.avg ?? 0),
      overdueProjects,
    });
  } catch (err) {
    console.error("[getAssignedStats]", err);
    return res.status(500).json({ message: "Failed to fetch assigned project stats", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/my-projects/:id
   ───────────────────────────────────────────────────────────
   Fetch a single project — only succeeds if the logged-in
   admin is actually assigned to it (double-check at DB level).
═══════════════════════════════════════════════════════════ */
// exports.getAssignedProject = async (req, res) => {

//   try {
//     // if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//     //   return res.status(404).json({ message: "Project not found" });
//     // }

//     // /* Merge the project _id condition with the assignment scope */
//     // const filter = {
//     //   _id: req.params.id,
//     //   ...buildAssignmentMatch(req.admin._id),
//     // };

//     // /*
//     //  * buildAssignmentMatch returns { isDeleted, $or:[...] }.
//     //  * Spreading gives: { _id, isDeleted, $or }.
//     //  * That is a valid MongoDB filter — all conditions must be true.
//     //  */

//     // const project = await Project
//     //   .findOne(filter)
//     //   .populate("projectManager",    "name email role phone")
//     //   .populate("assignedEngineers", "name email role phone");

//     // if (!project) {
//     //   return res.status(404).json({
//     //     message: "Project not found or you are not assigned to it.",
//     //   });
//     // }

    

//     return res.json({ project });
//   } catch (err) {
//     console.error("[getAssignedProject]", err);
//     return res.status(500).json({ message: "Failed to fetch project", error: err.message });
//   }
// };

exports.getAssignedProject = async (req, res) => {
  try {
    return res.json({
      success: true,
      project: req.project,
    });
  } catch (err) {
    console.error("[getAssignedProject]", err);

    return res.status(500).json({
      message: "Failed to fetch project",
      error: err.message,
    });
  }
};


exports.updateAssignedProjectStatus = async (req, res) => {
  try {
    const { status } = req.body;

    req.project.status = status;

    await req.project.save();

    return res.json({
      success: true,
      message: "Project status updated successfully",
      project: req.project,
    });
  } catch (err) {
    console.error("[updateAssignedProjectStatus]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to update project status",
      error: err.message,
    });
  }
};


exports.addAssignedCheckIn = projectsController.addCheckIn;

exports.addAssignedDocument = projectsController.addDocument;

exports.deleteAssignedDocument = projectsController.deleteDocument;

exports.addAssignedMilestone = projectsController.addMilestone;

exports.updateAssignedMilestone = projectsController.updateMilestone;

exports.deleteAssignedMilestone = projectsController.deleteMilestone;
exports.sendAssignedNotification = projectsController.sendNotification;