const mongoose = require("mongoose");

const {
  DEFAULT_INVOICE_TEMPLATE,
} = require("../config/invoiceTemplates");

/* ─────────────────────────────────────────────
   Invoice Item
───────────────────────────────────────────── */

const invoiceItemSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0.01,
    },

    rate: {
      type: Number,
      required: true,
      min: 0,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

/* ─────────────────────────────────────────────
   Customer Snapshot
───────────────────────────────────────────── */

const customerSnapshotSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },

    contactPerson: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    gstin: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    _id: false,
  }
);

/* ─────────────────────────────────────────────
   Business Snapshot
───────────────────────────────────────────── */

const businessSnapshotSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

        logoUrl: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    gstin: {
      type: String,
      trim: true,
      default: "",
    },

    bank: {
      accountName: {
        type: String,
        default: "",
      },

      bankName: {
        type: String,
        default: "",
      },

      accountNumber: {
        type: String,
        default: "",
      },

      ifsc: {
        type: String,
        default: "",
      },
    },

    authorizedSignatory: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  }
);

/* ─────────────────────────────────────────────
   Invoice Template Snapshot
───────────────────────────────────────────── */

const invoiceTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      default: "modern",
    },

    version: {
      type: Number,
      required: true,
      min: 1,
      default: 1,

      validate: {
        validator: Number.isInteger,
        message:
          "Invoice template version must be an integer",
      },
    },
  },
  {
    _id: false,
  }
);

/* ─────────────────────────────────────────────
   Invoice
───────────────────────────────────────────── */

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    customerId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Customer",
  default: null,
  index: true,
},

    customerSnapshot: {
      type: customerSnapshotSchema,
      required: true,
    },

    businessSnapshot: {
      type: businessSnapshotSchema,
      required: true,
    },

    invoiceDate: {
      type: Date,
      required: true,
    },

    dueDate: {
      type: Date,
      required: true,
    },

    paymentTerms: {
      type: String,
      default: "15",
    },
    template: {
  type: invoiceTemplateSchema,

  default: () => ({
    ...DEFAULT_INVOICE_TEMPLATE,
  }),
},

    items: {
      type: [invoiceItemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length > 0,
        message: "At least one invoice item is required",
      },
    },

    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },

    discountValue: {
      type: Number,
      default: 0,
      min: 0,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxEnabled: {
      type: Boolean,
      default: false,
    },

    taxRate: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxableAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    additionalChargeName: {
      type: String,
      trim: true,
      default: "",
    },

    additionalChargeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    grandTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    terms: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["unpaid", "paid", "cancelled"],
      default: "unpaid",
    },


    ownerId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Admin",
  required: true,
},

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({
  ownerId: 1,
  createdAt: -1,
});

module.exports = mongoose.model("Invoice", invoiceSchema);