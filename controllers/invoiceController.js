const Invoice = require("../models/Invoice");
const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const validator = require("validator");
const {
  generateInvoiceNumber,
  calculateInvoice,
} = require("../services/invoice/invoiceService");

const {
  getOwnershipFilter,
  getOwnedResourceFilter,
} = require("../utils/ownership");


const {
  resolveInvoiceTemplate,
} = require("../config/invoiceTemplates");

const {
  sendInvoiceEmail,
} = require(
  "../utils/invoiceMailer"
);
/* ─────────────────────────────────────────────
   Create Invoice
───────────────────────────────────────────── */

exports.createInvoice = async (req, res) => {
  try {
  const {
  customerId,
  invoiceDate,
  dueDate,
  paymentTerms,

  template,

  items,

  discountType = "percentage",
  discountValue = 0,

  taxEnabled = false,
  taxRate = 0,

  additionalChargeName = "",
  additionalChargeAmount = 0,

  notes = "",
  terms = "",
} = req.body;


/*
 * BusinessProfile middleware already verified
 * that this authenticated user's profile exists
 * and is invoice-ready.
 */
const businessProfile =
  req.businessProfile;


/*
 * BusinessProfile address structured hai,
 * while current Invoice snapshot address string hai.
 *
 * Therefore current invoice schema ko touch kiye
 * bina professional printable address banate hain.
 */
const businessAddress = [
  businessProfile.address?.line1,
  businessProfile.address?.line2,
  businessProfile.address?.city,
  businessProfile.address?.state,
  businessProfile.address?.postalCode,
  businessProfile.address?.country,
]
  .map((value) =>
    String(value || "").trim()
  )
  .filter(Boolean)
  .join(", ");

    

   /* ───────── Customer validation ───────── */

if (!customerId) {
  return res.status(400).json({
    message: "Customer is required",
  });
}

if (!mongoose.Types.ObjectId.isValid(customerId)) {
  return res.status(400).json({
    message: "Invalid customer ID",
  });
}


/*
  IMPORTANT:
  Customer ID ke saath ownerId bhi verify
  kar rahe hain.

  Isliye logged-in user kisi doosre user ka
  customer invoice me use nahi kar sakta.
*/

const customer = await Customer.findOne({
  _id: customerId,
  ownerId: req.ownerId,
}).lean();


if (!customer) {
  return res.status(404).json({
    message: "Customer not found",
  });
}
    // if (!business?.name?.trim()) {
    //   return res.status(400).json({
    //     message: "Business information is required",
    //   });
    // }

    if (!invoiceDate || !dueDate) {
      return res.status(400).json({
        message: "Invoice date and due date are required",
      });
    }

    const parsedInvoiceDate = new Date(invoiceDate);
    const parsedDueDate = new Date(dueDate);

    if (
      Number.isNaN(parsedInvoiceDate.getTime()) ||
      Number.isNaN(parsedDueDate.getTime())
    ) {
      return res.status(400).json({
        message: "Invalid invoice or due date",
      });
    }

    if (parsedDueDate < parsedInvoiceDate) {
      return res.status(400).json({
        message:
          "Due date cannot be before invoice date",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one invoice item is required",
      });
    }

    /* ───────── Validate each item ───────── */

    for (const item of items) {
      if (!item.description?.trim()) {
        return res.status(400).json({
          message:
            "Every invoice item must have a description",
        });
      }

      const quantity = Number(item.quantity);
      const rate = Number(item.rate);

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          message:
            "Item quantity must be greater than 0",
        });
      }

      if (
        !Number.isFinite(rate) ||
        rate < 0
      ) {
        return res.status(400).json({
          message:
            "Item rate must be a valid non-negative number",
        });
      }
    }

    if (
      !["percentage", "fixed"].includes(
        discountType
      )
    ) {
      return res.status(400).json({
        message: "Invalid discount type",
      });
    }

    const numericDiscount =
      Number(discountValue) || 0;

    if (numericDiscount < 0) {
      return res.status(400).json({
        message: "Discount cannot be negative",
      });
    }

    if (
      discountType === "percentage" &&
      numericDiscount > 100
    ) {
      return res.status(400).json({
        message:
          "Percentage discount cannot exceed 100%",
      });
    }

    const numericTaxRate = Number(taxRate) || 0;

    if (
      taxEnabled &&
      (numericTaxRate < 0 || numericTaxRate > 100)
    ) {
      return res.status(400).json({
        message: "Invalid tax rate",
      });
    }

    if (Number(additionalChargeAmount) < 0) {
      return res.status(400).json({
        message:
          "Additional charge cannot be negative",
      });
    }



    /* ───────── Validate invoice template ───────── */

