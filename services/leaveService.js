const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Role = require('../models/Role');
const Account = require('../models/LeaveAccount');
const Holiday = require('../models/Holiday');
const Policy = require('../models/WeeklyOffPolicy');
const { buildWeeklyOffPreview } = require('../utils/weeklyOffCalculator');
const { problem, range } = require('../utils/leaveRules');
async function allowed(user, permission) {
  if (user.role === 'superadmin') return true;
  if (Array.isArray(user.permissions) && user.permissions.length) return user.permissions.includes(permission);
  const escaped = user.role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const role = await Role.findOne({ $or: [{ slug: user.role }, { name: new RegExp(`^${escaped}$`, 'i') }] }).lean();
  return role?.permissions?.includes(permission) || false;
}
async function reviewers(ids, applicant) {
  const users = await Admin.find({ _id: { $in: ids }, isActive: true }).select('name email role permissions');
  const result = [];
  for (const user of users) if (String(user._id) !== String(applicant) && await allowed(user, 'approve_leaves')) result.push(user);
  return result;
}
async function calculate(settings, body) {
  range(body.from, body.to, body.portion);
  const type = settings.types.find(t => String(t._id) === String(body.typeId) && t.active);
  if (!type) throw problem(400, 'Select an active leave type.');
  if (body.portion !== 'full' && !type.halfDay) throw problem(400, 'Half-day leave is not allowed for this type.');
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  if (!settings.allowPast && body.from < today) throw problem(400, 'Backdated leave is not allowed by company settings.');
  const [holidays, previous, changes] = await Promise.all([
    Holiday.find({ isDeleted: false, date: { $gte: body.from, $lte: body.to } }).select('date').lean(),
    Policy.findOne({ effectiveFrom: { $lt: body.from } }).sort({ effectiveFrom: -1 }).select('effectiveFrom rules').lean(),
    Policy.find({ effectiveFrom: { $gte: body.from, $lte: body.to } }).sort({ effectiveFrom: 1 }).select('effectiveFrom rules').lean(),
  ]);
  const schedule = buildWeeklyOffPreview(body.from, body.to, previous ? [previous, ...changes] : changes);
  if (schedule.some(d => d.status === 'not_configured')) throw problem(409, 'Weekly-off policy is missing for these dates. Contact your administrator.');
  const holidayDates = new Set(holidays.map(h => h.date));
  const days = schedule.filter(d => d.status !== 'weekly_off' && !holidayDates.has(d.date)).map(d => ({ date: d.date, units: body.portion === 'full' ? 1 : 0.5 }));
  const units = days.reduce((sum, d) => sum + d.units, 0);
  if (!units) throw problem(400, 'These dates contain only holidays or weekly offs. No leave is required.');
  return { type, days, units, excludedDays: schedule.length - days.length };
}
async function accountFor(employee, year) {
  try { await Account.updateOne({ employee, year }, { $setOnInsert: { employee, year, allocations: [], requests: [], mail: [], adjustments: [] } }, { upsert: true }); }
  catch (e) { if (e.code !== 11000) throw e; }
  return Account.findOne({ employee, year });
}
function notify(account, request, recipientIds, actorName, note) {
  const recipients = [...new Set(recipientIds.map(String))];
  for (const recipient of recipients) account.mail.push({
    _id: new mongoose.Types.ObjectId(), requestId: request._id, recipient,
    subject: `Leave ${request.status.replaceAll('_', ' ')} | ${request.from} – ${request.to}`,
    text: `${actorName} updated a leave request.\nReference: ${request._id}\nType: ${request.typeName} (${request.paid ? 'Paid' : 'Unpaid'})\nDates: ${request.from} to ${request.to}\nDuration: ${request.units} day(s), ${request.portion.replaceAll('_', ' ')}\nStatus: ${request.status.replaceAll('_', ' ')}\nNote: ${note}\n\nOpen the CRM to view the request. Sign-in and permission checks are required.`,
    status: 'queued', attempts: 0, nextAt: new Date(),
  });
}
module.exports = { allowed, reviewers, calculate, accountFor, notify };
