const mongoose = require("mongoose");

const payrollRunSchema = new mongoose.Schema(
  {
    month: {
      type: String,
      required: true,
      match: /^20\d{2}-(0[1-9]|1[0-2])$/,
      unique: true,
      index: true,
    },
    cutoffDate: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "review", "finalized", "completed", "cancelled"],
      default: "draft",
      index: true,
    },
    calculationMode: {
      type: String,
      enum: ["accrued_to_date"],
      default: "accrued_to_date",
    },
    sandwichRule: {
      enabled: { type: Boolean, default: true },
      mode: { type: String, enum: ["unpaid"], default: "unpaid" },
    },
    employeeCount: { type: Number, default: 0, min: 0 },
    totals: {
      scheduledGross: { type: Number, default: 0, min: 0 },
      grossAccrued: { type: Number, default: 0, min: 0 },
      lossOfPay: { type: Number, default: 0, min: 0 },
      grossEarned: { type: Number, default: 0, min: 0 },
      deductions: { type: Number, default: 0, min: 0 },
      employerContributions: { type: Number, default: 0, min: 0 },
      net: { type: Number, default: 0, min: 0 },
      payableUnits: { type: Number, default: 0, min: 0 },
      unpaidUnits: { type: Number, default: 0, min: 0 },
      salaryAccruedUnits: { type: Number, default: 0, min: 0 },
      salaryEarnedUnits: { type: Number, default: 0, min: 0 },
      salaryUnpaidUnits: { type: Number, default: 0, min: 0 },
      paidCount: { type: Number, default: 0, min: 0 },
      holdCount: { type: Number, default: 0, min: 0 },
      pendingCount: { type: Number, default: 0, min: 0 },
    },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    generatedAt: { type: Date, default: Date.now },
    recalculatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    recalculatedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    reviewedAt: { type: Date, default: null },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PayrollRun", payrollRunSchema);
