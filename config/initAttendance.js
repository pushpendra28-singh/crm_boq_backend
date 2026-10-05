const Attendance = require("../models/Attendance");
const AttendanceOffice = require("../models/AttendanceOffice");
const defaults = require("./attendance");

module.exports = async function initAttendance() {
  // Explicit index creation also works when production autoIndex is disabled.
  // Never use syncIndexes here: it could drop existing indexes.
  await AttendanceOffice.createIndexes();
  await Attendance.createIndexes();
  try {
  await AttendanceOffice.updateOne(
  { key: defaults.key },
  { $setOnInsert: { ...defaults } },
  { upsert: true, runValidators: true, timestamps: false }
);
  } catch (error) {
    // Another server may have initialized the same office concurrently.
    if (error.code !== 11000) throw error;
    if (!(await AttendanceOffice.exists({ key: defaults.key }))) throw error;
  }
  const office = await AttendanceOffice.findOne({ key: defaults.key });
  await office.validate();
};
