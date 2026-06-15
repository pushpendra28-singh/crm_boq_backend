"use strict";

const Project  = require("../models/Project");
const mongoose = require("mongoose");

const LIFECYCLE = [
  "enquiry", "site_survey", "design", "permit_pending",
  "procurement", "installation", "inspection", "grid_connection", "completed",
];

const VALID_STATUSES = [
  "enquiry", "site_survey", "design", "permit_pending",
  "procurement", "installation", "inspection", "grid_connection",
  "completed", "on_hold", "cancelled",
];

const VALID_PRIORITIES  = ["low", "medium", "high", "critical"];
const VALID_DOC_TYPES   = ["contract", "permit", "completion_certificate", "inspection_report", "photo", "other"];
const VALID_CHECKIN_STATUS = ["on_track", "delayed", "issue_found", "milestone_reached"];
const VALID_MILESTONE_STATUS = ["pending", "in_progress", "completed", "delayed"];

/* ─── safe user snapshot ─── */
const snap = (user) =>
  user && user._id ? { _id: user._id, name: user.name || "Unknown" } : { name: "System" };

/* ─── coerce numeric strings from form inputs ─── */
const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

/* ─── sanitise installation block ─── */
const cleanInstallation = (raw = {}) => ({
  systemCapacity:      toNum(raw.systemCapacity),
  panelCount:          toNum(raw.panelCount),
  panelModel:          raw.panelModel          || "",
  inverterModel:       raw.inverterModel        || "",
  inverterCapacity:    toNum(raw.inverterCapacity),
  mountingType:        ["rooftop","ground","carport","other"].includes(raw.mountingType)
                         ? raw.mountingType : "rooftop",
  installationAddress: raw.installationAddress  || "",
  expectedOutput:      toNum(raw.expectedOutput),
  subsidyAmount:       toNum(raw.subsidyAmount),
  totalCost:           toNum(raw.totalCost),
  quotationNumber:     raw.quotationNumber      || "",
});

