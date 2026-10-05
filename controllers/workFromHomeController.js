const mongoose = require("mongoose");
const Admin = require("../models/Admin");
const WorkFromHomeSetting = require("../models/WorkFromHomeSetting");

const DAY_TYPES = new Set(["full_day", "half_day"]);

function validateEmployeeId(id) {
  if (!mongoose.isObjectIdOrHexString(id)) {
    const error = new Error("Invalid employee ID.");
    error.status = 400;
    throw error;
  }
}

function normalizeSetting(setting) {
  return {
    enabled: Boolean(setting?.enabled),
    dayType: setting?.enabled ? (setting.dayType || "full_day") : null,
  };
}

async function findEligibleEmployees() {
  return Admin.find({
    isActive: true,
    role: { $ne: "superadmin" },
    "employment.currentlyWorking": { $ne: false },
  })
    .select("_id name email role isActive employment.joiningDate employment.exitDate employment.currentlyWorking")
    .sort({ name: 1, _id: 1 })
    .lean();
}

exports.getSettings = async (req, res) => {
  try {
    const employees = await findEligibleEmployees();
    const employeeIds = employees.map((employee) => employee._id);

    const settings = await WorkFromHomeSetting.find({
      employeeId: { $in: employeeIds },
    }).lean();

    const settingsByEmployee = new Map(
      settings.map((setting) => [String(setting.employeeId), setting])
    );

    return res.json({
      success: true,
      employees: employees.map((employee) => {
        const setting = settingsByEmployee.get(String(employee._id));
        return {
          id: employee._id,
          name: employee.name,
          email: employee.email,
          role: employee.role,
          isActive: employee.isActive,
          currentlyWorking: employee.employment?.currentlyWorking ?? true,
          wfh: normalizeSetting(setting),
        };
      }),
    });
  } catch (error) {
    console.error("Get WFH settings error:", error.name, error.code || "UNKNOWN");
    return res.status(500).json({
      success: false,
      message: "Unable to load WFH settings. Please refresh and try again.",
    });
  }
};

exports.getMySetting = async (req, res) => {
  try {
    const setting = await WorkFromHomeSetting.findOne({
      employeeId: req.admin._id,
    }).lean();

    return res.json({
      success: true,
      wfh: normalizeSetting(setting),
    });
  } catch (error) {
    console.error("Get own WFH setting error:", error.name, error.code || "UNKNOWN");
    return res.status(500).json({
      success: false,
      message: "Unable to load your WFH setting. Please refresh and try again.",
    });
  }
};

exports.updateSetting = async (req, res) => {
  try {
    validateEmployeeId(req.params.employeeId);

    const employee = await Admin.findOne({
      _id: req.params.employeeId,
      isActive: true,
      role: { $ne: "superadmin" },
      "employment.currentlyWorking": { $ne: false },
    }).select("_id name email").lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Eligible employee not found.",
      });
    }

    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "enabled must be true or false.",
      });
    }

    const enabled = req.body.enabled;
    const dayType = req.body.dayType || "full_day";

    if (enabled && !DAY_TYPES.has(dayType)) {
      return res.status(400).json({
        success: false,
        message: "dayType must be full_day or half_day.",
      });
    }

    const setting = await WorkFromHomeSetting.findOneAndUpdate(
      { employeeId: employee._id },
      {
        $set: {
          enabled,
          dayType: enabled ? dayType : "full_day",
          updatedBy: req.admin._id,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({
      success: true,
      message: enabled ? "WFH access updated successfully." : "WFH access disabled successfully.",
      employee: { id: employee._id, name: employee.name, email: employee.email },
      wfh: normalizeSetting(setting),
    });
  } catch (error) {
    console.error("Update WFH setting error:", error.name, error.code || "UNKNOWN");
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "WFH setting changed concurrently. Refresh and try again.",
      });
    }
    if (error?.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return res.status(500).json({
      success: false,
      message: "Unable to save WFH setting. Please try again.",
    });
  }
};
