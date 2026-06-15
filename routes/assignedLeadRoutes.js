// routes/assignedLeadRoutes.js

const express = require("express");
const router  = express.Router();

const { protect }  = require("../middleware/authMiddleware");
const {
  getMyAssignedLeads,
  getMyAssignedLeadCount,
  logFollowUp,
  setReminder,
  updateLeadStatus,
   getSalesEmployees,   // ← ADD
  reassignLead,
} = require("../controllers/assignedLeadController");

// ─────────────────────────────────────────────────────────────
// Permission middleware — checks BOTH custom permissions array
// AND the role's default permissions so role-based users work too.
// ─────────────────────────────────────────────────────────────

// Mirrors Admin.methods.hasPermission exactly:
// 1. custom admin.permissions array (direct override)
// 2. Role document lookup by slug (same as AuthContext)
// const requirePerm = (perm) => async (req, res, next) => {
//   try {
//     const admin = req.admin;

//     if (admin.permissions && admin.permissions.length > 0) {
//       if (!admin.permissions.includes(perm)) {
//         return res.status(403).json({ success: false, message: "Permission denied" });
//       }
//       return next();
//     }

//     const Role = require("../models/Role");
//     const role = await Role.findOne({ slug: admin.role });

//     if (!role || !role.permissions.includes(perm)) {
//       return res.status(403).json({ success: false, message: "Permission denied" });
//     }

//     next();
//   } catch (err) {
//     console.error("requirePerm error:", err);
//     return res.status(500).json({ success: false, message: "Server error" });
//   }
// };
const requirePerm = (perm) => async (req, res, next) => {
  try {
    const admin = req.admin;

    // Superadmin bypass
    if (admin.role === "superadmin") {
      return next();
    }

    const Role = require("../models/Role");

    const role = await Role.findOne({
      slug: admin.role,
    });

    // Direct permissions
    const directPermissions = admin.permissions || [];

    // Role permissions
    const rolePermissions = role?.permissions || [];

    // Merge both
    const allPermissions = [
      ...new Set([
        ...directPermissions,
        ...rolePermissions,
      ]),
    ];

    if (!allPermissions.includes(perm)) {
      return res.status(403).json({
        success: false,
        message: "Permission denied",
      });
    }

    next();

  } catch (err) {
    console.error("requirePerm error:", err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ─── Routes ───────────────────────────────────────────────────

// List + count (view permission)
router.get("/my-leads/count", protect, requirePerm("view_assigned_leads"), getMyAssignedLeadCount);
router.get("/my-leads",       protect, requirePerm("view_assigned_leads"), getMyAssignedLeads);

// Mutation routes (edit permission)
router.post ("/my-leads/:id/followup", protect, requirePerm("edit_assigned_leads"), logFollowUp);
router.post ("/my-leads/:id/reminder", protect, requirePerm("edit_assigned_leads"), setReminder);
router.patch("/my-leads/:id/status",   protect, requirePerm("edit_assigned_leads"), updateLeadStatus);
// Employee fetching peers for reassignment
router.get ("/my-leads/employees",       protect, requirePerm("edit_assigned_leads"), getSalesEmployees);

// Employee reassigning their lead to another employee
router.patch("/my-leads/:id/reassign",  protect, requirePerm("edit_assigned_leads"), reassignLead);

module.exports = router;