const InvoiceCounter = require("../../models/InvoiceCounter");

/* ─────────────────────────────────────────────
   Money rounding
───────────────────────────────────────────── */

const roundMoney = (value) => {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
};

/* ─────────────────────────────────────────────
   Generate unique invoice number
───────────────────────────────────────────── */

const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const key = `invoice-${year}`;

  const counter = await InvoiceCounter.findOneAndUpdate(
    { key },
    {
      $inc: {
        sequence: 1,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return `INV-${year}-${String(counter.sequence).padStart(
    4,
    "0"
  )}`;
};

/* ─────────────────────────────────────────────
   Calculate complete invoice
───────────────────────────────────────────── */

const calculateInvoice = ({
  items,
  discountType,
  discountValue,
  taxEnabled,
  taxRate,
  additionalChargeAmount,
}) => {
  const calculatedItems = items.map((item) => {
    const quantity = Number(item.quantity);
    const rate = Number(item.rate);

    return {
      description: item.description.trim(),
      quantity,
      rate: roundMoney(rate),
      amount: roundMoney(quantity * rate),
    };
  });

  const subtotal = roundMoney(
    calculatedItems.reduce(
      (sum, item) => sum + item.amount,
      0
    )
  );

  const safeDiscountValue = Math.max(
    Number(discountValue) || 0,
    0
  );

  let discountAmount = 0;

  if (discountType === "percentage") {
    const percentage = Math.min(
      safeDiscountValue,
      100
    );

    discountAmount = roundMoney(
      subtotal * (percentage / 100)
    );
  } else {
    discountAmount = roundMoney(
      Math.min(safeDiscountValue, subtotal)
    );
  }

  const taxableAmount = roundMoney(
    subtotal - discountAmount
  );

  const safeTaxRate = taxEnabled
    ? Math.max(Number(taxRate) || 0, 0)
    : 0;

  const taxAmount = roundMoney(
    taxableAmount * (safeTaxRate / 100)
  );

  const safeAdditionalCharge = roundMoney(
    Math.max(
      Number(additionalChargeAmount) || 0,
      0
    )
  );

  const grandTotal = roundMoney(
    taxableAmount +
      taxAmount +
      safeAdditionalCharge
  );

  return {
    items: calculatedItems,
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    additionalChargeAmount:
      safeAdditionalCharge,
    grandTotal,
  };
};

module.exports = {
  generateInvoiceNumber,
  calculateInvoice,
};