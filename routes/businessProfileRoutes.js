const express = require("express");

const {
  getMyBusinessProfile,
  saveMyBusinessProfile,
  uploadMyBusinessLogo,
  getBusinessLogo,
} = require("../controllers/businessProfileController");

const {
  attachOwner,
} = require("../middleware/ownershipMiddleware");

/*
 * IMPORTANT:
 *
 * Yahan protect ka import EXACTLY wahi use karo
 * jo current invoiceRoutes.js me use ho raha hai.
 *
 * Agar tumhare invoiceRoutes me ye path hai:
 *
 * const { protect } =
 *   require("../middleware/authMiddleware");
 *
 * to same yahan bhi rakho.
 */
const {
  protect,
} = require("../middleware/authMiddleware");

const {
  uploadBusinessLogo,
} = require(
  "../middleware/businessLogoUpload"
);


const router = express.Router();

router.get(
  "/logo/:filename",
  getBusinessLogo
);


/*
 * GET /api/business-profile/me
 *
 * Logged-in user ka own business profile/prefill.
 */
router.get(
  "/me",
  protect,
  attachOwner,
  getMyBusinessProfile
);

router.put(
  "/me",
  protect,
  attachOwner,
  saveMyBusinessProfile
);

router.put(
  "/me/logo",
  protect,
  attachOwner,
  uploadBusinessLogo,
  uploadMyBusinessLogo
);




module.exports = router;