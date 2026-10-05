const mongoose = require("mongoose");
const Holiday = require("../models/Holiday");
const { isValidDateKey } = require("../utils/holidayDate");

function sendError(res, error) {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "An active holiday already exists on this date.",
    });
  }

  if (error.name === "VersionError") {
    return res.status(409).json({
      success: false,
      message: "This holiday was updated by someone else. Refresh and retry.",
    });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message:
        Object.values(error.errors)[0]?.message ||
        "Invalid holiday details.",
    });
  }

  console.error("Holiday operation failed:", error.name);

  return res.status(500).json({
    success: false,
    message: "Unable to process holidays. Refresh the list before retrying.",
  });
}

function validYear(value) {
  return /^\d{4}$/.test(String(value)) &&
    Number(value) >= 2000 &&
    Number(value) <= 2099;
}

function validName(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 2 &&
    value.trim().length <= 120
  );
}

function validReason(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 3 &&
    value.trim().length <= 1000
  );
}

function validMutation(req, res) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    res.status(400).json({
      success: false,
      message: "Invalid holiday ID.",
    });
    return false;
  }

  if (
    !Number.isInteger(req.body?.version) ||
    req.body.version < 0
  ) {
    res.status(400).json({
      success: false,
      message: "A valid record version is required. Refresh the list.",
    });
    return false;
  }

  if (!validReason(req.body?.reason)) {
    res.status(400).json({
      success: false,
      message: "Provide a reason between 3 and 1000 characters.",
    });
    return false;
  }

  return true;
}

function serialize(holiday) {
  return {
    id: holiday._id,
    name: holiday.name,
    date: holiday.date,
    version: holiday.__v,
    createdAt: holiday.createdAt,
    updatedAt: holiday.updatedAt,
  };
}

// GET /api/holidays?year=2026
exports.getHolidays = async (req, res) => {
  try {
    const year = req.query.year;

    if (typeof year !== "string" || !validYear(year)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid year between 2000 and 2099.",
      });
    }

    const holidays = await Holiday.find({
      isDeleted: false,
      date: {
        $gte: `${year}-01-01`,
        $lt: `${Number(year) + 1}-01-01`,
      },
    })
      .select("name date __v createdAt updatedAt")
      .sort({ date: 1, _id: 1 })
      .lean();

    return res.json({
      success: true,
      year: Number(year),
      holidays: holidays.map(serialize),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

// POST /api/holidays/bulk
// Single holiday bhi one-item array se add ho sakta hai.
exports.createHolidays = async (req, res) => {
  try {
    const { year, holidays } = req.body || {};

    if (
      !["string", "number"].includes(typeof year) ||
      !validYear(year)
    ) {
      return res.status(400).json({
        success: false,
        message: "Select a valid year between 2000 and 2099.",
      });
    }

    if (
      !Array.isArray(holidays) ||
      holidays.length === 0 ||
      holidays.length > 366
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide between 1 and 366 holidays.",
      });
    }

    const dates = new Set();
    const normalized = [];

    // Validate the complete batch before writing any rows.
    for (let index = 0; index < holidays.length; index += 1) {
      const row = holidays[index];

      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        !validName(row.name) ||
        !isValidDateKey(row.date)
      ) {
        return res.status(400).json({
          success: false,
          message: `Row ${index + 1}: provide a valid name and date.`,
        });
      }

      if (!row.date.startsWith(`${year}-`)) {
        return res.status(400).json({
          success: false,
          message: `Row ${index + 1}: date must belong to ${year}.`,
        });
      }

      if (dates.has(row.date)) {
        return res.status(400).json({
          success: false,
          message: `Duplicate date in submitted rows: ${row.date}.`,
        });
      }

      dates.add(row.date);
      normalized.push({
        name: row.name.trim(),
        date: row.date,
      });
    }

    const existing = await Holiday.find({
      isDeleted: false,
      date: { $in: [...dates] },
    })
      .select("date")
      .lean();

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Some dates already have active holidays.",
        conflictingDates: existing.map((holiday) => holiday.date),
      });
    }

    const results = [];

    for (let index = 0; index < normalized.length; index += 1) {
      const row = normalized[index];

      try {
        const holiday = await Holiday.create({
          ...row,
          createdBy: req.admin._id,
          updatedBy: req.admin._id,
          auditHistory: [
            {
              action: "create",
              actor: req.admin._id,
              after: row,
            },
          ],
        });

        results.push({
          date: row.date,
          status: "created",
          holiday: serialize(holiday),
        });
      } catch (error) {
        if (error.code === 11000) {
          results.push({
            date: row.date,
            status: "conflict",
            message: "Another request already added this date.",
          });
          continue;
        }

        console.error("Holiday batch write failed:", error.name);

        // A network failure can leave the write outcome uncertain.
        results.push({
          date: row.date,
          status: "unconfirmed",
          message: "Refresh the holiday list to confirm this row.",
        });

        for (const remaining of normalized.slice(index + 1)) {
          results.push({
            date: remaining.date,
            status: "not_attempted",
          });
        }

        break;
      }
    }

    const createdCount = results.filter(
      (result) => result.status === "created"
    ).length;

    const complete = createdCount === normalized.length;

    return res.status(complete ? 201 : 207).json({
      success: complete,
      partial: !complete,
      message: complete
        ? `${createdCount} holiday(s) added successfully.`
        : "Some rows were not confirmed. Refresh the list and review results.",
      createdCount,
      results,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

// PATCH /api/holidays/:id
exports.updateHoliday = async (req, res) => {
  try {
    if (!validMutation(req, res)) return;

    const { name, date, reason, version } = req.body;

    if (!validName(name) || !isValidDateKey(date)) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid holiday name and date.",
      });
    }

    const holiday = await Holiday.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!holiday) {
      return res.status(404).json({
        success: false,
        message: "Holiday not found.",
      });
    }

    if (holiday.__v !== version) {
      return res.status(409).json({
        success: false,
        message: "This holiday changed. Refresh before editing.",
      });
    }

    const nextName = name.trim();

    if (holiday.name === nextName && holiday.date === date) {
      return res.json({
        success: true,
        message: "No changes to save.",
        holiday: serialize(holiday),
      });
    }

    holiday.auditHistory.push({
      action: "edit",
      actor: req.admin._id,
      reason: reason.trim(),
      before: { name: holiday.name, date: holiday.date },
      after: { name: nextName, date },
    });

    holiday.name = nextName;
    holiday.date = date;
    holiday.updatedBy = req.admin._id;

    await holiday.save();

    return res.json({
      success: true,
      message: "Holiday updated successfully.",
      holiday: serialize(holiday),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

// DELETE /api/holidays/:id
exports.deleteHoliday = async (req, res) => {
  try {
    if (!validMutation(req, res)) return;

    const holiday = await Holiday.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!holiday) {
      return res.status(404).json({
        success: false,
        message: "Holiday not found or already deleted.",
      });
    }

    if (holiday.__v !== req.body.version) {
      return res.status(409).json({
        success: false,
        message: "This holiday changed. Refresh before deleting.",
      });
    }

    holiday.auditHistory.push({
      action: "delete",
      actor: req.admin._id,
      reason: req.body.reason.trim(),
      before: { name: holiday.name, date: holiday.date },
    });

    holiday.isDeleted = true;
    holiday.deletedAt = new Date();
    holiday.deletedBy = req.admin._id;
    holiday.updatedBy = req.admin._id;

    await holiday.save();

    return res.json({
      success: true,
      message: "Holiday deleted successfully. Audit history retained.",
    });
  } catch (error) {
    return sendError(res, error);
  }
};