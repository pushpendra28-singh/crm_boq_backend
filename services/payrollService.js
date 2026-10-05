const mongoose = require("mongoose");
const Admin = require("../models/Admin");
const SalaryStructure = require("../models/SalaryStructure");
const PayrollRun = require("../models/PayrollRun");
const PayrollRecord = require("../models/PayrollRecord");
const { getMonthlyRecords, getMonthRange } = require("./monthlyWorkRecordService");
const { calculatePayroll, roundMoney } = require("../utils/payrollCalculator");
const {createSalarySlipPdf,} = require("./salarySlipService");

function normalizeId(value, label = "ID") {
  if (!mongoose.isObjectIdOrHexString(value)) {
    const error = new Error(`Invalid ${label}.`);
    error.status = 400;
    throw error;
  }
  return value;
}

function validateMonth(month) {
  getMonthRange(month);
  return month;
}

function todayInKolkata() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getPayrollCutoffDate(month) {
  const { from, to } = getMonthRange(month);
  const today = todayInKolkata();

  if (month > today.slice(0, 7)) {
    const error = new Error("Payroll cannot be generated for a future month.");
    error.status = 422;
    throw error;
  }

  return month === today.slice(0, 7) ? today : to;
}

async function getAllMonthlyRecords(month) {
  const records = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const result = await getMonthlyRecords({ month, page, limit, includeDays: true });
    records.push(...(result.records || []));
    if (records.length >= result.total || !result.pages || page >= result.pages) break;
    page += 1;
  }

  return records;
}

function normalizeComponent(item, fieldName, index, { earnings = false } = {}) {
  const name = String(item?.name || "").trim();
  if (!name || name.length > 100) {
    const error = new Error(`Invalid ${fieldName} component name at row ${index + 1}.`);
    error.status = 400;
    throw error;
  }

  const calculationType = item?.calculationType === "percentage" ? "percentage" : "fixed";
  const value = Number(item?.value);
  if (!Number.isFinite(value) || value < 0) {
    const error = new Error(`Invalid ${fieldName} component value at row ${index + 1}.`);
    error.status = 400;
    throw error;
  }

  const percentageOf = item?.percentageOf === "gross" ? "gross" : "basic";
  if (earnings && calculationType === "percentage" && percentageOf !== "basic") {
    const error = new Error("Earning percentage components can only be based on Basic Pay.");
    error.status = 400;
    throw error;
  }

  const capAmount =
    item?.capAmount === null || item?.capAmount === undefined || item?.capAmount === ""
      ? null
      : Number(item.capAmount);

  if (capAmount !== null && (!Number.isFinite(capAmount) || capAmount < 0)) {
    const error = new Error(`Invalid cap amount for ${fieldName} component at row ${index + 1}.`);
    error.status = 400;
    throw error;
  }

  return {
    name,
    code: String(item?.code || "").trim().slice(0, 50),
    calculationType,
    value: roundMoney(value),
    percentageOf,
    prorate: item?.prorate !== false,
    capAmount: capAmount === null ? null : roundMoney(capAmount),
    statutory: Boolean(item?.statutory),
  };
}

function normalizeComponents(items, fieldName, options = {}) {
  if (!Array.isArray(items)) {
    const error = new Error(`${fieldName} must be an array.`);
    error.status = 400;
    throw error;
  }

  if (items.length > 30) {
    const error = new Error(`${fieldName} can contain at most 30 components.`);
    error.status = 400;
    throw error;
  }

  const normalized = items.map((item, index) => normalizeComponent(item, fieldName, index, options));
  const seen = new Set();
  for (const row of normalized) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) {
      const error = new Error(`Duplicate ${fieldName} component: ${row.name}.`);
      error.status = 400;
      throw error;
    }
    seen.add(key);
  }
  return normalized;
}

