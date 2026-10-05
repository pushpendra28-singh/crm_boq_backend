function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clamp(value, min = 0, max = Number.POSITIVE_INFINITY) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function dateAtUtc(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function safeDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isLeaveAnchor(day) {
  return Boolean(day?.leave && Number(day.leave.units || 0) > 0);
}

function isSandwichCandidate(day) {
  return Boolean(
    day &&
      day.employed !== false &&
      !day.expectedWorkday &&
      (day.status === "holiday" || day.status === "weekly_off")
  );
}

function findSandwichDates(days, cutoffDate, enabled) {
  if (!enabled) return new Set();

  const source = days
    .filter((day) => day?.date && day.date <= cutoffDate)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const result = new Set();
  let index = 0;

  while (index < source.length) {
    if (!isSandwichCandidate(source[index])) {
      index += 1;
      continue;
    }

    const start = index;
    while (index < source.length && isSandwichCandidate(source[index])) index += 1;
    const end = index - 1;

    const before = source[start - 1];
    const after = source[end + 1];

    if (isLeaveAnchor(before) && isLeaveAnchor(after)) {
      for (let cursor = start; cursor <= end; cursor += 1) {
        result.add(source[cursor].date);
      }
    }
  }

  return result;
}

function normalizeAttendanceUnits(day) {
  const status = day?.attendance?.attendanceStatus;
  if (status === "half_day") return 0.5;

  if (
    day?.attendance?.workMode === "wfh" &&
    day?.attendance?.wfhType === "half_day"
  ) {
    return 0.5;
  }

  return clamp(
    day?.attendance?.attendanceUnits || day?.attendanceUnits || 0,
    0,
    1
  );
}

function buildWorkSnapshot(monthlyRecord, { cutoffDate, sandwichRule = true } = {}) {
  const allDays = Array.isArray(monthlyRecord?.days)
    ? monthlyRecord.days
        .filter((day) => day?.date)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  if (!allDays.length) {
    const error = new Error("Monthly work record has no daily data.");
    error.status = 422;
    throw error;
  }

  const monthStart = allDays[0].date;
  const monthEnd = allDays[allDays.length - 1].date;
  const effectiveCutoff = cutoffDate || monthEnd;

  if (effectiveCutoff < monthStart) {
    const error = new Error("Payroll cutoff date is before the payroll month.");
    error.status = 422;
    throw error;
  }

  const cutoff = effectiveCutoff > monthEnd ? monthEnd : effectiveCutoff;
  const sandwichDates = findSandwichDates(allDays, cutoff, sandwichRule);
  const activeDays = allDays.filter((day) => day.date <= cutoff);

  let presentUnits = 0;
  let paidLeaveUnits = 0;
  let unpaidLeaveUnits = 0;
  let absentUnits = 0;
  let halfDayUnits = 0;
  let sandwichLeaveUnits = 0;
  let payableUnits = 0;
  let unpaidUnits = 0;
  let lateDays = 0;
  let holidays = 0;
  let weeklyOffs = 0;
  let wfhFullDays = 0;
  let wfhHalfDays = 0;
  let elapsedWorkingDays = 0;
  let fullMonthWorkingDays = 0;
  let elapsedCalendarServiceDays = 0;
  let fullMonthServiceCalendarDays = 0;

  for (const day of allDays) {
    const employed = day.employed !== false;
    if (employed) fullMonthServiceCalendarDays += 1;
    if (employed && day.expectedWorkday) fullMonthWorkingDays += 1;
  }

  const snapshotDays = activeDays.map((day) => {
    const employed = day.employed !== false;
    const attendanceUnits = normalizeAttendanceUnits(day);
    const leaveUnits = clamp(day?.leave?.units || 0, 0, 1);
    const paidLeave = Boolean(day?.leave?.paid);
    const sandwich = sandwichDates.has(day.date);
    const expectedWorkday = Boolean(employed && day?.expectedWorkday);

    if (employed) elapsedCalendarServiceDays += 1;
    if (expectedWorkday) elapsedWorkingDays += 1;

    if (day.holidayName) holidays += 1;
    if (day.isWeeklyOff) weeklyOffs += 1;

    if (attendanceUnits > 0) {
      presentUnits += attendanceUnits;
      if (attendanceUnits === 0.5) halfDayUnits += 0.5;
    }

    if (day?.attendance?.workMode === "wfh") {
      if (day.attendance.wfhType === "half_day" && attendanceUnits > 0) wfhHalfDays += 1;
      else if (attendanceUnits > 0) wfhFullDays += 1;
    }

    if (day?.attendance?.arrivalStatus === "late") lateDays += 1;

    if (paidLeave) paidLeaveUnits += leaveUnits;
    else if (leaveUnits > 0) unpaidLeaveUnits += leaveUnits;

    if (expectedWorkday && !attendanceUnits && !leaveUnits) absentUnits += 1;

    let dayPayable = 0;
    let dayUnpaid = 0;
    let payrollExpectedWorkday = expectedWorkday;

    if (expectedWorkday) {
      dayPayable = Math.min(1, attendanceUnits + (paidLeave ? leaveUnits : 0));
      dayUnpaid = Math.max(0, 1 - dayPayable);
    } else if (sandwich) {
      payrollExpectedWorkday = true;
      sandwichLeaveUnits += 1;
      dayPayable = 0;
      dayUnpaid = 1;
    }

    payableUnits += dayPayable;
    unpaidUnits += dayUnpaid;

    return {
      date: day.date,
      status: day.status,
      employed,
      expectedWorkday,
      payrollExpectedWorkday,
      payableUnits: roundMoney(dayPayable),
      unpaidUnits: roundMoney(dayUnpaid),
      sandwichLeave: sandwich,
      holidayName: day.holidayName || null,
      isWeeklyOff: Boolean(day.isWeeklyOff),
      leave: day.leave
        ? {
            typeName: day.leave.typeName || "Leave",
            paid: paidLeave,
            units: leaveUnits,
          }
        : null,
      attendance: day.attendance
        ? {
            attendanceStatus: day.attendance.attendanceStatus || null,
            workMode: day.attendance.workMode || null,
            wfhType: day.attendance.wfhType || null,
            attendanceUnits: roundMoney(attendanceUnits),
          }
        : null,
    };
  });

  return {
    totalDays: allDays.length,
    elapsedDays: activeDays.length,
    monthStart,
    monthEnd,
    cutoffDate: cutoff,
    fullMonthWorkingDays,
    elapsedWorkingDays,
    fullMonthServiceCalendarDays,
    elapsedCalendarServiceDays,
    presentUnits: roundMoney(presentUnits),
    paidLeaveUnits: roundMoney(paidLeaveUnits),
    unpaidLeaveUnits: roundMoney(unpaidLeaveUnits),
    absentUnits: roundMoney(absentUnits),
    halfDayUnits: roundMoney(halfDayUnits),
    sandwichLeaveUnits: roundMoney(sandwichLeaveUnits),
    payableUnits: roundMoney(payableUnits),
    unpaidUnits: roundMoney(unpaidUnits),
    lateDays,
    holidays,
    weeklyOffs,
    wfhFullDays,
    wfhHalfDays,
    days: snapshotDays,
  };
}

function normalizeComponent(item, fallbackName = "Component") {
  return {
    name: String(item?.name || fallbackName).trim(),
    code: String(item?.code || "").trim(),
    calculationType: item?.calculationType === "percentage" ? "percentage" : "fixed",
    value: clamp(item?.value ?? item?.amount ?? 0),
    percentageOf: item?.percentageOf === "gross" ? "gross" : "basic",
    prorate: item?.prorate !== false,
    capAmount:
      item?.capAmount === null || item?.capAmount === undefined || item?.capAmount === ""
        ? null
        : clamp(item.capAmount),
    statutory: Boolean(item?.statutory),
  };
}

function normalizeSalaryStructure(structure) {
  const legacyEarnings = Array.isArray(structure?.earnings) ? structure.earnings : [];
  const rawBasic = Number(structure?.basicPay);
  const legacyBasicIndex = legacyEarnings.findIndex((item) =>
    /^(basic|basic pay|basic salary)$/i.test(String(item?.name || "").trim())
  );

  const basicPay = Number.isFinite(rawBasic) && rawBasic > 0
    ? clamp(rawBasic)
    : legacyBasicIndex >= 0
      ? clamp(legacyEarnings[legacyBasicIndex]?.amount)
      : 0;

  const earnings = (rawBasic > 0 ? legacyEarnings : legacyEarnings.filter((_, index) => index !== legacyBasicIndex))
    .map((item) => normalizeComponent(item))
    .filter((item) => item.name);

  const deductions = (Array.isArray(structure?.deductions) ? structure.deductions : [])
    .map((item) => normalizeComponent(item))
    .filter((item) => item.name);

  const employerContributions = (Array.isArray(structure?.employerContributions)
    ? structure.employerContributions
    : []
  )
    .map((item) => normalizeComponent(item))
    .filter((item) => item.name);

  if (basicPay <= 0 && earnings.length === 0) {
    const error = new Error("Basic Pay or salary earnings are not configured for this employee.");
    error.status = 422;
    throw error;
  }

  return {
    id: structure?._id || null,
    effectiveFrom: structure?.effectiveFrom || null,
    currency: structure?.currency || "INR",
    prorationMethod: ["working_days", "calendar_days"].includes(structure?.prorationMethod)
      ? structure.prorationMethod
      : "working_days",
    sandwichRule: structure?.sandwichRule !== false,
    sandwichRuleMode: "unpaid",
    basicPay,
    earnings,
    deductions,
    employerContributions,
  };
}

function componentMonthlyAmount(component, { monthlyBasic, monthlyGross }) {
  let amount;
  if (component.calculationType === "percentage") {
    const base = component.percentageOf === "gross" ? monthlyGross : monthlyBasic;
    amount = base * component.value / 100;
  } else {
    amount = component.value;
  }

  if (component.capAmount !== null) amount = Math.min(amount, component.capAmount);
  return roundMoney(Math.max(0, amount));
}

function buildMonthlyEarnings(structure) {
  const baseBasic = roundMoney(structure.basicPay);
  let monthlyGross = baseBasic;
  const rows = [
    {
      name: "Basic Pay",
      code: "BASIC",
      calculationType: "fixed",
      value: baseBasic,
      percentageOf: "basic",
      prorate: true,
      capAmount: null,
      statutory: false,
      monthlyAmount: baseBasic,
      amount: 0,
    },
  ];

  for (const component of structure.earnings) {
    const monthlyAmount = componentMonthlyAmount(component, {
      monthlyBasic: baseBasic,
      monthlyGross,
    });
    monthlyGross = roundMoney(monthlyGross + monthlyAmount);
    rows.push({ ...component, monthlyAmount, amount: 0 });
  }

  return { monthlyGross, rows };
}

function buildPeriods(structures, monthStart, monthEnd, cutoffDate) {
  const sorted = structures
    .filter((item) => item?.isActive !== false)
    .slice()
    .sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom));

  const eligible = sorted.filter((item) => new Date(item.effectiveFrom) <= dateAtUtc(monthEnd));
  const usable = eligible.filter((item) => new Date(item.effectiveFrom) <= dateAtUtc(cutoffDate));

  if (!usable.length) {
    const error = new Error("Salary structure is not configured through the payroll calculation date.");
    error.status = 422;
    throw error;
  }

  const selectedBase = usable[0];
  const selected = [
    selectedBase,
    ...eligible.filter((item) => new Date(item.effectiveFrom) > new Date(selectedBase.effectiveFrom)),
  ].filter((item, index, list) =>
    list.findIndex((candidate) => String(candidate._id) === String(item._id)) === index
  );

  return selected
    .map((item, index) => {
      const rawStart = new Date(item.effectiveFrom);
      const start = rawStart <= dateAtUtc(monthStart) ? monthStart : safeDateKey(rawStart);
      const next = selected[index + 1];
      const nextStart = next ? safeDateKey(next.effectiveFrom) : monthEnd;
      const rawEnd = next
        ? new Date(dateAtUtc(nextStart).getTime() - 86400000)
        : dateAtUtc(monthEnd);
      const end = rawEnd > dateAtUtc(monthEnd) ? monthEnd : safeDateKey(rawEnd);
      return { structure: item, start, end };
    })
    .filter((item) => item.start && item.end && item.start <= item.end);
}

