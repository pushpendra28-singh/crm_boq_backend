const mongoose = require("mongoose");

const lineItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "", trim: true },
    monthlyAmount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    statutory: { type: Boolean, default: false },
  },
  { _id: false }
);

const salaryComponentSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "", trim: true },
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
    capAmount: { type: Number, default: null, min: 0 },
    statutory: { type: Boolean, default: false },
  },
  { _id: false }
);

const payrollDaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    status: { type: String, required: true },
    expectedWorkday: { type: Boolean, default: false },
    payrollExpectedWorkday: { type: Boolean, default: false },
    payableUnits: { type: Number, default: 0, min: 0 },
    unpaidUnits: { type: Number, default: 0, min: 0 },
    sandwichLeave: { type: Boolean, default: false },
    leave: {
      typeName: { type: String, default: null },
      paid: { type: Boolean, default: false },
      units: { type: Number, default: 0, min: 0 },
    },
    attendance: {
      attendanceStatus: { type: String, default: null },
      workMode: { type: String, default: null },
      wfhType: { type: String, default: null },
      attendanceUnits: { type: Number, default: 0, min: 0 },
    },
  },
  { _id: false }
);

const payrollRecordSchema = new mongoose.Schema(
  {
    payrollRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayrollRun",
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    employeeSnapshot: {
      id: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      email: { type: String, required: true },
      role: { type: String, default: "employee" },
      joiningDate: { type: Date, default: null },
      exitDate: { type: Date, default: null },
    },
    salarySnapshot: {
  currency: { type: String, default: "INR" },
  effectiveFrom: { type: Date, default: null },
  prorationMethod: { type: String, required: true },
  sandwichRule: { type: Boolean, default: true },
  basicPay: { type: Number, default: 0, min: 0 },

  earnings: {
    type: [salaryComponentSnapshotSchema],
    default: [],
  },

  deductions: {
    type: [salaryComponentSnapshotSchema],
    default: [],
  },

  employerContributions: {
    type: [salaryComponentSnapshotSchema],
    default: [],
  },
  periods: {
        type: [
          new mongoose.Schema(
            {
              from: String,
              to: String,
              structureId: { type: mongoose.Schema.Types.ObjectId, default: null },
              fraction: { type: Number, default: 0, min: 0 },
              earnedFraction: { type: Number, default: 0, min: 0 },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },
    attendanceSnapshot: {
      totalDays: { type: Number, default: 0 },
      elapsedDays: { type: Number, default: 0 },
      fullMonthWorkingDays: { type: Number, default: 0 },
      elapsedWorkingDays: { type: Number, default: 0 },
      presentUnits: { type: Number, default: 0, min: 0 },
      paidLeaveUnits: { type: Number, default: 0, min: 0 },
      unpaidLeaveUnits: { type: Number, default: 0, min: 0 },
      absentUnits: { type: Number, default: 0, min: 0 },
      halfDayUnits: { type: Number, default: 0, min: 0 },
      sandwichLeaveUnits: { type: Number, default: 0, min: 0 },
      payableUnits: { type: Number, default: 0, min: 0 },
      unpaidUnits: { type: Number, default: 0, min: 0 },
      lateDays: { type: Number, default: 0, min: 0 },
      holidays: { type: Number, default: 0, min: 0 },
      weeklyOffs: { type: Number, default: 0, min: 0 },
      wfhFullDays: { type: Number, default: 0, min: 0 },
      wfhHalfDays: { type: Number, default: 0, min: 0 },
      salaryAccruedUnits: { type: Number, default: 0, min: 0 },
      salaryEarnedUnits: { type: Number, default: 0, min: 0 },
      salaryUnpaidUnits: { type: Number, default: 0, min: 0 },
    },
    days: { type: [payrollDaySchema], default: [] },
    earnings: { type: [lineItemSchema], default: [] },
    deductions: { type: [lineItemSchema], default: [] },
    employerContributions: { type: [lineItemSchema], default: [] },
    monthlyGross: { type: Number, default: 0, min: 0 },
    grossAccrued: { type: Number, default: 0, min: 0 },
    lossOfPay: { type: Number, default: 0, min: 0 },
    grossSalary: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },
    employerContributionTotal: { type: Number, default: 0, min: 0 },
    netSalary: { type: Number, default: 0, min: 0 },
    paymentStatus: {
      type: String,
      enum: ["pending", "hold", "paid"],
      default: "pending",
      index: true,
    },
    holdReason: { type: String, default: "", trim: true, maxlength: 500 },
    holdAt: { type: Date, default: null },
    holdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    paymentMethod: { type: String, default: "", trim: true, maxlength: 50 },
    paymentReference: { type: String, default: "", trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

payrollRecordSchema.index({ payrollRunId: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model("PayrollRecord", payrollRecordSchema);
