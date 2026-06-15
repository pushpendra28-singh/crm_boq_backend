const express = require("express");
const router = express.Router();
const sendEmail = require("../utils/sendEmail");

// ─── Shared Email Template Builder ───────────────────────────────────────────

/**
 * Wraps lead fields in a professional, branded HTML email layout.
 * @param {string} title       - Email heading (e.g. "Residential Lead")
 * @param {string} badge       - Short category label (e.g. "Residential")
 * @param {string} badgeColor  - Hex color for the badge background
 * @param {{ label: string, value: string }[]} fields - Key-value pairs to display
 * @returns {string} Full HTML email string
 */
function buildLeadEmail(title, badge, badgeColor, fields) {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "short",
  });

  const rows = fields
    .map(
      ({ label, value }) => `
        <tr>
          <td style="
            padding: 12px 16px;
            font-size: 13px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            width: 38%;
            border-bottom: 1px solid #f3f4f6;
            white-space: nowrap;
          ">${label}</td>
          <td style="
            padding: 12px 16px;
            font-size: 15px;
            color: #111827;
            border-bottom: 1px solid #f3f4f6;
          ">${value || "<span style='color:#9ca3af;font-style:italic;'>Not provided</span>"}</td>
        </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="
  margin: 0;
  padding: 0;
  background-color: #f9fafb;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="
              background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
              border-radius: 12px 12px 0 0;
              padding: 32px 36px;
            ">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="
                      margin: 0 0 6px 0;
                      font-size: 11px;
                      font-weight: 700;
                      letter-spacing: 0.15em;
                      text-transform: uppercase;
                      color: #93c5fd;
                    ">New Inquiry Received</p>
                    <h1 style="
                      margin: 0;
                      font-size: 24px;
                      font-weight: 700;
                      color: #ffffff;
                      line-height: 1.3;
                    ">${title}</h1>
                  </td>
                  <td align="right" style="vertical-align: top;">
                    <span style="
                      display: inline-block;
                      background-color: ${badgeColor};
                      color: #ffffff;
                      font-size: 11px;
                      font-weight: 700;
                      letter-spacing: 0.08em;
                      text-transform: uppercase;
                      padding: 5px 12px;
                      border-radius: 999px;
                    ">${badge}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="
              background-color: #ffffff;
              padding: 32px 36px;
              border-left: 1px solid #e5e7eb;
              border-right: 1px solid #e5e7eb;
            ">
              <p style="
                margin: 0 0 20px 0;
                font-size: 14px;
                color: #6b7280;
                line-height: 1.6;
              ">
                A new lead has been submitted through the website. Please review the details below and follow up promptly.
              </p>

              <!-- Fields Table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                overflow: hidden;
                border-collapse: collapse;
              ">
                ${rows}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="
              background-color: #f8fafc;
              border: 1px solid #e5e7eb;
              border-top: none;
              border-radius: 0 0 12px 12px;
              padding: 20px 36px;
            ">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                      🕐 Received on <strong style="color: #6b7280;">${now} IST</strong>
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                      This is an automated notification. Do not reply to this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/* ── CONTACT US ── */
router.post("/contact-us", async (req, res) => {
  try {
    const { fullName, companyName, phone, email, subject, message } = req.body;

    const html = buildLeadEmail(
      "Contact Us Inquiry",
      "Contact",
      "#2563eb",
      [
        { label: "Full Name",    value: fullName },
        { label: "Company",      value: companyName },
        { label: "Phone",        value: phone },
        { label: "Email",        value: email },
        { label: "Subject",      value: subject },
        { label: "Message",      value: message },
      ]
    );

    await sendEmail("New Contact Lead", html);
    res.json({ msg: "Contact form submitted" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── RESIDENTIAL ── */
router.post("/residential", async (req, res) => {
  try {
    const { fullname, pincode, whatsappnumber, bill, agree } = req.body;

    if (!agree) return res.status(400).json({ msg: "Terms not accepted" });

    const html = buildLeadEmail(
      "Residential Solar Inquiry",
      "Residential",
      "#16a34a",
      [
        { label: "Full Name",       value: fullname },
        { label: "Pincode",         value: pincode },
        { label: "WhatsApp Number", value: whatsappnumber },
        { label: "Monthly Bill",    value: bill },
      ]
    );

    await sendEmail("Residential Lead", html);
    res.json({ msg: "Residential form submitted" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── HOUSING SOCIETY ── */
router.post("/housingsociety", async (req, res) => {
  try {
    const { fullname, societyName, pincode, whatsapp, bill, designation, agmStatus, agree } = req.body;

    if (!agree) return res.status(400).json({ msg: "Terms not accepted" });

    const html = buildLeadEmail(
      "Housing Society Solar Inquiry",
      "Society",
      "#7c3aed",
      [
        { label: "Full Name",    value: fullname },
        { label: "Society Name", value: societyName },
        { label: "Pincode",      value: pincode },
        { label: "WhatsApp",     value: whatsapp },
        { label: "Monthly Bill", value: bill },
        { label: "Designation",  value: designation },
        { label: "AGM Status",   value: agmStatus },
      ]
    );

    await sendEmail("Housing Society Lead", html);
    res.json({ msg: "Housing society form submitted" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── COMMERCIAL ── */
router.post("/commercial", async (req, res) => {
  try {
    const { fullname, companyName, city, whatsapp, bill, agree } = req.body;

    if (!agree) return res.status(400).json({ msg: "Terms not accepted" });

    const html = buildLeadEmail(
      "Commercial Solar Inquiry",
      "Commercial",
      "#ea580c",
      [
        { label: "Full Name",    value: fullname },
        { label: "Company",      value: companyName },
        { label: "City",         value: city },
        { label: "WhatsApp",     value: whatsapp },
        { label: "Monthly Bill", value: bill },
      ]
    );

    await sendEmail("Commercial Lead", html);
    res.json({ msg: "Commercial form submitted" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── CHATBOT QUERY ── */
router.post("/chatbot-query", async (req, res) => {
  try {
    const { name, email, phone, address, query, agree } = req.body;

    if (!agree)           return res.status(400).json({ msg: "Terms not accepted" });
    if (!name || !phone || !query)
                          return res.status(400).json({ msg: "Required fields missing" });

    const html = buildLeadEmail(
      "Chatbot Lead Inquiry",
      "Chatbot",
      "#0891b2",
      [
        { label: "Full Name", value: name },
        { label: "Email",     value: email },
        { label: "Phone",     value: phone },
        { label: "Address",   value: address },
        { label: "Query",     value: query },
      ]
    );

    await sendEmail("Chatbot Lead", html);
    res.json({ success: true, msg: "Query submitted successfully. Our team will contact you shortly." });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;