function countPeriodUnits(workDays, start, end, method) {
  const periodDays = workDays.filter((day) => day.date >= start && day.date <= end);

  if (method === "calendar_days") {
    return {
      days: periodDays,
      accruedUnits: periodDays.filter((day) => day.employed !== false).length,
    };
  }

  return {
    days: periodDays,
    accruedUnits: periodDays.filter((day) => day.expectedWorkday).length,
  };
}

function earnedComponentAmount(component, monthlyAmount, earnedFraction, earnedBasic, earnedGross) {
  if (component.calculationType === "percentage") {
    const base = component.percentageOf === "gross" ? earnedGross : earnedBasic;
    let amount = base * component.value / 100;
    if (component.capAmount !== null) amount = Math.min(amount, component.capAmount);
    return roundMoney(Math.max(0, amount));
  }

  return roundMoney(component.prorate ? monthlyAmount * earnedFraction : monthlyAmount);
}

function aggregateLine(map, component, monthlyAmount, amount) {
  const key = String(component.name).trim().toLowerCase();
  const existing = map.get(key) || {
    name: component.name,
    code: component.code || "",
    statutory: Boolean(component.statutory),
    monthlyAmount: 0,
    amount: 0,
  };
  existing.monthlyAmount += monthlyAmount;
  existing.amount += amount;
  map.set(key, existing);
}

