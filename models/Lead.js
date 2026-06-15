const mongoose = require("mongoose");

// ─── Activity Log Sub-Schema ─────────────────────────────────────────────────
const activitySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "created",
        "status_changed",
        "assigned",
        "note_added",
        "merged",
        "source_updated",
        "score_updated",
      ],
      required: true,
    },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    byName: String,
    from: String,
    to: String,
    note: String,
  },
  { timestamps: true }
);

// ─── Main Lead Schema ────────────────────────────────────────────────────────
const leadSchema = new mongoose.Schema(
  {
    // ── Common fields ──
    name: { type: String, required: true, trim: true },
    whatsapp: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },

    category: {
      type: String,
      enum: ["Residential", "Housing Society", "Commercial"],
      required: true,
    },

    // ── Residential ──
    pincode: String,
    bill: String,

    // ── Housing Society ──
    societyName: String,
    monthlyBill: String,
    agmStatus: String,
    designation: String,

    // ── Commercial ──
    companyName: String,
    city: String,
    commercialBill: Number,

    // ── Status ──
    status: {
      type: String,
      enum: ["Pending", "Connected", "Rejected", "In Progress", "Converted"],
      default: "Pending",
    },

    // ── Source Attribution ──
    source: {
      type: String,
      enum: [
        "Website Form",
        "Google Ads",
        "Meta Ads",
        "Landing Page",
        "Webhook",
        "Manual",
        "Referral",
        "Organic",
        "WhatsApp",
        "Other",
      ],
      default: "Manual",
    },
    sourceDetails: {
      campaign: String,      // UTM campaign
      medium: String,        // UTM medium
      keyword: String,       // Google Ads keyword
      adSet: String,         // Meta ad set
      landingPage: String,   // Which landing page
      referrer: String,      // HTTP referrer
      utmSource: String,
      utmMedium: String,
      utmCampaign: String,
      utmContent: String,
      utmTerm: String,
      gclid: String,         // Google click ID
      fbclid: String,        // Facebook click ID
      webhookId: String,     // Which webhook fired
      ipAddress: String,
    },

    // ── Assignment ──
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedToName: String,
    assignedAt: Date,
    // Track full assignment chain
assignmentHistory: [
  {
    assignedTo:     { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedToName: String,
    assignedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedByName: String,
    assignedAt:     { type: Date, default: Date.now },
    note:           { type: String, default: "" },
  }
],
    territory: String,



    assignedLeadStatus: {
  type: String,
  enum: [
    "new",
    "contacted",
    "interested",
    "not_interested",
    "callback",
    "converted",
    "closed",
  ],
  default: "new",
},



// ── AI Verification ──
// ── AI Verification ──
aiAnalysis: {
  isReal:        { type: Boolean, default: true },
  spamScore:     { type: Number,  default: 0 },
  buyingIntent:  { type: Number,  default: 0 },
  trustScore:    { type: Number,  default: 0 },
  leadQuality:   { type: String, enum: ["high", "medium", "low"], default: "medium" },
  reason:        String,
  tags:          [String],
},

// ── Rich AI fields (frontend-facing) ──
authenticityScore:     { type: Number, default: 0, min: 0, max: 100 },
phoneVerified:         { type: Boolean, default: false },
emailVerified:         { type: Boolean, default: false },
isSpam:                { type: Boolean, default: false },
isFake:                { type: Boolean, default: false },
leadTemperature:       { type: String, enum: ["Hot", "Warm", "Cold"], default: "Cold" },
intent:                { type: String, enum: ["High", "Medium", "Low"], default: "Low" },
buyingStage:           { type: String, default: "Researching" },
conversionProbability: { type: Number, default: 0, min: 0, max: 100 },
summary:               { type: String, default: "" },
nextBestAction:        { type: String, default: "" },
painPoints:            [String],
duplicateRisk:         { type: Number, default: 0, min: 0, max: 100 },
validationFlags:       [String],
priorityTag:           { type: String, enum: ["Hot Lead", "Warm Lead", "Cold Lead"], default: "Cold Lead" },

validationIssues: [String],

riskLevel: {
  type: String,
  enum: ["low", "medium", "high"],
  default: "low",
},

isVerified: {
  type: Boolean,
  default: false,
},

    // ── Lead Scoring ──
    score: { type: Number, default: 0, min: 0, max: 100 },

      
   
    scoreBreakdown: {
  // Rule-based (kept for pre-save calculation)
  sourceScore:       { type: Number, default: 0 },
  billScore:         { type: Number, default: 0 },
  completenessScore: { type: Number, default: 0 },
  engagementScore:   { type: Number, default: 0 },
  // AI-based (new)
  aiIntent:          { type: Number, default: 0 },
  emailTrust:        { type: Number, default: 0 },
  phoneTrust:        { type: Number, default: 0 },
  duplicateRisk:     { type: Number, default: 0 },
  engagement:        { type: Number, default: 0 },
},

    // ── Duplicate Detection ──
    isDuplicate: { type: Boolean, default: false },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    mergedLeads: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lead" }],

    // ── Notes & Activity ──
    notes: [
      {
        text: String,
        addedBy: String,
        addedById: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    activityLog: [activitySchema],

    // ── Follow-up ──
    followUpDate: Date,
    followUpNote: String,

    // ── Tags ──
    tags: [String],

    // ── Webhook metadata ──
    webhookPayload: mongoose.Schema.Types.Mixed,
    externalId: String, // ID from external system (Google Ads, Meta, etc.)
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }



  
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
leadSchema.index({ whatsapp: 1 });
leadSchema.index({ email: 1 });
leadSchema.index({ category: 1, status: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ source: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ score: -1 });
leadSchema.index({ externalId: 1 }, { sparse: true });

leadSchema.index({ authenticityScore: -1 });
leadSchema.index({ priorityTag: 1 });
leadSchema.index({ leadTemperature: 1 });

// ─── Virtual: Bill Amount (normalized across categories) ──────────────────────
leadSchema.virtual("normalizedBill").get(function () {
  const raw =
    this.category === "Residential"    ? this.bill :
    this.category === "Housing Society" ? this.monthlyBill :
    this.category === "Commercial"      ? this.commercialBill : null;

  if (!raw) return 0;
  // Handles range strings like "₹ 4000 - ₹ 8000" or "More than ₹ 8000"
  const nums = String(raw).replace(/[₹,]/g, "").match(/\d+/g);
  if (!nums) return 0;
  const vals = nums.map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
});

// ─── Pre-save: Auto scoring ───────────────────────────────────────────────────
leadSchema.pre("save", function () {
  if (this.isNew || this.isModified()) {
    this._calculateScore();
  }
});

leadSchema.methods._calculateScore = function () {
  let score = 0;
  const breakdown = { sourceScore: 0, billScore: 0, completenessScore: 0, engagementScore: 0 };

  // Source score
  const sourceScores = {
    "Google Ads": 25,
    "Meta Ads": 22,
    "Landing Page": 20,
    "Website Form": 18,
    "Webhook": 15,
    "Referral": 20,
    "WhatsApp": 12,
    "Organic": 10,
    "Manual": 5,
    "Other": 5,
  };
  breakdown.sourceScore = sourceScores[this.source] || 5;
  score += breakdown.sourceScore;

  // Bill score (higher bill = higher score)
  const bill = this.normalizedBill;
  if (bill >= 10000) breakdown.billScore = 30;
  else if (bill >= 5000) breakdown.billScore = 22;
  else if (bill >= 2000) breakdown.billScore = 15;
  else if (bill >= 500) breakdown.billScore = 8;
  else if (bill > 0) breakdown.billScore = 4;
  score += breakdown.billScore;

  // Completeness score
  let fields = 0, total = 0;
  const commonFields = ["name", "whatsapp", "email"];
  commonFields.forEach((f) => { total++; if (this[f]) fields++; });

  if (this.category === "Residential") {
    ["pincode", "bill"].forEach((f) => { total++; if (this[f]) fields++; });
  } else if (this.category === "Housing Society") {
    ["societyName", "pincode", "monthlyBill", "designation"].forEach((f) => { total++; if (this[f]) fields++; });
  } else if (this.category === "Commercial") {
    ["companyName", "city", "pincode", "commercialBill"].forEach((f) => { total++; if (this[f]) fields++; });
  }
  breakdown.completenessScore = Math.round((fields / total) * 25);
  score += breakdown.completenessScore;

  // UTM data presence
  if (this.sourceDetails?.utmCampaign) breakdown.engagementScore += 10;
  if (this.sourceDetails?.gclid || this.sourceDetails?.fbclid) breakdown.engagementScore += 10;
  score += breakdown.engagementScore;

  this.score = Math.min(100, score);
  this.scoreBreakdown = breakdown;
};


// ─────────────────────────────────────────────────────────────
// ADD THESE TO YOUR EXISTING Lead mongoose schema
// (merge into your models/Lead.js — do NOT replace the whole file)
// ─────────────────────────────────────────────────────────────

// ── Follow-up subdocument ──────────────────────────────────────
const followUpSchema = new mongoose.Schema(
  {
    type:        { type: String, enum: ["call", "whatsapp", "email", "meeting"], default: "call" },
    outcome:     { type: String, enum: ["answered", "not_answered", "busy", "callback", ""], default: "" },
    notes:       { type: String, required: true, trim: true },
    nextFollowUp:{ type: Date,   default: null },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

// ── Reminder subdocument ───────────────────────────────────────
const reminderSchema = new mongoose.Schema({
  date:      { type: Date, required: true },
  note:      { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
});

// ── ADD THESE FIELDS to your existing leadSchema definition ───
//
//   followUps:  { type: [followUpSchema], default: [] },
//   reminder:   { type: reminderSchema,  default: null },
//
// Also make sure your status field includes assigned-lead statuses:
//   status: {
//     type: String,
//     enum: ["new","contacted","interested","not_interested","callback","converted","closed"],
//     default: "new",
//   },
//
// And assignedTo field:
//   assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },



module.exports = mongoose.model("Lead", leadSchema);