/* ═══════════════════════════════════════════════════════════
   GET /api/projects  — paginated list
═══════════════════════════════════════════════════════════ */
exports.listProjects = async (req, res) => {
  try {
    const {
      page = 1, limit = 12,
      search = "", status = "", priority = "",
      sort = "-createdAt",
    } = req.query;

    const filter = { isDeleted: false };
    if (status   && VALID_STATUSES.includes(status))    filter.status   = status;
    if (priority && VALID_PRIORITIES.includes(priority)) filter.priority = priority;

    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { title:            re },
        { projectId:        re },
        { "customer.name":  re },
        { "customer.city":  re },
        { "customer.phone": re },
        { tags:             re },
      ];
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
    console.error("[listProjects]", err);
    return res.status(500).json({ message: "Failed to fetch projects", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/projects/stats/overview
═══════════════════════════════════════════════════════════ */
exports.getStats = async (req, res) => {
  try {
    const base = { isDeleted: false };
    const now  = new Date();

    const [
      totalProjects,
      byStatus,
      byPriority,
      avgAgg,
      overdueProjects,
      capacityAgg,
    ] = await Promise.all([
      Project.countDocuments(base),
      Project.aggregate([
        { $match: base },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Project.aggregate([
        { $match: base },
        { $group: { _id: "$priority", count: { $sum: 1 } } },
      ]),
      Project.aggregate([
        { $match: base },
        { $group: { _id: null, avg: { $avg: "$progressPercent" } } },
      ]),
      Project.countDocuments({
        ...base,
        expectedCompletionDate: { $lt: now },
        status: { $nin: ["completed", "cancelled"] },
      }),
      Project.aggregate([
        { $match: { ...base, status: "completed" } },
        { $group: { _id: null, total: { $sum: "$installation.systemCapacity" } } },
      ]),
    ]);

    return res.json({
      totalProjects,
      byStatus,
      byPriority,
      avgProgress:     Math.round(avgAgg[0]?.avg ?? 0),
      overdueProjects,
      totalCapacityKW: capacityAgg[0]?.total ?? 0,
    });
  } catch (err) {
    console.error("[getStats]", err);
    return res.status(500).json({ message: "Failed to fetch stats", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/projects/engineers
═══════════════════════════════════════════════════════════ */
exports.getEngineers = async (req, res) => {
  try {
    let AdminModel;
    // Try the most common model names in order
    for (const name of ["Admin", "User", "Employee"]) {
      try { AdminModel = mongoose.model(name); break; } catch (_) {}
    }
    if (!AdminModel) return res.json({ engineers: [] });

    const engineers = await AdminModel
      .find({ isActive: { $ne: false }, isDeleted: { $ne: true } })
      .select("name email role phone")
      .sort("name")
      .lean();

    return res.json({ engineers });
  } catch (err) {
    console.error("[getEngineers]", err);
    return res.status(500).json({ message: "Failed to fetch engineers", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/projects/:id
═══════════════════════════════════════════════════════════ */
exports.getProject = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = await Project
      .findOne({ _id: req.params.id, isDeleted: false })
      .populate("projectManager",    "name email role phone")
      .populate("assignedEngineers", "name email role phone");

    if (!project) return res.status(404).json({ message: "Project not found" });
    return res.json({ project });
  } catch (err) {
    console.error("[getProject]", err);
    return res.status(500).json({ message: "Failed to fetch project", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/projects  — create
═══════════════════════════════════════════════════════════ */
exports.createProject = async (req, res) => {
  try {
    const {
      title, description, notes, tags,
      status, priority,
      customer, installation,
      projectManager, assignedEngineers,
      startDate, expectedCompletionDate,
      milestones,
    } = req.body;

    /* ── Validation ── */
    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Project title is required" });
    }
    if (!customer || !customer.name || !customer.name.trim()) {
      return res.status(400).json({ message: "Customer name is required" });
    }

    /* ── Sanitise milestones coming from form ── */
    const cleanedMilestones = (Array.isArray(milestones) ? milestones : [])
      .filter((m) => m && m.title && m.title.trim())
      .map((m, i) => ({
        title:       m.title.trim(),
        description: m.description || "",
        status:      VALID_MILESTONE_STATUS.includes(m.status) ? m.status : "pending",
        dueDate:     m.dueDate || null,
        order:       typeof m.order === "number" ? m.order : i,
      }));

    /* ── Sanitise assigned engineers (may arrive as ObjectId strings or objects) ── */
    const engineerIds = (Array.isArray(assignedEngineers) ? assignedEngineers : [])
      .map((e) => (typeof e === "object" && e._id ? e._id : e))
      .filter((e) => e && mongoose.Types.ObjectId.isValid(e));

    const pmId = projectManager && mongoose.Types.ObjectId.isValid(
      typeof projectManager === "object" ? projectManager._id : projectManager
    )
      ? (typeof projectManager === "object" ? projectManager._id : projectManager)
      : null;

    const doc = {
      title:       title.trim(),
      description: description  || "",
      notes:       notes        || "",
      tags:        Array.isArray(tags) ? tags.filter(Boolean) : [],
      status:      VALID_STATUSES.includes(status)    ? status    : "enquiry",
      priority:    VALID_PRIORITIES.includes(priority) ? priority  : "medium",
      customer: {
        name:    customer.name.trim(),
        email:   customer.email   || "",
        phone:   customer.phone   || "",
        address: customer.address || "",
        city:    customer.city    || "",
        state:   customer.state   || "",
        pincode: customer.pincode || "",
      },
      installation: cleanInstallation(installation),
      projectManager:    pmId,
      assignedEngineers: engineerIds,
      startDate:              startDate              || null,
      expectedCompletionDate: expectedCompletionDate || null,
      milestones: cleanedMilestones,
       createdBy:  req.admin?._id || null,
    };

    const project  = await Project.create(doc);
    const populated = await Project
      .findById(project._id)
      .populate("projectManager",    "name email role")
      .populate("assignedEngineers", "name email role");

    return res.status(201).json({
      message: "Project created successfully",
      project: populated,
    });
  } catch (err) {
    console.error("[createProject]", err);
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message).join(", ");
      return res.status(400).json({ message: messages });
    }
    if (err.code === 11000) {
      return res.status(409).json({ message: "Duplicate project ID — please try again" });
    }
    return res.status(500).json({ message: "Failed to create project", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   PUT /api/projects/:id  — full update
═══════════════════════════════════════════════════════════ */
exports.updateProject = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const {
      title, description, notes, tags,
      status, priority,
      customer, installation,
      projectManager, assignedEngineers,
      startDate, expectedCompletionDate, actualCompletionDate,
      milestones,
    } = req.body;

    if (title       !== undefined) project.title       = title.trim();
    if (description !== undefined) project.description = description;
    if (notes       !== undefined) project.notes       = notes;
    if (tags        !== undefined) project.tags        = Array.isArray(tags) ? tags : [];

    if (status   !== undefined && VALID_STATUSES.includes(status))    project.status   = status;
    if (priority !== undefined && VALID_PRIORITIES.includes(priority)) project.priority = priority;

    if (customer) {
      project.customer = {
        name:    (customer.name    || project.customer.name || "").trim(),
        email:   customer.email    ?? project.customer.email,
        phone:   customer.phone    ?? project.customer.phone,
        address: customer.address  ?? project.customer.address,
        city:    customer.city     ?? project.customer.city,
        state:   customer.state    ?? project.customer.state,
        pincode: customer.pincode  ?? project.customer.pincode,
      };
    }

    if (installation) {
      project.installation = cleanInstallation({
        ...project.installation.toObject?.() || project.installation,
        ...installation,
      });
    }

    if (projectManager !== undefined) {
      const pmId = typeof projectManager === "object" && projectManager?._id
        ? projectManager._id
        : projectManager;
      project.projectManager = pmId && mongoose.Types.ObjectId.isValid(pmId) ? pmId : null;
    }

    if (assignedEngineers !== undefined) {
      project.assignedEngineers = (Array.isArray(assignedEngineers) ? assignedEngineers : [])
        .map((e) => (typeof e === "object" && e._id ? e._id : e))
        .filter((e) => e && mongoose.Types.ObjectId.isValid(e));
    }

    if (startDate              !== undefined) project.startDate              = startDate              || null;
    if (expectedCompletionDate !== undefined) project.expectedCompletionDate = expectedCompletionDate || null;
    if (actualCompletionDate   !== undefined) project.actualCompletionDate   = actualCompletionDate   || null;

    /* Replace milestones array on full edit */
    if (milestones !== undefined && Array.isArray(milestones)) {
      project.milestones = milestones
        .filter((m) => m && m.title && m.title.trim())
        .map((m, i) => ({
          _id:         m._id && mongoose.Types.ObjectId.isValid(m._id)
                         ? m._id : new mongoose.Types.ObjectId(),
          title:       m.title.trim(),
          description: m.description || "",
          status:      VALID_MILESTONE_STATUS.includes(m.status) ? m.status : "pending",
          dueDate:     m.dueDate || null,
          order:       typeof m.order === "number" ? m.order : i,
        }));
    }

    /* Auto-stamp actualCompletionDate */
    if (project.status === "completed" && !project.actualCompletionDate) {
      project.actualCompletionDate = new Date();
    }

    await project.save();

    const populated = await Project
      .findById(project._id)
      .populate("projectManager",    "name email role")
      .populate("assignedEngineers", "name email role");

    return res.json({ message: "Project updated successfully", project: populated });
  } catch (err) {
    console.error("[updateProject]", err);
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message).join(", ");
      return res.status(400).json({ message: messages });
    }
    return res.status(500).json({ message: "Failed to update project", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   DELETE /api/projects/:id  — soft delete
═══════════════════════════════════════════════════════════ */
exports.deleteProject = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    project.isDeleted = true;
    project.deletedAt = new Date();
    await project.save();

    return res.json({ message: "Project deleted successfully" });
  } catch (err) {
    console.error("[deleteProject]", err);
    return res.status(500).json({ message: "Failed to delete project", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   PUT /api/projects/:id/status
═══════════════════════════════════════════════════════════ */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    project.status = status;
    if (status === "completed" && !project.actualCompletionDate) {
      project.actualCompletionDate = new Date();
    }

    await project.save();

    const populated = await Project
      .findById(project._id)
      .populate("projectManager",    "name email role")
      .populate("assignedEngineers", "name email role");

    return res.json({ message: "Status updated", project: populated });
  } catch (err) {
    console.error("[updateStatus]", err);
    return res.status(500).json({ message: "Failed to update status", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/projects/:id/milestones
═══════════════════════════════════════════════════════════ */
exports.addMilestone = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const { title, description, dueDate } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Milestone title is required" });
    }

    project.milestones.push({
      title:       title.trim(),
      description: description || "",
      status:      "pending",
      dueDate:     dueDate     || null,
      order:       project.milestones.length,
    });

    await project.save();

    const ms = project.milestones[project.milestones.length - 1];
    return res.status(201).json({ message: "Milestone added", milestone: ms, project });
  } catch (err) {
    console.error("[addMilestone]", err);
    return res.status(500).json({ message: "Failed to add milestone", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   PUT /api/projects/:id/milestones/:mid
═══════════════════════════════════════════════════════════ */
exports.updateMilestone = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const milestone = project.milestones.id(req.params.mid);
    if (!milestone) return res.status(404).json({ message: "Milestone not found" });

    const { title, description, status, dueDate } = req.body;
    if (title       !== undefined) milestone.title       = title.trim();
    if (description !== undefined) milestone.description = description;
    if (dueDate     !== undefined) milestone.dueDate     = dueDate || null;

    if (status !== undefined) {
      if (!VALID_MILESTONE_STATUS.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID_MILESTONE_STATUS.join(", ")}` });
      }
      milestone.status = status;
      if (status === "completed" && !milestone.completedAt) {
        milestone.completedAt = new Date();
      } else if (status !== "completed") {
        milestone.completedAt = null;
      }
    }

    await project.save();
    return res.json({ message: "Milestone updated", milestone, project });
  } catch (err) {
    console.error("[updateMilestone]", err);
    return res.status(500).json({ message: "Failed to update milestone", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   DELETE /api/projects/:id/milestones/:mid
═══════════════════════════════════════════════════════════ */
exports.deleteMilestone = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const milestone = project.milestones.id(req.params.mid);
    if (!milestone) return res.status(404).json({ message: "Milestone not found" });

    milestone.deleteOne();
    await project.save();
    return res.json({ message: "Milestone deleted", project });
  } catch (err) {
    console.error("[deleteMilestone]", err);
    return res.status(500).json({ message: "Failed to delete milestone", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/projects/:id/checkins
═══════════════════════════════════════════════════════════ */
exports.addCheckIn = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const { statusUpdate = "on_track", note = "", location = {}, photos = [] } = req.body;

    if (!VALID_CHECKIN_STATUS.includes(statusUpdate)) {
      return res.status(400).json({ message: `Invalid statusUpdate. Must be one of: ${VALID_CHECKIN_STATUS.join(", ")}` });
    }

    project.checkIns.push({
      engineer:     snap(req.admin),
      statusUpdate,
      note:         note || "",
      location: {
        address: location.address || "",
        lat:     location.lat     || null,
        lng:     location.lng     || null,
      },
      photos: (Array.isArray(photos) ? photos : [])
        .filter((p) => p && p.url)
        .map((p) => ({ url: p.url, caption: p.caption || "" })),
    });

    await project.save();
    const ci = project.checkIns[project.checkIns.length - 1];
    return res.status(201).json({ message: "Check-in submitted", checkIn: ci, project });
  } catch (err) {
    console.error("[addCheckIn]", err);
    return res.status(500).json({ message: "Failed to submit check-in", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/projects/:id/documents
═══════════════════════════════════════════════════════════ */
exports.addDocument = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const { name, type, url, mimeType = "" } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: "Document name is required" });
    if (!url  || !url.trim())  return res.status(400).json({ message: "Document URL is required" });

    project.documents.push({
      name:       name.trim(),
      type:       VALID_DOC_TYPES.includes(type) ? type : "other",
      url:        url.trim(),
      mimeType,
      uploadedBy: snap(req.admin),
      uploadedAt: new Date(),
    });

    await project.save();
    const doc = project.documents[project.documents.length - 1];
    return res.status(201).json({ message: "Document added", document: doc, project });
  } catch (err) {
    console.error("[addDocument]", err);
    return res.status(500).json({ message: "Failed to add document", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   DELETE /api/projects/:id/documents/:did
═══════════════════════════════════════════════════════════ */
exports.deleteDocument = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const doc = project.documents.id(req.params.did);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    doc.deleteOne();
    await project.save();
    return res.json({ message: "Document deleted", project });
  } catch (err) {
    console.error("[deleteDocument]", err);
    return res.status(500).json({ message: "Failed to delete document", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/projects/:id/notify
═══════════════════════════════════════════════════════════ */
exports.sendNotification = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const { type, message } = req.body;
    if (!["email", "sms", "both"].includes(type)) {
      return res.status(400).json({ message: "type must be 'email', 'sms', or 'both'" });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    /* ─ Plug in Twilio / SendGrid here ─
    let deliveryStatus = "sent";
    try {
      if (type === "email" || type === "both") await emailService.send(...)
      if (type === "sms"   || type === "both") await smsService.send(...)
    } catch { deliveryStatus = "failed"; }
    */
    const deliveryStatus = "sent";

    project.notificationLogs.push({
      type,
      message: message.trim(),
      status:  deliveryStatus,
      sentBy:  snap(req.admin),
      sentAt:  new Date(),
    });

    await project.save();
    const log = project.notificationLogs[project.notificationLogs.length - 1];
    return res.json({
      message:      "Notification logged successfully",
      notification: log,
      deliveryStatus,
      project,
    });
  } catch (err) {
    console.error("[sendNotification]", err);
    return res.status(500).json({ message: "Failed to send notification", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════
   POST /api/projects/:id/certificate
═══════════════════════════════════════════════════════════ */
exports.generateCertificate = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Project not found" });
    }
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project) return res.status(404).json({ message: "Project not found" });

    if (project.status !== "completed") {
      return res.status(400).json({
        message: "Completion certificate can only be generated for completed projects",
      });
    }
    if (project.completionCertificate?.generated) {
      return res.status(400).json({
        message: "Completion certificate already generated",
        certificate: project.completionCertificate,
      });
    }

    const certNum = `CERT-${project.projectId}-${Date.now().toString(36).toUpperCase()}`;
    const certUrl = `/certificates/${certNum}.pdf`; // replace with real cloud URL in production

    project.completionCertificate = {
      generated:         true,
      certificateNumber: certNum,
      generatedAt:       new Date(),
      generatedBy:       snap(req.admin),
      url:               certUrl,
    };

    /* Also attach as a document so it shows in the Documents tab */
    project.documents.push({
      name:       `Completion Certificate — ${certNum}`,
      type:       "completion_certificate",
      url:        certUrl,
      mimeType:   "application/pdf",
      uploadedBy: snap(req.admin),
      uploadedAt: new Date(),
    });

    await project.save();

    const populated = await Project
      .findById(project._id)
      .populate("projectManager",    "name email role")
      .populate("assignedEngineers", "name email role");

    return res.status(201).json({
      message:     "Completion certificate generated successfully",
      certificate: project.completionCertificate,
      project:     populated,
    });
  } catch (err) {
    console.error("[generateCertificate]", err);
    return res.status(500).json({ message: "Failed to generate certificate", error: err.message });
  }
};