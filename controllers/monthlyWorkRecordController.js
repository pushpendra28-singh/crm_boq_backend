const mongoose = require("mongoose");
const {
  getMonthlyRecords,
  getEmployeeMonthlyRecord,
  getMonthRange,
} = require("../services/monthlyWorkRecordService");

function parsePage(value) {
  const page = Number(value || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    const error = new Error("Invalid page number.");
    error.status = 400;
    throw error;
  }
  return page;
}

function parseLimit(value) {
  const limit = Number(value || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    const error = new Error("Invalid page size.");
    error.status = 400;
    throw error;
  }
  return limit;
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
    });
  }

  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      message: "Invalid monthly record request.",
    });
  }

  console.error("Monthly work record error:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to load monthly work records. Please refresh and try again.",
  });
}

exports.list = async (req, res) => {
  try {
    getMonthRange(req.query.month);
    console.log("Fetching monthly records for month:", req.query.month);

    const result = await getMonthlyRecords({
      month: req.query.month,
      search: req.query.search,
      page: parsePage(req.query.page),
      limit: parseLimit(req.query.limit),
    });

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.detail = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.employeeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid employee ID.",
      });
    }

    getMonthRange(req.query.month);
    const result = await getEmployeeMonthlyRecord(
      req.params.employeeId,
      req.query.month
    );

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error);
  }
};