const resolvedTemplate =
  resolveInvoiceTemplate(template);

if (!resolvedTemplate) {
  return res.status(400).json({
    message:
      "Invalid or unsupported invoice template",
  });
}


    /* ───────── Backend calculations ───────── */

    const calculated = calculateInvoice({
      items,
      discountType,
      discountValue,
      taxEnabled,
      taxRate,
      additionalChargeAmount,
    });

    /* ───────── Generate invoice number ───────── */

    const invoiceNumber =
      await generateInvoiceNumber();

    /* ───────── Save invoice ───────── */

    const invoice = await Invoice.create({
      invoiceNumber,
      customerId: customer._id,

      customerSnapshot: {
        companyName: customer.companyName,
        contactPerson:
          customer.contactPerson || "",
        email: customer.email || "",
        phone: customer.phone || "",
        address: customer.address || "",
        gstin: customer.gstin || "",
      },

     businessSnapshot: {
  name:
    businessProfile.businessName,

    logoUrl:
  businessProfile.logoUrl || "",

  email:
    businessProfile.email || "",

  phone:
    businessProfile.phone || "",

  address:
    businessAddress,

  gstin:
    businessProfile.gstRegistered
      ? businessProfile.gstin || ""
      : "",

  bank: {
    accountName:
      businessProfile.bank?.accountName || "",

    bankName:
      businessProfile.bank?.bankName || "",

    accountNumber:
      businessProfile.bank?.accountNumber || "",

    ifsc:
      businessProfile.bank?.ifsc || "",
  },

  authorizedSignatory:
    businessProfile.authorizedSignatory || "",
},

      invoiceDate: parsedInvoiceDate,
      dueDate: parsedDueDate,
      paymentTerms,

      template: resolvedTemplate,

      items: calculated.items,

      discountType,
      discountValue: numericDiscount,
      discountAmount:
        calculated.discountAmount,

      taxEnabled: Boolean(taxEnabled),
      taxRate: taxEnabled
        ? numericTaxRate
        : 0,
      taxAmount:
        calculated.taxAmount,

      taxableAmount:
        calculated.taxableAmount,

      additionalChargeName:
        additionalChargeName.trim(),

      additionalChargeAmount:
        calculated.additionalChargeAmount,

      subtotal:
        calculated.subtotal,

      grandTotal:
        calculated.grandTotal,

      notes,
      terms,

      status: "unpaid",

      ownerId: req.ownerId,

      createdBy: req.admin._id,
    });

    return res.status(201).json({
      message: "Invoice generated successfully",

      invoice: {
        id: invoice._id,
        invoiceNumber:
          invoice.invoiceNumber,
          template: invoice.template,
        status: invoice.status,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        grandTotal: invoice.grandTotal,
        createdAt: invoice.createdAt,
      },
    });
  } catch (error) {
    console.error(
      "Create invoice error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(409).json({
        message:
          "Invoice number already exists. Please try again.",
      });
    }

    if (error?.name === "ValidationError") {
      return res.status(400).json({
        message:
          Object.values(error.errors)[0]?.message ||
          "Invalid invoice data",
      });
    }

    return res.status(500).json({
      message:
        "Unable to generate invoice. Please try again.",
    });
  }
};

/* ─────────────────────────────────────────────
   Get Invoices
───────────────────────────────────────────── */

