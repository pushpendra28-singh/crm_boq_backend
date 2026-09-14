const BusinessProfile =
  require("../models/BusinessProfile");

const {
  getBusinessProfileCompletion,
} = require("../services/invoice/businessProfileService");


/*
 * REQUIRE COMPLETE BUSINESS PROFILE
 * ─────────────────────────────────────────────────────
 *
 * Purpose:
 *
 * Kisi bhi feature ko execute hone se pehle ensure
 * karta hai ki authenticated user ke paas:
 *
 * 1. BusinessProfile exists
 * 2. BusinessProfile invoice-ready / complete hai
 *
 *
 * Expected middleware order:
 *
 * protect
 *   ↓
 * attachOwner
 *   ↓
 * requireCompleteBusinessProfile
 *   ↓
 * controller
 *
 *
 * SECURITY:
 *
 * - ownerId request body se nahi aata.
 * - ownerId params se nahi aata.
 * - authenticated req.ownerId hi use hota hai.
 *
 * IMPORTANT:
 *
 * Ye middleware normal user aur superadmin dono ke
 * liye "their own profile" check karta hai.
 *
 * Kisi superadmin ko automatically kisi aur user's
 * business profile use karne nahi deta.
 */
const requireCompleteBusinessProfile =
  async (req, res, next) => {
    try {
      /*
       * Defensive authentication / ownership check.
       *
       * Normal flow me protect + attachOwner
       * already ye value provide karenge.
       */
      if (
        !req.admin ||
        !req.ownerId
      ) {
        return res
          .status(401)
          .json({
            message:
              "Authentication required",

            code:
              "AUTHENTICATION_REQUIRED",
          });
      }


      /*
       * ISOLATION:
       *
       * Exact authenticated owner ka profile.
       *
       * Yahan getOwnershipFilter use nahi karenge,
       * because business profile gate ko always
       * CURRENT USER ka own profile check karna hai.
       */
      const businessProfile =
        await BusinessProfile
          .findOne({
            ownerId:
              req.ownerId,
          })
          .lean();


      /*
       * CASE 1:
       * Business profile create hi nahi hui.
       */
      if (!businessProfile) {
        return res
          .status(409)
          .json({
            message:
              "Create your business profile before creating an invoice.",

            code:
              "BUSINESS_PROFILE_REQUIRED",

            profileExists:
              false,

            isComplete:
              false,
          });
      }


      /*
       * CASE 2:
       * Profile exists but invoice-ready nahi hai.
       */
      const completion =
        getBusinessProfileCompletion(
          businessProfile
        );


      if (!completion.isComplete) {
        return res
          .status(409)
          .json({
            message:
              "Complete your business profile before creating an invoice.",

            code:
              "BUSINESS_PROFILE_INCOMPLETE",

            profileExists:
              true,

            isComplete:
              false,

            missingFields:
              completion.missingFields,
          });
      }


      /*
       * CASE 3:
       * BusinessProfile complete hai.
       *
       * Profile ko request me attach kar dete hain
       * taaki next controller ko same profile
       * dobara query na karna pade.
       */
      req.businessProfile =
        businessProfile;


      next();
    } catch (error) {
      console.error(
        "Business profile gate error:",
        error
      );


      return res
        .status(500)
        .json({
          message:
            "Unable to verify business profile. Please try again.",

          code:
            "BUSINESS_PROFILE_CHECK_FAILED",
        });
    }
  };


module.exports = {
  requireCompleteBusinessProfile,
};