function buildLineItems(map) {
  return Array.from(map.values()).map((row) => ({
    name: row.name,
    code: row.code,
    monthlyAmount: roundMoney(row.monthlyAmount),
    amount: roundMoney(row.amount),
    statutory: Boolean(row.statutory),
  }));
}

function calculatePayroll({ monthlyRecord, salaryStructures, cutoffDate }) {
  if (!Array.isArray(salaryStructures) || salaryStructures.length === 0) {
    const error = new Error("Salary structure is not configured for this employee.");
    error.status = 422;
    throw error;
  }

  const normalizedStructures = salaryStructures
    .map(normalizeSalaryStructure)
    .sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom));

  const cutoff = cutoffDate || monthlyRecord?.month || null;
  const primary = normalizedStructures
    .filter((structure) => !cutoff || new Date(structure.effectiveFrom || 0) <= dateAtUtc(cutoff))
    .at(-1);

  if (!primary) {
    const error = new Error("Salary structure is not configured through the payroll calculation date.");
    error.status = 422;
    throw error;
  }

  const workSnapshot = buildWorkSnapshot(monthlyRecord, {
    cutoffDate,
    sandwichRule: primary.sandwichRule,
  });

  const method = primary.prorationMethod;
  const fullDivisor = method === "calendar_days"
    ? workSnapshot.fullMonthServiceCalendarDays
    : workSnapshot.fullMonthWorkingDays;

  if (fullDivisor <= 0) {
    const error = new Error("No salary-proration days are available for this payroll month.");
    error.status = 422;
    throw error;
  }

  const periods = buildPeriods(
    salaryStructures,
    workSnapshot.monthStart,
    workSnapshot.monthEnd,
    workSnapshot.cutoffDate
  );

  const aggregatedEarnings = new Map();
  const aggregatedDeductions = new Map();
  const aggregatedEmployer = new Map();
  const salaryPeriodSnapshots = [];

  let grossAccrued = 0;
  let earnedBasic = 0;
  let earnedGross = 0;
  let totalAccruedUnits = 0;
  let totalEarnedUnits = 0;
  let totalUnpaidUnits = 0;

  for (const period of periods) {
    const structure = normalizeSalaryStructure(period.structure);
    const monthly = buildMonthlyEarnings(structure);
    const periodStart = period.start;
    const periodEnd = period.end > workSnapshot.cutoffDate ? workSnapshot.cutoffDate : period.end;

    if (periodStart > periodEnd) continue;

    const { days: periodDays, accruedUnits } = countPeriodUnits(
      workSnapshot.days,
      periodStart,
      periodEnd,
      method
    );

    const unpaidUnits = roundMoney(
      periodDays.reduce((sum, day) => sum + Number(day.unpaidUnits || 0), 0)
    );
    const earnedUnits = roundMoney(Math.max(0, accruedUnits - unpaidUnits));

    const accruedFraction = clamp(accruedUnits / fullDivisor, 0, 1);
    const earnedFraction = clamp(earnedUnits / fullDivisor, 0, 1);

    totalAccruedUnits += accruedUnits;
    totalEarnedUnits += earnedUnits;
    totalUnpaidUnits += unpaidUnits;
    grossAccrued += monthly.monthlyGross * accruedFraction;

    const periodEarnedBasic = roundMoney(structure.basicPay * earnedFraction);
    const periodEarnedGross = roundMoney(monthly.monthlyGross * earnedFraction);
    earnedBasic = roundMoney(earnedBasic + periodEarnedBasic);
    earnedGross = roundMoney(earnedGross + periodEarnedGross);

    for (const row of monthly.rows) {
      const amount = row.code === "BASIC"
        ? periodEarnedBasic
        : earnedComponentAmount(
            row,
            row.monthlyAmount,
            earnedFraction,
            periodEarnedBasic,
            periodEarnedGross
          );
      aggregateLine(aggregatedEarnings, row, row.monthlyAmount, amount);
    }

    for (const component of structure.deductions) {
      const monthlyAmount = componentMonthlyAmount(component, {
        monthlyBasic: structure.basicPay,
        monthlyGross: monthly.monthlyGross,
      });
      const amount = component.calculationType === "percentage"
        ? earnedComponentAmount(component, monthlyAmount, earnedFraction, periodEarnedBasic, periodEarnedGross)
        : roundMoney(component.prorate ? monthlyAmount * earnedFraction : monthlyAmount);
      aggregateLine(aggregatedDeductions, component, monthlyAmount, amount);
    }

    for (const component of structure.employerContributions) {
      const monthlyAmount = componentMonthlyAmount(component, {
        monthlyBasic: structure.basicPay,
        monthlyGross: monthly.monthlyGross,
      });
      const amount = component.calculationType === "percentage"
        ? earnedComponentAmount(component, monthlyAmount, earnedFraction, periodEarnedBasic, periodEarnedGross)
        : roundMoney(component.prorate ? monthlyAmount * earnedFraction : monthlyAmount);
      aggregateLine(aggregatedEmployer, component, monthlyAmount, amount);
    }

    salaryPeriodSnapshots.push({
      from: periodStart,
      to: period.end,
      structureId: period.structure?._id || null,
      fraction: roundMoney(accruedFraction),
      earnedFraction: roundMoney(earnedFraction),
    });
  }

  const earnings = buildLineItems(aggregatedEarnings);
  const deductions = buildLineItems(aggregatedDeductions);
  const employerContributions = buildLineItems(aggregatedEmployer);

  const totalDeductions = roundMoney(deductions.reduce((sum, row) => sum + row.amount, 0));
  const employerContributionTotal = roundMoney(
    employerContributions.reduce((sum, row) => sum + row.amount, 0)
  );
  const grossSalary = roundMoney(earnings.reduce((sum, row) => sum + row.amount, 0));
  grossAccrued = roundMoney(grossAccrued);
  const lossOfPay = roundMoney(Math.max(0, grossAccrued - grossSalary));
  const netSalary = roundMoney(grossSalary - totalDeductions);

  if (netSalary < 0) {
    const error = new Error("Employee deductions exceed earned gross salary.");
    error.status = 422;
    throw error;
  }

  const currentMonthlyGross = buildMonthlyEarnings(primary).monthlyGross;

  return {
    currency: primary.currency,
    prorationMethod: method,
    sandwichRule: primary.sandwichRule,
    cutoffDate: workSnapshot.cutoffDate,
    salaryPeriods: salaryPeriodSnapshots,
    salarySnapshot: {
      effectiveFrom: primary.effectiveFrom,
      basicPay: primary.basicPay,
      earnings: primary.earnings,
      deductions: primary.deductions,
      employerContributions: primary.employerContributions,
    },
    workSnapshot: {
      ...workSnapshot,
      salaryAccruedUnits: roundMoney(totalAccruedUnits),
      salaryEarnedUnits: roundMoney(totalEarnedUnits),
      salaryUnpaidUnits: roundMoney(totalUnpaidUnits),
    },
    earnings,
    deductions,
    employerContributions,
    monthlyGross: currentMonthlyGross,
    grossAccrued,
    lossOfPay,
    grossSalary,
    totalDeductions,
    employerContributionTotal,
    netSalary,
    earnedBasic: roundMoney(earnedBasic),
    earnedGross: roundMoney(earnedGross),
  };
}

module.exports = {
  roundMoney,
  buildWorkSnapshot,
  calculatePayroll,
};
