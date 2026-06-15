const mongoose = require("mongoose");

const proposalSchema = new mongoose.Schema(
  {
    // ── Lead Reference (optional — null for manual/random proposals) ──
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },

    // ── Customer Info ──
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      whatsapp: { type: String, trim: true },
      address: String,
      city: String,
      pincode: String,
    },

    // ── Site Survey Data ──
    survey: {
      monthlyBill: { type: Number, required: true }, // in ₹
      roofType: {
        type: String,
        enum: ["RCC Flat", "Sloped Tin", "Sloped Tile", "Industrial Shed", "Other"],
        default: "RCC Flat",
      },
      roofAreaSqFt: Number,
      sanctionedLoad: Number, // kW
      gridType: { type: String, enum: ["On-Grid", "Off-Grid", "Hybrid"], default: "On-Grid" },
      phase: { type: String, enum: ["Single Phase", "Three Phase"], default: "Single Phase" },
      existingSolarKW: { type: Number, default: 0 },
      shadingLevel: { type: String, enum: ["None", "Partial", "Heavy"], default: "None" },
    },

    // ── AI-Generated Proposal Data ──
    proposal: {
      systemSizeKW: Number,
      panelCount: Number,
      panelWattage: Number,
      inverterType: String,
      batteryBackupHours: Number,

      // Financial
      installationCost: Number,
      subsidyAmount: Number,
      netCost: Number,

      // Savings
      monthlyEnergySavings: Number, // ₹
      annualEnergySavings: Number,  // ₹
      co2OffsetTonsPerYear: Number,
      unitsGeneratedPerDay: Number,

      // ROI
      paybackYears: Number,
      roi25Years: Number, // total savings over 25 years
      irr: Number,        // internal rate of return %

      // Financing
      emiOptions: [
        {
          tenure: Number, // months
          emi: Number,    // ₹/month
          interestRate: Number, // %
          totalPayable: Number,
        },
      ],
      subsidyEligible: { type: Boolean, default: true },
      subsidyScheme: String, // PM Surya Ghar, MNRE, State DISCOMs, etc.
      netMeteringAvailable: { type: Boolean, default: true },

      // Itemized Breakdown
      costBreakdown: [
        {
          item: String,
          quantity: Number,
          unitCost: Number,
          totalCost: Number,
        },
      ],

      // AI narrative sections
      executiveSummary: String,
      systemDescription: String,
      financialHighlights: String,
      whyChooseUs: String,
    },

    // ── Template & Variant (for A/B testing) ──
    templateVariant: { type: String, default: "standard" }, // standard | premium | compact
    language: { type: String, default: "en" },

    // ── Status & Lifecycle ──
    status: {
      type: String,
      enum: ["draft", "sent", "opened", "accepted", "rejected", "expired", "revised"],
      default: "draft",
    },
    generationStatus: {
      type: String,
      enum: ["pending", "generating", "completed", "failed"],
      default: "pending",
    },
    generationError: String,

    // ── Delivery ──
    sentVia: [{ type: String, enum: ["whatsapp", "email", "manual"] }],
    sentAt: Date,
    expiresAt: Date,

    // ── Tracking ──
    openedAt: Date,
    openCount: { type: Number, default: 0 },
    lastOpenedAt: Date,
    trackingToken: { type: String, unique: true, sparse: true },

    // ── PDF ──
    pdfUrl: String,
    pdfGeneratedAt: Date,

    // ── Assignment ──
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    assignedToName: String,

    // ── Versioning ──
    version: { type: Number, default: 1 },
    previousVersions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Proposal" }],

    // ── Created by ──
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    createdByName: String,

    // ── Metadata ──
    notes: String,
    tags: [String],
    source: {
      type: String,
      enum: ["lead_qualified", "manual", "bulk", "api"],
      default: "manual",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Indexes ──
proposalSchema.index({ leadId: 1 });
proposalSchema.index({ status: 1 });
proposalSchema.index({ createdAt: -1 });
proposalSchema.index({ "customer.whatsapp": 1 });
proposalSchema.index({ trackingToken: 1 });
proposalSchema.index({ generationStatus: 1 });
proposalSchema.index({ expiresAt: 1 });

// ── Virtual: Is Expired ──
proposalSchema.virtual("isExpired").get(function () {
  return this.expiresAt && new Date() > this.expiresAt;
});

// ── Pre-save: set expiry & tracking token ──
proposalSchema.pre("save", function (next) {
  if (this.isNew) {
    // Set expiry to 7 days from creation
    if (!this.expiresAt) {
      this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    // Generate tracking token
    if (!this.trackingToken) {
      this.trackingToken =
        Math.random().toString(36).substring(2) +
        Date.now().toString(36) +
        Math.random().toString(36).substring(2);
    }
  }
 
});

module.exports = mongoose.model("Proposal", proposalSchema);