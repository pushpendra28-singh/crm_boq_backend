const BusinessProfile =
  require("../models/BusinessProfile");

const {
  getBusinessProfileCompletion,
  getBusinessProfileFormData,
  validateAndNormalizeBusinessProfile,
} = require("../services/invoice/businessProfileService");


const path =
  require("path");


const {
  BUSINESS_LOGO_DIR,
  saveBusinessLogo,
  deleteBusinessLogoFile,
  isSafeLogoFilename,
} = require(
  "../services/invoice/businessLogoStorageService"
);

/*
 * GET MY BUSINESS PROFILE
 * ─────────────────────────────────────────────────────
 *
 * Current authenticated user ka BusinessProfile return
 * karta hai.
 *
 * CASE 1:
 * Profile exists
 * → saved BusinessProfile form data return.
 *
 * CASE 2:
 * Profile does not exist
 * → registration/account details se prefill return.
 *
 * SECURITY:
 * - ownerId request body se nahi aata.
 * - userId params se nahi aata.
 * - req.ownerId authenticated ownership middleware
 *   se aata hai.
 */
exports.getMyBusinessProfile =
  async (req, res) => {
    try {
      /*
       * Defensive check.
       *
       * Normal flow me protect + attachOwner
       * already req.admin and req.ownerId set
       * karenge.
       */
      if (!req.admin || !req.ownerId) {
        return res.status(401).json({
          message:
            "Authentication required",
        });
      }


      /*
       * IMPORTANT ISOLATION:
       *
       * Sirf logged-in user ka profile.
       *
       * Never:
       * req.body.ownerId
       * req.params.userId
       */
      const businessProfile =
        await BusinessProfile.findOne({
          ownerId: req.ownerId,
        }).lean();


      /*
       * Existing profile ho:
       * → BusinessProfile source of truth.
       *
       * Missing ho:
       * → Admin registration data se prefill.
       */
      const formData =
        getBusinessProfileFormData({
          admin: req.admin,
          profile: businessProfile,
        });


      /*
       * Completion actual form data ke against
       * calculate karenge.
       *
       * Isse registration se prefilled values
       * unnecessarily "missing" nahi dikhenge.
       */
      const completion =
        getBusinessProfileCompletion(
          formData
        );


      /*
       * IMPORTANT:
       *
       * Prefill complete-looking ho sakta hai,
       * lekin jab tak BusinessProfile database
       * me save nahi hua tab tak user ko
       * invoice-ready nahi maanenge.
       */
      const profileExists =
        Boolean(businessProfile);

      const isComplete =
        profileExists &&
        completion.isComplete;


      return res.status(200).json({
        profileExists,

        isComplete,

        missingFields:
          completion.missingFields,

        formData,
      });
    } catch (error) {
      console.error(
        "Get business profile error:",
        error
      );

      return res.status(500).json({
        message:
          "Unable to load business profile. Please try again.",
      });
    }
  };


  /*
 * CREATE / UPDATE MY BUSINESS PROFILE
 * ─────────────────────────────────────────────────────
 *
 * PUT /api/business-profile/me
 *
 * Same endpoint:
 *
 * First save
 * → create
 *
 * Existing profile
 * → update
 *
 * SECURITY:
 * ownerId authenticated request se hi aayega.
 */
exports.saveMyBusinessProfile =
  async (req, res) => {
    try {
      if (
        !req.admin ||
        !req.ownerId
      ) {
        return res
          .status(401)
          .json({
            message:
              "Authentication required",
          });
      }


      /*
       * Body ko validate + sanitize.
       *
       * ownerId yahan se generate nahi
       * ho sakta.
       */
      const validation =
        validateAndNormalizeBusinessProfile(
          req.body
        );


      if (!validation.isValid) {
        return res
          .status(400)
          .json({
            message:
              "Please correct the highlighted business profile fields.",

            errors:
              validation.errors,
          });
      }


      /*
       * ISOLATION:
       *
       * Filter authenticated owner se.
       *
       * $set me bhi sirf sanitized
       * business fields.
       */
      const businessProfile =
        await BusinessProfile
          .findOneAndUpdate(
            {
              ownerId:
                req.ownerId,
            },

            {
              $set:
                validation.data,

              /*
               * ownerId sirf document
               * creation ke time server set kare.
               */
              $setOnInsert: {
                ownerId:
                  req.ownerId,
              },
            },

            {
              new: true,
              upsert: true,
              runValidators: true,
              setDefaultsOnInsert:
                true,
            }
          )
          .lean();


      /*
       * DB me jo actually save hua hai
       * wahi completion source hoga.
       */
      const completion =
        getBusinessProfileCompletion(
          businessProfile
        );


      const formData =
        getBusinessProfileFormData({
          admin: req.admin,
          profile:
            businessProfile,
        });


      return res
        .status(200)
        .json({
          message:
            completion.isComplete
              ? "Business profile saved successfully."
              : "Business profile saved. Complete the remaining details before creating an invoice.",

          profileExists: true,

          isComplete:
            completion.isComplete,

          missingFields:
            completion.missingFields,

          formData,
        });
    } catch (error) {
      console.error(
        "Save business profile error:",
        error
      );


      /*
       * ownerId unique index race case.
       *
       * Normally upsert correctly updates
       * existing profile.
       */
      if (
        error?.code === 11000
      ) {
        return res
          .status(409)
          .json({
            message:
              "Business profile was updated by another request. Please try again.",
          });
      }


      if (
        error?.name ===
        "ValidationError"
      ) {
        return res
          .status(400)
          .json({
            message:
              Object.values(
                error.errors
              )[0]?.message ||
              "Invalid business profile data.",
          });
      }


      return res
        .status(500)
        .json({
          message:
            "Unable to save business profile. Please try again.",
        });
    }
  };



  /*
 * UPLOAD / REPLACE MY BUSINESS LOGO
 * ─────────────────────────────────────────────
 *
 * PUT /api/business-profile/me/logo
 */
