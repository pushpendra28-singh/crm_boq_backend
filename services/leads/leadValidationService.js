const validator = require("validator");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const tempDomains = [
  "tempmail.com",
  "mailinator.com",
  "10minutemail.com",
];

exports.validateLead = (lead) => {
  const issues = [];

  // Name validation
  if (!lead.name || lead.name.length < 2) {
    issues.push("Invalid name");
  }

  // Phone validation
  const phone = parsePhoneNumberFromString(lead.whatsapp, "IN");

  if (!phone || !phone.isValid()) {
    issues.push("Invalid phone number");
  }

  // Email validation
  if (lead.email) {
    if (!validator.isEmail(lead.email)) {
      issues.push("Invalid email");
    }

    const domain = lead.email.split("@")[1];

    if (tempDomains.includes(domain)) {
      issues.push("Temporary email");
    }
  }

  // Spam keywords
  const spamWords = [
    "test",
    "demo",
    "asdf",
    "qwerty",
    "fake",
    "spam",
  ];

  const combined = JSON.stringify(lead).toLowerCase();

  spamWords.forEach((w) => {
    if (combined.includes(w)) {
      issues.push(`Spam keyword: ${w}`);
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
};


exports.getValidationDetails = (lead) => {
  const { valid, issues } = exports.validateLead(lead);

  const phone = parsePhoneNumberFromString(lead.whatsapp || "", "IN");
  const phoneVerified = !!(phone && phone.isValid());

  let emailVerified = false;
  if (lead.email && validator.isEmail(lead.email)) {
    const domain = lead.email.split("@")[1];
    emailVerified = !tempDomains.includes(domain);
  }

  return {
    valid,
    issues,
    phoneVerified,
    emailVerified,
    validationFlags: issues, // alias for frontend
  };
};
