const Lead = require("../models/Lead");

/*
|--------------------------------------------------------------------------
| Ensure logged-in user can access ONLY assigned lead
|--------------------------------------------------------------------------
*/

exports.onlyAssignedLead = async (req, res, next) => {
  try {

    const lead = await Lead.findOne({
      _id: req.params.id,
      assignedTo: req.admin._id,
    });

    if (!lead) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this lead",
      });
    }

    req.lead = lead;

    next();

  } catch (error) {

    console.error("onlyAssignedLead error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};