exports.uploadMyBusinessLogo =
  async (req, res) => {
    let uploadedFile = null;


    try {
      if (
        !req.admin ||
        !req.ownerId
      ) {
        return res
          .status(401)
          .json({
            message:
              "Authentication required",
          });
      }


      if (!req.file) {
        return res
          .status(400)
          .json({
            message:
              "Business logo is required.",

            code:
              "BUSINESS_LOGO_REQUIRED",
          });
      }


      /*
       * Logo tabhi upload karenge jab
       * BusinessProfile already exist karti ho.
       *
       * Frontend flow:
       *
       * 1. save profile fields
       * 2. upload logo
       */
      const existingProfile =
        await BusinessProfile
          .findOne({
            ownerId:
              req.ownerId,
          })
          .lean();


      if (!existingProfile) {
        return res
          .status(409)
          .json({
            message:
              "Save your business profile details before uploading a logo.",

            code:
              "BUSINESS_PROFILE_REQUIRED",

            profileExists:
              false,

            isComplete:
              false,
          });
      }


      uploadedFile =
        await saveBusinessLogo({
          ownerId:
            req.ownerId,

          buffer:
            req.file.buffer,
        });


      /*
       * IMPORTANT:
       *
       * Previous logo file intentionally delete
       * nahi kar rahe.
       *
       * Old generated invoices future me old
       * logo URL reference kar sakte hain.
       *
       * Historical invoice integrity preserve
       * rehni chahiye.
       */
      const updatedProfile =
        await BusinessProfile
          .findOneAndUpdate(
            {
              ownerId:
                req.ownerId,
            },

            {
              $set: {
                logoUrl:
                  uploadedFile.logoUrl,
              },
            },

            {
              new: true,
              runValidators: true,
            }
          )
          .lean();


      /*
       * Extremely defensive:
       * profile request ke beech delete ho gayi.
       */
      if (!updatedProfile) {
        await deleteBusinessLogoFile(
          uploadedFile.absolutePath
        );

        return res
          .status(404)
          .json({
            message:
              "Business profile not found.",

            code:
              "BUSINESS_PROFILE_NOT_FOUND",
          });
      }


      const completion =
        getBusinessProfileCompletion(
          updatedProfile
        );


      const formData =
        getBusinessProfileFormData({
          admin:
            req.admin,

          profile:
            updatedProfile,
        });


      return res
        .status(200)
        .json({
          message:
            "Business logo uploaded successfully.",

          profileExists:
            true,

          isComplete:
            completion.isComplete,

          missingFields:
            completion.missingFields,

          logoUrl:
            updatedProfile.logoUrl,

          formData,
        });
    } catch (error) {
      /*
       * File successfully write hui but DB operation
       * fail ho gaya to orphan file remove karo.
       */
      if (
        uploadedFile
          ?.absolutePath
      ) {
        await deleteBusinessLogoFile(
          uploadedFile.absolutePath
        );
      }


      console.error(
        "Upload business logo error:",
        error
      );


      if (
        error?.code ===
        "INVALID_IMAGE_SIGNATURE"
      ) {
        return res
          .status(400)
          .json({
            message:
              error.message,

            code:
              "INVALID_BUSINESS_LOGO",
          });
      }


      return res
        .status(500)
        .json({
          message:
            "Unable to upload business logo. Please try again.",

          code:
            "BUSINESS_LOGO_UPLOAD_FAILED",
        });
    }
  };



  /*
 * PUBLIC BUSINESS LOGO
 * ─────────────────────────────────────────────
 *
 * GET /api/business-profile/logo/:filename
 *
 * Business logo intentionally public asset hai,
 * because invoice eventually clients ke saath
 * share hogi.
 */
exports.getBusinessLogo =
  async (req, res) => {
    try {
      const {
        filename,
      } = req.params;


      if (
        !isSafeLogoFilename(
          filename
        )
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid logo file.",
          });
      }


      return res.sendFile(
        filename,
        {
          root:
            BUSINESS_LOGO_DIR,

          dotfiles:
            "deny",

          headers: {
            "Cache-Control":
              "public, max-age=31536000, immutable",
          },
        },
        (error) => {
          if (!error) {
            return;
          }


          if (
            error.code ===
              "ENOENT" ||
            error.statusCode ===
              404
          ) {
            if (
              !res.headersSent
            ) {
              res
                .status(404)
                .json({
                  message:
                    "Business logo not found.",
                });
            }

            return;
          }


          console.error(
            "Serve business logo error:",
            error
          );


          if (
            !res.headersSent
          ) {
            res
              .status(500)
              .json({
                message:
                  "Unable to load business logo.",
              });
          }
        }
      );
    } catch (error) {
      console.error(
        "Get business logo error:",
        error
      );


      return res
        .status(500)
        .json({
          message:
            "Unable to load business logo.",
        });
    }
  };