const mongoose = require("mongoose");

const componentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, trim: true, maxlength: 50, default: "" },
    calculationType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },
    value: { type: Number, required: true, min: 0 },
    percentageOf: {
      type: String,
      enum: ["basic", "gross"],
      default: "basic",
    },
    prorate: { type: Boolean, default: true },
    capAmount: { type: Number, min: 0, default: null },
    statutory: { type: Boolean, default: false },
  },
  { _id: false }
);

const salaryStructureSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    effectiveFrom: { type: Date, required: true },
    currency: { type: String, default: "INR", trim: true, maxlength: 10 },
    prorationMethod: {
      type: String,
      enum: ["working_days", "calendar_days"],
      default: "working_days",
    },
    sandwichRule: { type: Boolean, default: true },
    sandwichRuleMode: {
      type: String,
      enum: ["unpaid"],
      default: "unpaid",
    },
    basicPay: { type: Number, min: 0, required: true },
    earnings: { type: [componentSchema], default: [] },
    deductions: { type: [componentSchema], default: [] },
    employerContributions: { type: [componentSchema], default: [] },
    notes: { type: String, default: "", trim: true, maxlength: 1500 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

salaryStructureSchema.index({ employeeId: 1, effectiveFrom: 1 }, { unique: true });

module.exports = mongoose.model("SalaryStructure", salaryStructureSchema);
