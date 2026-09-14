const express = require("express");

const {
  protect,
} = require("../middleware/authMiddleware");

const {
  attachOwner,
} = require("../middleware/ownershipMiddleware");

const {
  createCustomer,
  getMyCustomers,
  getMyCustomerById,
  updateMyCustomer,
} = require("../controllers/customerController");


const router = express.Router();


/* ─────────────────────────────────────────────
   Create Customer
───────────────────────────────────────────── */

router.post( "/", protect, attachOwner, createCustomer);


/* ─────────────────────────────────────────────
   Get Logged-in User Customers
───────────────────────────────────────────── */

router.get("/", protect, attachOwner, getMyCustomers);


/* ─────────────────────────────────────────────
   Get Single Own Customer
───────────────────────────────────────────── */

router.get("/:id",protect,attachOwner,getMyCustomerById);

router.put("/:id", protect, attachOwner, updateMyCustomer);



module.exports = router;