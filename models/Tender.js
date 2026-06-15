const mongoose = require("mongoose");

const tenderSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    generatedProposal: { type: String, default: "" },
    conversationHistory: { type: Array, default: [] }, // [{role, content}]
    docFileName: { type: String, default: null },      // if user uploaded a doc
    docPrompt: { type: String, default: null },        // prompt sent with doc
    status: {
      type: String,
      enum: ["in_progress", "draft", "pending", "approved", "rejected"],
      default: "in_progress",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },

     // ── NEW: vendor dispatch log ──
    sentTo: [
      {
        vendorId:      { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
        vendorName:    { type: String },
        vendorEmail:   { type: String },
        docType:       { type: String, enum: ["generated", "custom"], default: "generated" },
        customDocName: { type: String, default: null },
        sentAt:        { type: Date,   default: Date.now },
      },
    ],
  },


  { timestamps: true }
);

module.exports = mongoose.model("Tender", tenderSchema);