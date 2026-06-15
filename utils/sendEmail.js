const nodemailer = require("nodemailer");

const sendEmail = async (subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.in",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const info = await transporter.sendMail({
      from: `"Savorka Bot" <${process.env.EMAIL_USER}>`,
      to: process.env.RECEIVER_EMAIL,
      subject,
      html
    });

    console.log("EMAIL RESPONSE:", info);

  } catch (error) {
    console.log("EMAIL ERROR:", error);
  }
};

module.exports = sendEmail;