exports.getInvoices = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page || "1", 10);
    const limit = Number.parseInt(req.query.limit || "10", 10);

    /* ───────── Pagination validation ───────── */

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({
        message: "Page must be a positive integer",
      });
    }

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        message: "Limit must be between 1 and 100",
      });
    }

    const skip = (page - 1) * limit;
    const ownershipFilter =
  getOwnershipFilter(req);

    /*
      Invoice list aur total count parallel me
      fetch kar rahe hain.
    */
   const [invoices, total] = await Promise.all([
  Invoice.find(ownershipFilter)
    .select(
      "invoiceNumber customerSnapshot.companyName invoiceDate dueDate status grandTotal createdAt"
    )
    .sort({
      createdAt: -1,
      _id: -1,
    })
    .skip(skip)
    .limit(limit)
    .lean(),

  Invoice.countDocuments(
    ownershipFilter
  ),
]);

    const formattedInvoices = invoices.map((invoice) => ({
      id: invoice._id,

      invoiceNumber: invoice.invoiceNumber,

      customerName:
        invoice.customerSnapshot?.companyName || "",

      invoiceDate: invoice.invoiceDate,

      dueDate: invoice.dueDate,

      status: invoice.status,

      grandTotal: invoice.grandTotal,

      createdAt: invoice.createdAt,
    }));

    return res.status(200).json({
      message: "Invoices fetched successfully",

      invoices: formattedInvoices,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get invoices error:", error);

    return res.status(500).json({
      message:
        "Unable to fetch invoices. Please try again.",
    });
  }
};

/* ─────────────────────────────────────────────
   Get Single Invoice By ID
───────────────────────────────────────────── */

exports.getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;

    // MongoDB ObjectId validation
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid invoice ID",
      });
    }

    const invoice = await Invoice.findOne(
    getOwnedResourceFilter(req, id)).populate("createdBy","name email")
    .lean();

    if (!invoice) {
      return res.status(404).json({
        message: "Invoice not found",
      });
    }

    const { _id, __v, ...invoiceData } = invoice;

    return res.status(200).json({
      message: "Invoice fetched successfully",

      invoice: {
        id: _id,
        ...invoiceData,
      },
    });
  } catch (error) {
    console.error("Get invoice by ID error:", error);

    return res.status(500).json({
      message:
        "Unable to fetch invoice. Please try again.",
    });
  }
};

/* ─────────────────────────────────────────────
   Update Invoice
───────────────────────────────────────────── */

