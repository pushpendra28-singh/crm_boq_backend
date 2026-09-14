/*
 * Business Profile Service
 * ─────────────────────────────────────────────────────────────
 *
 * Responsibilities:
 *
 * 1. Registration/account data se business profile prefill banana.
 *
 * 2. Business profile invoice-ready hai ya nahi,
 *    centrally determine karna.
 *
 * 3. Missing required fields return karna.
 *
 * IMPORTANT:
 * - Ye service ownerId accept nahi karti.
 * - Ye database ownership query nahi karti.
 * - Isolation controller + req.ownerId layer me rahegi.
 * - Ye sirf business-profile domain logic handle karti hai.
 */


/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

const cleanString = (value) =>
  String(value || "").trim();


const normalizeEmail = (value) =>
  cleanString(value).toLowerCase();


const normalizeUppercase = (value) =>
  cleanString(value).toUpperCase();


/* ─────────────────────────────────────────────
   Registration → Business Profile Prefill
───────────────────────────────────────────── */

/*
 * BusinessProfile abhi create nahi hui ho,
 * tab Admin account ke existing data se
 * popup/form ko prefill karne ke liye.
 *
 * IMPORTANT:
 * Ye Admin.profile ko permanent business source
 * nahi banata.
 *
 * Once BusinessProfile exists,
 * BusinessProfile itself becomes source of truth.
 */
const buildBusinessProfilePrefill = (admin) => {
  if (!admin) {
    return {
      businessName: "",
      businessType: "",
      logoUrl: "",
      authorizedSignatory: "",

      email: "",
      phone: "",
      website: "",

      address: {
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
      },

      gstRegistered: false,
      gstin: "",

      bank: {
        accountName: "",
        bankName: "",
        accountNumber: "",
        ifsc: "",
      },
    };
  }


  const profile =
    admin.profile || {};

  const registrationBank =
    profile.bankDetails || {};

  const registeredGstin =
    normalizeUppercase(
      profile.gstin
    );


  /*
   * BUSINESS ACCOUNT:
   * Registration ka businessName preferred.
   *
   * PERSONAL ACCOUNT:
   * User ka account name initial display/business
   * name ke roop me use hoga.
   *
   * User popup me isse edit kar sakta hai.
   */
  const businessName =
    admin.accountType === "business"
      ? cleanString(
          profile.businessName
        ) || cleanString(admin.name)
      : cleanString(admin.name);


  return {
    businessName,

    businessType:
      cleanString(
        profile.businessType
      ),

    /*
     * Registration me logo currently nahi liya ja raha,
     * therefore blank.
     */
    logoUrl: "",

    /*
     * Account owner name useful professional prefill hai.
     * User save se pehle change kar sakta hai.
     */
    authorizedSignatory:
      cleanString(admin.name),

    /*
     * Account email ko business email ke initial
     * prefill ke roop me use karenge.
     *
     * BusinessProfile me save hone ke baad user
     * isse independently update kar sakta hai.
     */
    email:
      normalizeEmail(
        admin.email
      ),

    phone:
      cleanString(
        profile.phone
      ),

    website: "",


    /*
     * Existing registration address ek plain
     * string hai.
     *
     * Isliye safe migration/prefill:
     *
     * old address
     *      ↓
     * address.line1
     *
     * User modal me city/state/pincode
     * separately complete karega.
     */
    address: {
      line1:
        cleanString(
          profile.address
        ),

      line2: "",

      city: "",

      state: "",

      postalCode: "",

      country: "India",
    },


    /*
     * Agar registration me valid-looking GSTIN
     * already present hai, initial GST status
     * registered maan sakte hain.
     *
     * User modal me ise change kar sakta hai.
     */
    gstRegistered:
      Boolean(registeredGstin),

    gstin:
      registeredGstin,


    /*
     * Registration naming:
     * accountHolderName
     *
     * BusinessProfile canonical naming:
     * accountName
     */
    bank: {
      accountName:
        cleanString(
          registrationBank
            .accountHolderName
        ),

      bankName:
        cleanString(
          registrationBank.bankName
        ),

      accountNumber:
        cleanString(
          registrationBank
            .accountNumber
        ),

      ifsc:
        normalizeUppercase(
          registrationBank.ifsc
        ),
    },
  };
};


