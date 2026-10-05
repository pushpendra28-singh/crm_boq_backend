const LeaveAccount = require('../models/LeaveAccount');
const EFFECTIVE_STATUSES = ['approved', 'cancel_requested'];

// Only charged dates from the saved approval snapshot count as leave.
// Reasons, email jobs, balances and approver details never leave this service.
function projectLeaveDays(requests, from, to) {
  const dates = new Map();
  for (const request of requests) {
    if (!EFFECTIVE_STATUSES.includes(request.status)) continue;
    for (const day of request.days || []) {
      if (day.date < from || day.date > to) continue;
      if (![0.5, 1].includes(day.units) || !['full', 'first_half', 'second_half'].includes(request.portion)) {
        throw new Error('Invalid saved leave day.');
      }
      const entries = dates.get(day.date) || [];
      entries.push({
        requestId: String(request._id),
        typeName: request.typeName,
        paid: request.paid,
        portion: request.portion,
        units: day.units,
        cancellationPending: request.status === 'cancel_requested',
      });
      dates.set(day.date, entries);
    }
  }
  return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, leaves]) => {
    const units = leaves.reduce((total, item) => total + item.units, 0);
    const portions = leaves.map(item => item.portion);
    const conflict = units > 1 || new Set(portions).size !== portions.length || (portions.includes('full') && portions.length > 1);
    return { date, leaves, units, paidUnits: leaves.filter(item => item.paid).reduce((total, item) => total + item.units, 0), conflict };
  });
}
async function getEmployeeLeaveDays(employeeId, from, to) {
  const accounts = await LeaveAccount.find({
    employee: employeeId,
    year: { $gte: Number(from.slice(0, 4)), $lte: Number(to.slice(0, 4)) },
    requests: { $elemMatch: { status: { $in: EFFECTIVE_STATUSES }, 'days.date': { $gte: from, $lte: to } } },
  }).select('requests._id requests.typeName requests.paid requests.portion requests.status requests.days').lean();
  return projectLeaveDays(accounts.flatMap(account => account.requests), from, to);
}
module.exports = { getEmployeeLeaveDays, projectLeaveDays };
