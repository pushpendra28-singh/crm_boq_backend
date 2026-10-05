const mongoose = require("mongoose");
const payrollService = require("../services/payrollService");

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      details: error.details,
    });
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      success: false,
      message: "Payroll data is invalid.",
      details: error.errors,
    });
  }

  if (error?.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "A payroll or salary record already exists for the selected period.",
    });
  }

  console.error("Payroll error:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to complete the payroll request. Please try again.",
  });
}

exports.employees = async (req, res) => {
  try {
    const employees = await payrollService.listEmployees(req.query.search || "");
    return res.json({ success: true, employees });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.salaryList = async (req, res) => {
  try {
    const salaries = await payrollService.listSalaryStructures(req.params.employeeId);
    return res.json({ success: true, salaries });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.salaryCreate = async (req, res) => {
  try {
    const salary = await payrollService.createSalaryStructure(req.body, req.admin._id);
    return res.status(201).json({ success: true, message: "Salary structure saved.", salary });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.salaryUpdate = async (req, res) => {
  try {
    const salary = await payrollService.updateSalaryStructure(req.params.salaryId, req.body, req.admin._id);
    return res.json({ success: true, message: "Salary structure updated.", salary });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.runs = async (req, res) => {
  try {
    const runs = await payrollService.listPayrollRuns(req.query.month || "");
    return res.json({ success: true, runs });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.generate = async (req, res) => {
  try {
    const run = await payrollService.createPayrollRun(req.body?.month, req.admin._id);
    return res.status(201).json({ success: true, message: "Payroll generated through the current calculation date.", run });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.recalculate = async (req, res) => {
  try {
    const run = await payrollService.recalculatePayrollRun(req.params.runId, req.admin._id);
    return res.json({ success: true, message: "Payroll regenerated through the current calculation date.", run });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.detail = async (req, res) => {
  try {
    const result = await payrollService.getPayrollRun(req.params.runId);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.salarySlip = async (req, res) => {
  try {
    const result = await payrollService.generateSalarySlip(
      req.params.runId,
      req.params.recordId
    );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(result.buffer.length),
      "Access-Control-Expose-Headers": "Content-Disposition",
    });

    return res.send(result.buffer);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.review = async (req, res) => {
  try {
    const run = await payrollService.updateRunStatus(req.params.runId, "review", req.admin._id);
    return res.json({ success: true, message: "Payroll moved to review.", run });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.finalize = async (req, res) => {
  try {
    const run = await payrollService.updateRunStatus(req.params.runId, "finalize", req.admin._id);
    return res.json({ success: true, message: "Payroll finalized.", run });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.recordPayment = async (req, res) => {
  try {
    const record = await payrollService.setRecordPaymentStatus(
      req.params.runId,
      req.params.recordId,
      req.body?.action,
      req.admin._id,
      req.body
    );
    return res.json({ success: true, message: "Employee payroll status updated.", record });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.markPaid = async (req, res) => {
  try {
    const run = await payrollService.bulkMarkPaid(req.params.runId, req.admin._id);
    return res.json({ success: true, message: "All pending payroll records marked as paid.", run });
  } catch (error) {
    return handleError(res, error);
  }
};
