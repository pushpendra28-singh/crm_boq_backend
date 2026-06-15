const Comment = require("../models/Comment");

const createComment = async (req, res) => {
  try {
    const { comment, name, email, acceptedPolicy } = req.body;

    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: "Comment is required." });
    }

    if (comment.trim().length < 15) {
      return res
        .status(400)
        .json({ message: "Comment must be at least 15 characters long." });
    }

    if (comment.trim().length > 1000) {
      return res
        .status(400)
        .json({ message: "Comment must be less than 1000 characters." });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name is required." });
    }

    if (name.trim().length < 2) {
      return res
        .status(400)
        .json({ message: "Name must be at least 2 characters." });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ message: "Email is required." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: "Please enter a valid email." });
    }

    if (!acceptedPolicy) {
      return res.status(400).json({
        message: "You must accept the Privacy Policy before submitting.",
      });
    }

    const newComment = await Comment.create({
      comment: comment.trim(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      acceptedPolicy: true,
      status: "Pending",
    });

    return res.status(201).json({
      message: "Comment submitted successfully.",
      comment: newComment,
    });
  } catch (error) {
    console.error("createComment error:", error);
    return res.status(500).json({
      message: "Server error while submitting comment.",
    });
  }
};

const getComments = async (req, res) => {
  try {
    const comments = await Comment.find().sort({ createdAt: -1 });
    return res.status(200).json(comments);
  } catch (error) {
    console.error("getComments error:", error);
    return res.status(500).json({
      message: "Server error while fetching comments.",
    });
  }
};

const getCommentCount = async (req, res) => {
  try {
    const total = await Comment.countDocuments();
    const pending = await Comment.countDocuments({ status: "Pending" });
    const approved = await Comment.countDocuments({ status: "Approved" });
    const rejected = await Comment.countDocuments({ status: "Rejected" });
    const spam = await Comment.countDocuments({ status: "Spam" });

    return res.status(200).json({
      total,
      pending,
      approved,
      rejected,
      spam,
    });
  } catch (error) {
    console.error("getCommentCount error:", error);
    return res.status(500).json({
      message: "Server error while counting comments.",
    });
  }
};

const updateCommentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["Pending", "Approved", "Rejected", "Spam"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const updatedComment = await Comment.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updatedComment) {
      return res.status(404).json({ message: "Comment not found." });
    }

    return res.status(200).json({
      message: "Comment status updated successfully.",
      comment: updatedComment,
    });
  } catch (error) {
    console.error("updateCommentStatus error:", error);
    return res.status(500).json({
      message: "Server error while updating comment status.",
    });
  }
};

const deleteComment = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedComment = await Comment.findByIdAndDelete(id);

    if (!deletedComment) {
      return res.status(404).json({ message: "Comment not found." });
    }

    return res.status(200).json({
      message: "Comment deleted successfully.",
    });
  } catch (error) {
    console.error("deleteComment error:", error);
    return res.status(500).json({
      message: "Server error while deleting comment.",
    });
  }
};

const bulkDeleteComments = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "Please provide comment ids to delete.",
      });
    }

    await Comment.deleteMany({ _id: { $in: ids } });

    return res.status(200).json({
      message: "Selected comments deleted successfully.",
    });
  } catch (error) {
    console.error("bulkDeleteComments error:", error);
    return res.status(500).json({
      message: "Server error while bulk deleting comments.",
    });
  }
};

module.exports = {
  createComment,
  getComments,
  getCommentCount,
  updateCommentStatus,
  deleteComment,
  bulkDeleteComments,
};