const mongoose = require("mongoose");

/* ═══════════════════════════════════════════════════════════════
   CONVERSATION MESSAGE SCHEMA
═══════════════════════════════════════════════════════════════ */

const conversationMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    _id: false,
  }
);


/* ═══════════════════════════════════════════════════════════════
   VENDOR DISPATCH SCHEMA
═══════════════════════════════════════════════════════════════ */

const sentToSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    vendorName: {
      type: String,
      default: "",
      trim: true,
    },

    vendorEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    docType: {
      type: String,
      enum: [
        "generated",
        "custom",
      ],
      default: "generated",
    },

    customDocName: {
      type: String,
      default: null,
      trim: true,
    },

    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);


/* ═══════════════════════════════════════════════════════════════
   MAIN TENDER SCHEMA
═══════════════════════════════════════════════════════════════ */

const tenderSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },


    /*
     * IMPORTANT:
     *
     * Keep this as String for backward compatibility.
     *
     * Old records:
     *   Markdown BOQ string
     *
     * New records:
     *   JSON.stringify(structuredBOQObject)
     *
     * generateBOQExcel.js supports both.
     */
    generatedProposal: {
      type: String,
      default: "",
    },


    /*
     * Structured conversation instead of raw Array.
     *
     * Existing controller usage:
     *
     * tender.conversationHistory.push({
     *   role: "user",
     *   content: "..."
     * })
     *
     * continues to work.
     */
    conversationHistory: {
      type: [
        conversationMessageSchema
      ],
      default: [],
    },


    /*
     * Uploaded document filename.
     */
    docFileName: {
      type: String,
      default: null,
      trim: true,
    },


    /*
     * User prompt submitted with uploaded document.
     */
    docPrompt: {
      type: String,
      default: null,
      trim: true,
    },


    status: {
      type: String,

      enum: [
        "in_progress",
        "draft",
        "pending",
        "approved",
        "rejected",
      ],

      default:
        "in_progress",

      index: true,
    },


    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      index: true,
    },


    /*
     * Vendor dispatch log.
     *
     * Only populated after successful email sending
     * in tenderController.
     */
    sentTo: {
      type: [
        sentToSchema
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);


/* ═══════════════════════════════════════════════════════════════
   INDEXES
═══════════════════════════════════════════════════════════════ */

/*
 * Dashboard:
 * newest tenders first.
 */
tenderSchema.index({
  createdAt: -1,
});


/*
 * Useful for admin-specific tender listing.
 */
tenderSchema.index({
  createdBy: 1,
  createdAt: -1,
});


/*
 * Useful for status-based dashboards.
 */
tenderSchema.index({
  status: 1,
  createdAt: -1,
});


/* ═══════════════════════════════════════════════════════════════
   MODEL
═══════════════════════════════════════════════════════════════ */

module.exports = mongoose.model(
  "Tender",
  tenderSchema
);




// const mongoose = require("mongoose");

// const tenderSchema = new mongoose.Schema(
//   {
//     title: { type: String, default: "" },
//     generatedProposal: { type: String, default: "" },
//     conversationHistory: { type: Array, default: [] }, // [{role, content}]
//     docFileName: { type: String, default: null },      // if user uploaded a doc
//     docPrompt: { type: String, default: null },        // prompt sent with doc
//     status: {
//       type: String,
//       enum: ["in_progress", "draft", "pending", "approved", "rejected"],
//       default: "in_progress",
//     },
//     createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },

//      // ── NEW: vendor dispatch log ──
//     sentTo: [
//       {
//         vendorId:      { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
//         vendorName:    { type: String },
//         vendorEmail:   { type: String },
//         docType:       { type: String, enum: ["generated", "custom"], default: "generated" },
//         customDocName: { type: String, default: null },
//         sentAt:        { type: Date,   default: Date.now },
//       },
//     ],
//   },


//   { timestamps: true }
// );

// module.exports = mongoose.model("Tender", tenderSchema);