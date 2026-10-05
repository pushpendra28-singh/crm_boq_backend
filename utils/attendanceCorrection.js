const { AttendanceError } = require('./attendance');
const bad = (message) => { throw new AttendanceError('INVALID_CORRECTION', message); };
function day(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) bad('Date must be YYYY-MM-DD between 2000 and 2099.');
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value) bad('Please enter a valid calendar date.');
  return value;
}
function istDay(now = new Date()) { return new Date(now.getTime() + 19800000).toISOString().slice(0,10); }
function reason(value) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 1000) bad('Provide a reason between 3 and 1000 characters.');
  return value.trim();
}
function clock(d, value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) bad('Time must use HH:mm or HH:mm:ss (IST).');
  return new Date(`${d}T${value.length === 5 ? value + ':00' : value}+05:30`);
}
function snapshot(record) {
  return { attendanceDate: record.attendanceDate, attendanceStatus: record.attendanceStatus || 'present',
    checkIn: record.checkIn, checkOut: record.checkOut, arrivalStatus: record.arrivalStatus,
    shiftSnapshot: record.shiftSnapshot, deletedAt: record.deletedAt || null };
}
function correction(record, body, now = new Date()) {
  const date = day(body.attendanceDate);
  if (date > istDay(now)) bad('Future attendance dates are not allowed.');
  if (!['present','half_day','absent'].includes(body.attendanceStatus)) bad('Status must be present, half day, or absent.');
  const why = reason(body.reason);
  const oldDay = new Date(`${record.attendanceDate}T00:00:00+05:30`);
  const delta = new Date(`${date}T00:00:00+05:30`) - oldDay;
  const shift = { ...record.shiftSnapshot };
  for (const key of ['scheduledCheckIn','scheduledCheckOut','graceEndsAt']) shift[key] = new Date(new Date(shift[key]).getTime() + delta);
  let checkIn = record.checkIn, checkOut = record.checkOut;
  
  if (["present", "half_day"].includes(body.attendanceStatus)) {
    const at = clock(date, body.checkInTime);
    const out = body.checkOutTime === '' || body.checkOutTime == null ? null : clock(date, body.checkOutTime);
    if (at > now || (out && out > now)) bad('Attendance times cannot be in the future.');
    if (out && out < at) bad('Check-out cannot be before check-in.');
    checkIn = { ...record.checkIn, at };
    checkOut = out ? { ...(record.checkOut || { originalAt: null, location: null }), at: out } : null;
  }
  // For absence keep captured punches as audit evidence; APIs suppress effective times.
  return { reason: why, update: { attendanceDate: date, attendanceStatus: body.attendanceStatus,
    checkIn, checkOut, shiftSnapshot: shift,
    arrivalStatus: new Date(checkIn.at) > shift.graceEndsAt ? 'late' : 'on_time' } };
}
module.exports = { day, istDay, reason, correction, snapshot };
