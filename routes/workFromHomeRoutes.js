const router = require("express").Router();
const { protect, requireAnyPermission, requirePermission } = require("../middleware/authMiddleware");
const controller = require("../controllers/workFromHomeController");

router.use(protect);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/me", requireAnyPermission("view_attendance", "mark_attendance"), controller.getMySetting);
router.get("/", requirePermission("manage_wfh_settings"), controller.getSettings);
router.put("/:employeeId", requirePermission("manage_wfh_settings"), controller.updateSetting);

module.exports = router;
