const mongoose = require("mongoose");
const Admin = require("../models/Admin");
const Attendance = require("../models/Attendance");
const LeaveAccount = require("../models/LeaveAccount");
const Holiday = require("../models/Holiday");
const WeeklyOffPolicy = require("../models/WeeklyOffPolicy");
const { buildWeeklyOffPreview } = require("../utils/weeklyOffCalculator");

const DATE_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;

function getMonthRange(month) {
  if (typeof month !== "string" || !DATE_RE.test(month)) {
    const error = new Error("Month must be in YYYY-MM format.");
    error.status = 400;
    throw error;
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return {
    year,
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
    totalDays: lastDay,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function normalizeEmployeeId(value) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    const error = new Error("Invalid employee ID.");
    error.status = 400;
    throw error;
  }
  return value;
}

function buildEmployeeFilter(search) {
  if (search === undefined) return {};
  if (typeof search !== "string" || search.length > 100) {
    const error = new Error("Employee search must be at most 100 characters.");
    error.status = 400;
    throw error;
  }

  const value = search.trim();
  if (!value) return {};

  const escaped = escapeRegex(value);
  return {
    $or: [
      { name: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ],
  };
}

function buildPolicyPromise(from, to) {
  return Promise.all([
    Holiday.find({
      isDeleted: false,
      date: { $gte: from, $lte: to },
    })
      .select("name date")
      .lean(),
    WeeklyOffPolicy.findOne({ effectiveFrom: { $lt: from } })
      .sort({ effectiveFrom: -1 })
      .select("effectiveFrom rules")
      .lean(),
    WeeklyOffPolicy.find({
      effectiveFrom: { $gte: from, $lte: to },
    })
      .sort({ effectiveFrom: 1 })
      .select("effectiveFrom rules")
      .lean(),
  ]);
}

function createDailySummary(date, attendance, leave, holidayName, weeklyOff, employed = true) {
  const hasAttendance = Boolean(
    employed && attendance && attendance.attendanceStatus !== "absent"
  );

  const leaveUnits = Math.min(1, Number(leave?.units || 0));
  const expectedWorkday = employed && !holidayName && !weeklyOff;
  const absenceUnits = expectedWorkday && !hasAttendance
    ? Math.max(0, 1 - leaveUnits)
    : 0;


     const isHalfDayAttendance =
  hasAttendance && attendance.attendanceStatus === "half_day";
  const workMode = hasAttendance ? (attendance.workMode || "office") : null;
  const wfhType = workMode === "wfh" ? (attendance.wfhType || "full_day") : null;
const attendanceUnits = hasAttendance
  ? isHalfDayAttendance ||
    (workMode === "wfh" && wfhType === "half_day")
    ? 0.5
    : 1
  : 0;

   

 let status = "absent";

if (!employed) {
  status = "not_employed";
} else if (isHalfDayAttendance) {
  status = "half_day";
} else if (hasAttendance) {
  status =
    attendance.arrivalStatus === "late"
      ? "late"
      : "present";
} else if (leaveUnits >= 1) {
  status = leave.paid ? "paid_leave" : "unpaid_leave";
} else if (leaveUnits > 0) {
  status = leave.paid
    ? "partial_paid_leave"
    : "partial_unpaid_leave";
} else if (holidayName) {
  status = "holiday";
} else if (weeklyOff) {
  status = "weekly_off";
}

  return {
    date,
    day: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
      timeZone: "UTC",
      weekday: "long",
    }),
    status,
    expectedWorkday,
    employed,
    holidayName: holidayName || null,
    isWeeklyOff: Boolean(weeklyOff),
    leave: leave
      ? {
          typeName: leave.typeName || "Leave",
          paid: Boolean(leave.paid),
          units: leaveUnits,
        }
      : null,
    attendance: hasAttendance
      ? {
          attendanceStatus: attendance.attendanceStatus || "present",
          workMode,
          wfhType,
          attendanceUnits,
          arrivalStatus: attendance.arrivalStatus || null,
          checkInLocation: attendance.checkIn?.location || null,
          checkOutLocation: attendance.checkOut?.location || null,
          checkInAt: attendance.checkIn?.at || null,
          checkOutAt: attendance.checkOut?.at || null,
          workingMinutes:
            attendance.checkOut?.at && attendance.checkIn?.at
              ? Math.max(
                  0,
                  Math.floor(
                    (new Date(attendance.checkOut.at) -
                      new Date(attendance.checkIn.at)) /
                      60000
                  )
                )
              : null,
          completionStatus: attendance.checkOut?.at ? "completed" : "incomplete",
        }
      : null,
    attendanceUnits,
    workMode,
    wfhType,
    absenceUnits,
  };
}

