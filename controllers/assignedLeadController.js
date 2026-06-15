// controllers/assignedLeadController.js

const Lead = require("../models/Lead");

// ─────────────────────────────────────────────────────────────
// GET LOGGED-IN USER ASSIGNED LEADS  (paginated + filtered)
// ─────────────────────────────────────────────────────────────

exports.getMyAssignedLeads = async (req, res) => {
  try {
    const adminId = req.admin._id;

    const {
      status,
      category,
      search,
      page     = 1,
      limit    = 15,
      sortBy   = "createdAt",
      sortOrder= "desc",
    } = req.query;

    const filter = { assignedTo: adminId };

    if (status) {
  filter.assignedLeadStatus = status.toLowerCase();
}
    if (category) filter.category = category;

    if (search) {
      filter.$or = [
        { name:        { $regex: search, $options: "i" } },
        { whatsapp:    { $regex: search, $options: "i" } },
        { email:       { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { societyName: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("assignedTo", "name email")
        .populate("assignmentHistory.assignedBy", "name"),
      Lead.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      leads,
      pagination: {
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Assigned Leads Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch assigned leads" });
  }
};

// ─────────────────────────────────────────────────────────────
// COUNT
// ─────────────────────────────────────────────────────────────

exports.getMyAssignedLeadCount = async (req, res) => {
  try {
    const count = await Lead.countDocuments({ assignedTo: req.admin._id });
    return res.status(200).json({ success: true, count });
  } catch (error) {
    console.error("Assigned Lead Count Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch assigned lead count" });
  }
};

// ─────────────────────────────────────────────────────────────
// LOG FOLLOW-UP  (also updates status + schedules next followup)
// ─────────────────────────────────────────────────────────────

exports.logFollowUp = async (req, res) => {
  try {
    const { type, outcome, notes, nextFollowUp, newStatus } = req.body;

    if (!notes?.trim()) {
      return res.status(400).json({ success: false, message: "Notes are required" });
    }

    const lead = await Lead.findOne({
      _id:        req.params.id,
      assignedTo: req.admin._id,
    });

    if (!lead) {
      return res.status(403).json({ success: false, message: "Access denied to this lead" });
    }

    // Append followup entry
    lead.followUps = lead.followUps || [];
    lead.followUps.push({
      type:          type || "call",
      outcome:       outcome || "",
      notes:         notes.trim(),
      nextFollowUp:  nextFollowUp ? new Date(nextFollowUp) : null,
      createdAt:     new Date(),
      createdBy:     req.admin._id,
    });

    // Update status if provided
   if (newStatus) {
  lead.assignedLeadStatus = newStatus.toLowerCase();
}

    // If nextFollowUp is set, also save it as the reminder (convenience)
    if (nextFollowUp) {
      lead.reminder = {
        date:      new Date(nextFollowUp),
        note:      `Follow-up: ${type || "call"}`,
        createdBy: req.admin._id,
      };
    }

    await lead.save();

    return res.status(200).json({ success: true, message: "Follow-up logged", lead });
  } catch (error) {
    console.error("Log FollowUp Error:", error);
console.error(error.message);
console.error(error.errors);
    return res.status(500).json({ success: false, message: "Failed to log follow-up" });
  }
};

// ─────────────────────────────────────────────────────────────
// SET REMINDER
// ─────────────────────────────────────────────────────────────

exports.setReminder = async (req, res) => {
  try {
    const { reminderDate, reminderNote } = req.body;

    if (!reminderDate) {
      return res.status(400).json({ success: false, message: "Reminder date is required" });
    }

    const lead = await Lead.findOne({
      _id:        req.params.id,
      assignedTo: req.admin._id,
    });

    if (!lead) {
      return res.status(403).json({ success: false, message: "Access denied to this lead" });
    }

    lead.reminder = {
      date:      new Date(reminderDate),
      note:      reminderNote?.trim() || "",
      createdBy: req.admin._id,
    };

    await lead.save();

    return res.status(200).json({ success: true, message: "Reminder set", lead });
  } catch (error) {
    console.error("Set Reminder Error:", error);
    return res.status(500).json({ success: false, message: "Failed to set reminder" });
  }
};

// ─────────────────────────────────────────────────────────────
// QUICK STATUS UPDATE
// ─────────────────────────────────────────────────────────────

exports.updateLeadStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const VALID = ["new","contacted","interested","not_interested","callback","converted","closed"];
    if (!VALID.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.admin._id },
        { assignedLeadStatus: status },
      { new: true }
    );

    if (!lead) {
      return res.status(403).json({ success: false, message: "Access denied to this lead" });
    }

    return res.status(200).json({ success: true, message: "Status updated", lead });
  } catch (error) {
    console.error("Update Status Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update status" });
  }
};

// ─────────────────────────────────────────────────────────────
// GET ALL SALES EMPLOYEES (for reassign dropdown)
// Only returns admins with a role that has "view_assigned_leads"
// permission — i.e. sales-type employees
// ─────────────────────────────────────────────────────────────
exports.getSalesEmployees = async (req, res) => {
  try {
    const Admin = require("../models/Admin"); // adjust path if needed
    const Role  = require("../models/Role");

    // Find roles that have the sales permission
    const salesRoles = await Role.find({
      permissions: { $in: ["view_assigned_leads"] },
    }).select("slug");

    const roleSlugs = salesRoles.map((r) => r.slug);

    const employees = await Admin.find({
      _id:    { $ne: req.admin._id },          // exclude self
      role:   { $in: roleSlugs },
      status: { $ne: "inactive" },             // skip if you have status field
    }).select("_id name email role");

    return res.status(200).json({ success: true, employees });
  } catch (error) {
    console.error("Get Sales Employees Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch employees" });
  }
};

// ─────────────────────────────────────────────────────────────
// EMPLOYEE REASSIGN LEAD TO ANOTHER EMPLOYEE
// ─────────────────────────────────────────────────────────────
exports.reassignLead = async (req, res) => {
  try {
    const { targetEmployeeId, note } = req.body;

    if (!targetEmployeeId) {
      return res.status(400).json({ success: false, message: "Target employee ID required" });
    }

    // Lead must currently belong to requesting employee
    const lead = await Lead.findOne({
      _id:        req.params.id,
      assignedTo: req.admin._id,
    });

    if (!lead) {
      return res.status(403).json({ success: false, message: "Access denied or lead not found" });
    }

    const Admin = require("../models/Admin"); // adjust path if needed
    const targetEmployee = await Admin.findById(targetEmployeeId).select("name email");

    if (!targetEmployee) {
      return res.status(404).json({ success: false, message: "Target employee not found" });
    }

    // Push to history BEFORE overwriting
    lead.assignmentHistory = lead.assignmentHistory || [];
    lead.assignmentHistory.push({
      assignedTo:     lead.assignedTo,
      assignedToName: lead.assignedToName,
      assignedBy:     req.admin._id,
      assignedByName: req.admin.name,
      assignedAt:     lead.assignedAt || lead.createdAt,
      note:           note?.trim() || "",
    });

    // Reassign
    lead.assignedTo     = targetEmployee._id;
    lead.assignedToName = targetEmployee.name;
    lead.assignedAt     = new Date();

    // Reset assigned status so new employee starts fresh
    lead.assignedLeadStatus = "new";

    await lead.save();

    return res.status(200).json({
      success: true,
      message: `Lead reassigned to ${targetEmployee.name}`,
      lead,
    });
  } catch (error) {
    console.error("Reassign Lead Error:", error);
    return res.status(500).json({ success: false, message: "Failed to reassign lead" });
  }
};