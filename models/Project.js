const mongoose = require("mongoose");

/* ─────────────────────────── sub-schemas ─────────────────────────── */

const photoSchema = new mongoose.Schema(
  { url: { type: String, required: true }, caption: { type: String, default: "" } },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  { address: { type: String, default: "" }, lat: Number, lng: Number },
  { _id: false }
);

const milestoneSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "delayed"],
      default: "pending",
    },
    dueDate:     { type: Date, default: null },
    completedAt: { type: Date, default: null },
    order:       { type: Number, default: 0 },
  },
  { timestamps: true }
);

const checkInSchema = new mongoose.Schema(
  {
    engineer: {
      _id:  { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, default: "Unknown" },
    },
    statusUpdate: {
      type: String,
      enum: ["on_track", "delayed", "issue_found", "milestone_reached"],
      default: "on_track",
    },
    note:     { type: String, default: "" },
    location: { type: locationSchema, default: () => ({}) },
    photos:   { type: [photoSchema], default: [] },
  },
  { timestamps: true }
);

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["contract", "permit", "completion_certificate", "inspection_report", "photo", "other"],
      default: "other",
    },
    url:      { type: String, required: true, trim: true },
    mimeType: { type: String, default: "" },
    uploadedBy: {
      _id:  { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, default: "System" },
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const notificationLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["email", "sms", "both"],
      required: true,
    },
    message: { type: String, required: true },
    status:  { type: String, enum: ["sent", "failed"], default: "sent" },
    sentBy: {
      _id:  { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, default: "System" },
    },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const completionCertSchema = new mongoose.Schema(
  {
    generated:         { type: Boolean, default: false },
    certificateNumber: { type: String, default: null },
    generatedAt:       { type: Date,   default: null },
    generatedBy: {
      _id:  { type: mongoose.Schema.Types.ObjectId },
      name: { type: String },
    },
    url: { type: String, default: null },
  },
  { _id: false }
);

/* ─────────────────────────── main schema ─────────────────────────── */

const projectSchema = new mongoose.Schema(
  {
    projectId: { type: String, unique: true, index: true },

    title:       { type: String, required: [true, "Project title is required"], trim: true },
    description: { type: String, default: "" },
    notes:       { type: String, default: "" },
    tags:        { type: [String], default: [] },

    status: {
      type: String,
      enum: [
        "enquiry", "site_survey", "design", "permit_pending",
        "procurement", "installation", "inspection", "grid_connection",
        "completed", "on_hold", "cancelled",
      ],
      default: "enquiry",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    customer: {
      name:    { type: String, required: [true, "Customer name is required"], trim: true },
      email:   { type: String, default: "", trim: true, lowercase: true },
      phone:   { type: String, default: "", trim: true },
      address: { type: String, default: "" },
      city:    { type: String, default: "" },
      state:   { type: String, default: "" },
      pincode: { type: String, default: "" },
    },

    installation: {
      systemCapacity:      { type: Number, default: null },
      panelCount:          { type: Number, default: null },
      panelModel:          { type: String, default: "" },
      inverterModel:       { type: String, default: "" },
      inverterCapacity:    { type: Number, default: null },
      mountingType: {
        type: String,
        enum: ["rooftop", "ground", "carport", "other"],
        default: "rooftop",
      },
      installationAddress: { type: String, default: "" },
      expectedOutput:      { type: Number, default: null },
      subsidyAmount:       { type: Number, default: null },
      totalCost:           { type: Number, default: null },
      quotationNumber:     { type: String, default: "" },
    },

    projectManager:    { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    assignedEngineers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Admin" }], default: [] },

    startDate:              { type: Date, default: null },
    expectedCompletionDate: { type: Date, default: null },
    actualCompletionDate:   { type: Date, default: null },

    milestones:       { type: [milestoneSchema],       default: [] },
    checkIns:         { type: [checkInSchema],         default: [] },
    documents:        { type: [documentSchema],         default: [] },
    notificationLogs: { type: [notificationLogSchema], default: [] },

    completionCertificate: {
      type:    completionCertSchema,
      default: () => ({ generated: false }),
    },

    progressPercent: { type: Number, default: 0, min: 0, max: 100 },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date,    default: null  },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* ── indexes ── */
projectSchema.index({ isDeleted: 1, createdAt: -1 });
projectSchema.index({ status: 1, priority: 1 });
projectSchema.index({ expectedCompletionDate: 1 });
projectSchema.index(
  { title: "text", projectId: "text", "customer.name": "text" },
  { weights: { projectId: 10, "customer.name": 5, title: 3 } }
);

/* ── auto projectId ── */
projectSchema.pre("save", async function () {
  if (!this.projectId) {
    const count = await mongoose.model("Project").countDocuments();
    this.projectId = `PROJ-${String(count + 1).padStart(4, "0")}`;
  }
});

/* ── auto progressPercent ── */
const LIFECYCLE = [
  "enquiry", "site_survey", "design", "permit_pending",
  "procurement", "installation", "inspection", "grid_connection", "completed",
];

projectSchema.pre("save", function (next) {
  const ms = this.milestones || [];
  if (ms.length > 0) {
    const done = ms.filter((m) => m.status === "completed").length;
    this.progressPercent = Math.round((done / ms.length) * 100);
  } else {
    const idx = LIFECYCLE.indexOf(this.status);
    this.progressPercent = idx >= 0 ? Math.round((idx / (LIFECYCLE.length - 1)) * 100) : 0;
  }
  
});

module.exports = mongoose.model("Project", projectSchema);