exports.updateInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      customerId,

      invoiceDate,
      dueDate,
      paymentTerms,

      template,

      items,

      discountType = "percentage",
      discountValue = 0,

      taxEnabled = false,
      taxRate = 0,

      additionalChargeName = "",
      additionalChargeAmount = 0,

      notes = "",
      terms = "",
    } = req.body;


    /* ───────── Validate invoice ID ───────── */

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid invoice ID",
      });
    }


    /* ───────── Find owned invoice ───────── */

    const invoice = await Invoice.findOne(
      getOwnedResourceFilter(req, id)
    );

    /*
      Invoice exist nahi karta
      OR
      logged-in user ko access nahi hai

      dono cases me same response.
    */

    if (!invoice) {
      return res.status(404).json({
        message: "Invoice not found",
      });
    }


    /* ───────── Customer validation ───────── */

    if (!customerId) {
      return res.status(400).json({
        message: "Customer is required",
      });
    }

    if (
      !mongoose.Types.ObjectId.isValid(
        customerId
      )
    ) {
      return res.status(400).json({
        message: "Invalid customer ID",
      });
    }


    /*
      IMPORTANT ISOLATION:

      Invoice edit karne wala user sirf
      apne customer ko invoice me use
      kar sakta hai.
    */

    const customer =
      await Customer.findOne({
        _id: customerId,
        ownerId: req.ownerId,
      }).lean();


    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }


    /* ───────── Date validation ───────── */

    if (!invoiceDate || !dueDate) {
      return res.status(400).json({
        message:
          "Invoice date and due date are required",
      });
    }


    const parsedInvoiceDate =
      new Date(invoiceDate);

    const parsedDueDate =
      new Date(dueDate);


    if (
      Number.isNaN(
        parsedInvoiceDate.getTime()
      ) ||
      Number.isNaN(
        parsedDueDate.getTime()
      )
    ) {
      return res.status(400).json({
        message:
          "Invalid invoice or due date",
      });
    }


    if (
      parsedDueDate <
      parsedInvoiceDate
    ) {
      return res.status(400).json({
        message:
          "Due date cannot be before invoice date",
      });
    }


    /* ───────── Items validation ───────── */

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message:
          "At least one invoice item is required",
      });
    }


    for (const item of items) {
      if (!item.description?.trim()) {
        return res.status(400).json({
          message:
            "Every invoice item must have a description",
        });
      }


      const quantity =
        Number(item.quantity);

      const rate =
        Number(item.rate);


      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          message:
            "Item quantity must be greater than 0",
        });
      }


      if (
        !Number.isFinite(rate) ||
        rate < 0
      ) {
        return res.status(400).json({
          message:
            "Item rate must be a valid non-negative number",
        });
      }
    }


    /* ───────── Discount validation ───────── */

    if (
      ![
        "percentage",
        "fixed",
      ].includes(discountType)
    ) {
      return res.status(400).json({
        message:
          "Invalid discount type",
      });
    }


    const numericDiscount =
      Number(discountValue) || 0;


    if (numericDiscount < 0) {
      return res.status(400).json({
        message:
          "Discount cannot be negative",
      });
    }


    if (
      discountType === "percentage" &&
      numericDiscount > 100
    ) {
      return res.status(400).json({
        message:
          "Percentage discount cannot exceed 100%",
      });
    }


    /* ───────── Tax validation ───────── */

    const numericTaxRate =
      Number(taxRate) || 0;


    if (
      taxEnabled &&
      (
        numericTaxRate < 0 ||
        numericTaxRate > 100
      )
    ) {
      return res.status(400).json({
        message:
          "Invalid tax rate",
      });
    }


    /* ───────── Additional charge validation ───────── */

    if (
      Number(additionalChargeAmount) <
      0
    ) {
      return res.status(400).json({
        message:
          "Additional charge cannot be negative",
      });
    }


    /* ───────── Template validation ───────── */

    const resolvedTemplate =
      resolveInvoiceTemplate(
        template
      );


    if (!resolvedTemplate) {
      return res.status(400).json({
        message:
          "Invalid or unsupported invoice template",
      });
    }


    /* ───────── Recalculate invoice ───────── */

    const calculated =
      calculateInvoice({
        items,

        discountType,
        discountValue,

        taxEnabled,
        taxRate,

        additionalChargeAmount,
      });


    /* ───────── Update editable fields ───────── */

    invoice.customerId =
      customer._id;


    /*
      Customer master ka current verified
      data new snapshot banega.
    */

    invoice.customerSnapshot = {
      companyName:
        customer.companyName,

      contactPerson:
        customer.contactPerson || "",

      email:
        customer.email || "",

      phone:
        customer.phone || "",

      address:
        customer.address || "",

      gstin:
        customer.gstin || "",
    };


    invoice.invoiceDate =
      parsedInvoiceDate;

    invoice.dueDate =
      parsedDueDate;

    invoice.paymentTerms =
      paymentTerms;

    invoice.template =
      resolvedTemplate;


    invoice.items =
      calculated.items;


    invoice.discountType =
      discountType;

    invoice.discountValue =
      numericDiscount;

    invoice.discountAmount =
      calculated.discountAmount;


    invoice.taxEnabled =
      Boolean(taxEnabled);

    invoice.taxRate =
      taxEnabled
        ? numericTaxRate
        : 0;

    invoice.taxAmount =
      calculated.taxAmount;

    invoice.taxableAmount =
      calculated.taxableAmount;


    invoice.additionalChargeName =
      String(
        additionalChargeName || ""
      ).trim();

    invoice.additionalChargeAmount =
      calculated.additionalChargeAmount;


    invoice.subtotal =
      calculated.subtotal;

    invoice.grandTotal =
      calculated.grandTotal;


    invoice.notes =
      notes || "";

    invoice.terms =
      terms || "";


    /* ───────── Save ───────── */

    await invoice.save();


    return res.status(200).json({
      message:
        "Invoice updated successfully",

      invoice: {
        id:
          invoice._id,

        invoiceNumber:
          invoice.invoiceNumber,

        customerId:
          invoice.customerId,

        template:
          invoice.template,

        status:
          invoice.status,

        subtotal:
          invoice.subtotal,

        taxAmount:
          invoice.taxAmount,

        grandTotal:
          invoice.grandTotal,

        updatedAt:
          invoice.updatedAt,
      },
    });

  } catch (error) {
    console.error(
      "Update invoice error:",
      error
    );


    if (
      error?.name ===
      "ValidationError"
    ) {
      return res.status(400).json({
        message:
          Object.values(
            error.errors
          )[0]?.message ||
          "Invalid invoice data",
      });
    }


    return res.status(500).json({
      message:
        "Unable to update invoice. Please try again.",
    });
  }
};



