const NewProposal = require("../models/NewProposal");
const {
  generateProposalAI,
} = require("../services/newproposal/aiGenerator");

const {
  generateGraphs,
} = require("../services/newproposal/graphGenerator");


// CREATE DRAFT
exports.createProposal = async (req, res) => {
  try {
    const proposal =
      await NewProposal.create(req.body);

    return res.status(201).json({
      success: true,
      message: "Proposal draft created",
      proposal,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};


// GENERATE AI PROPOSAL
exports.generateProposal = async (
  req,
  res
) => {
  try {
    const proposalId =
      req.params.id;

    const proposal =
      await NewProposal.findById(
        proposalId
      );

    if (!proposal) {
      return res.status(404).json({
        success: false,
        message:
          "Proposal not found",
      });
    }

    const aiContent =
      await generateProposalAI(
        proposal
      );

    const graphs =
      generateGraphs(proposal);

    proposal.generatedContent =
      aiContent;

    proposal.graphs = graphs;

    proposal.status =
      "generated";

    proposal.aiGeneratedAt =
      new Date();

    await proposal.save();

    return res.status(200).json({
      success: true,
      message:
        "Proposal generated successfully",
      proposal,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};


// GET SINGLE
exports.getProposal =
  async (req, res) => {
    try {
      const proposal =
        await NewProposal.findById(
          req.params.id
        );

      if (!proposal) {
        return res.status(404).json({
          success: false,
          message:
            "Proposal not found",
        });
      }

      return res.json({
        success: true,
        proposal,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  };


// GET ALL
exports.getAllProposals =
  async (req, res) => {
    try {
      const page =
        Number(req.query.page) || 1;

      const limit =
        Number(req.query.limit) ||
        10;

      const skip =
        (page - 1) * limit;

      const search =
        req.query.search || "";

      const status =
        req.query.status;

      let query = {};

      if (search) {
        query.$or = [
          {
            clientName: {
              $regex: search,
              $options: "i",
            },
          },
          {
            proposalTitle: {
              $regex: search,
              $options: "i",
            },
          },
        ];
      }

      if (status) {
        query.status = status;
      }

      const proposals =
        await NewProposal.find(
          query
        )
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(limit);

      const total =
        await NewProposal.countDocuments(
          query
        );

      return res.json({
        success: true,
        page,
        total,
        proposals,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  };


// UPDATE
exports.updateProposal =
  async (req, res) => {
    try {
      const proposal =
        await NewProposal.findByIdAndUpdate(
          req.params.id,
          req.body,
          {
            new: true,
            runValidators: true,
          }
        );

      return res.json({
        success: true,
        message:
          "Proposal updated",
        proposal,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  };


// DELETE
exports.deleteProposal =
  async (req, res) => {
    try {
      await NewProposal.findByIdAndDelete(
        req.params.id
      );

      return res.json({
        success: true,
        message:
          "Proposal deleted",
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  };