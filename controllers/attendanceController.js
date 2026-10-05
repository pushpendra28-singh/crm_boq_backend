const Attendance = require("../models/Attendance");
const AttendanceOffice = require("../models/AttendanceOffice");
const WorkFromHomeSetting = require("../models/WorkFromHomeSetting");
const defaults = require("../config/attendance");
const { AttendanceError, verifyLocation, verifyWfhLocation, getShiftContext } = require("../utils/attendance");

async function getOffice() {
  const office = await AttendanceOffice.findOne({ key: defaults.key }).lean();
  if (!office || !office.isActive) {
    throw new AttendanceError("OFFICE_UNAVAILABLE", "Attendance office is currently unavailable. Please contact your administrator.", 503);
  }
  return office;
}
function inputWorkMode(body) {
  const value = body?.workMode ?? "office";
  if (value !== "office" && value !== "wfh") {
    throw new AttendanceError("INVALID_WORK_MODE", "Work mode must be office or wfh.");
  }
  return value;
}

async function getWfhSetting(employeeId) {
  return WorkFromHomeSetting.findOne({ employeeId }).lean();
}

function inputLocation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AttendanceError("INVALID_LOCATION", "Latitude, longitude and accuracy are required.");
  }
  // No request-supplied employee ID, timestamp, office or distance is trusted.
  return { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy };
}
function present(record) {
  if (!record) return null;
  return {
    id: record._id,
    attendanceDate: record.attendanceDate,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    attendanceStatus: record.attendanceStatus || "present",
    workMode: record.workMode || "office",
    wfhType: record.workMode === "wfh" ? record.wfhType || "full_day" : null,
    arrivalStatus: record.attendanceStatus === "absent" ? null : record.arrivalStatus,
    completionStatus: record.checkOut ? "completed" : "incomplete",
    workingMinutes: record.attendanceStatus === "absent" ? 0 : record.checkOut
      ? Math.max(0, Math.floor((new Date(record.checkOut.at) - new Date(record.checkIn.at)) / 60000)) : null,
    earlyDeparture: record.checkOut
      ? new Date(record.checkOut.at) < new Date(record.shiftSnapshot.scheduledCheckOut) : false,
  };
}
function fail(res, error, action) {
  if (error instanceof AttendanceError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, details: error.details });
  }
  // Log only classification, not GPS, tokens or employee records.
  console.error(`Attendance ${action} failed:`, error.name, error.code || "UNKNOWN");
  return res.status(500).json({ success: false, code: "ATTENDANCE_ERROR",
    message: "Unable to process attendance. Refresh today's status before trying again." });
}
exports.getToday = async (req, res) => {
  try {
    const office = await getOffice();
    const now = new Date();
    const shift = getShiftContext(now, office);
    const [record, wfhSetting] = await Promise.all([
      Attendance.findOne({ employeeId: req.admin._id, attendanceDate: shift.attendanceDate }).lean(),
      getWfhSetting(req.admin._id),
    ]);
    return res.status(200).json({ success: true, message: "Today's attendance fetched successfully.",
      serverTime: now, attendanceDate: shift.attendanceDate,
      workMode: record?.workMode || "office",
      wfh: { enabled: Boolean(wfhSetting?.enabled), dayType: wfhSetting?.enabled ? (wfhSetting.dayType || "full_day") : null },
      office: { name: office.name, latitude: office.latitude, longitude: office.longitude,
        radiusMeters: office.radiusMeters, maxAccuracyMeters: office.maxAccuracyMeters,
        timezone: office.timezone, checkInTime: office.checkInTime, checkOutTime: office.checkOutTime,
        graceMinutes: office.graceMinutes },
      attendance: record?.deletedAt ? null : present(record), nextAction: record?.deletedAt || record?.attendanceStatus === "absent" ? "completed" : !record ? "check_in" : record.checkOut ? "completed" : "check_out",
      actionBlocked: !!record?.deletedAt || record?.attendanceStatus === "absent",
      actionMessage: record?.deletedAt ? "Today’s record was removed by an administrator. Contact your administrator for assistance." : record?.attendanceStatus === "absent" ? "Today is marked absent by an administrator." : null });
  } catch (error) { return fail(res, error, "today"); }
};
exports.checkIn = async (req, res) => {
  try {
    const office = await getOffice();
    const workMode = inputWorkMode(req.body);
    const now = new Date();
    const shift = getShiftContext(now, office);

    let location;
    let wfhType = null;

    if (workMode === "wfh") {
      const setting = await getWfhSetting(req.admin._id);
      if (!setting?.enabled) {
        throw new AttendanceError("WFH_NOT_ALLOWED", "Work From Home is not enabled for your account.", 403);
      }
      wfhType = setting.dayType || "full_day";
      location = verifyWfhLocation(inputLocation(req.body), office.maxAccuracyMeters);
    } else {
      location = verifyLocation(inputLocation(req.body), office);
    }

    let record;
    try {
      record = await Attendance.create({
        employeeId: req.admin._id, officeId: office._id, attendanceDate: shift.attendanceDate,
        workMode, wfhType,
        shiftSnapshot: {
          timezone: office.timezone, scheduledCheckIn: shift.scheduledCheckIn,
          scheduledCheckOut: shift.scheduledCheckOut, graceEndsAt: shift.graceEndsAt,
          latitude: office.latitude, longitude: office.longitude, radiusMeters: office.radiusMeters,
          maxAccuracyMeters: office.maxAccuracyMeters,
        },
        checkIn: { at: now, originalAt: now, location }, arrivalStatus: shift.arrivalStatus,
      });
    } catch (error) {
      if (error.code === 11000) {
        throw new AttendanceError("ALREADY_CHECKED_IN", "You have already checked in today. Refresh your attendance status before trying again.", 409);
      }
      throw error;
    }
    return res.status(201).json({ success: true, message: workMode === "wfh" ? "WFH check-in recorded successfully." : "Checked in successfully.",
      serverTime: now, attendance: present(record), nextAction: "check_out" });
  } catch (error) { return fail(res, error, "check-in"); }
};

