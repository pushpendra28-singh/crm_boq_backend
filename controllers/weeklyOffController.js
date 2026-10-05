const WeeklyOffPolicy = require("../models/WeeklyOffPolicy");

const { isValidDateKey } = require("../utils/holidayDate");

const {
  buildWeeklyOffPreview,
} = require("../utils/weeklyOffCalculator");

function sendError(res, error) {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message:
        "A weekly-off policy already starts on this date. Choose a different effective date.",
    });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message:
        Object.values(error.errors)[0]?.message ||
        "Invalid weekly-off settings.",
    });
  }

  console.error("Weekly-off operation failed:", error.name);

  return res.status(500).json({
    success: false,
    message:
      "Unable to process weekly-off settings. Refresh before retrying.",
  });
}

function getISTDate() {
  return new Date(Date.now() + 19800000)
    .toISOString()
    .slice(0, 10);
}

function serialize(policy) {
  return {
    id: policy._id,
    effectiveFrom: policy.effectiveFrom,
    rules: policy.rules,
    reason: policy.reason,
    createdBy: policy.createdBy,
    createdAt: policy.createdAt,
  };
}

// GET /api/weekly-offs
exports.getPolicies = async (req, res) => {
  try {
    const policies = await WeeklyOffPolicy.find({})
      .select("effectiveFrom rules reason createdBy createdAt")
      .populate("createdBy", "name")
      .sort({ effectiveFrom: -1 })
      .lean();

    const today = getISTDate();

    const currentPolicy =
      policies.find((policy) => policy.effectiveFrom <= today) || null;

    return res.json({
      success: true,
      today,
      currentPolicy: currentPolicy ? serialize(currentPolicy) : null,
      policies: policies.map(serialize),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

// POST /api/weekly-offs
exports.createPolicy = async (req, res) => {
  try {
    const {
      effectiveFrom,
      rules,
      reason,
      confirmPastChange,
      confirmNoWeeklyOffs,
    } = req.body || {};

    if (!isValidDateKey(effectiveFrom)) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid effective date between 2000 and 2099.",
      });
    }

    if (!Array.isArray(rules) || rules.length > 7) {
      return res.status(400).json({
        success: false,
        message: "Provide a weekly-off rules array with at most 7 entries.",
      });
    }

    if (
      typeof reason !== "string" ||
      reason.trim().length < 3 ||
      reason.trim().length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide a reason between 3 and 1000 characters.",
      });
    }

    if (
      effectiveFrom < getISTDate() &&
      confirmPastChange !== true
    ) {
      return res.status(400).json({
        success: false,
        code: "PAST_CHANGE_CONFIRMATION_REQUIRED",
        message:
          "This policy affects past dates. Confirm the historical schedule change.",
      });
    }

    if (rules.length === 0 && confirmNoWeeklyOffs !== true) {
      return res.status(400).json({
        success: false,
        code: "NO_OFFS_CONFIRMATION_REQUIRED",
        message:
          "No weekly offs are selected. Confirm that all weekdays are working days.",
      });
    }

    const normalizedRules = [];

    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];

      if (
        !rule ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        !Number.isInteger(rule.weekday) ||
        rule.weekday < 0 ||
        rule.weekday > 6 ||
        ![
          "every_week",
          "selected_occurrences",
          "alternate_weeks",
        ].includes(rule.pattern)
      ) {
        return res.status(400).json({
          success: false,
          message: `Rule ${index + 1}: select a valid weekday and pattern.`,
        });
      }

      const occurrences = rule.occurrences ?? [];

      if (
        !Array.isArray(occurrences) ||
        occurrences.some(
          (value) =>
            !Number.isInteger(value) ||
            value < 1 ||
            value > 5
        )
      ) {
        return res.status(400).json({
          success: false,
          message: `Rule ${index + 1}: occurrences must contain numbers from 1 to 5.`,
        });
      }

      normalizedRules.push({
        weekday: rule.weekday,
        pattern: rule.pattern,
        occurrences,
        anchorDate: rule.anchorDate ?? null,
      });
    }

    const policy = new WeeklyOffPolicy({
      effectiveFrom,
      rules: normalizedRules,
      reason: reason.trim(),
      createdBy: req.admin._id,
    });

    // Executes the model's rule and anchor-date validators.
    await policy.save();

    return res.status(201).json({
      success: true,
      message: "Weekly-off policy saved successfully.",
      policy: serialize(policy),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

// GET /api/weekly-offs/preview?from=2026-10-01&to=2026-10-31
exports.getPreview = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!isValidDateKey(from) || !isValidDateKey(to)) {
      return res.status(400).json({
        success: false,
        message: "Provide valid from and to dates in YYYY-MM-DD format.",
      });
    }

    const difference =
      new Date(`${to}T00:00:00Z`) -
      new Date(`${from}T00:00:00Z`);

    if (difference < 0 || difference > 365 * 86400000) {
      return res.status(400).json({
        success: false,
        message: "Select a date range of up to 366 days.",
      });
    }

    // Include the last policy before the range and all changes within it.
    const [previousPolicy, changes] = await Promise.all([
      WeeklyOffPolicy.findOne({
        effectiveFrom: { $lt: from },
      })
        .sort({ effectiveFrom: -1 })
        .select("effectiveFrom rules")
        .lean(),

      WeeklyOffPolicy.find({
        effectiveFrom: { $gte: from, $lte: to },
      })
        .select("effectiveFrom rules")
        .sort({ effectiveFrom: 1 })
        .lean(),
    ]);

    const policies = previousPolicy
      ? [previousPolicy, ...changes]
      : changes;

    const days = buildWeeklyOffPreview(from, to, policies);

    return res.json({
      success: true,
      from,
      to,
      weeklyOffCount: days.filter(
        (day) => day.status === "weekly_off"
      ).length,
      days,
    });
  } catch (error) {
    return sendError(res, error);
  }
};