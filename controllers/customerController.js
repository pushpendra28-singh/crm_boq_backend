const mongoose = require("mongoose");
const Customer = require("../models/Customer");


/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

const cleanString = (value) => {
  return typeof value === "string" ? value.trim(): "";};


const normalizeEmail = (value) => {
  return cleanString(value).toLowerCase();
};


const normalizeGstin = (value) => {
  return cleanString(value).toUpperCase();
};


const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;


/* ─────────────────────────────────────────────
   Create Customer
───────────────────────────────────────────── */

exports.createCustomer = async (req, res) => {
  try {
    /*
      attachOwner middleware already sets:

      req.ownerId = logged-in user's _id
    */

    if (!req.ownerId) {
      return res.status(401).json({
        message: "Authenticated user not found",
      });
    }


    /*
      IMPORTANT:

      ownerId body se nahi lenge.

      User agar request me manually:

      {
        ownerId: "someone-else-id"
      }

      bhej bhi de, ignore ho jayega.
    */

    const {
      companyName,
      contactPerson,
      email,
      phone,
      address,
      gstin,
    } = req.body;


    /* ───────── Normalize ───────── */

    const normalizedCompanyName =
      cleanString(companyName);

    const normalizedContactPerson =
      cleanString(contactPerson);

    const normalizedEmail =
      normalizeEmail(email);

    const normalizedPhone =
      cleanString(phone);

    const normalizedAddress =
      cleanString(address);

    const normalizedGstin =
      normalizeGstin(gstin);


    /* ───────── Validation ───────── */

    if (!normalizedCompanyName) {
      return res.status(400).json({
        message: "Customer company name is required",
      });
    }


    if (
      normalizedEmail &&
      !EMAIL_REGEX.test(normalizedEmail)
    ) {
      return res.status(400).json({
        message: "Please enter a valid customer email",
      });
    }


    if (normalizedPhone) {
      const phoneDigits =
        normalizedPhone.replace(/\D/g, "");

      if (
        phoneDigits.length < 7 ||
        phoneDigits.length > 15
      ) {
        return res.status(400).json({
          message:
            "Customer phone number must contain 7 to 15 digits",
        });
      }
    }


    if (
      normalizedGstin &&
      !GSTIN_REGEX.test(normalizedGstin)
    ) {
      return res.status(400).json({
        message: "Please enter a valid GSTIN",
      });
    }


    /* ───────── Create ───────── */

    const customer =
      await Customer.create({
        /*
          Server-side ownership.

          Body ownerId kabhi use nahi kar rahe.
        */
        ownerId: req.ownerId,

        companyName:
          normalizedCompanyName,

        contactPerson:
          normalizedContactPerson,

        email:
          normalizedEmail,

        phone:
          normalizedPhone,

        address:
          normalizedAddress,

        gstin:
          normalizedGstin,
      });


    return res.status(201).json({
      message:
        "Customer created successfully",

      customer: {
        id: customer._id,

        companyName:
          customer.companyName,

        contactPerson:
          customer.contactPerson,

        email:
          customer.email,

        phone:
          customer.phone,

        address:
          customer.address,

        gstin:
          customer.gstin,

        createdAt:
          customer.createdAt,

        updatedAt:
          customer.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "Create customer error:",
      error
    );


    if (
      error?.name === "ValidationError"
    ) {
      return res.status(400).json({
        message:
          Object.values(
            error.errors
          )[0]?.message ||
          "Invalid customer data",
      });
    }


    return res.status(500).json({
      message:
        "Unable to create customer. Please try again.",
    });
  }
};


/* ─────────────────────────────────────────────
   Get Logged-in User Customers
───────────────────────────────────────────── */

exports.getMyCustomers = async (req, res) => {
  try {
    if (!req.ownerId) {
      return res.status(401).json({
        message: "Authenticated user not found",
      });
    }


    /*
      IMPORTANT:

      getOwnershipFilter(req) use nahi kar rahe.

      Hume superadmin ko bhi Create Invoice
      dropdown me sirf apne customers dikhane hain.
    */

    const customers =
      await Customer.find({
        ownerId: req.ownerId,
      })
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .lean();


    const formattedCustomers =
      customers.map(
        (customer) => ({
          id: customer._id,

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

          createdAt:
            customer.createdAt,

          updatedAt:
            customer.updatedAt,
        })
      );


    return res.status(200).json({
      message:
        "Customers fetched successfully",

      customers:
        formattedCustomers,
    });
  } catch (error) {
    console.error(
      "Get customers error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to fetch customers. Please try again.",
    });
  }
};


/* ─────────────────────────────────────────────
   Get Single Own Customer
───────────────────────────────────────────── */

exports.getMyCustomerById = async (req, res) => {
  try {
    if (!req.ownerId) {
      return res.status(401).json({
        message: "Authenticated user not found",
      });
    }


    const { id } = req.params;


    /* Validate MongoDB ObjectId */

    if (
      !mongoose.Types.ObjectId.isValid(
        id
      )
    ) {
      return res.status(400).json({
        message: "Invalid customer ID",
      });
    }


    /*
      Ye sabse important isolation query hai.

      Customer id + logged-in owner's id
      dono match hone chahiye.
    */

    const customer =
      await Customer.findOne({
        _id: id,
        ownerId: req.ownerId,
      }).lean();


    /*
      Agar customer exist karta hai lekin
      kisi aur user ka hai tab bhi 404.

      Isse hum attacker ko ye information
      bhi nahi dete ki customer actually exists.
    */

    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }


    return res.status(200).json({
      message:
        "Customer fetched successfully",

      customer: {
        id: customer._id,

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

        createdAt:
          customer.createdAt,

        updatedAt:
          customer.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "Get customer error:",
      error
    );

    return res.status(500).json({
      message:
        "Unable to fetch customer. Please try again.",
    });
  }
};

/* ─────────────────────────────────────────────
   Update Own Customer
───────────────────────────────────────────── */

exports.updateMyCustomer = async (req, res) => {
  try {
    /*
      attachOwner middleware already sets:

      req.ownerId = logged-in user's _id
    */

    if (!req.ownerId) {
      return res.status(401).json({
        message: "Authenticated user not found",
      });
    }


    const { id } = req.params;


    /* ───────── Validate Customer ID ───────── */

    if (
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      return res.status(400).json({
        message: "Invalid customer ID",
      });
    }


    /*
      IMPORTANT:

      ownerId body se kabhi accept nahi karenge.

      Sirf editable customer fields hi request
      se lenge.
    */

    const {
      companyName,
      contactPerson,
      email,
      phone,
      address,
      gstin,
    } = req.body;


    /* ───────── Normalize ───────── */

    const normalizedCompanyName =
      cleanString(companyName);

    const normalizedContactPerson =
      cleanString(contactPerson);

    const normalizedEmail =
      normalizeEmail(email);

    const normalizedPhone =
      cleanString(phone);

    const normalizedAddress =
      cleanString(address);

    const normalizedGstin =
      normalizeGstin(gstin);


    /* ───────── Validation ───────── */

    if (!normalizedCompanyName) {
      return res.status(400).json({
        message:
          "Customer company name is required",
      });
    }


    if (
      normalizedEmail &&
      !EMAIL_REGEX.test(
        normalizedEmail
      )
    ) {
      return res.status(400).json({
        message:
          "Please enter a valid customer email",
      });
    }


    if (normalizedPhone) {
      const phoneDigits =
        normalizedPhone.replace(
          /\D/g,
          ""
        );

      if (
        phoneDigits.length < 7 ||
        phoneDigits.length > 15
      ) {
        return res.status(400).json({
          message:
            "Customer phone number must contain 7 to 15 digits",
        });
      }
    }


    if (
      normalizedGstin &&
      !GSTIN_REGEX.test(
        normalizedGstin
      )
    ) {
      return res.status(400).json({
        message:
          "Please enter a valid GSTIN",
      });
    }


    /* ───────── Secure Update ───────── */

    const customer =
      await Customer.findOneAndUpdate(
        {
          /*
            Customer ID + owner ID dono
            match hone chahiye.

            Yahi actual ownership isolation hai.
          */

          _id: id,

          ownerId:
            req.ownerId,
        },

        {
          /*
            ownerId yahan intentionally nahi hai.

            Customer ownership edit ke through
            transfer nahi ho sakti.
          */

          companyName:
            normalizedCompanyName,

          contactPerson:
            normalizedContactPerson,

          email:
            normalizedEmail,

          phone:
            normalizedPhone,

          address:
            normalizedAddress,

          gstin:
            normalizedGstin,
        },

        {
          /*
            Updated document return karo.
          */
          new: true,

          /*
            Mongoose schema validation bhi
            update ke time run hogi.
          */
          runValidators: true,
        }
      ).lean();


    /*
      Customer:
      - exist nahi karta
      OR
      - kisi aur user ka hai

      dono cases me same 404.

      Security ke liye ye better hai.
    */

    if (!customer) {
      return res.status(404).json({
        message:
          "Customer not found",
      });
    }


    /* ───────── Response ───────── */

    return res.status(200).json({
      message:
        "Customer updated successfully",

      customer: {
        id:
          customer._id,

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

        createdAt:
          customer.createdAt,

        updatedAt:
          customer.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "Update customer error:",
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
          "Invalid customer data",
      });
    }


    return res.status(500).json({
      message:
        "Unable to update customer. Please try again.",
    });
  }
};