exports.checkOut = async (req, res) => {
  try {
    const office = await getOffice();
    const now = new Date();
    const { attendanceDate } = getShiftContext(now, office);
    const filter = { employeeId: req.admin._id, attendanceDate };
    const current = await Attendance.findOne(filter).lean();
    if (!current) throw new AttendanceError("CHECK_IN_REQUIRED", "Check in today before checking out. Previous-day records cannot be checked out here.", 409);
    if (current.deletedAt || current.attendanceStatus === "absent") throw new AttendanceError("ATTENDANCE_LOCKED", "This record was removed or marked absent. Contact your administrator.", 409);
    if (current.checkOut) throw new AttendanceError("ALREADY_CHECKED_OUT", "You have already checked out today.", 409);
    // Use the work mode captured at check-in for this attendance day.
    const location = current.workMode === "wfh"
      ? verifyWfhLocation(inputLocation(req.body), current.shiftSnapshot.maxAccuracyMeters)
      : verifyLocation(inputLocation(req.body), { ...current.shiftSnapshot, isActive: true });
    if (now < new Date(current.checkIn.at)) {
      throw new AttendanceError("INVALID_CHECK_OUT_TIME", "Check-out cannot be before check-in. Please contact your administrator.", 409);
    }
    const record = await Attendance.findOneAndUpdate(
      { ...filter, _id: current._id, __v: current.__v, deletedAt: null, attendanceStatus: { $ne: "absent" }, checkOut: null, "checkIn.at": current.checkIn.at },
      { $set: { checkOut: { at: now, originalAt: now, location } }, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (!record) throw new AttendanceError("ATTENDANCE_CHANGED", "Attendance was already updated. Refresh today's status.", 409);
    return res.status(200).json({ success: true, message: current.workMode === "wfh" ? "WFH check-out recorded successfully." : "Checked out successfully.",
      serverTime: now, attendance: present(record), nextAction: "completed" });
  } catch (error) { return fail(res, error, "check-out"); }
};

exports.getMyHistory = async (req, res) => {
  try {
    const currentMonth = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());

    const month = req.query.month ?? currentMonth;

    if (
      typeof month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      Number(month.slice(0, 4)) < 2000 ||
      Number(month.slice(0, 4)) > 2100
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid month in YYYY-MM format.",
      });
    }

    const [year, monthNumber] = month.split("-").map(Number);

    const nextMonth =
      monthNumber === 12
        ? `${year + 1}-01`
        : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;

    const records = await Attendance.find({
      // Always use the authenticated user, never a request employeeId.
      employeeId: req.admin._id,
      deletedAt: null,
      attendanceDate: {
        $gte: `${month}-01`,
        $lt: `${nextMonth}-01`,
      },
    })
      .select("attendanceDate checkIn checkOut arrivalStatus attendanceStatus workMode wfhType")
      .sort({ attendanceDate: -1 })
      .lean();

    const attendance = records.map((record) => {
      const checkInAt = record.attendanceStatus === "absent" ? null : record.checkIn?.at ?? null;
      const checkOutAt = record.attendanceStatus === "absent" ? null : record.checkOut?.at ?? null;

      return {
        id: record._id,
        attendanceDate: record.attendanceDate,
        checkInAt,
        checkOutAt,
        attendanceStatus: record.attendanceStatus || "present",
        workMode: record.workMode || "office",
        wfhType: record.workMode === "wfh" ? record.wfhType || "full_day" : null,
        checkInLocation: record.attendanceStatus === "absent" ? null : record.checkIn?.location || null,
        checkOutLocation: record.attendanceStatus === "absent" ? null : record.checkOut?.location || null,
    arrivalStatus: record.attendanceStatus === "absent" ? null : record.arrivalStatus,
        workingMinutes:
          record.attendanceStatus === "absent" ? 0 : checkInAt && checkOutAt
            ? Math.max(
                0,
                Math.floor(
                  (new Date(checkOutAt) - new Date(checkInAt)) / 60000
                )
              )
            : null,
      };
    });

    return res.status(200).json({
      success: true,
      month,
      attendance,
    });
  } catch (error) {
    console.error("Attendance history failed:", error.name);

    return res.status(500).json({
      success: false,
      message: "Unable to load attendance records. Please try again.",
    });
  }
};