/* ─────────────────────────────────────────────
   Business Profile Completion
───────────────────────────────────────────── */

/*
 * IMPORTANT:
 *
 * "Mongo document valid hai"
 * aur
 * "Invoice create karne ke liye profile complete hai"
 * dono different concepts hain.
 *
 * Schema partial profile save karne deta hai.
 * Ye function decide karega invoice access milega ya nahi.
 */
const getBusinessProfileCompletion = (
  profile
) => {
  if (!profile) {
    return {
      isComplete: false,

      missingFields: [
        "businessName",
        "logoUrl",
        "authorizedSignatory",
        "email",
        "phone",
        "address.line1",
        "address.city",
        "address.state",
        "address.postalCode",
        "address.country",
        "gstRegistered",
        "bank.accountName",
        "bank.bankName",
        "bank.accountNumber",
        "bank.ifsc",
      ],
    };
  }


  const missingFields = [];


  /* ───────── Business Identity ───────── */

  if (
    !cleanString(
      profile.businessName
    )
  ) {
    missingFields.push(
      "businessName"
    );
  }


  if (
    !cleanString(
      profile.logoUrl
    )
  ) {
    missingFields.push(
      "logoUrl"
    );
  }


  if (
    !cleanString(
      profile.authorizedSignatory
    )
  ) {
    missingFields.push(
      "authorizedSignatory"
    );
  }


  /* ───────── Contact ───────── */

  if (
    !cleanString(
      profile.email
    )
  ) {
    missingFields.push(
      "email"
    );
  }


  if (
    !cleanString(
      profile.phone
    )
  ) {
    missingFields.push(
      "phone"
    );
  }


  /* ───────── Address ───────── */

  const address =
    profile.address || {};


  if (
    !cleanString(
      address.line1
    )
  ) {
    missingFields.push(
      "address.line1"
    );
  }


  if (
    !cleanString(
      address.city
    )
  ) {
    missingFields.push(
      "address.city"
    );
  }


  if (
    !cleanString(
      address.state
    )
  ) {
    missingFields.push(
      "address.state"
    );
  }


  if (
    !cleanString(
      address.postalCode
    )
  ) {
    missingFields.push(
      "address.postalCode"
    );
  }


  if (
    !cleanString(
      address.country
    )
  ) {
    missingFields.push(
      "address.country"
    );
  }


  /* ───────── GST ───────── */

  /*
   * Boolean false valid answer hai.
   *
   * Isliye false ko missing nahi maanna.
   *
   * Only undefined/null means user ne
   * GST registration status choose nahi kiya.
   */
  if (
    typeof profile.gstRegistered !==
    "boolean"
  ) {
    missingFields.push(
      "gstRegistered"
    );
  }


  /*
   * GSTIN sirf GST registered business
   * ke liye required hai.
   */
  if (
    profile.gstRegistered === true &&
    !cleanString(profile.gstin)
  ) {
    missingFields.push(
      "gstin"
    );
  }


  /* ───────── Bank Details ───────── */

  const bank =
    profile.bank || {};


  if (
    !cleanString(
      bank.accountName
    )
  ) {
    missingFields.push(
      "bank.accountName"
    );
  }


  if (
    !cleanString(
      bank.bankName
    )
  ) {
    missingFields.push(
      "bank.bankName"
    );
  }


  if (
    !cleanString(
      bank.accountNumber
    )
  ) {
    missingFields.push(
      "bank.accountNumber"
    );
  }


  if (
    !cleanString(
      bank.ifsc
    )
  ) {
    missingFields.push(
      "bank.ifsc"
    );
  }


  return {
    isComplete:
      missingFields.length === 0,

    missingFields,
  };
};