function emptySummary(totalDays) {
  return {
    totalDays,
    expectedWorkingDays: 0,
    presentDays: 0,
    halfDayDays: 0,
    lateDays: 0,
    absentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holidayDays: 0,
    weeklyOffDays: 0,
    incompleteAttendanceDays: 0,
    totalWorkingMinutes: 0,
    attendanceUnits: 0,
    wfhFullDays: 0,
    wfhHalfDays: 0,
    notEmployedDays: 0,
    nonWorkingDays: 0,
  };
}

function addDayToSummary(summary, day) {
  if (!day.employed) summary.notEmployedDays += 1;
  if (day.expectedWorkday) summary.expectedWorkingDays += 1;
  if (day.holidayName) summary.holidayDays += 1;
  if (day.isWeeklyOff) summary.weeklyOffDays += 1;
  if (day.attendance) {
  const isHalfDayAttendance =
    day.attendance.attendanceStatus === "half_day";

  const isWfhHalf =
    day.attendance.workMode === "wfh" &&
    day.attendance.wfhType === "half_day";

  const isPartialAttendance =
    isHalfDayAttendance || isWfhHalf;

  if (isPartialAttendance) {
    if (isHalfDayAttendance) {
      summary.halfDayDays += 1;
    }
  } else {
    summary.presentDays += 1;

    if (day.attendance.arrivalStatus === "late") {
      summary.lateDays += 1;
    }
  }

  summary.attendanceUnits +=
    Number(day.attendance.attendanceUnits || 0);

  if (day.attendance.workMode === "wfh") {
    if (day.attendance.wfhType === "half_day") {
      summary.wfhHalfDays += 1;
    } else {
      summary.wfhFullDays += 1;
    }
  }

  if (day.attendance.completionStatus === "incomplete") {
    summary.incompleteAttendanceDays += 1;
  }

  if (Number.isFinite(day.attendance.workingMinutes)) {
    summary.totalWorkingMinutes += day.attendance.workingMinutes;
  }
}
  if (day.leave?.paid) summary.paidLeaveDays += day.leave.units;
  if (day.leave && !day.leave.paid) summary.unpaidLeaveDays += day.leave.units;
  summary.absentDays += day.absenceUnits;
}

function finalizeSummary(summary, days) {
  summary.nonWorkingDays = days.filter((day) => !day.expectedWorkday).length;
  return summary;
}

async function loadMonthlySourceData(employeeIds, from, to) {
  const [attendance, leaves, policyData] = await Promise.all([
    Attendance.find({
      employeeId: { $in: employeeIds },
      deletedAt: null,
      attendanceDate: { $gte: from, $lte: to },
    })
      .select("employeeId attendanceDate attendanceStatus arrivalStatus workMode wfhType checkIn checkOut")
      .lean(),
    LeaveAccount.find({
      employee: { $in: employeeIds },
      requests: {
        $elemMatch: {
          status: "approved",
          "days.date": { $gte: from, $lte: to },
        },
      },
    })
      .select("employee requests")
      .lean(),
    buildPolicyPromise(from, to),
  ]);

  const [holidays, previousPolicy, changes] = policyData;
  const policies = previousPolicy ? [previousPolicy, ...changes] : changes;
  const weeklyOffDays = buildWeeklyOffPreview(from, to, policies);

  const holidaysByDate = new Map(
    holidays.map((holiday) => [holiday.date, holiday.name])
  );

  const weeklyOffByDate = new Map(
    weeklyOffDays.map((day) => [day.date, day.status === "weekly_off"])
  );

  const attendanceByEmployee = new Map();
  for (const item of attendance) {
    const employeeKey = String(item.employeeId);
    if (!attendanceByEmployee.has(employeeKey)) {
      attendanceByEmployee.set(employeeKey, new Map());
    }
    attendanceByEmployee.get(employeeKey).set(item.attendanceDate, item);
  }

  const leavesByEmployee = new Map();
  for (const account of leaves) {
    const employeeKey = String(account.employee);
    const dateMap = leavesByEmployee.get(employeeKey) || new Map();

    for (const request of account.requests || []) {
      if (request.status !== "approved") continue;

      for (const leaveDay of request.days || []) {
        if (leaveDay.date < from || leaveDay.date > to) continue;

        const previous = dateMap.get(leaveDay.date);
        const units = Number(leaveDay.units || 0);
        if (!previous) {
          dateMap.set(leaveDay.date, {
            typeName: request.typeName,
            paid: Boolean(request.paid),
            units,
          });
          continue;
        }

        previous.units = Math.min(1, previous.units + units);
      }
    }

    leavesByEmployee.set(employeeKey, dateMap);
  }

  return {
    holidaysByDate,
    weeklyOffByDate,
    attendanceByEmployee,
    leavesByEmployee,
  };
}

