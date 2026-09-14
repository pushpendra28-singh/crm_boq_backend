const nodemailer =
  require("nodemailer");

const {
  renderInvoicePdfBuffer,
} = require(
  "../generated/invoiceEngine.cjs"
);


/*
  =====================================================
  HELPERS
  =====================================================
*/

const toNumber = (value) => {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
};


const createSafeFilename = (
  value
) => {
  return String(
    value || "invoice"
  )
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    )
    .slice(0, 80);
};


/*
  =====================================================
  NORMALIZE SAVED INVOICE
  =====================================================

  Database invoice ko exactly us common shape
  me convert karta hai jo React-PDF templates
  expect karte hain.

  Template-specific logic yahan nahi hai.
*/

const normalizeInvoiceForPdf = (
  invoice
) => {
  const customer =
    invoice.customerSnapshot ||
    {};

  const business =
    invoice.businessSnapshot ||
    {};


  return {
    id:
      invoice.id ||
      invoice._id ||
      null,

    invoiceNumber:
      invoice.invoiceNumber || "",

    invoiceDate:
      invoice.invoiceDate ||
      null,

    dueDate:
      invoice.dueDate ||
      null,

    paymentTerms:
      invoice.paymentTerms ??
      "",

    status:
      invoice.status ||
      "unpaid",


    /*
      Customer
    */

    customer: {
      companyName:
        customer.companyName ||
        "",

      contactPerson:
        customer.contactPerson ||
        "",

      email:
        customer.email ||
        "",

      phone:
        customer.phone ||
        "",

      address:
        customer.address ||
        "",

      gstin:
        customer.gstin ||
        "",
    },


    /*
      Business
    */

    business: {
      name:
        business.name ||
        "",

     logoUrl:
  business.logoUrl
    ? /^https?:\/\//i.test(
        business.logoUrl
      )
      ? business.logoUrl
      : new URL(
          business.logoUrl,
          process.env.APP_BASE_URL
        ).toString()
    : "",

      email:
        business.email ||
        "",

      phone:
        business.phone ||
        "",

      address:
        business.address ||
        "",

      gstin:
        business.gstin ||
        "",

      bank: {
        accountName:
          business.bank
            ?.accountName ||
          "",

        bankName:
          business.bank
            ?.bankName ||
          "",

        accountNumber:
          business.bank
            ?.accountNumber ||
          "",

        ifsc:
          business.bank
            ?.ifsc ||
          "",
      },

      authorizedSignatory:
        business
          .authorizedSignatory ||
        "",
    },


    /*
      Items
    */

    items:
      Array.isArray(
        invoice.items
      )
        ? invoice.items.map(
            (item, index) => {
              const quantity =
                toNumber(
                  item.quantity
                );

              const rate =
                toNumber(
                  item.rate
                );

              return {
                id:
                  item.id ||
                  item._id ||
                  `invoice-item-${index}`,

                description:
                  item.description ||
                  "",

                quantity,

                rate,

                amount:
                  item.amount !==
                    undefined &&
                  item.amount !==
                    null
                    ? toNumber(
                        item.amount
                      )
                    : quantity *
                      rate,
              };
            }
          )
        : [],


    /*
      Totals
    */

    discountType:
      invoice.discountType ||
      "percentage",

    discountValue:
      toNumber(
        invoice.discountValue
      ),

    subtotal:
      toNumber(
        invoice.subtotal
      ),

    discountAmount:
      toNumber(
        invoice.discountAmount
      ),

    taxableAmount:
      toNumber(
        invoice.taxableAmount
      ),

    taxEnabled:
      Boolean(
        invoice.taxEnabled
      ),

    taxRate:
      toNumber(
        invoice.taxRate
      ),

    taxAmount:
      toNumber(
        invoice.taxAmount
      ),

    additionalChargeName:
      invoice
        .additionalChargeName ||
      "",

    additionalChargeAmount:
      toNumber(
        invoice
          .additionalChargeAmount
      ),

    grandTotal:
      toNumber(
        invoice.grandTotal
      ),

    notes:
      invoice.notes ||
      "",

    terms:
      invoice.terms ||
      "",


    /*
      Most important:

      Saved invoice ka exact template
      key + version preserve rahega.
    */

    template: {
      key:
        invoice.template?.key ||
        "modern",

      version:
        Number(
          invoice.template
            ?.version
        ) || 1,
    },

    createdBy:
      invoice.createdBy ||
      null,

    createdAt:
      invoice.createdAt ||
      null,
  };
};


/*
  =====================================================
  SEND INVOICE EMAIL
  =====================================================
*/

const sendInvoiceEmail =
  async ({
    invoice,
    to,
    subject,
    message,
  }) => {
    if (
      !process.env.MAIL_HOST ||
      !process.env.EMAIL_USERNAME ||
      !process.env.EMAIL_PASSWORD ||
      !process.env.MAIL_FROM_ADDRESS
    ) {
      throw new Error(
        "Email SMTP configuration is incomplete."
      );
    }


    /*
      Existing SMTP configuration.
      Isko change nahi kar rahe.
    */

    const transporter =
      nodemailer.createTransport({
        host:
          process.env.MAIL_HOST,

        port:
          Number(
            process.env
              .MAIL_PORT ||
              465
          ),

        secure:
          process.env
            .MAIL_ENCRYPTION ===
          "ssl",

        auth: {
          user:
            process.env
              .EMAIL_USERNAME,

          pass:
            process.env
              .EMAIL_PASSWORD,
        },
      });


    /*
      Database invoice
           ↓
      Common invoice shape
    */

    const normalizedInvoice =
      normalizeInvoiceForPdf(
        invoice
      );


    /*
      =================================================
      IMPORTANT

      Ab PDFKit nahi.

      Saved invoice ke template.key/version ke
      according same React-PDF template render hoga.
      =================================================
    */

    const pdfBuffer =
      await renderInvoicePdfBuffer(
        {
          invoice:
            normalizedInvoice,

          template:
            normalizedInvoice
              .template,
        }
      );


    const businessName =
      normalizedInvoice
        .business?.name ||
      "Business";


    const safeBusinessName =
      String(
        businessName
      )
        .replace(
          /["\r\n]/g,
          ""
        )
        .trim();


    const fromEmail =
      process.env
        .MAIL_FROM_ADDRESS;


    return transporter.sendMail({
      from:
        `"${safeBusinessName}" <${fromEmail}>`,

      to,

      subject,

      text:
        message,

      attachments: [
        {
          filename:
            `${createSafeFilename(
              normalizedInvoice
                .invoiceNumber
            )}.pdf`,

          content:
            pdfBuffer,

          contentType:
            "application/pdf",
        },
      ],
    });
  };


module.exports = {
  sendInvoiceEmail,
};