const router = require('express').Router();
const { protect, requirePermission, requireAnyPermission } = require('../middleware/authMiddleware');
const c = require('../controllers/leaveController');
router.use(protect);
router.use((req, res, next) => {
  if (['POST', 'PUT'].includes(req.method)) {
    req.body = req.body || {};
    if (typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'Request body must be a JSON object.' });
  }
  next();
});
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const any = requireAnyPermission('view_leaves', 'apply_leaves', 'approve_leaves', 'view_all_leaves', 'manage_leave_settings', 'manage_leave_balances');
router.get('/meta', any, c.meta);
router.get('/directory', requireAnyPermission('manage_leave_settings', 'manage_leave_balances'), c.directory);
router.put('/settings', requirePermission('manage_leave_settings'), c.saveSettings);
router.get('/balance', requireAnyPermission('view_leaves', 'apply_leaves', 'manage_leave_balances'), c.balance);
router.put('/allocation', requirePermission('manage_leave_balances'), c.allocate);
router.post('/preview', requirePermission('apply_leaves'), c.preview);
router.post('/requests', requirePermission('apply_leaves'), c.apply);
router.get('/requests', requireAnyPermission('view_leaves', 'apply_leaves', 'approve_leaves', 'view_all_leaves'), c.list);
router.post('/requests/:id/action', requireAnyPermission('apply_leaves', 'approve_leaves'), c.action);
router.post('/notifications/:account/:mail/retry', requirePermission('manage_leave_settings'), c.retryMail);
module.exports = router;
