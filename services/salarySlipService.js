const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const Admin = require("../models/Admin");

const COMPANY_NAME = String(
  process.env.PAYROLL_COMPANY_NAME ||
    process.env.COMPANY_NAME ||
    "Wheedle Technologies Pvt. Ltd."
).trim();

const COMPANY_ADDRESS = String(
  process.env.PAYROLL_COMPANY_ADDRESS || ""
).trim();

const COMPANY_LOGO_PATH = String(
  process.env.PAYROLL_COMPANY_LOGO_PATH ||
    path.join(__dirname, "../assets/company-logo.png")
).trim();

function money(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function numberValue(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMonth(month) {
  if (!month) return "-";
  const [year, monthNumber] = String(month).split("-").map(Number);
  if (!year || !monthNumber) return String(month);

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

function getComponentAmount(items, patterns) {
  const rows = Array.isArray(items) ? items : [];

  for (const pattern of patterns) {
    const item = rows.find((row) =>
      pattern.test(String(row?.name || "").trim())
    );
    if (item) return numberValue(item.amount);
  }

  return 0;
}

function getOtherComponents(items, excludedPatterns) {
  const rows = Array.isArray(items) ? items : [];
  return rows.filter((row) => {
    const name = String(row?.name || "").trim();
    return name && !excludedPatterns.some((pattern) => pattern.test(name));
  });
}

function sumAmounts(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (total, row) => total + numberValue(row?.amount),
    0
  );
}

function getProfessionalEmployeeCode(admin) {
  const value =
    admin?.employeeCode ||
    admin?.employeeNumber ||
    admin?.employeeNo ||
    admin?.staffCode ||
    admin?.staffId ||
    "";

  return String(value || "").trim() || "—";
}

function createFallbackLogo(doc, x, y, size) {
  doc
    .roundedRect(x, y, size, size, 10)
    .fill("#111827");

  doc
    .font("Helvetica-Bold")
    .fontSize(size * 0.35)
    .fillColor("#FFFFFF")
    .text("WT", x, y + size * 0.32, {
      width: size,
      align: "center",
    });
}

function drawLogo(doc) {
  const x = 42;
  const y = 38;
  const size = 54;

  if (COMPANY_LOGO_PATH && fs.existsSync(COMPANY_LOGO_PATH)) {
    try {
      doc.image(COMPANY_LOGO_PATH, x, y, {
        fit: [size, size],
        align: "center",
        valign: "center",
      });
      return;
    } catch {
      // fall through to the vector fallback
    }
  }

  createFallbackLogo(doc, x, y, size);
}

function drawDivider(doc, y) {
  doc
    .moveTo(42, y)
    .lineTo(553, y)
    .strokeColor("#E5E7EB")
    .lineWidth(1)
    .stroke();
}

function drawPageHeader(doc, monthLabel, slipNumber) {
  const pageWidth = 511;

  drawLogo(doc);

  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor("#111827")
    .text(COMPANY_NAME, 108, 44, {
      width: 290,
    });

  if (COMPANY_ADDRESS) {
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#6B7280")
      .text(COMPANY_ADDRESS, 108, 67, {
        width: 290,
      });
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#047857")
    .text("SALARY SLIP", 410, 47, {
      width: pageWidth,
      align: "right",
    });

  doc
    .font("Helvetica")
    .fontSize(7.8)
    .fillColor("#6B7280")
    .text(monthLabel, 410, 66, {
      width: pageWidth,
      align: "right",
    });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#6B7280")
    .text(slipNumber, 410, 80, {
      width: pageWidth,
      align: "right",
    });

  drawDivider(doc, 104);
}

function ensureSpaceForContent(doc, currentY, requiredHeight, onPageBreak) {
  const pageBottom = 760;

  if (currentY + requiredHeight > pageBottom) {
    doc.addPage();
    onPageBreak();
    return 124;
  }

  return currentY;
}

function truncateLabel(value, maxLength = 24) {
  const label = String(value || "-").trim();
  if (!label) return "-";
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

function drawSectionTitle(doc, title, y) {
  doc
    .roundedRect(42, y, 511, 20, 6)
    .fill("#F3F4F6");

  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#111827")
    .text(title.toUpperCase(), 54, y + 6);

  return y + 26;
}

function drawInfoRows(doc, rows, x, y, width) {
  let currentY = y;

  for (const row of rows) {
    doc
      .font("Helvetica")
      .fontSize(6.8)
      .fillColor("#6B7280")
      .text(truncateLabel(row.label, 24), x, currentY, { width: width * 0.42 });

    doc
      .font("Helvetica-Bold")
      .fontSize(7.1)
      .fillColor("#111827")
      .text(truncateLabel(row.value || "-", 20), x + width * 0.42, currentY, {
        width: width * 0.58,
        align: "right",
      });

    currentY += 13;
  }

  return currentY;
}

function drawSimpleTable(doc, title, items, x, y, width, totalLabel, totalValue) {
  const rows = items.length
    ? items
    : [{ name: "No items", amount: 0 }];

  const rowHeight = 12;
  const totalHeight = 20 + rows.length * rowHeight + 20;

  doc
    .roundedRect(x, y, width, totalHeight, 8)
    .fill("#FFFFFF")
    .strokeColor("#E5E7EB")
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#111827")
    .text(title.toUpperCase(), x + 10, y + 8);

  let currentY = y + 22;

  for (const item of rows) {
    doc
      .font("Helvetica")
      .fontSize(6.8)
      .fillColor("#374151")
      .text(truncateLabel(item.name || "-", 18), x + 10, currentY, {
        width: width - 130,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(6.8)
      .fillColor("#111827")
      .text(money(item.amount), x + width - 108, currentY, {
        width: 95,
        align: "right",
      });

    currentY += rowHeight;
  }

  drawDividerInside(doc, x + 10, x + width - 10, currentY + 1);

  doc
    .font("Helvetica-Bold")
    .fontSize(7.4)
    .fillColor("#111827")
    .text(totalLabel, x + 10, currentY + 7, {
      width: width - 120,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(7.4)
    .fillColor("#111827")
    .text(money(totalValue), x + width - 108, currentY + 7, {
      width: 95,
      align: "right",
    });

  return y + totalHeight;
}

function drawDividerInside(doc, x1, x2, y) {
  doc
    .moveTo(x1, y)
    .lineTo(x2, y)
    .strokeColor("#E5E7EB")
    .lineWidth(1)
    .stroke();
}

async function loadEmployeeMeta(record) {
  if (!record?.employeeId) return null;

  try {
    return await Admin.findById(record.employeeId)
      .select(
        "employeeCode employeeNumber employeeNo staffCode staffId department designation"
      )
      .lean();
  } catch {
    return null;
  }
}

async function createSalarySlipPdf({ run, record }) {
  if (!run || !record) {
    const error = new Error("Salary slip data is not available.");
    error.status = 404;
    throw error;
  }

  const employee = record.employeeSnapshot || {};
  const adminMeta = await loadEmployeeMeta(record);
  const professionalEmployeeCode = getProfessionalEmployeeCode(adminMeta);

  const earnings = Array.isArray(record.earnings) ? record.earnings : [];
  const deductions = Array.isArray(record.deductions)
    ? record.deductions
    : [];
  const employerContributions = Array.isArray(
    record.employerContributions
  )
    ? record.employerContributions
    : [];

  const basicPay = numberValue(record.salarySnapshot?.basicPay);

  const hraAmount = getComponentAmount(earnings, [
    /^hra$/i,
    /house rent allowance/i,
  ]);

  const conveyanceAmount = getComponentAmount(earnings, [
    /^conveyance$/i,
    /conveyance allowance/i,
    /transport allowance/i,
  ]);

  const specialAllowanceAmount = getComponentAmount(earnings, [
    /^special allowance$/i,
  ]);

  const knownAllowancePatterns = [
    /^hra$/i,
    /house rent allowance/i,
    /^conveyance$/i,
    /conveyance allowance/i,
    /transport allowance/i,
    /^special allowance$/i,
    /^basic$/i,
    /^basic pay$/i,
    /^basic salary$/i,
  ];

  const otherAllowances = getOtherComponents(
    earnings,
    knownAllowancePatterns
  );

  const pfAmount = getComponentAmount(deductions, [
    /^pf$/i,
    /provident fund/i,
    /employee provident fund/i,
  ]);

  const esiAmount = getComponentAmount(deductions, [
    /^esi$/i,
    /employee state insurance/i,
  ]);

  const professionalTaxAmount = getComponentAmount(deductions, [
    /^pt$/i,
    /professional tax/i,
  ]);

  const tdsAmount = getComponentAmount(deductions, [
    /^tds$/i,
    /income tax/i,
  ]);

  const knownDeductionPatterns = [
    /^pf$/i,
    /provident fund/i,
    /employee provident fund/i,
    /^esi$/i,
    /employee state insurance/i,
    /^pt$/i,
    /professional tax/i,
    /^tds$/i,
    /income tax/i,
  ];

  const otherDeductions = getOtherComponents(
    deductions,
    knownDeductionPatterns
  );

  const employerPf = getComponentAmount(employerContributions, [
    /^employer pf$/i,
    /employer provident fund/i,
  ]);

  const employerEsi = getComponentAmount(employerContributions, [
    /^employer esi$/i,
    /employer state insurance/i,
  ]);

  const otherEmployerContributions = getOtherComponents(
    employerContributions,
    [
      /^employer pf$/i,
      /employer provident fund/i,
      /^employer esi$/i,
      /employer state insurance/i,
    ]
  );

  const otherAllowanceTotal = sumAmounts(otherAllowances);
  const otherDeductionTotal = sumAmounts(otherDeductions);
  const otherEmployerContributionTotal = sumAmounts(otherEmployerContributions);

  const salaryEarnings = [
    { name: "Basic Pay", amount: basicPay },
    { name: "HRA", amount: hraAmount },
    { name: "Conveyance Allowance", amount: conveyanceAmount },
    { name: "Special Allowance", amount: specialAllowanceAmount },
    ...(otherAllowanceTotal > 0 ? [{ name: "Other Allowances", amount: otherAllowanceTotal }] : []),
  ];

  const salaryDeductions = [
    { name: "Provident Fund (PF)", amount: pfAmount },
    { name: "Employee State Insurance (ESI)", amount: esiAmount },
    { name: "Professional Tax", amount: professionalTaxAmount },
    { name: "TDS / Income Tax", amount: tdsAmount },
    ...(otherDeductionTotal > 0 ? [{ name: "Other Deductions", amount: otherDeductionTotal }] : []),
  ];

  const companyContributionRows = [
    { name: "Employer PF", amount: employerPf },
    { name: "Employer ESI", amount: employerEsi },
    ...(otherEmployerContributionTotal > 0 ? [{ name: "Other Employer Contributions", amount: otherEmployerContributionTotal }] : []),
  ];

  const monthlySalary = numberValue(record.monthlyGross);
  const grossAccrued = numberValue(record.grossAccrued);
  const lossOfPay = numberValue(record.lossOfPay);
  const grossEarned = numberValue(record.grossSalary);
  const totalDeductions = numberValue(record.totalDeductions);
  const netSalary = numberValue(record.netSalary);
  const employerTotal = numberValue(record.employerContributionTotal);

  const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      info: {
        Title: `Salary Slip - ${employee.name || "Employee"} - ${run.month}`,
        Author: COMPANY_NAME,
        Subject: "Employee Salary Slip",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = 511;
    const monthLabel = formatMonth(run.month);

    const slipNumber = `SLIP-${String(run.month || "").replace("-", "")}-${String(
      record._id || ""
    )
      .slice(-6)
      .toUpperCase()}`;

    const drawCurrentPageHeader = () => drawPageHeader(doc, monthLabel, slipNumber);

    drawCurrentPageHeader();

    let y = 124;

    // Employee information - no MongoDB ObjectId shown
    y = drawSectionTitle(doc, "Employee Information", y);

    const leftRows = [
      { label: "Employee Name", value: employee.name || "-" },
      { label: "Employee Code", value: professionalEmployeeCode },
      {
        label: "Designation",
        value:
          adminMeta?.designation || employee.role || "-",
      },
    ];

    const rightRows = [
      {
        label: "Department",
        value: adminMeta?.department || "-",
      },
      {
        label: "Pay Period",
        value: formatMonth(run.month),
      },
      {
        label: "Joining Date",
        value: formatDate(employee.joiningDate),
      },
    ];

    const leftEnd = drawInfoRows(doc, leftRows, 48, y, 242);
    const rightEnd = drawInfoRows(doc, rightRows, 303, y, 242);

    y = Math.max(leftEnd, rightEnd) + 7;
    drawDivider(doc, y);
    y += 16;

    // Salary summary
    y = drawSectionTitle(doc, "Salary Summary", y);

    const summaryRows = [
      ["Monthly Salary", money(monthlySalary)],
      ["Gross Accrued", money(grossAccrued)],
      ["Loss of Pay", money(lossOfPay)],
      ["Gross Salary Earned", money(grossEarned)],
      ["Total Deductions", money(totalDeductions)],
      ["Net Salary", money(netSalary)],
    ];

    let summaryY = y;

    summaryRows.forEach(([label, value], index) => {
      const column = index < 3 ? 0 : 1;
      const rowIndex = index < 3 ? index : index - 3;
      const x = column === 0 ? 48 : 303;
      const rowY = y + rowIndex * 16;

      doc
        .font("Helvetica")
        .fontSize(7.2)
        .fillColor("#6B7280")
        .text(label, x, rowY, { width: 125 });

      doc
        .font("Helvetica-Bold")
        .fontSize(7.7)
        .fillColor(label === "Net Salary" ? "#047857" : "#111827")
        .text(value, x + 126, rowY, {
          width: 115,
          align: "right",
        });

      summaryY = Math.max(summaryY, rowY + 12);
    });

    y = summaryY + 5;

    // Earnings and deductions
    const tableY = y;
    const tableWidth = 245;
    const leftTableBottom = drawSimpleTable(
      doc,
      "Earnings",
      salaryEarnings,
      42,
      tableY,
      tableWidth,
      "Monthly Earnings",
      monthlySalary
    );

    const rightTableBottom = drawSimpleTable(
      doc,
      "Deductions",
      salaryDeductions,
      308,
      tableY,
      tableWidth,
      "Total Deductions",
      totalDeductions
    );

    y = Math.max(leftTableBottom, rightTableBottom) + 18;
    y = ensureSpaceForContent(doc, y, 110, drawCurrentPageHeader);

    // Net salary highlight
    doc
      .roundedRect(42, y, pageWidth, 68, 10)
      .fill("#ECFDF5")
      .strokeColor("#A7F3D0")
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(8.4)
      .fillColor("#065F46")
      .text("NET SALARY PAYABLE", 58, y + 12);

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#047857")
      .text("After applicable deductions and Loss of Pay", 58, y + 27);

    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor("#047857")
      .text(money(netSalary), 345, y + 20, {
        width: 195,
        align: "right",
      });

    y += 64;

    const paymentRows = [
      {
        label: "Payment Status",
        value:
          record.paymentStatus === "paid"
            ? "PAID"
            : record.paymentStatus === "hold"
              ? "ON HOLD"
              : "PENDING",
      },
      {
        label: "Payment Date",
        value: formatDate(record.paidAt),
      },
      {
        label: "Payment Method",
        value: truncateLabel(record.paymentMethod || "-", 22),
      },
      {
        label: "Reference",
        value: truncateLabel(record.paymentReference || "-", 22),
      },
    ];

    const paymentStartY = y + 4;
    drawInfoRows(doc, paymentRows, 48, paymentStartY, 500);

    // Footer
    const footerY = 640;
    drawDivider(doc, footerY);

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#9CA3AF")
      .text(
        "This is a computer-generated salary slip and does not require a signature.",
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
      .text(COMPANY_NAME, 42, footerY + 26, {
        width: 511,
        align: "center",
      });

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
