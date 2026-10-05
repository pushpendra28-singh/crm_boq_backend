const express = require("express");
const { protect, requirePermission } = require("../middleware/authMiddleware");
const controller = require("../controllers/monthlyWorkRecordController");

const router = express.Router();

router.use(protect);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", requirePermission("view_monthly_records"),controller.list);

router.get("/:employeeId", requirePermission("view_monthly_records"),controller.detail);

module.exports = router;
