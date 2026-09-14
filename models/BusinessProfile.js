const mongoose = require("mongoose");


/* ─────────────────────────────────────────────
   Business Address
───────────────────────────────────────────── */

const businessAddressSchema =
  new mongoose.Schema(
    {
      line1: {
        type: String,
        trim: true,
        default: "",
      },

      line2: {
        type: String,
        trim: true,
        default: "",
      },

      city: {
        type: String,
        trim: true,
        default: "",
      },

      state: {
        type: String,
        trim: true,
        default: "",
      },

      postalCode: {
        type: String,
        trim: true,
        default: "",
      },

      country: {
        type: String,
        trim: true,
        default: "India",
      },
    },
    {
      _id: false,
    }
  );


/* ─────────────────────────────────────────────
   Bank Details
───────────────────────────────────────────── */

const bankDetailsSchema =
  new mongoose.Schema(
    {
      accountName: {
        type: String,
        trim: true,
        default: "",
      },

      bankName: {
        type: String,
        trim: true,
        default: "",
      },

      accountNumber: {
        type: String,
        trim: true,
        default: "",
      },

      ifsc: {
        type: String,
        trim: true,
        uppercase: true,
        default: "",
      },
    },
    {
      _id: false,
    }
  );


/* ─────────────────────────────────────────────
   Business Profile
───────────────────────────────────────────── */

const businessProfileSchema =
  new mongoose.Schema(
    {
      /*
        SECURITY + ISOLATION

        One authenticated user currently owns
        exactly one BusinessProfile.

        ownerId request body se kabhi accept
        nahi kiya jayega.
      */
      ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true,
        unique: true,
        index: true,
      },


      /* ───────── Business identity ───────── */

      businessName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150,
      },

      businessType: {
        type: String,
        trim: true,
        maxlength: 100,
        default: "",
      },

      logoUrl: {
        type: String,
        trim: true,
        default: "",
      },

      authorizedSignatory: {
        type: String,
        trim: true,
        maxlength: 120,
        default: "",
      },


      /* ───────── Contact ───────── */

      email: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 150,
        default: "",
      },

      phone: {
        type: String,
        trim: true,
        maxlength: 30,
        default: "",
      },

      website: {
        type: String,
        trim: true,
        maxlength: 250,
        default: "",
      },


      /* ───────── Address ───────── */

      address: {
        type: businessAddressSchema,
        default: () => ({}),
      },


      /* ───────── Tax ───────── */

      gstRegistered: {
        type: Boolean,
        default: false,
      },

      gstin: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 15,
        default: "",
      },


      /* ───────── Payment details ───────── */

      bank: {
        type: bankDetailsSchema,
        default: () => ({}),
      },
    },
    {
      timestamps: true,
    }
  );


module.exports =
  mongoose.model(
    "BusinessProfile",
    businessProfileSchema
  );