async function generateForEmployees(employees, month) {
  const { from, to, totalDays } = getMonthRange(month);
  const ids = employees.map((employee) => employee._id);

  const source = await loadMonthlySourceData(ids, from, to);

  return employees.map((employee) => {
    const employeeKey = String(employee._id);
    const attendanceMap = source.attendanceByEmployee.get(employeeKey) || new Map();
    const leaveMap = source.leavesByEmployee.get(employeeKey) || new Map();
    const days = [];
    const summary = emptySummary(totalDays);
    const joiningDate = dateKey(employee.employment?.joiningDate);
    const exitDate = dateKey(employee.employment?.exitDate);

    for (const [date, weeklyOff] of source.weeklyOffByDate) {
      const employed = (!joiningDate || date >= joiningDate) && (!exitDate || date <= exitDate);
      const day = createDailySummary(
        date,
        attendanceMap.get(date),
        leaveMap.get(date),
        source.holidaysByDate.get(date),
        weeklyOff,
        employed
      );
      days.push(day);
      addDayToSummary(summary, day);
    }

    days.sort((a, b) => a.date.localeCompare(b.date));
    finalizeSummary(summary, days);

    return {
      employee: {
        id: employee._id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        isActive: employee.isActive,
      },
      month,
      summary,
      days,
    };
  });
}

