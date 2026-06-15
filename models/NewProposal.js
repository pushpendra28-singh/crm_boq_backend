const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    name: String,
    description: String,
  },
  { _id: false }
);

const lineItemSchema = new mongoose.Schema(
  {
    description: String,
    qty: Number,
    unit: String,
    unitPrice: Number,
  },
  { _id: false }
);

const milestoneSchema = new mongoose.Schema(
  {
    title: String,
    dueDate: Date,
    description: String,
  },
  { _id: false }
);

const generatedContentSchema = new mongoose.Schema(
  {
    executiveSummary: String,
    businessOverview: String,
    problemStatement: String,
    proposedSolution: String,
    scopeOfWork: String,
    servicesSection: String,
    pricingNarrative: String,
    timelineSection: String,
    roiBenefits: String,
    termsSection: String,
    closingCTA: String,
    fullProposal: String,
  },
  { _id: false }
);

const graphSchema = new mongoose.Schema(
  {
    pricingChart: Array,
    timelineChart: Array,
    milestoneChart: Array,
  },
  { _id: false }
);

const newProposalSchema = new mongoose.Schema(
  {
    // Client
    clientName: {
      type: String,
      required: true,
    },
    clientEmail: {
      type: String,
      required: true,
    },
    clientPhone: String,
    clientCompany: String,
    clientAddress: String,

    // Business
    businessType: {
      type: String,
      required: true,
    },
    proposalType: {
      type: String,
      required: true,
    },
    proposalTitle: {
      type: String,
      required: true,
    },
    proposalNumber: String,
    issueDate: Date,
    validUntil: Date,

    // Scope
    projectSummary: String,
    services: [serviceSchema],
    terms: String,
    notes: String,

    // Pricing
    currency: {
      type: String,
      default: "USD",
    },
    lineItems: [lineItemSchema],
    discount: Number,
    taxRate: Number,
    paymentTerms: String,

    // Timeline
    startDate: Date,
    endDate: Date,
    milestones: [milestoneSchema],

    // AI
    generatedContent: generatedContentSchema,

    // Graphs
    graphs: graphSchema,

    // Status
    status: {
      type: String,
      enum: [
        "draft",
        "generated",
        "sent",
        "viewed",
        "accepted",
        "rejected",
        "expired",
      ],
      default: "draft",
    },

    aiGeneratedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "NewProposal",
  newProposalSchema
);