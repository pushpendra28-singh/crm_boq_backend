const Holiday = require('../models/Holiday');
const WeeklyOffPolicy = require('../models/WeeklyOffPolicy');
const { buildWeeklyOffPreview } = require('../utils/weeklyOffCalculator');

exports.getSchedule = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { month } = req.query;
  if (typeof month !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ success: false, message: 'Month must be YYYY-MM between 2000-01 and 2099-12.' });
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  try {
    const [holidays, previous, changes] = await Promise.all([
      Holiday.find({ isDeleted: false, date: { $gte: from, $lte: to } }).select('name date').lean(),
      WeeklyOffPolicy.findOne({ effectiveFrom: { $lt: from } }).sort({ effectiveFrom: -1 }).select('effectiveFrom rules').lean(),
      WeeklyOffPolicy.find({ effectiveFrom: { $gte: from, $lte: to } }).sort({ effectiveFrom: 1 }).select('effectiveFrom rules').lean(),
    ]);
    const holidaysByDate = new Map(holidays.map(item => [item.date, item.name]));
    const policies = previous ? [previous, ...changes] : changes;
    const days = buildWeeklyOffPreview(from, to, policies).map(day => ({
      date: day.date,
      holidayName: holidaysByDate.get(day.date) || null,
      isWeeklyOff: day.status === 'weekly_off',
      weeklyOffConfigured: day.status !== 'not_configured',
    }));
    return res.json({ success: true, month, days });
  } catch (error) {
    console.error('Attendance schedule error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load holidays and weekly offs. Please refresh the calendar.' });
  }
};