async function getMonthlyRecords({ month, search, page = 1, limit = 50, includeDays = false, }) {
  const filter = buildEmployeeFilter(search);
  const [total, employees] = await Promise.all([
    Admin.countDocuments(filter),
    Admin.find(filter)
      .select("name email role isActive employment.joiningDate employment.exitDate employment.currentlyWorking")
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const records = await generateForEmployees(employees, month);

  return {
    month,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    records: records.map((record) => ({
  employee: record.employee,
  month: record.month,
  summary: record.summary,
  ...(includeDays ? { days: record.days } : {}),
})),
  };
}

async function getEmployeeMonthlyRecord(employeeId, month) {
  normalizeEmployeeId(employeeId);
  const employee = await Admin.findById(employeeId)
    .select("name email role isActive employment.joiningDate employment.exitDate employment.currentlyWorking")
    .lean();

  if (!employee) {
    const error = new Error("Employee not found.");
    error.status = 404;
    throw error;
  }

  const [record] = await generateForEmployees([employee], month);
  return record;
}

module.exports = {
  getMonthlyRecords,
  getEmployeeMonthlyRecord,
  getMonthRange,
};




// const mongoose = require("mongoose");
// const Admin = require("../models/Admin");
// const Attendance = require("../models/Attendance");
// const LeaveAccount = require("../models/LeaveAccount");
// const Holiday = require("../models/Holiday");
// const WeeklyOffPolicy = require("../models/WeeklyOffPolicy");
// const { buildWeeklyOffPreview } = require("../utils/weeklyOffCalculator");

// const DATE_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;

// function getMonthRange(month) {
//   if (typeof month !== "string" || !DATE_RE.test(month)) {
//     const error = new Error("Month must be in YYYY-MM format.");
//     error.status = 400;
//     throw error;
//   }

//   const [year, monthNumber] = month.split("-").map(Number);
//   const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

//   return {
//     year,
//     from: `${month}-01`,
//     to: `${month}-${String(lastDay).padStart(2, "0")}`,
//     totalDays: lastDay,
//   };
// }

// function escapeRegex(value) {
//   return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// }

// function normalizeEmployeeId(value) {
//   if (!mongoose.isObjectIdOrHexString(value)) {
//     const error = new Error("Invalid employee ID.");
//     error.status = 400;
//     throw error;
//   }
//   return value;
// }

// function buildEmployeeFilter(search) {
//   if (search === undefined) return {};
//   if (typeof search !== "string" || search.length > 100) {
//     const error = new Error("Employee search must be at most 100 characters.");
//     error.status = 400;
//     throw error;
//   }

//   const value = search.trim();
//   if (!value) return {};

//   const escaped = escapeRegex(value);
//   return {
//     $or: [
//       { name: { $regex: escaped, $options: "i" } },
//       { email: { $regex: escaped, $options: "i" } },
//     ],
//   };
// }

// function buildPolicyPromise(from, to) {
//   return Promise.all([
//     Holiday.find({
//       isDeleted: false,
//       date: { $gte: from, $lte: to },
//     })
//       .select("name date")
//       .lean(),
//     WeeklyOffPolicy.findOne({ effectiveFrom: { $lt: from } })
//       .sort({ effectiveFrom: -1 })
//       .select("effectiveFrom rules")
//       .lean(),
//     WeeklyOffPolicy.find({
//       effectiveFrom: { $gte: from, $lte: to },
//     })
//       .sort({ effectiveFrom: 1 })
//       .select("effectiveFrom rules")
//       .lean(),
//   ]);
// }

// function createDailySummary(date, attendance, leave, holidayName, weeklyOff) {
//   const hasAttendance = Boolean(
//     attendance && attendance.attendanceStatus !== "absent"
//   );

//   const leaveUnits = Math.min(1, Number(leave?.units || 0));
//   const expectedWorkday = !holidayName && !weeklyOff;
//   const absenceUnits = expectedWorkday && !hasAttendance
//     ? Math.max(0, 1 - leaveUnits)
//     : 0;

//   let status = "absent";
//   if (hasAttendance) {
//     status = attendance.arrivalStatus === "late" ? "late" : "present";
//   } else if (leaveUnits >= 1) {
//     status = leave.paid ? "paid_leave" : "unpaid_leave";
//   } else if (leaveUnits > 0) {
//     status = leave.paid ? "partial_paid_leave" : "partial_unpaid_leave";
//   } else if (holidayName) {
//     status = "holiday";
//   } else if (weeklyOff) {
//     status = "weekly_off";
//   }

//   return {
//     date,
//     day: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
//       timeZone: "UTC",
//       weekday: "long",
//     }),
//     status,
//     expectedWorkday,
//     holidayName: holidayName || null,
//     isWeeklyOff: Boolean(weeklyOff),
//     leave: leave
//       ? {
//           typeName: leave.typeName || "Leave",
//           paid: Boolean(leave.paid),
//           units: leaveUnits,
//         }
//       : null,
//     attendance: hasAttendance
//       ? {
//           attendanceStatus: attendance.attendanceStatus || "present",
//           arrivalStatus: attendance.arrivalStatus || null,
//           checkInAt: attendance.checkIn?.at || null,
//           checkOutAt: attendance.checkOut?.at || null,
//           workingMinutes:
//             attendance.checkOut?.at && attendance.checkIn?.at
//               ? Math.max(
//                   0,
//                   Math.floor(
//                     (new Date(attendance.checkOut.at) -
//                       new Date(attendance.checkIn.at)) /
//                       60000
//                   )
//                 )
//               : null,
//           completionStatus: attendance.checkOut?.at ? "completed" : "incomplete",
//         }
//       : null,
//     absenceUnits,
//   };
// }

// function emptySummary(totalDays) {
//   return {
//     totalDays,
//     expectedWorkingDays: 0,
//     presentDays: 0,
//     lateDays: 0,
//     absentDays: 0,
//     paidLeaveDays: 0,
//     unpaidLeaveDays: 0,
//     holidayDays: 0,
//     weeklyOffDays: 0,
//     incompleteAttendanceDays: 0,
//     totalWorkingMinutes: 0,
//     nonWorkingDays: 0,
//   };
// }

// function addDayToSummary(summary, day) {
//   if (day.expectedWorkday) summary.expectedWorkingDays += 1;
//   if (day.holidayName) summary.holidayDays += 1;
//   if (day.isWeeklyOff) summary.weeklyOffDays += 1;
//   if (day.attendance) {
//     summary.presentDays += 1;
//     if (day.attendance.arrivalStatus === "late") summary.lateDays += 1;
//     if (day.attendance.completionStatus === "incomplete") {
//       summary.incompleteAttendanceDays += 1;
//     }
//     if (Number.isFinite(day.attendance.workingMinutes)) {
//       summary.totalWorkingMinutes += day.attendance.workingMinutes;
//     }
//   }
//   if (day.leave?.paid) summary.paidLeaveDays += day.leave.units;
//   if (day.leave && !day.leave.paid) summary.unpaidLeaveDays += day.leave.units;
//   summary.absentDays += day.absenceUnits;
// }

// function finalizeSummary(summary, days) {
//   summary.nonWorkingDays = days.filter((day) => !day.expectedWorkday).length;
//   return summary;
// }

// async function loadMonthlySourceData(employeeIds, from, to) {
//   const [attendance, leaves, policyData] = await Promise.all([
//     Attendance.find({
//       employeeId: { $in: employeeIds },
//       deletedAt: null,
//       attendanceDate: { $gte: from, $lte: to },
//     })
//       .select("employeeId attendanceDate attendanceStatus arrivalStatus checkIn.at checkOut.at")
//       .lean(),
//     LeaveAccount.find({
//       employee: { $in: employeeIds },
//       requests: {
//         $elemMatch: {
//           status: "approved",
//           "days.date": { $gte: from, $lte: to },
//         },
//       },
//     })
//       .select("employee requests")
//       .lean(),
//     buildPolicyPromise(from, to),
//   ]);

//   const [holidays, previousPolicy, changes] = policyData;
//   const policies = previousPolicy ? [previousPolicy, ...changes] : changes;
//   const weeklyOffDays = buildWeeklyOffPreview(from, to, policies);

//   const holidaysByDate = new Map(
//     holidays.map((holiday) => [holiday.date, holiday.name])
//   );

//   const weeklyOffByDate = new Map(
//     weeklyOffDays.map((day) => [day.date, day.status === "weekly_off"])
//   );

//   const attendanceByEmployee = new Map();
//   for (const item of attendance) {
//     const employeeKey = String(item.employeeId);
//     if (!attendanceByEmployee.has(employeeKey)) {
//       attendanceByEmployee.set(employeeKey, new Map());
//     }
//     attendanceByEmployee.get(employeeKey).set(item.attendanceDate, item);
//   }

//   const leavesByEmployee = new Map();
//   for (const account of leaves) {
//     const employeeKey = String(account.employee);
//     const dateMap = leavesByEmployee.get(employeeKey) || new Map();

//     for (const request of account.requests || []) {
//       if (request.status !== "approved") continue;

//       for (const leaveDay of request.days || []) {
//         if (leaveDay.date < from || leaveDay.date > to) continue;

//         const previous = dateMap.get(leaveDay.date);
//         const units = Number(leaveDay.units || 0);
//         if (!previous) {
//           dateMap.set(leaveDay.date, {
//             typeName: request.typeName,
//             paid: Boolean(request.paid),
//             units,
//           });
//           continue;
//         }

//         previous.units = Math.min(1, previous.units + units);
//       }
//     }

//     leavesByEmployee.set(employeeKey, dateMap);
//   }

//   return {
//     holidaysByDate,
//     weeklyOffByDate,
//     attendanceByEmployee,
//     leavesByEmployee,
//   };
// }

// async function generateForEmployees(employees, month) {
//   const { from, to, totalDays } = getMonthRange(month);
//   const ids = employees.map((employee) => employee._id);

//   const source = await loadMonthlySourceData(ids, from, to);

//   return employees.map((employee) => {
//     const employeeKey = String(employee._id);
//     const attendanceMap = source.attendanceByEmployee.get(employeeKey) || new Map();
//     const leaveMap = source.leavesByEmployee.get(employeeKey) || new Map();
//     const days = [];
//     const summary = emptySummary(totalDays);

//     for (const [date, weeklyOff] of source.weeklyOffByDate) {
//       const day = createDailySummary(
//         date,
//         attendanceMap.get(date),
//         leaveMap.get(date),
//         source.holidaysByDate.get(date),
//         weeklyOff
//       );
//       days.push(day);
//       addDayToSummary(summary, day);
//     }

//     days.sort((a, b) => a.date.localeCompare(b.date));
//     finalizeSummary(summary, days);

//     return {
//       employee: {
//         id: employee._id,
//         name: employee.name,
//         email: employee.email,
//         role: employee.role,
//         isActive: employee.isActive,
//       },
//       month,
//       summary,
//       days,
//     };
//   });
// }

// async function getMonthlyRecords({ month, search, page = 1, limit = 50 }) {
//   const filter = buildEmployeeFilter(search);
//   const [total, employees] = await Promise.all([
//     Admin.countDocuments(filter),
//     Admin.find(filter)
//       .select("name email role isActive")
//       .sort({ name: 1, _id: 1 })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean(),
//   ]);

//   const records = await generateForEmployees(employees, month);

//   return {
//     month,
//     page,
//     limit,
//     total,
//     pages: Math.max(1, Math.ceil(total / limit)),
//     records: records.map((record) => ({
//       employee: record.employee,
//       month: record.month,
//       summary: record.summary,
//     })),
//   };
// }

// async function getEmployeeMonthlyRecord(employeeId, month) {
//   normalizeEmployeeId(employeeId);
//   const employee = await Admin.findById(employeeId)
//     .select("name email role isActive")
//     .lean();

//   if (!employee) {
//     const error = new Error("Employee not found.");
//     error.status = 404;
//     throw error;
//   }

//   const [record] = await generateForEmployees([employee], month);
//   return record;
// }

// module.exports = {
//   getMonthlyRecords,
//   getEmployeeMonthlyRecord,
//   getMonthRange,
// };
