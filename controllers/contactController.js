const ContactLead = require("../models/ContactLead");

exports.createContactLead = async (req,res)=>{
  try{

    const lead = new ContactLead(req.body);

    await lead.save();

    res.status(201).json({
      message:"Contact lead saved",
      lead
    });

  }catch(error){
    res.status(500).json({
      message:"Failed to save contact lead",
      error:error.message
    });
  }
};

exports.getContactLeads = async (req,res)=>{
  try{

    const leads = await ContactLead
      .find()
      .sort({createdAt:-1});

    res.json(leads);

  }catch(error){
    res.status(500).json({
      message:"Failed to fetch contact leads"
    });
  }
};

exports.updateContactStatus = async (req,res)=>{
  try{

    const lead = await ContactLead.findByIdAndUpdate(
      req.params.id,
      {status:req.body.status},
      {new:true}
    );

    res.json({
      message:"Status updated",
      lead
    });

  }catch(error){
    res.status(500).json({
      message:"Failed to update status"
    });
  }
};

exports.deleteContactLead = async (req,res)=>{
  try{

    await ContactLead.findByIdAndDelete(req.params.id);

    res.json({
      message:"Contact lead deleted"
    });

  }catch(error){
    res.status(500).json({
      message:"Delete failed"
    });
  }
};