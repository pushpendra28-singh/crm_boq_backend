"use strict";

const Project = require("../models/Project");

/*
|--------------------------------------------------------------------------
| Ensure logged-in user can access ONLY assigned project
|--------------------------------------------------------------------------
*/

exports.onlyAssignedProject = async (req, res, next) => {
  try {
    const project = await Project.findOne({
  _id: req.params.id,
  $or: [
    { projectManager: req.admin._id },
    { assignedEngineers: req.admin._id },
  ],
})
.populate("projectManager", "name email role phone")
.populate("assignedEngineers", "name email role phone");

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or access denied",
      });
    }

    req.project = project;
     next(); 

    
  } catch (error) {
    console.error("onlyAssignedProject error:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};