const express = require("express");

const {
  protect,
  requirePermission,
} = require("../middleware/authMiddleware");

const {
  getHolidays,
  createHolidays,
  updateHoliday,
  deleteHoliday,
} = require("../controllers/holidayController");

const router = express.Router();

router.use(protect);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get(
  "/",
  requirePermission("view_holidays"),
  getHolidays
);

router.post(
  "/bulk",
  requirePermission("create_holidays"),
  createHolidays
);

router.patch(
  "/:id",
  requirePermission("edit_holidays"),
  updateHoliday
);

router.delete(
  "/:id",
  requirePermission("delete_holidays"),
  deleteHoliday
);

module.exports = router;