const nodemailer = require("nodemailer");

/**
 * Reads SMTP config from your existing .env keys:
 *
 * MAIL_MAILER=smtp
 * MAIL_HOST=smtp.gmail.com
 * MAIL_PORT=465
 * EMAIL_USERNAME=dev.clientg@gmail.com
 * EMAIL_PASSWORD="seav mxog mzxk xlfz"
 * MAIL_ENCRYPTION=ssl
 * MAIL_FROM_ADDRESS="dev.clientg@gmail.com"
 * MAIL_FROM_NAME="Wheedle Technologies"
 *
 * No new env vars needed — this just maps to what's already there.
 */
const mailPort = Number(process.env.MAIL_PORT) || 465;

// port 465 (or MAIL_ENCRYPTION=ssl) => secure connection (TLS from the start)
// port 587 (MAIL_ENCRYPTION=tls/starttls) => secure: false, nodemailer upgrades via STARTTLS
const isSecure =
  mailPort === 465 || (process.env.MAIL_ENCRYPTION || "").toLowerCase() === "ssl";

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: mailPort,
  secure: isSecure,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

/**
 * Sends a tender proposal email to a vendor.
 * `to` is ALWAYS supplied by the caller (sendToVendor controller), pulled
 * fresh from the vendor's DB record for whichever vendor's "Send" button
 * was clicked — nothing here is hardcoded.
 *
 * @param {Object} opts
 * @param {string} opts.to - vendor email (dynamic, passed in by caller)
 * @param {string} opts.vendorName
 * @param {string} opts.tenderTitle
 * @param {string} opts.htmlBody
 * @param {Array}  opts.attachments - nodemailer attachment objects ({ filename, path } or { filename, content })
 */
const sendVendorProposalEmail = async ({ to, vendorName, tenderTitle, htmlBody, attachments = [] }) => {
  const fromName = process.env.MAIL_FROM_NAME || "Tender Management";
  const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.EMAIL_USERNAME;

  const mailOptions = {
    from: `"${fromName}" <${fromAddress}>`, // fixed sender identity
    to,                                      // dynamic receiver (vendor's DB email)
    subject: `New Tender Proposal: ${tenderTitle || "Project BOQ"}`,
    html: htmlBody,
    attachments,
  };

  return transporter.sendMail(mailOptions);
};

module.exports = { transporter, sendVendorProposalEmail };