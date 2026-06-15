const express = require("express");
const router = express.Router();

const Admin = require("../models/Admin");
const { protect } = require("../middleware/authMiddleware");

// GET /api/admins?role=sales,manager&isActive=true
router.get("/", protect, async (req, res) => {
  try {
    const { role, isActive } = req.query;

    const filter = {};

    // fetch multiple roles
    if (role) {
      filter.role = {
        $in: role.split(",").map((r) => r.trim()),
      };
    }

    // active users only
    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    const admins = await Admin.find(filter).select(
      "_id name email role isActive territory"
    );

    res.status(200).json({ admins });
  } catch (error) {
    console.error("Fetch admins error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;