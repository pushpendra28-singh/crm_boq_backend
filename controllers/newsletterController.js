const Newsletter = require("../models/Newsletter");

// GET all newsletters
exports.getNewsletters = async (req, res) => {
  try {

    const newsletters = await Newsletter.find().sort({ createdAt: -1 });

    res.status(200).json(newsletters);

  } catch (error) {

    res.status(500).json({
      message: "Failed to fetch newsletters",
      error: error.message,
    });

  }
};

// CREATE newsletter
exports.createNewsletter = async (req, res) => {
  try {

    const newsletter = new Newsletter(req.body);

    await newsletter.save();

    res.status(201).json(newsletter);

  } catch (error) {

    res.status(500).json({
      message: "Failed to create newsletter",
      error: error.message,
    });

  }
};



// DELETE newsletter
exports.deleteNewsletter = async (req, res) => {
  try {

    await Newsletter.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: "Newsletter deleted" });

  } catch (error) {

    res.status(500).json({
      message: "Delete failed",
      error: error.message,
    });

  }
};


exports.updateNewsletterStatus = async (req, res) => {
  try {

    const newsletter = await Newsletter.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );

    res.json(newsletter);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }
};