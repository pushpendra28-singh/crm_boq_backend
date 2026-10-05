const PDFDocument = require("pdfkit");

const COMPANY_NAME =
  String(
    process.env.PAYROLL_COMPANY_NAME ||
      process.env.COMPANY_NAME ||
      "Company Name"
  ).trim();

const COMPANY_ADDRESS = String(
  process.env.PAYROLL_COMPANY_ADDRESS || ""
).trim();

function money(value) {
  return `INR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMonth(month) {
  if (!month) return "-";

  const [year, monthNumber] = String(month).split("-").map(Number);

  if (!year || !monthNumber) return month;

  return new Date(
    Date.UTC(year, monthNumber - 1, 1)
  ).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function drawDivider(doc, y) {
  doc
    .moveTo(42, y)
    .lineTo(553, y)
    .strokeColor("#E5E7EB")
    .lineWidth(1)
    .stroke();
}

function drawSectionTitle(doc, title, y) {
  doc
    .roundedRect(42, y, 511, 28, 7)
    .fill("#F3F4F6");

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#111827")
    .text(title.toUpperCase(), 54, y + 9);

  return y + 38;
}

function drawInfoBlock(doc, rows, x, y, width) {
  let currentY = y;

  for (const row of rows) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#6B7280")
      .text(row.label, x, currentY, {
        width: width * 0.42,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#111827")
      .text(row.value || "-", x + width * 0.42, currentY, {
        width: width * 0.58,
        align: "right",
      });

    currentY += 21;
  }

  return currentY;
}

function drawAmountTable(
  doc,
  title,
  items,
  x,
  y,
  width,
  totalLabel,
  totalValue
) {
  let currentY = drawSectionTitle(doc, title, y);

  for (const item of items) {
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("#374151")
      .text(item.name, x + 12, currentY + 6, {
        width: width - 140,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#111827")
      .text(money(item.amount), x + width - 125, currentY + 6, {
        width: 113,
        align: "right",
      });

    currentY += 23;

    doc
      .moveTo(x + 10, currentY)
      .lineTo(x + width - 10, currentY)
      .strokeColor("#F1F5F9")
      .stroke();
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#111827")
    .text(totalLabel, x + 12, currentY + 9, {
      width: width - 140,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#111827")
    .text(money(totalValue), x + width - 125, currentY + 9, {
      width: 113,
      align: "right",
    });

  return currentY + 37;
}

async function createSalarySlipPdf({ run, record }) {
  if (!run || !record) {
    const error = new Error("Salary slip data is not available.");
    error.status = 404;
    throw error;
  }

  const employee = record.employeeSnapshot || {};
  const attendance = record.attendanceSnapshot || {};

  const earnings = Array.isArray(record.earnings)
    ? record.earnings
    : [];

  const deductions = Array.isArray(record.deductions)
    ? record.deductions
    : [];

  const employerContributions = Array.isArray(
    record.employerContributions
  )
    ? record.employerContributions
    : [];

  const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      info: {
        Title: `Salary Slip - ${employee.name || "Employee"} - ${
          run.month
        }`,
        Author: COMPANY_NAME,
        Subject: "Employee Salary Slip",
      },
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = 511;

    // HEADER
    doc
      .roundedRect(42, 42, pageWidth, 78, 10)
      .fill("#111827");

    doc
      .font("Helvetica-Bold")
      .fontSize(19)
      .fillColor("#FFFFFF")
      .text(COMPANY_NAME, 58, 57, {
        width: 320,
      });

    if (COMPANY_ADDRESS) {
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#D1D5DB")
        .text(COMPANY_ADDRESS, 58, 82, {
          width: 320,
        });
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#FFFFFF")
      .text("SALARY SLIP", 390, 58, {
        width: 140,
        align: "right",
      });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#D1D5DB")
      .text(formatMonth(run.month), 390, 77, {
        width: 140,
        align: "right",
      });

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#D1D5DB")
      .text(`Generated: ${formatDate(new Date())}`, 390, 92, {
        width: 140,
        align: "right",
      });

    let y = 140;

    // EMPLOYEE INFO
    y = drawSectionTitle(doc, "Employee Details", y);

    const leftInfo = [
      {
        label: "Employee",
        value: employee.name || "-",
      },
      {
        label: "Employee ID",
        value: String(employee.id || "-"),
      },
      {
        label: "Designation",
        value: employee.role || "-",
      },
      {
        label: "Email",
        value: employee.email || "-",
      },
    ];

    const rightInfo = [
      {
        label: "Pay Period",
        value: formatMonth(run.month),
      },
      {
        label: "Calculation Through",
        value: run.cutoffDate || "-",
      },
      {
        label: "Joining Date",
        value: formatDate(employee.joiningDate),
      },
      {
        label: "Payment Status",
        value:
          record.paymentStatus === "paid"
            ? "PAID"
            : record.paymentStatus === "hold"
              ? "ON HOLD"
              : "PENDING",
      },
    ];

    const leftEnd = drawInfoBlock(
      doc,
      leftInfo,
      48,
      y,
      245
    );

    drawInfoBlock(
      doc,
      rightInfo,
      303,
      y,
      245
    );

    y = Math.max(leftEnd, y + 84) + 10;

    drawDivider(doc, y);

    y += 16;

    // ATTENDANCE SUMMARY
    y = drawSectionTitle(doc, "Payroll Attendance Summary", y);

    const attendanceRows = [
      ["Salary accrued units", attendance.salaryAccruedUnits || 0],
      ["Salary earned units", attendance.salaryEarnedUnits || 0],
      ["Salary unpaid / LOP units", attendance.salaryUnpaidUnits || 0],
      ["Present units", attendance.presentUnits || 0],
      ["Half-day units", attendance.halfDayUnits || 0],
      ["Paid leave units", attendance.paidLeaveUnits || 0],
      ["Unpaid leave units", attendance.unpaidLeaveUnits || 0],
      ["Absent units", attendance.absentUnits || 0],
      ["Late days", attendance.lateDays || 0],
      ["WFH full / half", `${attendance.wfhFullDays || 0} / ${attendance.wfhHalfDays || 0}`],
      ["Holidays / weekly offs", `${attendance.holidays || 0} / ${attendance.weeklyOffs || 0}`],
      ["Sandwich leave units", attendance.sandwichLeaveUnits || 0],
    ];

    let attendanceX = 48;
    let attendanceY = y;

    attendanceRows.forEach(([label, value], index) => {
      const column = index % 2;

      if (column === 0) {
        attendanceX = 48;
        if (index !== 0) attendanceY += 24;
      } else {
        attendanceX = 303;
      }

      doc
        .font("Helvetica")
        .fontSize(7.8)
        .fillColor("#6B7280")
        .text(label, attendanceX, attendanceY, {
          width: 125,
        });

      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#111827")
        .text(String(value), attendanceX + 128, attendanceY, {
          width: 72,
          align: "right",
        });
    });

    y = attendanceY + 34;

    drawDivider(doc, y);

    y += 16;

    // EARNINGS / DEDUCTIONS
    const tableTop = y;

    const earningsHeight =
      Math.max(earnings.length, 1) * 23 + 75;

    const deductionsHeight =
      Math.max(deductions.length, 1) * 23 + 75;

    const tableHeight = Math.max(
      earningsHeight,
      deductionsHeight
    );

    doc
      .roundedRect(42, tableTop, 245, tableHeight, 8)
      .fill("#FFFFFF")
      .strokeColor("#E5E7EB")
      .stroke();

    doc
      .roundedRect(308, tableTop, 245, tableHeight, 8)
      .fill("#FFFFFF")
      .strokeColor("#E5E7EB")
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text("EARNINGS", 54, tableTop + 12);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text("DEDUCTIONS", 320, tableTop + 12);

    let ey = tableTop + 37;

    for (const item of earnings) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#374151")
        .text(item.name, 54, ey, {
          width: 130,
        });

      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#111827")
        .text(money(item.amount), 184, ey, {
          width: 90,
          align: "right",
        });

      ey += 22;
    }

    let dy = tableTop + 37;

    for (const item of deductions) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#374151")
        .text(item.name, 320, dy, {
          width: 130,
        });

      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#111827")
        .text(money(item.amount), 450, dy, {
          width: 90,
          align: "right",
        });

      dy += 22;
    }

    const earningsTotalY = tableTop + tableHeight - 42;

    doc
      .moveTo(54, earningsTotalY)
      .lineTo(275, earningsTotalY)
      .strokeColor("#E5E7EB")
      .stroke();

    doc
      .moveTo(320, earningsTotalY)
      .lineTo(541, earningsTotalY)
      .strokeColor("#E5E7EB")
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text("Gross Earned", 54, earningsTotalY + 9);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text(money(record.grossSalary), 164, earningsTotalY + 9, {
        width: 110,
        align: "right",
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text("Total Deductions", 320, earningsTotalY + 9);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#111827")
      .text(money(record.totalDeductions), 431, earningsTotalY + 9, {
        width: 110,
        align: "right",
      });

    y = tableTop + tableHeight + 18;

    // LOP / NET
    doc
      .roundedRect(42, y, pageWidth, 78, 10)
      .fill("#F8FAFC")
      .strokeColor("#E2E8F0")
      .stroke();

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748B")
      .text("Gross Accrued", 58, y + 15);

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#111827")
      .text(money(record.grossAccrued), 58, y + 30);

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748B")
      .text("Loss of Pay", 205, y + 15);

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#C2410C")
      .text(money(record.lossOfPay), 205, y + 30);

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748B")
      .text("Net Salary", 388, y + 15);

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#047857")
      .text(money(record.netSalary), 335, y + 29, {
        width: 195,
        align: "right",
      });

    y += 96;

    // EMPLOYER CONTRIBUTIONS
    if (employerContributions.length) {
      y = drawSectionTitle(
        doc,
        "Employer Contributions",
        y
      );

      let contributionTotal = 0;

      employerContributions.forEach((item) => {
        contributionTotal += Number(item.amount || 0);

        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#374151")
          .text(item.name, 54, y);

        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor("#111827")
          .text(money(item.amount), 420, y, {
            width: 111,
            align: "right",
          });

        y += 21;
      });

      drawDivider(doc, y);

      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor("#111827")
        .text("Employer contribution total", 54, y + 8);

      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor("#111827")
        .text(money(contributionTotal), 420, y + 8, {
          width: 111,
          align: "right",
        });

      y += 36;
    }

    // PAYMENT INFO
    if (record.paymentStatus === "paid") {
      y = drawSectionTitle(doc, "Payment Details", y);

      const paymentRows = [
        ["Status", "PAID"],
        ["Payment date", formatDate(record.paidAt)],
        ["Payment method", record.paymentMethod || "-"],
        ["Reference", record.paymentReference || "-"],
      ];

      y = drawInfoBlock(
        doc,
        paymentRows,
        48,
        y,
        500
      ) + 8;
    } else if (record.paymentStatus === "hold") {
      y = drawSectionTitle(doc, "Payment Status", y);

      doc
        .roundedRect(48, y, 500, 42, 8)
        .fill("#FFF7ED");

      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor("#9A3412")
        .text("ON HOLD", 62, y + 10);

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#7C2D12")
        .text(
          record.holdReason || "Salary is currently on hold.",
          130,
          y + 10,
          {
            width: 395,
          }
        );

      y += 58;
    }

    // FOOTER
    const footerY = 760;

    drawDivider(doc, footerY);

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#9CA3AF")
      .text(
        "This is a system-generated salary slip. Salary figures are based on the payroll snapshot for the selected payroll period.",
        42,
        footerY + 12,
        {
          width: 511,
          align: "center",
        }
      );

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#9CA3AF")
      .text(
        `${COMPANY_NAME} | Payroll`,
        42,
        footerY + 26,
        {
          width: 511,
          align: "center",
        }
      );

    doc.end();
  });

  const safeName = String(employee.name || "employee")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return {
    buffer,
    fileName: `salary-slip-${safeName || "employee"}-${run.month}.pdf`,
  };
}

module.exports = {
  createSalarySlipPdf,
};