// const Attendance = require("../models/Attendance");
// const AttendanceOffice = require("../models/AttendanceOffice");
// const defaults = require("../config/attendance");
// const { AttendanceError, verifyLocation, getShiftContext } = require("../utils/attendance");

// async function getOffice() {
//   const office = await AttendanceOffice.findOne({ key: defaults.key }).lean();
//   if (!office || !office.isActive) {
//     throw new AttendanceError("OFFICE_UNAVAILABLE", "Attendance office is currently unavailable. Please contact your administrator.", 503);
//   }
//   return office;
// }
// function inputLocation(body) {
//   if (!body || typeof body !== "object" || Array.isArray(body)) {
//     throw new AttendanceError("INVALID_LOCATION", "Latitude, longitude and accuracy are required.");
//   }
//   // No request-supplied employee ID, timestamp, office or distance is trusted.
//   return { latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy };
// }
// function present(record) {
//   if (!record) return null;
//   return {
//     id: record._id,
//     attendanceDate: record.attendanceDate,
//     checkIn: record.checkIn,
//     checkOut: record.checkOut,
//     attendanceStatus: record.attendanceStatus || "present",
//     arrivalStatus: record.attendanceStatus === "absent" ? null : record.arrivalStatus,
//     completionStatus: record.checkOut ? "completed" : "incomplete",
//     workingMinutes: record.attendanceStatus === "absent" ? 0 : record.checkOut
//       ? Math.max(0, Math.floor((new Date(record.checkOut.at) - new Date(record.checkIn.at)) / 60000)) : null,
//     earlyDeparture: record.checkOut
//       ? new Date(record.checkOut.at) < new Date(record.shiftSnapshot.scheduledCheckOut) : false,
//   };
// }
// function fail(res, error, action) {
//   if (error instanceof AttendanceError) {
//     return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, details: error.details });
//   }
//   // Log only classification, not GPS, tokens or employee records.
//   console.error(`Attendance ${action} failed:`, error.name, error.code || "UNKNOWN");
//   return res.status(500).json({ success: false, code: "ATTENDANCE_ERROR",
//     message: "Unable to process attendance. Refresh today's status before trying again." });
// }
// exports.getToday = async (req, res) => {
//   try {
//     const office = await getOffice();
//     const now = new Date();
//     const shift = getShiftContext(now, office);
//     const record = await Attendance.findOne({ employeeId: req.admin._id, attendanceDate: shift.attendanceDate }).lean();
//     return res.status(200).json({ success: true, message: "Today's attendance fetched successfully.",
//       serverTime: now, attendanceDate: shift.attendanceDate,
//       office: { name: office.name, latitude: office.latitude, longitude: office.longitude,
//         radiusMeters: office.radiusMeters, maxAccuracyMeters: office.maxAccuracyMeters,
//         timezone: office.timezone, checkInTime: office.checkInTime, checkOutTime: office.checkOutTime,
//         graceMinutes: office.graceMinutes },
//       attendance: record?.deletedAt ? null : present(record), nextAction: record?.deletedAt || record?.attendanceStatus === "absent" ? "completed" : !record ? "check_in" : record.checkOut ? "completed" : "check_out",
//       actionBlocked: !!record?.deletedAt || record?.attendanceStatus === "absent",
//       actionMessage: record?.deletedAt ? "Today’s record was removed by an administrator. Contact your administrator for assistance." : record?.attendanceStatus === "absent" ? "Today is marked absent by an administrator." : null });
//   } catch (error) { return fail(res, error, "today"); }
// };
// exports.checkIn = async (req, res) => {
//   try {
//     const office = await getOffice();
//     const location = verifyLocation(inputLocation(req.body), office);
//     const now = new Date();
//     const shift = getShiftContext(now, office);
//     let record;
//     try {
//       record = await Attendance.create({
//         employeeId: req.admin._id, officeId: office._id, attendanceDate: shift.attendanceDate,
//         shiftSnapshot: {
//           timezone: office.timezone, scheduledCheckIn: shift.scheduledCheckIn,
//           scheduledCheckOut: shift.scheduledCheckOut, graceEndsAt: shift.graceEndsAt,
//           latitude: office.latitude, longitude: office.longitude, radiusMeters: office.radiusMeters,
//           maxAccuracyMeters: office.maxAccuracyMeters,
//         },
//         checkIn: { at: now, originalAt: now, location }, arrivalStatus: shift.arrivalStatus,
//       });
//     } catch (error) {
//       if (error.code === 11000) {
//         throw new AttendanceError("ALREADY_CHECKED_IN", "You have already checked in today. Refresh your attendance status.", 409);
//       }
//       throw error;
//     }
//     return res.status(201).json({ success: true, message: "Checked in successfully.",
//       serverTime: now, attendance: present(record), nextAction: "check_out" });
//   } catch (error) { return fail(res, error, "check-in"); }
// };
// exports.checkOut = async (req, res) => {
//   try {
//     const office = await getOffice();
//     const now = new Date();
//     const { attendanceDate } = getShiftContext(now, office);
//     const filter = { employeeId: req.admin._id, attendanceDate };
//     const current = await Attendance.findOne(filter).lean();
//     if (!current) throw new AttendanceError("CHECK_IN_REQUIRED", "Check in today before checking out. Previous-day records cannot be checked out here.", 409);
//     if (current.deletedAt || current.attendanceStatus === "absent") throw new AttendanceError("ATTENDANCE_LOCKED", "This record was removed or marked absent. Contact your administrator.", 409);
//     if (current.checkOut) throw new AttendanceError("ALREADY_CHECKED_OUT", "You have already checked out today.", 409);
//     // Use the office policy captured at check-in for this attendance day.
//     const location = verifyLocation(inputLocation(req.body), { ...current.shiftSnapshot, isActive: true });
//     if (now < new Date(current.checkIn.at)) {
//       throw new AttendanceError("INVALID_CHECK_OUT_TIME", "Check-out cannot be before check-in. Please contact your administrator.", 409);
//     }
//     const record = await Attendance.findOneAndUpdate(
//       { ...filter, _id: current._id, __v: current.__v, deletedAt: null, attendanceStatus: { $ne: "absent" }, checkOut: null, "checkIn.at": current.checkIn.at },
//       { $set: { checkOut: { at: now, originalAt: now, location } }, $inc: { __v: 1 } },
//       { new: true, runValidators: true }
//     );
//     if (!record) throw new AttendanceError("ATTENDANCE_CHANGED", "Attendance was already updated. Refresh today's status.", 409);
//     return res.status(200).json({ success: true, message: "Checked out successfully.",
//       serverTime: now, attendance: present(record), nextAction: "completed" });
//   } catch (error) { return fail(res, error, "check-out"); }
// };

