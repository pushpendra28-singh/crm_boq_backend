const mongoose = require("mongoose");
const { isValidDateKey } = require("../utils/holidayDate");

const { Schema } = mongoose;

const auditSchema = new Schema(
  {
    action: {
      type: String,
      enum: ["create", "edit", "delete"],
      required: true,
    },
    actor: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    at: {
      type: Date,
      default: Date.now,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    before: {
      name: String,
      date: String,
    },
    after: {
      name: String,
      date: String,
    },
  },
  { _id: false }
);

const holidaySchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Holiday name is required."],
      trim: true,
      minlength: [2, "Holiday name must contain at least 2 characters."],
      maxlength: [120, "Holiday name cannot exceed 120 characters."],
    },

    date: {
      type: String,
      required: [true, "Holiday date is required."],
      validate: {
        validator: isValidDateKey,
        message: "Provide a valid holiday date between 2000 and 2099.",
      },
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      immutable: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      required: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    auditHistory: {
      type: [auditSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

// Same date par sirf ek active holiday.
// Soft-deleted holiday audit ke liye database me rahega.
holidaySchema.index(
  { date: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

module.exports = mongoose.model("Holiday", holidaySchema);