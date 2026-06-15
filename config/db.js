const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;

    if (!uri) {
      throw new Error("MONGO_URI is not defined in .env file");
    }

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000, // 10 sec timeout
    });

    console.log("✅ MongoDB Connected Successfully");
  } catch (error) {
    console.error("❌ DB Connection Error:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;