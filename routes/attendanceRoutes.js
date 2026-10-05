const router = require('express').Router();
const { protect, requirePermission, requireAnyPermission } = require('../middleware/authMiddleware');
const { getToday, checkIn, checkOut, getMyHistory } = require('../controllers/attendanceController');
const management = require('../controllers/attendanceManagementController');
const { getSchedule } = require("../controllers/attendanceScheduleController");
const { getLeaveDays } = require("../controllers/attendanceLeaveController");


router.use(protect);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/today', requireAnyPermission('view_attendance', 'mark_attendance'), getToday);
router.get('/history', requirePermission('view_attendance'), getMyHistory);
router.post('/check-in', requirePermission('mark_attendance'), checkIn);
router.post('/check-out', requirePermission('mark_attendance'), checkOut);
router.get('/all', requirePermission('view_all_attendance'), management.list);
router.patch('/:id', requirePermission('view_all_attendance', 'edit_attendance'), management.edit);
router.delete('/:id', requirePermission('view_all_attendance', 'delete_attendance'), management.remove);
router.get('/schedule', requirePermission('view_attendance'), getSchedule);
router.get('/leave-days', requirePermission('view_all_attendance'), getLeaveDays);
module.exports = router;