/* ─────────────────────────────────────────────
   Delete Invoice
───────────────────────────────────────────── */

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;


    /* ───────── Validate invoice ID ───────── */

    if (
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      return res.status(400).json({
        message: "Invalid invoice ID",
      });
    }


    /*
      IMPORTANT:

      Same existing ownership/isolation
      helper use ho raha hai.

      Normal user → sirf accessible invoice
      Superadmin → existing system rules same
    */

    const deletedInvoice =
      await Invoice.findOneAndDelete(
        getOwnedResourceFilter(req, id)
      );


    /*
      Invoice exist nahi karta ya
      current user ko access nahi hai.

      Dono case me resource expose nahi karenge.
    */

    if (!deletedInvoice) {
      return res.status(404).json({
        message: "Invoice not found",
      });
    }


    return res.status(200).json({
      message:
        "Invoice deleted successfully",

      invoice: {
        id: deletedInvoice._id,

        invoiceNumber:
          deletedInvoice.invoiceNumber,
      },
    });

  } catch (error) {
    console.error(
      "Delete invoice error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to delete invoice. Please try again.",
    });
  }
};


/* ─────────────────────────────────────────────
   Send Invoice By Email
───────────────────────────────────────────── */

exports.sendInvoiceByEmail =
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        recipientEmail,
        subject,
        message,
      } = req.body;


      /* Validate invoice ID */

      if (
        !mongoose.Types
          .ObjectId
          .isValid(id)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid invoice ID",
          });
      }


      /*
        IMPORTANT:
        Same existing invoice ownership
        logic use kar rahe hain.
      */

      const invoice =
        await Invoice.findOne(
          getOwnedResourceFilter(
            req,
            id
          )
        ).lean();


      if (!invoice) {
        return res
          .status(404)
          .json({
            message:
              "Invoice not found",
          });
      }


      /*
        Registered email fallback.

        Frontend custom email bhej sakta hai.
        Agar nahi bheja, saved customer
        snapshot email use hogi.
      */

      const email =
        String(
          recipientEmail ||
            invoice
              .customerSnapshot
              ?.email ||
            ""
        )
          .trim()
          .toLowerCase();


      if (
        !email ||
        !validator.isEmail(
          email
        )
      ) {
        return res
          .status(400)
          .json({
            message:
              "Please provide a valid recipient email.",
          });
      }


      const businessName =
        invoice
          .businessSnapshot
          ?.name ||
        "Business";


      const customerName =
        invoice
          .customerSnapshot
          ?.contactPerson ||
        invoice
          .customerSnapshot
          ?.companyName ||
        "Customer";


      /*
        Subject me newline allow nahi
        karenge.
      */

      const emailSubject =
        String(
          subject ||
            `Invoice ${invoice.invoiceNumber} from ${businessName}`
        )
          .replace(
            /[\r\n]+/g,
            " "
          )
          .trim()
          .slice(0, 200);


      const emailMessage =
        String(
          message ||
            `Hello ${customerName},

Please find attached invoice ${invoice.invoiceNumber}.

Invoice Amount: INR ${Number(
              invoice.grandTotal ||
                0
            ).toFixed(2)}

Thank you.

Regards,
${businessName}`
        )
          .trim()
          .slice(0, 5000);


      try {
        await sendInvoiceEmail({
          invoice,
          to: email,
          subject:
            emailSubject,
          message:
            emailMessage,
        });

      } catch (mailError) {
        console.error(
          "Invoice email error:",
          mailError
        );

        return res
          .status(502)
          .json({
            message:
              "Unable to send invoice email. Please check email configuration and try again.",
          });
      }


      return res
        .status(200)
        .json({
          message:
            `Invoice sent successfully to ${email}`,

          recipientEmail:
            email,
        });

    } catch (error) {
      console.error(
        "Send invoice error:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Unable to send invoice. Please try again.",
        });
    }
  };