// exports.getMyHistory = async (req, res) => {
//   try {
//     const currentMonth = new Intl.DateTimeFormat("en-CA", {
//       timeZone: "Asia/Kolkata",
//       year: "numeric",
//       month: "2-digit",
//     }).format(new Date());

//     const month = req.query.month ?? currentMonth;

//     if (
//       typeof month !== "string" ||
//       !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
//       Number(month.slice(0, 4)) < 2000 ||
//       Number(month.slice(0, 4)) > 2100
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide a valid month in YYYY-MM format.",
//       });
//     }

//     const [year, monthNumber] = month.split("-").map(Number);

//     const nextMonth =
//       monthNumber === 12
//         ? `${year + 1}-01`
//         : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;

//     const records = await Attendance.find({
//       // Always use the authenticated user, never a request employeeId.
//       employeeId: req.admin._id,
//       deletedAt: null,
//       attendanceDate: {
//         $gte: `${month}-01`,
//         $lt: `${nextMonth}-01`,
//       },
//     })
//       .select("attendanceDate checkIn.at checkOut.at arrivalStatus attendanceStatus")
//       .sort({ attendanceDate: -1 })
//       .lean();

//     const attendance = records.map((record) => {
//       const checkInAt = record.attendanceStatus === "absent" ? null : record.checkIn?.at ?? null;
//       const checkOutAt = record.attendanceStatus === "absent" ? null : record.checkOut?.at ?? null;

//       return {
//         id: record._id,
//         attendanceDate: record.attendanceDate,
//         checkInAt,
//         checkOutAt,
//         attendanceStatus: record.attendanceStatus || "present",
//     arrivalStatus: record.attendanceStatus === "absent" ? null : record.arrivalStatus,
//         workingMinutes:
//           record.attendanceStatus === "absent" ? 0 : checkInAt && checkOutAt
//             ? Math.max(
//                 0,
//                 Math.floor(
//                   (new Date(checkOutAt) - new Date(checkInAt)) / 60000
//                 )
//               )
//             : null,
//       };
//     });

//     return res.status(200).json({
//       success: true,
//       month,
//       attendance,
//     });
//   } catch (error) {
//     console.error("Attendance history failed:", error.name);

//     return res.status(500).json({
//       success: false,
//       message: "Unable to load attendance records. Please try again.",
//     });
//   }
// };
