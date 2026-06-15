const express = require("express");

const router =
  express.Router();

const controller =
  require(
    "../controllers/newProposalController"
  );


// Draft create
router.post("/", controller.createProposal);


// AI generate
router.post("/generate/:id", controller.generateProposal);


// Get all
router.get("/", controller.getAllProposals);


// Get single
router.get("/:id", controller.getProposal);


// Update
router.put("/:id", controller.updateProposal);


// Delete
router.delete("/:id", controller.deleteProposal);

module.exports = router;