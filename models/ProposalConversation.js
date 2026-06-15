/**
 * ProposalConversation.js
 * MongoDB schema for AI chat interview sessions.
 * Stores full conversation history, extracted data, uploaded docs, and completion state.
 */

const mongoose = require("mongoose");

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    // Optional: doc attached to this specific message
    attachedDocument: {
      filename: String,
      originalName: String,
      mimeType: String,
      size: Number,
      extractedText: String, // parsed text content (stored once, referenced here)
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const uploadedDocumentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },   // disk filename (sanitized)
    originalName: { type: String, required: true }, // original upload name
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },         // bytes
    extractedText: { type: String, default: "" },   // parsed plain text
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Structured data extracted during the conversation
const extractedDataSchema = new mongoose.Schema(
  {
    // Client
    clientName: String,
    clientEmail: String,
    clientPhone: String,
    clientCompany: String,
    clientAddress: String,

    // Business context
    businessType: String,
    proposalType: String,
    proposalTitle: String,
    industry: String,

    // Project
    projectSummary: String,
    services: [String],

    // Pricing
    currency: { type: String, default: "INR" },
    budget: String,               // raw extracted string ("10 lakh", "$50,000")
    budgetNumeric: Number,        // parsed numeric value
    lineItems: [
      {
        description: String,
        qty: Number,
        unit: String,
        unitPrice: Number,
      },
    ],
    discount: Number,
    taxRate: Number,
    paymentTerms: String,

    // Timeline
    startDate: String,
    endDate: String,
    timeline: String,             // raw extracted ("3 months", "Q2 2025")
    milestones: [
      {
        title: String,
        dueDate: String,
        description: String,
      },
    ],

    // Scope
    scope: String,
    requirements: [String],
    amc: Boolean,                 // Annual Maintenance Contract requested?
    tone: String,                 // "premium", "standard", etc.

    // Arbitrary extra fields the AI discovers
    extras: { type: Map, of: String },
  },
  { _id: false }
);

// ── Main Schema ───────────────────────────────────────────────────────────────

const proposalConversationSchema = new mongoose.Schema(
  {
    // Link to the user who owns this chat (reuse your existing auth user id)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Mode: interview (flow 1) or document (flow 2)
    mode: {
      type: String,
      enum: ["interview", "document"],
      default: "interview",
    },

    // Conversation messages (ordered)
    messages: [messageSchema],

    // All documents uploaded during this session
    documents: [uploadedDocumentSchema],

    // Live-updating structured extraction
    extractedData: { type: extractedDataSchema, default: () => ({}) },

    // Completion tracking
    completed: {
      type: Boolean,
      default: false,
    },

    // Which required fields are still missing (AI-evaluated)
    missingFields: {
      type: [String],
      default: [],
    },

    // Once the user clicks "Generate Proposal", link the resulting proposal
    generatedProposalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewProposal",
      default: null,
    },

    // Soft-delete / session state
    status: {
      type: String,
      enum: ["active", "completed", "abandoned"],
      default: "active",
    },

    // Title shown in sidebar (auto-generated from first message or doc name)
    title: {
      type: String,
      default: "New Proposal Chat",
    },

    // Token count for context compression decisions
    totalTokensEstimate: {
      type: Number,
      default: 0,
    },

    // Expiry: auto-abandon stale sessions after X days (handled via TTL or cron)
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
proposalConversationSchema.index({ userId: 1, status: 1 });
proposalConversationSchema.index({ lastActivityAt: 1 }); // for cleanup jobs

module.exports = mongoose.model("ProposalConversation", proposalConversationSchema);