/* ─────────────────────────────────────────────
   Form Data Resolver
───────────────────────────────────────────── */

/*
 * Frontend ko ek consistent object milega.
 *
 * CASE 1:
 * BusinessProfile exists
 * → existing profile hi edit hoga.
 *
 * CASE 2:
 * BusinessProfile missing
 * → Admin registration data se prefill.
 */
const getBusinessProfileFormData = ({
  admin,
  profile,
}) => {
  if (profile) {
    return {
      businessName:
        cleanString(
          profile.businessName
        ),

      businessType:
        cleanString(
          profile.businessType
        ),

      logoUrl:
        cleanString(
          profile.logoUrl
        ),

      authorizedSignatory:
        cleanString(
          profile
            .authorizedSignatory
        ),

      email:
        normalizeEmail(
          profile.email
        ),

      phone:
        cleanString(
          profile.phone
        ),

      website:
        cleanString(
          profile.website
        ),

      address: {
        line1:
          cleanString(
            profile.address
              ?.line1
          ),

        line2:
          cleanString(
            profile.address
              ?.line2
          ),

        city:
          cleanString(
            profile.address
              ?.city
          ),

        state:
          cleanString(
            profile.address
              ?.state
          ),

        postalCode:
          cleanString(
            profile.address
              ?.postalCode
          ),

        country:
          cleanString(
            profile.address
              ?.country
          ) || "India",
      },

      gstRegistered:
        typeof profile
          .gstRegistered ===
        "boolean"
          ? profile.gstRegistered
          : false,

      gstin:
        normalizeUppercase(
          profile.gstin
        ),

      bank: {
        accountName:
          cleanString(
            profile.bank
              ?.accountName
          ),

        bankName:
          cleanString(
            profile.bank
              ?.bankName
          ),

        accountNumber:
          cleanString(
            profile.bank
              ?.accountNumber
          ),

        ifsc:
          normalizeUppercase(
            profile.bank?.ifsc
          ),
      },
    };
  }


  return buildBusinessProfilePrefill(
    admin
  );
};

/* ─────────────────────────────────────────────
   Business Profile Payload Validation
───────────────────────────────────────────── */

const BUSINESS_EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const IFSC_REGEX =
  /^[A-Z]{4}0[A-Z0-9]{6}$/;


/*
 * Website ko professional normalized format
 * me store karenge.
 *
 * example.com
 *      ↓
 * https://example.com/
 */
