const mongoose = require('mongoose');
const { getEmployeeLeaveDays } = require('../services/attendanceLeaveService');
exports.getLeaveDays = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { month, employeeId } = req.query;
  if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ success: false, message: 'Select a valid month between 2000-01 and 2099-12.' });
  }
  if (typeof employeeId !== 'string' || !mongoose.isObjectIdOrHexString(employeeId)) {
    return res.status(400).json({ success: false, message: 'Select a valid employee.' });
  }
  const [year, number] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
  try {
    const days = await getEmployeeLeaveDays(employeeId, from, to);
    res.json({ success: true, employeeId, month, days });
  } catch (error) {
    console.error('Attendance leave lookup failed:', error.name);
    res.status(500).json({ success: false, message: 'Unable to load approved leaves. Please refresh the calendar.' });
  }
};