function validateSalaryPayload(body) {
  if (!body?.employeeId || !mongoose.isObjectIdOrHexString(body.employeeId)) {
    const error = new Error("Valid employee ID is required.");
    error.status = 400;
    throw error;
  }

  if (!body.effectiveFrom) {
    const error = new Error("Effective-from date is required.");
    error.status = 400;
    throw error;
  }

  const effectiveFrom = new Date(`${String(body.effectiveFrom).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(effectiveFrom.getTime())) {
    const error = new Error("Valid effective-from date is required.");
    error.status = 400;
    throw error;
  }

  const basicPay = Number(body.basicPay);
  if (!Number.isFinite(basicPay) || basicPay <= 0) {
    const error = new Error("Basic Pay must be greater than zero.");
    error.status = 400;
    throw error;
  }

  const prorationMethod = body.prorationMethod || "working_days";
  if (!["working_days", "calendar_days"].includes(prorationMethod)) {
    const error = new Error("Invalid salary proration method.");
    error.status = 400;
    throw error;
  }

  return {
    employeeId: body.employeeId,
    effectiveFrom,
    currency: String(body.currency || "INR").trim().slice(0, 10) || "INR",
    prorationMethod,
    sandwichRule: body.sandwichRule !== false,
    sandwichRuleMode: "unpaid",
    basicPay: roundMoney(basicPay),
    earnings: normalizeComponents(body.earnings || [], "earnings", { earnings: true }),
    deductions: normalizeComponents(body.deductions || [], "deductions"),
    employerContributions: normalizeComponents(body.employerContributions || [], "employer contributions"),
    notes: String(body.notes || "").trim().slice(0, 1500),
    isActive: body.isActive !== false,
  };
}

async function ensureEmployeeExists(employeeId) {
  const employee = await Admin.findById(employeeId)
    .select("_id name email role isActive employment.joiningDate employment.exitDate")
    .lean();
  if (!employee) {
    const error = new Error("Employee not found.");
    error.status = 404;
    throw error;
  }
  return employee;
}

function mapLegacySalaryForUi(row) {
  if (Number.isFinite(Number(row.basicPay)) && Number(row.basicPay) > 0) return row;

  const legacyEarnings = Array.isArray(row.earnings) ? row.earnings : [];
  const basicIndex = legacyEarnings.findIndex((item) => /^(basic|basic pay|basic salary)$/i.test(String(item?.name || "").trim()));
  const basicPay = basicIndex >= 0 ? Number(legacyEarnings[basicIndex]?.amount || 0) : 0;
  const earnings = legacyEarnings
    .filter((_, index) => index !== basicIndex)
    .map((item) => ({
      name: item.name,
      code: "",
      calculationType: "fixed",
      value: Number(item.amount || 0),
      percentageOf: "basic",
      prorate: true,
      capAmount: null,
      statutory: false,
    }));

  return {
    ...row,
    basicPay,
    earnings,
    deductions: Array.isArray(row.deductions)
      ? row.deductions.map((item) => ({
          name: item.name,
          code: "",
          calculationType: "fixed",
          value: Number(item.amount || 0),
          percentageOf: "basic",
          prorate: true,
          capAmount: null,
          statutory: false,
        }))
      : [],
    employerContributions: [],
    sandwichRule: row.sandwichRule !== false,
  };
}

async function listEmployees(search = "") {
  if (typeof search !== "string" || search.length > 100) {
    const error = new Error("Employee search must be at most 100 characters.");
    error.status = 400;
    throw error;
  }

  const value = search.trim();
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = value
    ? { $or: [{ name: { $regex: escaped, $options: "i" } }, { email: { $regex: escaped, $options: "i" } }] }
    : {};

  return Admin.find(filter)
    .select("name email role isActive employment.joiningDate employment.exitDate employment.currentlyWorking")
    .sort({ name: 1, _id: 1 })
    .limit(200)
    .lean();
}

async function listSalaryStructures(employeeId) {
  normalizeId(employeeId, "employee ID");
  const rows = await SalaryStructure.find({ employeeId })
    .sort({ effectiveFrom: -1, _id: -1 })
    .lean();
  return rows.map(mapLegacySalaryForUi);
}

async function createSalaryStructure(payload, adminId) {
  const data = validateSalaryPayload(payload);
  await ensureEmployeeExists(data.employeeId);

  try {
    return await SalaryStructure.create({ ...data, createdBy: adminId });
  } catch (error) {
    if (error?.code === 11000) {
      const conflict = new Error("A salary structure already exists for this employee on that effective date.");
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

async function updateSalaryStructure(id, payload, adminId) {
  normalizeId(id, "salary structure ID");
  const current = await SalaryStructure.findById(id).lean();
  if (!current) {
    const error = new Error("Salary structure not found.");
    error.status = 404;
    throw error;
  }

  const data = validateSalaryPayload({ ...payload, employeeId: current.employeeId });
  try {
    return await SalaryStructure.findByIdAndUpdate(
      id,
      { ...data, updatedBy: adminId },
      { new: true, runValidators: true }
    ).lean();
  } catch (error) {
    if (error?.code === 11000) {
      const conflict = new Error("A salary structure already exists for that employee on that effective date.");
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

async function getSalaryStructuresForEmployees(employeeIds, monthEnd) {
  const rows = await SalaryStructure.find({
    employeeId: { $in: employeeIds },
    effectiveFrom: { $lte: new Date(`${monthEnd}T23:59:59.999Z`) },
    isActive: { $ne: false },
  })
    .sort({ employeeId: 1, effectiveFrom: 1 })
    .lean();

  const map = new Map();
  for (const row of rows) {
    const key = String(row.employeeId);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function employeeIsEmployed(record) {
  const summary = record?.summary;
  return Boolean(summary && Number(summary.notEmployedDays || 0) < Number(summary.totalDays || 0));
}

function buildRecordData(record, payrollRunId, calculated) {
  const employee = record.employee || {};
  const employeeId = employee.id || employee._id;
  if (!employeeId || !mongoose.isObjectIdOrHexString(employeeId)) {
    const error = new Error(`Invalid employee reference for payroll record: ${employee.name || "Unknown employee"}.`);
    error.status = 422;
    throw error;
  }

  return {
    payrollRunId,
    employeeId,
    employeeSnapshot: {
      id: employeeId,
      name: employee.name,
      email: employee.email,
      role: employee.role || "employee",
      joiningDate: employee.joiningDate || null,
      exitDate: employee.exitDate || null,
    },
    salarySnapshot: {
      ...calculated.salarySnapshot,
      currency: calculated.currency,
      effectiveFrom: calculated.salarySnapshot.effectiveFrom,
      prorationMethod: calculated.prorationMethod,
      sandwichRule: calculated.sandwichRule,
      periods: calculated.salaryPeriods,
    },
    attendanceSnapshot: {
      totalDays: calculated.workSnapshot.totalDays,
      elapsedDays: calculated.workSnapshot.elapsedDays,
      fullMonthWorkingDays: calculated.workSnapshot.fullMonthWorkingDays,
      elapsedWorkingDays: calculated.workSnapshot.elapsedWorkingDays,
      presentUnits: calculated.workSnapshot.presentUnits,
      paidLeaveUnits: calculated.workSnapshot.paidLeaveUnits,
      unpaidLeaveUnits: calculated.workSnapshot.unpaidLeaveUnits,
      absentUnits: calculated.workSnapshot.absentUnits,
      halfDayUnits: calculated.workSnapshot.halfDayUnits,
      sandwichLeaveUnits: calculated.workSnapshot.sandwichLeaveUnits,
      payableUnits: calculated.workSnapshot.payableUnits,
      unpaidUnits: calculated.workSnapshot.unpaidUnits,
      lateDays: calculated.workSnapshot.lateDays,
      holidays: calculated.workSnapshot.holidays,
      weeklyOffs: calculated.workSnapshot.weeklyOffs,
      wfhFullDays: calculated.workSnapshot.wfhFullDays,
      wfhHalfDays: calculated.workSnapshot.wfhHalfDays,
      salaryAccruedUnits: calculated.workSnapshot.salaryAccruedUnits,
      salaryEarnedUnits: calculated.workSnapshot.salaryEarnedUnits,
      salaryUnpaidUnits: calculated.workSnapshot.salaryUnpaidUnits,
    },
    days: calculated.workSnapshot.days,
    earnings: calculated.earnings,
    deductions: calculated.deductions,
    employerContributions: calculated.employerContributions,
    monthlyGross: calculated.monthlyGross,
    grossAccrued: calculated.grossAccrued,
    lossOfPay: calculated.lossOfPay,
    grossSalary: calculated.grossSalary,
    totalDeductions: calculated.totalDeductions,
    employerContributionTotal: calculated.employerContributionTotal,
    netSalary: calculated.netSalary,
  };
}

function reduceTotals(records) {
  const totals = {
    scheduledGross: 0,
    grossAccrued: 0,
    lossOfPay: 0,
    grossEarned: 0,
    deductions: 0,
    employerContributions: 0,
    net: 0,
    payableUnits: 0,
    unpaidUnits: 0,
    salaryAccruedUnits: 0,
    salaryEarnedUnits: 0,
    salaryUnpaidUnits: 0,
    paidCount: 0,
    holdCount: 0,
    pendingCount: 0,
  };

  for (const record of records) {
    totals.scheduledGross += Number(record.monthlyGross || 0);
    totals.grossAccrued += Number(record.grossAccrued || 0);
    totals.lossOfPay += Number(record.lossOfPay || 0);
    totals.grossEarned += Number(record.grossSalary || 0);
    totals.deductions += Number(record.totalDeductions || 0);
    totals.employerContributions += Number(record.employerContributionTotal || 0);
    totals.net += Number(record.netSalary || 0);
    totals.payableUnits += Number(record.attendanceSnapshot?.payableUnits || 0);
    totals.unpaidUnits += Number(record.attendanceSnapshot?.unpaidUnits || 0);
    totals.salaryAccruedUnits += Number(record.attendanceSnapshot?.salaryAccruedUnits || 0);
    totals.salaryEarnedUnits += Number(record.attendanceSnapshot?.salaryEarnedUnits || 0);
    totals.salaryUnpaidUnits += Number(record.attendanceSnapshot?.salaryUnpaidUnits || 0);
    if (record.paymentStatus === "paid") totals.paidCount += 1;
    else if (record.paymentStatus === "hold") totals.holdCount += 1;
    else totals.pendingCount += 1;
  }

  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundMoney(value)]));
}

async function calculateRunRecords(month) {
  const { to } = getMonthRange(month);
  const cutoffDate = getPayrollCutoffDate(month);
  const monthlyRecords = await getAllMonthlyRecords(month);
  const includedRecords = monthlyRecords.filter(employeeIsEmployed);

  if (!includedRecords.length) {
    const error = new Error("No employed employees are available for this payroll month.");
    error.status = 422;
    throw error;
  }

  const employeeIds = includedRecords.map((record) => record.employee.id);
  const salaryMap = await getSalaryStructuresForEmployees(employeeIds, to);
  const missingSalary = [];
  const calculations = [];

  for (const record of includedRecords) {
    const structures = salaryMap.get(String(record.employee.id)) || [];
    const usableStructures = structures.filter((item) => new Date(item.effectiveFrom) <= new Date(`${cutoffDate}T23:59:59.999Z`));

    if (!usableStructures.length) {
      missingSalary.push({ employeeId: record.employee.id, name: record.employee.name, email: record.employee.email });
      continue;
    }

    const calculated = calculatePayroll({ monthlyRecord: record, salaryStructures: structures, cutoffDate });
    calculations.push({ record, calculated });
  }

  if (missingSalary.length) {
    const error = new Error("Payroll cannot be generated because salary is missing for one or more employees through the calculation date.");
    error.status = 422;
    error.details = { missingSalary };
    throw error;
  }

  return { cutoffDate, calculations };
}

async function createPayrollRun(month, adminId) {
  validateMonth(month);
  const existing = await PayrollRun.findOne({ month }).lean();
  if (existing) {
    const error = new Error(`Payroll for ${month} already exists. Use Regenerate to refresh the current draft.`);
    error.status = 409;
    throw error;
  }

  const { cutoffDate, calculations } = await calculateRunRecords(month);
  const run = await PayrollRun.create({
    month,
    cutoffDate,
    status: "draft",
    calculationMode: "accrued_to_date",
    sandwichRule: { enabled: calculations.some(({ calculated }) => calculated.sandwichRule), mode: "unpaid" },
    employeeCount: calculations.length,
    generatedBy: adminId,
  });

  try {
    const records = calculations.map(({ record, calculated }) => buildRecordData(record, run._id, calculated));
    await PayrollRecord.insertMany(records, { ordered: true });
    const totals = reduceTotals(records);
    run.totals = totals;
    await run.save();
  } catch (error) {
    await PayrollRecord.deleteMany({ payrollRunId: run._id }).catch(() => undefined);
    await PayrollRun.deleteOne({ _id: run._id }).catch(() => undefined);
    throw error;
  }

  return run.toObject();
}

async function recalculatePayrollRun(runId, adminId) {
  normalizeId(runId, "payroll run ID");
  const run = await PayrollRun.findById(runId);
  if (!run) {
    const error = new Error("Payroll run not found.");
    error.status = 404;
    throw error;
  }

  if (!["draft", "review"].includes(run.status)) {
    const error = new Error("Only draft or review payroll runs can be regenerated.");
    error.status = 409;
    throw error;
  }

  const existingPaid = await PayrollRecord.exists({ payrollRunId: run._id, paymentStatus: "paid" });
  if (existingPaid) {
    const error = new Error("Regenerate is locked because one or more employees are already marked paid.");
    error.status = 409;
    throw error;
  }

  const { cutoffDate, calculations } = await calculateRunRecords(run.month);
  const records = calculations.map(({ record, calculated }) => buildRecordData(record, run._id, calculated));
  const totals = reduceTotals(records);

  await PayrollRecord.deleteMany({ payrollRunId: run._id });
  await PayrollRecord.insertMany(records, { ordered: true });

  run.cutoffDate = cutoffDate;
  run.sandwichRule = { enabled: calculations.some(({ calculated }) => calculated.sandwichRule), mode: "unpaid" };
  run.status = "draft";
  run.employeeCount = records.length;
  run.totals = totals;
  run.recalculatedBy = adminId;
  run.recalculatedAt = new Date();
  run.reviewedBy = null;
  run.reviewedAt = null;
  run.finalizedBy = null;
  run.finalizedAt = null;

  return run.save();
}

async function listPayrollRuns(month) {
  if (month) validateMonth(month);
  return PayrollRun.find(month ? { month } : {})
    .sort({ month: -1 })
    .limit(24)
    .lean();
}

async function getPayrollRun(runId) {
  normalizeId(runId, "payroll run ID");
  const run = await PayrollRun.findById(runId).lean();
  if (!run) {
    const error = new Error("Payroll run not found.");
    error.status = 404;
    throw error;
  }

  const records = await PayrollRecord.find({ payrollRunId: runId })
    .sort({ "employeeSnapshot.name": 1 })
    .lean();

  return { run, records };
}

async function generateSalarySlip(runId, recordId) {
  normalizeId(runId, "payroll run ID");
  normalizeId(recordId, "payroll record ID");

  const run = await PayrollRun.findById(runId).lean();

  if (!run) {
    const error = new Error("Payroll run not found.");
    error.status = 404;
    throw error;
  }

  const record = await PayrollRecord.findOne({
    _id: recordId,
    payrollRunId: runId,
  }).lean();

  if (!record) {
    const error = new Error("Payroll employee record not found.");
    error.status = 404;
    throw error;
  }

  return createSalarySlipPdf({
    run,
    record,
  });
}

async function updateRunStatus(runId, action, adminId) {
  normalizeId(runId, "payroll run ID");
  const run = await PayrollRun.findById(runId);
  if (!run) {
    const error = new Error("Payroll run not found.");
    error.status = 404;
    throw error;
  }

  if (action === "review") {
    if (run.status !== "draft") {
      const error = new Error("Only a draft payroll can be moved to review.");
      error.status = 409;
      throw error;
    }
    run.status = "review";
    run.reviewedBy = adminId;
    run.reviewedAt = new Date();
  } else if (action === "finalize") {
    if (!["draft", "review"].includes(run.status)) {
      const error = new Error("Only draft or review payroll can be finalized.");
      error.status = 409;
      throw error;
    }
    run.status = "finalized";
    run.finalizedBy = adminId;
    run.finalizedAt = new Date();
  } else {
    const error = new Error("Unsupported payroll status action.");
    error.status = 400;
    throw error;
  }

  return run.save();
}

async function setRecordPaymentStatus(runId, recordId, action, adminId, payload = {}) {
  normalizeId(runId, "payroll run ID");
  normalizeId(recordId, "payroll record ID");

  const run = await PayrollRun.findById(runId);
  if (!run || run.status === "cancelled") {
    const error = new Error("Payroll run is not available for payment actions.");
    error.status = 409;
    throw error;
  }

  const record = await PayrollRecord.findOne({ _id: recordId, payrollRunId: runId });
  if (!record) {
    const error = new Error("Payroll employee record not found.");
    error.status = 404;
    throw error;
  }

  if (action === "hold") {
    const reason = String(payload.reason || "").trim();
    if (!reason) {
      const error = new Error("A hold reason is required.");
      error.status = 400;
      throw error;
    }
    if (record.paymentStatus === "paid") {
      const error = new Error("A paid salary cannot be moved to hold.");
      error.status = 409;
      throw error;
    }
    record.paymentStatus = "hold";
    record.holdReason = reason.slice(0, 500);
    record.holdAt = new Date();
    record.holdBy = adminId;
    record.paidAt = null;
    record.paidBy = null;
  } else if (action === "release") {
    if (record.paymentStatus !== "hold") {
      const error = new Error("Only a held salary can be released.");
      error.status = 409;
      throw error;
    }
    record.paymentStatus = "pending";
    record.holdReason = "";
    record.holdAt = null;
    record.holdBy = null;
  } else if (action === "paid") {
    if (record.paymentStatus === "paid") {
      return record.toObject();
    }
    record.paymentStatus = "paid";
    record.paidAt = new Date();
    record.paidBy = adminId;
    record.paymentMethod = String(payload.paymentMethod || "").trim().slice(0, 50);
    record.paymentReference = String(payload.paymentReference || "").trim().slice(0, 120);
    record.holdReason = "";
    record.holdAt = null;
    record.holdBy = null;
  } else {
    const error = new Error("Unsupported payment action.");
    error.status = 400;
    throw error;
  }

  const saved = await record.save();
  const allRecords = await PayrollRecord.find({ payrollRunId: runId }).select("paymentStatus").lean();
  const allPaid = allRecords.length > 0 && allRecords.every((item) => item.paymentStatus === "paid");
  if (allPaid) run.status = "completed";
  else if (run.status === "completed") run.status = "finalized";

  run.totals = reduceTotals(await PayrollRecord.find({ payrollRunId: runId }).lean());
  await run.save();

  return saved.toObject();
}

async function bulkMarkPaid(runId, adminId) {
  normalizeId(runId, "payroll run ID");
  const run = await PayrollRun.findById(runId);
  if (!run) {
    const error = new Error("Payroll run not found.");
    error.status = 404;
    throw error;
  }

  await PayrollRecord.updateMany(
    { payrollRunId: runId, paymentStatus: { $ne: "paid" } },
    {
      $set: {
        paymentStatus: "paid",
        paidAt: new Date(),
        paidBy: adminId,
        holdReason: "",
        holdAt: null,
        holdBy: null,
      },
    }
  );

  run.status = "completed";
  run.totals = reduceTotals(await PayrollRecord.find({ payrollRunId: runId }).lean());
  await run.save();
  return run.toObject();
}

module.exports = {
  listEmployees,
  listSalaryStructures,
  createSalaryStructure,
  updateSalaryStructure,
  createPayrollRun,
  recalculatePayrollRun,
  listPayrollRuns,
  getPayrollRun,
  generateSalarySlip,
  updateRunStatus,
  setRecordPaymentStatus,
  bulkMarkPaid,
  getPayrollCutoffDate,
};