const normalizeWebsite = (value) => {
  const website =
    cleanString(value);

  if (!website) {
    return "";
  }

  const withProtocol =
    /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`;

  try {
    const parsedUrl =
      new URL(withProtocol);

    if (
      !["http:", "https:"].includes(
        parsedUrl.protocol
      )
    ) {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
};


/*
 * Frontend payload ko directly DB me kabhi
 * spread nahi karenge.
 *
 * Only explicitly allowed fields pick honge.
 *
 * Therefore:
 * ownerId
 * createdBy
 * _id
 * timestamps
 *
 * request body se inject nahi kiye ja sakte.
 */
const validateAndNormalizeBusinessProfile =
  (input = {}) => {
    const errors = {};


    /* ───────── Business Identity ───────── */

    const businessName =
      cleanString(
        input.businessName
      );

    if (!businessName) {
      errors.businessName =
        "Business name is required.";
    } else if (
      businessName.length > 150
    ) {
      errors.businessName =
        "Business name cannot exceed 150 characters.";
    }


    const businessType =
      cleanString(
        input.businessType
      );

    if (
      businessType.length > 100
    ) {
      errors.businessType =
        "Business type cannot exceed 100 characters.";
    }


    const authorizedSignatory =
      cleanString(
        input.authorizedSignatory
      );

    if (
      authorizedSignatory.length >
      120
    ) {
      errors.authorizedSignatory =
        "Authorized signatory name cannot exceed 120 characters.";
    }


    /*
     * Logo upload next controlled step me
     * implement hoga.
     *
     * Abhi existing logoUrl ko safely accept
     * karenge.
     */
    // const logoUrl =
    //   cleanString(
    //     input.logoUrl
    //   );


    /* ───────── Contact ───────── */

    const email =
      normalizeEmail(
        input.email
      );

    if (
      email &&
      !BUSINESS_EMAIL_REGEX.test(
        email
      )
    ) {
      errors.email =
        "Please enter a valid business email address.";
    }


    const phone =
      cleanString(
        input.phone
      );

    if (phone) {
      const digits =
        phone.replace(
          /\D/g,
          ""
        );

      if (
        digits.length < 10 ||
        digits.length > 15
      ) {
        errors.phone =
          "Please enter a valid phone number.";
      }
    }


    const website =
      normalizeWebsite(
        input.website
      );

    if (
      input.website &&
      website === null
    ) {
      errors.website =
        "Please enter a valid website address.";
    }


    /* ───────── Address ───────── */

    const incomingAddress =
      input.address &&
      typeof input.address ===
        "object" &&
      !Array.isArray(input.address)
        ? input.address
        : {};


    const address = {
      line1:
        cleanString(
          incomingAddress.line1
        ),

      line2:
        cleanString(
          incomingAddress.line2
        ),

      city:
        cleanString(
          incomingAddress.city
        ),

      state:
        cleanString(
          incomingAddress.state
        ),

      postalCode:
        cleanString(
          incomingAddress
            .postalCode
        ),

      country:
        cleanString(
          incomingAddress.country
        ) || "India",
    };


    /*
     * India ke case me PIN code validation.
     *
     * International users ke liye unnecessarily
     * 6-digit rule force nahi karenge.
     */
    if (
      address.postalCode &&
      address.country.toLowerCase() ===
        "india" &&
      !/^[1-9][0-9]{5}$/.test(
        address.postalCode
      )
    ) {
      errors["address.postalCode"] =
        "Please enter a valid 6-digit PIN code.";
    }


    /* ───────── GST ───────── */

    const gstRegistered =
      input.gstRegistered === true;


    const gstin =
      normalizeUppercase(
        input.gstin
      );


    if (
      gstRegistered &&
      !gstin
    ) {
      errors.gstin =
        "GSTIN is required for a GST registered business.";
    } else if (
      gstRegistered &&
      !GSTIN_REGEX.test(gstin)
    ) {
      errors.gstin =
        "Please enter a valid GSTIN.";
    }


    /*
     * GST registered = false ho to stale GSTIN
     * database me preserve nahi karenge.
     */
    const normalizedGstin =
      gstRegistered
        ? gstin
        : "";


    /* ───────── Bank Details ───────── */

    const incomingBank =
      input.bank &&
      typeof input.bank ===
        "object" &&
      !Array.isArray(input.bank)
        ? input.bank
        : {};


    const bank = {
      accountName:
        cleanString(
          incomingBank.accountName
        ),

      bankName:
        cleanString(
          incomingBank.bankName
        ),

      accountNumber:
        cleanString(
          incomingBank.accountNumber
        ),

      ifsc:
        normalizeUppercase(
          incomingBank.ifsc
        ),
    };


    if (
      bank.ifsc &&
      !IFSC_REGEX.test(bank.ifsc)
    ) {
      errors["bank.ifsc"] =
        "Please enter a valid IFSC code.";
    }


    /* ───────── Result ───────── */

    return {
      isValid:
        Object.keys(errors)
          .length === 0,

      errors,

      data: {
        businessName,
        businessType,
        // logoUrl,
        authorizedSignatory,

        email,
        phone,

        website:
          website || "",

        address,

        gstRegistered,
        gstin:
          normalizedGstin,

        bank,
      },
    };
  };


module.exports = {
  buildBusinessProfilePrefill,
  getBusinessProfileCompletion,
  getBusinessProfileFormData,
  validateAndNormalizeBusinessProfile,

};