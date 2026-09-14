const mongoose = require("mongoose");


const customerSchema =
  new mongoose.Schema(
    {
      /*
        Customer kis logged-in user ka hai.

        Ek user ke multiple customers ho sakte hain,
        isliye unique: true nahi lagayenge.
      */
      ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true,
        index: true,
      },


      /*
        Invoice me abhi companyName required hai,
        isliye Customer me bhi required rakhenge.
      */
      companyName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150,
      },


      contactPerson: {
        type: String,
        trim: true,
        maxlength: 120,
        default: "",
      },


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


      /*
        Current Invoice.customerSnapshot me
        address string hai.

        Isliye abhi Customer me bhi address
        string hi rakhenge.

        Existing invoice structure ko change
        karne ki zarurat nahi padegi.
      */
      address: {
        type: String,
        trim: true,
        maxlength: 500,
        default: "",
      },


      gstin: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 15,
        default: "",
      },
    },
    {
      timestamps: true,
    }
  );


/*
  User-wise customer list fast rakhne ke liye.

  Query future me hogi:

  Customer.find({
    ownerId: req.ownerId
  }).sort({
    createdAt: -1
  })
*/
customerSchema.index({
  ownerId: 1,
  createdAt: -1,
});


module.exports =
  mongoose.model(
    "Customer",
    customerSchema
  );