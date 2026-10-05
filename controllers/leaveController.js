const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Settings = require('../models/LeaveSettings');
const Account = require('../models/LeaveAccount');
const { problem, range, balances, overlaps, nextStatus } = require('../utils/leaveRules');
const { allowed, reviewers, calculate, accountFor, notify } = require('../services/leaveService');
const id = value => { if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) throw problem(400, 'Invalid identifier.'); return value; };
const yearOf = value => { const year = Number(value); if (!Number.isInteger(year) || year < 2000 || year > 2099) throw problem(400, 'Select a year between 2000 and 2099.'); return year; };
const reasonOf = value => { if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 1000) throw problem(400, 'Reason must contain 3–1000 characters.'); return value.trim(); };
const versionOf = value => { if (!Number.isInteger(value) || value < 0) throw problem(400, 'A valid version is required.'); return value; };
const run = fn => async (req, res) => { try { await fn(req, res); } catch (e) {
  if (e.name === 'VersionError' || e.code === 11000) return res.status(409).json({ message: 'Another update occurred. Refresh before retrying; do not submit a duplicate request.' });
  if (e.status) return res.status(e.status).json({ message: e.message });
  if (e.name === 'ValidationError' || e.name === 'CastError') return res.status(400).json({ message: 'Invalid leave details. Check the form and try again.' });
  console.error('Leave operation failed:', e.name, e.code || '');
  res.status(500).json({ message: 'Unable to complete the operation. Refresh to check whether it was saved before trying again.' });
} };
async function settings() { const s = await Settings.findOne({ key: 'company' }); if (!s) throw problem(503, 'Leave settings are not initialized.'); return s; }
function serialize(account, r, viewer) {
  const employee = account.employee || { _id: null, name: 'Deleted employee', email: '' };
  const own = String(employee._id || employee) === String(viewer._id);
  return { ...r.toObject(), accountId: account._id, year: account.year,
    employee: { id: employee._id || employee, name: employee.name || 'Employee', email: employee.email || '' },
    own,
    notification: account.mail.filter(m => String(m.requestId) === String(r._id)).map(m => ({ id: m._id, status: m.status, attempts: m.attempts, sentAt: m.sentAt })),
  };
}
exports.meta = run(async (req, res) => {
  const s = await settings();
  const manage = await allowed(req.admin, 'manage_leave_settings');
  res.json({ types: s.types, allowPast: s.allowPast, ...(manage ? { reviewers: s.reviewers, version: s.__v } : {}) });
});
exports.directory = run(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  if (!Number.isInteger(page) || page > 10000) throw problem(400, 'Invalid page.');
  const q = String(req.query.q || '').trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = { isActive: true, ...(q ? { $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }] } : {}) };
  const [users, total] = await Promise.all([Admin.find(filter).select('name email role permissions').sort({ name: 1, _id: 1 }).skip((page - 1) * 50).limit(50), Admin.countDocuments(filter)]);
  const employees = [];
  for (const u of users) employees.push({ id: u._id, name: u.name, email: u.email, canApprove: await allowed(u, 'approve_leaves') });
  res.json({ employees, page, pages: Math.max(1, Math.ceil(total / 50)) });
});
exports.saveSettings = run(async (req, res) => {
  const s = await settings(), b = req.body;
  if (s.__v !== versionOf(b.version)) throw problem(409, 'Settings changed. Refresh and try again.');
  const reason = reasonOf(b.reason);
  if (!Array.isArray(b.types) || !b.types.length || b.types.length > 30) throw problem(400, 'Configure 1–30 leave types.');
  if (!Array.isArray(b.reviewers) || !b.reviewers.length || b.reviewers.length > 10) throw problem(400, 'Select 1–10 approvers.');
  if (typeof b.allowPast !== 'boolean') throw problem(400, 'Invalid backdated-leave setting.');
  const seen = new Set(), seenIds = new Set();
  const types = b.types.map(t => {
    if (!t || typeof t.name !== 'string' || t.name.trim().length < 2 || t.name.trim().length > 80 || ['paid', 'halfDay', 'active'].some(k => typeof t[k] !== 'boolean')) throw problem(400, 'Check leave type name and options.');
    const key = t.name.trim().toLowerCase(); if (seen.has(key)) throw problem(400, 'Leave type names must be unique.'); seen.add(key);
    const old = t._id ? s.types.id(id(t._id)) : null;
    if (t._id && !old) throw problem(400, 'Unknown leave type.');
    if (old && old.paid !== t.paid) throw problem(400, 'Paid/unpaid classification cannot change. Deactivate this type and create a new one.');
    if (t._id && seenIds.has(t._id)) throw problem(400, 'Duplicate leave type.'); if (t._id) seenIds.add(t._id);
    return { _id: old?._id || new mongoose.Types.ObjectId(), name: t.name.trim(), paid: t.paid, halfDay: t.halfDay, active: t.active };
  });
  if (s.types.some(t => !types.some(n => String(n._id) === String(t._id)))) throw problem(400, 'Existing leave types cannot be removed. Deactivate them instead.');
  b.reviewers.forEach(id);
  if (new Set(b.reviewers).size !== b.reviewers.length) throw problem(400, 'Duplicate approver.');
  const valid = await reviewers(b.reviewers);
  if (valid.length !== b.reviewers.length) throw problem(400, 'All approvers must be active and have Approve leaves permission.');
  s.audit.push({ actor: req.admin._id, at: new Date(), reason, before: { types: s.types.toObject(), reviewers: s.reviewers, allowPast: s.allowPast }, after: { types, reviewers: b.reviewers, allowPast: b.allowPast } });
  s.types = types; s.reviewers = b.reviewers; s.allowPast = b.allowPast;
  await s.save(); res.json({ message: 'Leave settings saved.' });
});
exports.balance = run(async (req, res) => {
  const year = yearOf(req.query.year);
  const employee = req.query.employee ? id(req.query.employee) : req.admin._id;
  if (String(employee) !== String(req.admin._id) && !await allowed(req.admin, 'manage_leave_balances')) throw problem(403, 'You cannot view this employee’s balance.');
  const [s, found] = await Promise.all([settings(), Account.findOne({ employee, year })]);
  const a = found || { allocations: [], requests: [] };
  res.json({ year, version: found?.__v ?? null, adjustments: found?.adjustments.slice(-50).reverse() || [], balances: s.types.map(t => ({ id: t._id, name: t.name, paid: t.paid, active: t.active, ...balances(a, t._id) })) });
});
exports.allocate = run(async (req, res) => {
  const b = req.body, employee = id(b.employee), year = yearOf(b.year), typeId = id(b.typeId), reason = reasonOf(b.reason);
  if (typeof b.units !== 'number' || !Number.isFinite(b.units) || b.units < 0 || b.units > 366 || !Number.isInteger(b.units * 2)) throw problem(400, 'Allocation must be 0–366 days, in half-day increments.');
  const [s, user] = await Promise.all([settings(), Admin.findById(employee)]);
  if (!user?.isActive) throw problem(404, 'Active employee not found.');
  if (!s.types.some(t => String(t._id) === typeId && t.paid)) throw problem(400, 'Allocation is available only for paid leave types.');
  const a = await accountFor(employee, year);
  if ((b.version === null && (a.allocations.length || a.requests.length || a.adjustments.length)) || (b.version !== null && a.__v !== versionOf(b.version))) throw problem(409, 'Balance changed. Refresh before setting allocation.');
  const balance = balances(a, typeId);
  if (b.units < balance.used + balance.reserved) throw problem(409, 'Allocation cannot be below used plus reserved leave.');
  const allocation = a.allocations.find(x => String(x.typeId) === typeId);
  if (allocation) allocation.units = b.units; else a.allocations.push({ typeId, units: b.units });
  a.adjustments.push({ typeId, before: balance.allocated, after: b.units, reason, actor: req.admin._id, at: new Date() });
  await a.save(); res.json({ message: 'Leave allocation saved with audit history.' });
});
exports.preview = run(async (req, res) => {
  const s = await settings(), result = await calculate(s, req.body);
  const a = await Account.findOne({ employee: req.admin._id, year: Number(req.body.from.slice(0, 4)) });
  res.json({ units: result.units, excludedDays: result.excludedDays, paid: result.type.paid, balance: balances(a || { allocations: [], requests: [] }, result.type._id) });
});
exports.apply = run(async (req, res) => {
  const b = req.body, year = range(b.from, b.to, b.portion), reason = reasonOf(b.reason);
  if (typeof b.key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(b.key)) throw problem(400, 'A submission key is required. Refresh the form.');
  const a = await accountFor(req.admin._id, year);
  const existing = a.requests.find(r => r.key === b.key);
  if (existing) {
    if (existing.from !== b.from || existing.to !== b.to || String(existing.typeId) !== b.typeId || existing.portion !== b.portion || existing.reason !== reason) throw problem(409, 'This submission key was already used. Open a new application.');
    return res.json({ message: 'This leave request was already submitted.', requestId: existing._id });
  }
  const s = await settings(), result = await calculate(s, b);
  const recipients = await reviewers(s.reviewers, req.admin._id);
  if (!recipients.length) throw problem(409, 'No eligible approver is configured. Contact your administrator.');
  if (a.requests.length >= 250) throw problem(409, 'Annual request limit reached. Contact your administrator.');
  if (overlaps(a, result.days, b.portion)) throw problem(409, 'An active leave request already overlaps these dates.');
  if (result.type.paid && balances(a, result.type._id).available < result.units) throw problem(409, 'Insufficient paid-leave balance. Contact your administrator or choose an unpaid leave type.');
  a.requests.push({ _id: new mongoose.Types.ObjectId(), key: b.key, typeId: result.type._id, typeName: result.type.name, paid: result.type.paid, from: b.from, to: b.to, portion: b.portion, days: result.days, units: result.units, reason, status: 'pending', version: 0, reviewers: recipients.map(u => u._id), history: [{ actor: req.admin._id, at: new Date(), status: 'pending', note: reason }], createdAt: new Date() });
  const r = a.requests[a.requests.length - 1];
  notify(a, r, [...recipients.map(u => u._id), req.admin._id], req.admin.name, reason);
  await a.save(); res.status(201).json({ message: 'Leave request submitted. Email notifications are queued.', requestId: r._id });
});
exports.list = run(async (req, res) => {
  const year = yearOf(req.query.year), scope = req.query.scope || 'mine';
  if (!['mine', 'approvals', 'all'].includes(scope)) throw problem(400, 'Invalid request scope.');
  const filter = { year };
  if (scope === 'mine') {
    if (!await allowed(req.admin, 'view_leaves') && !await allowed(req.admin, 'apply_leaves')) throw problem(403, 'View own leaves permission is required.');
    filter.employee = req.admin._id;
  }
  if (scope === 'all' && !await allowed(req.admin, 'view_all_leaves')) throw problem(403, 'View all leaves permission is required.');
  if (scope === 'approvals') {
    if (!await allowed(req.admin, 'approve_leaves')) throw problem(403, 'Approve leaves permission is required.');
    if (req.admin.role !== 'superadmin') filter['requests.reviewers'] = req.admin._id;
  }
  const page = Number(req.query.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw problem(400, 'Invalid page.');
  // Pagination is on requests, not employee accounts.
  const match = {};
  if (scope === 'approvals' && req.admin.role !== 'superadmin') match['requests.reviewers'] = req.admin._id;
  if (scope === 'approvals') match.employee = { $ne: req.admin._id };
  const statuses = ['pending', 'under_review', 'approved', 'rejected', 'cancel_requested', 'cancelled'];
  if (req.query.status) { if (!statuses.includes(req.query.status)) throw problem(400, 'Invalid status.'); match['requests.status'] = req.query.status; }
  if (req.query.requestId) match['requests._id'] = new mongoose.Types.ObjectId(id(req.query.requestId));
  const [output] = await Account.aggregate([{ $match: filter }, { $unwind: '$requests' }, { $match: match }, { $sort: { 'requests.createdAt': -1, 'requests._id': -1 } }, { $facet: { rows: [{ $skip: (page - 1) * 20 }, { $limit: 20 }, { $project: { _id: 1, requestId: '$requests._id' } }], count: [{ $count: 'value' }] } }]);
  const ids = output.rows.map(x => x._id);
  const accounts = await Account.find({ _id: { $in: ids } }).populate('employee', 'name email').populate('requests.history.actor', 'name');
  const rows = output.rows.map(row => { const a = accounts.find(x => String(x._id) === String(row._id)); const r = a.requests.id(row.requestId); return { ...serialize(a, r, req.admin), canAct: String(a.employee?._id) !== String(req.admin._id) && (req.admin.role === 'superadmin' || r.reviewers.some(x => String(x) === String(req.admin._id))) }; });
  res.json({ rows, pages: Math.max(1, Math.ceil((output.count[0]?.value || 0) / 20)), total: output.count[0]?.value || 0 });
});
exports.action = run(async (req, res) => {
  const requestId = id(req.params.id), b = req.body;
  const a = await Account.findOne({ 'requests._id': requestId });
  if (!a) throw problem(404, 'Leave request not found.');
  const r = a.requests.id(requestId), own = String(a.employee) === String(req.admin._id);
  if (b.action === 'cancel') {
    if (!own || !await allowed(req.admin, 'apply_leaves')) throw problem(403, 'Only the applicant can request cancellation.');
  } else {
    if (own) throw problem(403, 'You cannot decide your own leave request.');
    if (!await allowed(req.admin, 'approve_leaves') || (req.admin.role !== 'superadmin' && !r.reviewers.some(u => String(u) === String(req.admin._id)))) throw problem(403, 'You are not an authorized approver for this request.');
  }
  if (r.version !== versionOf(b.version)) throw problem(409, 'This request changed. Refresh before taking action.');
  if (r.history.length >= 30 && ['pending', 'review'].includes(b.action)) throw problem(409, 'Review transition limit reached. Please approve or reject this request.');
  const note = reasonOf(b.reason), next = nextStatus(r.status, b.action, b.action === 'cancel');
  const recipients = b.action === 'cancel' ? await reviewers(r.reviewers, req.admin._id) : [];
  if (next === 'cancel_requested' && !recipients.length) throw problem(409, 'No active approver remains. Contact your superadmin.');
  r.status = next; r.version += 1;
  r.history.push({ actor: req.admin._id, at: new Date(), status: next, note });
  notify(a, r, [a.employee, ...recipients.map(u => u._id)], req.admin.name, note);
  await a.save(); res.json({ message: `Leave ${next.replaceAll('_', ' ')}. Email notification queued.` });
});
exports.retryMail = run(async (req, res) => {
  const account = id(req.params.account), mail = id(req.params.mail);
  const result = await Account.updateOne({ _id: account, mail: { $elemMatch: { _id: mail, status: 'failed' } } }, { $set: { 'mail.$.status': 'queued', 'mail.$.attempts': 0, 'mail.$.nextAt': new Date(), 'mail.$.error': '' } });
  if (!result.modifiedCount) throw problem(409, 'Only a failed notification can be retried. Refresh first.');
  res.json({ message: 'Notification queued for retry.' });
});
