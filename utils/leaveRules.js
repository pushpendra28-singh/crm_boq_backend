const ACTIVE = new Set(['pending', 'under_review', 'approved', 'cancel_requested']);
function problem(status, message) { const error = new Error(message); error.status = status; return error; }
function dateKey(value) {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function range(from, to, portion) {
  if (!dateKey(from) || !dateKey(to) || from > to) throw problem(400, 'Select valid start and end dates.');
  if (from.slice(0, 4) !== to.slice(0, 4)) throw problem(400, 'Submit separate requests for each calendar year.');
  if (!['full', 'first_half', 'second_half'].includes(portion)) throw problem(400, 'Select a valid leave duration.');
  if (portion !== 'full' && from !== to) throw problem(400, 'Half-day leave must be for one date.');
  return Number(from.slice(0, 4));
}
function balances(account, typeId) {
  const allocated = account.allocations.find(a => String(a.typeId) === String(typeId))?.units || 0;
  let used = 0, reserved = 0;
  for (const r of account.requests) {
    if (!r.paid || String(r.typeId) !== String(typeId)) continue;
    if (['approved', 'cancel_requested'].includes(r.status)) used += r.units;
    if (['pending', 'under_review'].includes(r.status)) reserved += r.units;
  }
  return { allocated, used, reserved, available: allocated - used - reserved };
}
function overlaps(account, days, portion) {
  return account.requests.some(r => ACTIVE.has(r.status) && r.days.some(d => days.some(n => n.date === d.date) &&
    (portion === 'full' || r.portion === 'full' || portion === r.portion)));
}
function nextStatus(status, action, owner) {
  if (owner) {
    if (action === 'cancel' && ['pending', 'under_review'].includes(status)) return 'cancelled';
    if (action === 'cancel' && status === 'approved') return 'cancel_requested';
  } else {
    if (['pending', 'under_review'].includes(status)) {
      if (action === 'approve') return 'approved';
      if (action === 'reject') return 'rejected';
      if (action === 'review' && status !== 'under_review') return 'under_review';
      if (action === 'pending' && status !== 'pending') return 'pending';
    }
    if (status === 'cancel_requested') {
      if (action === 'approve_cancel') return 'cancelled';
      if (action === 'deny_cancel') return 'approved';
    }
  }
  throw problem(409, 'This action is not available for the current request status. Refresh and try again.');
}
module.exports = { problem, dateKey, range, balances, overlaps, nextStatus };
