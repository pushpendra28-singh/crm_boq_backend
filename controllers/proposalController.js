const Proposal = require("../models/Proposal");
const Lead = require("../models/Lead");
console.log("Proposal Model Check:");
console.log(Proposal);
console.log(typeof Proposal);

const { calculateSolarSystem } = require("../services/proposal/solarCalculator");
const { generateAINarrative } = require("../services/proposal/aiNarrative");

// ─── GET /proposals ───────────────────────────────────────────────────────────
exports.getProposals = async (req, res) => {
  try {
    const {
      status, leadId, search, page = 1, limit = 20,
      sortBy = "createdAt", sortOrder = "desc",
      startDate, endDate, generationStatus,
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (leadId) filter.leadId = leadId;
    if (generationStatus) filter.generationStatus = generationStatus;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }

    if (search) {
      filter.$or = [
        { "customer.name": { $regex: search, $options: "i" } },
        { "customer.whatsapp": { $regex: search, $options: "i" } },
        { "customer.email": { $regex: search, $options: "i" } },
      ];
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [proposals, total] = await Promise.all([
      Proposal.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("leadId", "name whatsapp status category")
        .populate("assignedTo", "name email")
        .select("-proposal.costBreakdown -proposal.emiOptions -webhookPayload"),
      Proposal.countDocuments(filter),
    ]);

    res.status(200).json({
      proposals,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch proposals", error: error.message });
  }
};

// ─── GET /proposals/stats ─────────────────────────────────────────────────────
exports.getProposalStats = async (req, res) => {
  try {
    const [summary, byStatus, dailyTrend, conversionByRep] = await Promise.all([
      Proposal.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $ne: ["$status", "draft"] }, 1, 0] } },
            opened: { $sum: { $cond: [{ $gt: ["$openCount", 0] }, 1, 0] } },
            accepted: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] } },
            totalRevenuePotential: { $sum: "$proposal.netCost" },
          },
        },
      ]),
      Proposal.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Proposal.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Proposal.aggregate([
        { $match: { assignedTo: { $exists: true } } },
        {
          $group: {
            _id: "$assignedTo",
            repName: { $first: "$assignedToName" },
            total: { $sum: 1 },
            accepted: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] } },
          },
        },
        { $sort: { accepted: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const s = summary[0] || { total: 0, sent: 0, opened: 0, accepted: 0, totalRevenuePotential: 0 };

    res.status(200).json({
      summary: {
        ...s,
        openRate: s.sent > 0 ? Math.round((s.opened / s.sent) * 100) : 0,
        conversionRate: s.sent > 0 ? Math.round((s.accepted / s.sent) * 100) : 0,
      },
      byStatus,
      dailyTrend,
      topReps: conversionByRep,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stats", error: error.message });
  }
};

// ─── GET /proposals/:id ───────────────────────────────────────────────────────
exports.getProposalById = async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id)
      .populate("leadId", "name whatsapp status category source")
      .populate("assignedTo", "name email");

    if (!proposal) return res.status(404).json({ message: "Proposal not found" });

    res.status(200).json(proposal);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch proposal", error: error.message });
  }
};

// ─── POST /proposals/generate-from-lead ──────────────────────────────────────
// Generates a proposal from an existing CRM lead (status: pending/in-progress/connected)
exports.generateFromLead = async (req, res) => {
  try {
    const { leadId, survey } = req.body;

    if (!leadId) return res.status(400).json({ message: "leadId is required" });
    if (!survey?.monthlyBill) return res.status(400).json({ message: "survey.monthlyBill is required" });

    // Fetch the lead
    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const allowedStatuses = ["Pending", "Connected", "In Progress"];
    if (!allowedStatuses.includes(lead.status)) {
      return res.status(400).json({
        message: `Proposals can only be generated for leads with status: ${allowedStatuses.join(", ")}`,
        currentStatus: lead.status,
      });
    }

    // Create proposal record with 'generating' status
    const proposal = new Proposal({
      leadId: lead._id,
      customer: {
        name: lead.name,
        email: lead.email,
        whatsapp: lead.whatsapp,
        address: lead.societyName || lead.companyName || "",
        city: lead.city || "",
        pincode: lead.pincode || "",
      },
      survey: {
        monthlyBill: survey.monthlyBill,
        roofType: survey.roofType || "RCC Flat",
        roofAreaSqFt: survey.roofAreaSqFt,
        sanctionedLoad: survey.sanctionedLoad,
        gridType: survey.gridType || "On-Grid",
        phase: survey.phase || "Single Phase",
        existingSolarKW: survey.existingSolarKW || 0,
        shadingLevel: survey.shadingLevel || "None",
      },
      generationStatus: "generating",
      source: "lead_qualified",
      createdBy: req.admin?._id,
      createdByName: req.admin?.name || "System",
      assignedTo: lead.assignedTo,
      assignedToName: lead.assignedToName,
    });
    
    await proposal.save();
    

    // Return immediately — generation is async
    res.status(202).json({
      message: "Proposal generation started",
      proposalId: proposal._id,
      status: "generating",
    });

    // ── Generate proposal asynchronously ──
    setImmediate(async () => {
      try {
        // 1. Calculate solar system
        // const calc = calculateSolarSystem(survey.monthlyBill, survey.existingSolarKW || 0);
        const monthlyBill = Number(survey.monthlyBill);

if (!Number.isFinite(monthlyBill) || monthlyBill <= 0) {
  throw new Error("Invalid monthly bill amount");
}

const calc = calculateSolarSystem(
  monthlyBill,
  Number(survey.existingSolarKW) || 0
);

        // 2. Generate AI narrative
        const narrative = await generateAINarrative(
          { name: lead.name, city: lead.city, pincode: lead.pincode, monthlyBill: survey.monthlyBill },
          calc
        );

        // 3. Update proposal with full data
        await Proposal.findByIdAndUpdate(proposal._id, {
         proposal: {
  ...Object.fromEntries(
    Object.entries(calc).map(([k, v]) => [
      k,
      typeof v === "number" && !Number.isFinite(v) ? 0 : v,
    ])
  ),
  ...narrative,
},
          generationStatus: "completed",
          status: "draft",
        });

        // 4. Update lead activity log
        if (!lead.activityLog) lead.activityLog = [];

lead.activityLog.push({
          action: "note_added",
          note: `Proposal #${proposal._id} generated successfully`,
          byName: req.admin?.name || "System",
          by: req.admin?._id,
        });
        await lead.save();

      } catch (err) {
        await Proposal.findByIdAndUpdate(proposal._id, {
          generationStatus: "failed",
          generationError: err.message,
        });
        console.error("❌ Proposal generation failed FULL ERROR:", err);
      }
    });

  } catch (error) {
  console.error("FULL ERROR:");
  console.error(error);
  console.error(error.stack);

  res.status(500).json({
    message: "Failed to initiate proposal generation",
    error: error.message,
  });
}
};

// ─── POST /proposals/generate-manual ─────────────────────────────────────────
// Generates a standalone proposal without a linked lead
exports.generateManual = async (req, res) => {
  try {
    const { customer, survey, templateVariant, language } = req.body;

    if (!customer?.name) return res.status(400).json({ message: "customer.name is required" });
    if (!survey?.monthlyBill) return res.status(400).json({ message: "survey.monthlyBill is required" });

    const proposal = new Proposal({
      customer: {
        name: customer.name?.trim(),
        email: customer.email?.trim()?.toLowerCase(),
        whatsapp: customer.whatsapp?.trim(),
        address: customer.address,
        city: customer.city,
        pincode: customer.pincode,
      },
      survey: {
        monthlyBill: survey.monthlyBill,
        roofType: survey.roofType || "RCC Flat",
        roofAreaSqFt: survey.roofAreaSqFt,
        sanctionedLoad: survey.sanctionedLoad,
        gridType: survey.gridType || "On-Grid",
        phase: survey.phase || "Single Phase",
        existingSolarKW: survey.existingSolarKW || 0,
        shadingLevel: survey.shadingLevel || "None",
      },
      templateVariant: templateVariant || "standard",
      language: language || "en",
      generationStatus: "generating",
      source: "manual",
      createdBy: req.admin?._id,
      createdByName: req.admin?.name,
    });

    await proposal.save();

    res.status(202).json({
      message: "Proposal generation started",
      proposalId: proposal._id,
      status: "generating",
    });

    setImmediate(async () => {
      try {
        // const calc = calculateSolarSystem(survey.monthlyBill, survey.existingSolarKW || 0);
        const monthlyBill = Number(survey.monthlyBill);

if (!Number.isFinite(monthlyBill) || monthlyBill <= 0) {
  throw new Error("Invalid monthly bill amount");
}

const calc = calculateSolarSystem(
  monthlyBill,
  Number(survey.existingSolarKW) || 0
);
        const narrative = await generateAINarrative(
          { name: customer.name, city: customer.city, pincode: customer.pincode, monthlyBill: survey.monthlyBill },
          calc
        );

        await Proposal.findByIdAndUpdate(proposal._id, {
          proposal: { ...calc, ...narrative },
          generationStatus: "completed",
          status: "draft",
        });
      } catch (err) {
        await Proposal.findByIdAndUpdate(proposal._id, {
          generationStatus: "failed",
          generationError: err.message,
        });
        console.error("Manual proposal generation failed:", err);
      }
    });

  } catch (error) {
    res.status(500).json({ message: "Failed to generate proposal", error: error.message });
  }
};

// ─── POST /proposals/bulk-generate ───────────────────────────────────────────
// Bulk generate proposals for multiple leads at once
exports.bulkGenerate = async (req, res) => {
  try {
    const { leadIds, defaultSurvey } = req.body;

    if (!leadIds?.length) return res.status(400).json({ message: "leadIds array is required" });
    if (leadIds.length > 100) return res.status(400).json({ message: "Max 100 leads per bulk operation" });

    const leads = await Lead.find({
      _id: { $in: leadIds },
      status: { $in: ["Pending", "Connected", "In Progress"] },
    });

    if (!leads.length) return res.status(404).json({ message: "No eligible leads found" });

    const proposalsToCreate = leads.map((lead) => ({
      leadId: lead._id,
      customer: {
        name: lead.name,
        email: lead.email,
        whatsapp: lead.whatsapp,
        city: lead.city || "",
        pincode: lead.pincode || "",
      },
      survey: {
        monthlyBill: parseFloat(lead.bill || lead.monthlyBill || lead.commercialBill || defaultSurvey?.monthlyBill || 3000),
        roofType: defaultSurvey?.roofType || "RCC Flat",
        gridType: defaultSurvey?.gridType || "On-Grid",
      },
      generationStatus: "pending",
      source: "bulk",
      createdBy: req.admin?._id,
      createdByName: req.admin?.name || "System",
      assignedTo: lead.assignedTo,
      assignedToName: lead.assignedToName,
    }));

    const created = await Proposal.insertMany(proposalsToCreate);

    res.status(202).json({
      message: `Bulk generation initiated for ${created.length} proposals`,
      proposalIds: created.map((p) => p._id),
      count: created.length,
    });

    // Process in parallel batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < created.length; i += BATCH_SIZE) {
      const batch = created.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (p, idx) => {
          const lead = leads[i + idx];
          const monthlyBill = p.survey.monthlyBill;
          if (!Number.isFinite(Number(monthlyBill)) || Number(monthlyBill) <= 0) {
  throw new Error("Invalid monthly bill amount");
}
          try {
            await Proposal.findByIdAndUpdate(p._id, { generationStatus: "generating" });
            const calc = calculateSolarSystem(Number(monthlyBill), 0);
            const narrative = await generateAINarrative(
              { name: p.customer.name, city: p.customer.city, pincode: p.customer.pincode, monthlyBill },
              calc
            );
            await Proposal.findByIdAndUpdate(p._id, {
              proposal: { ...calc, ...narrative },
              generationStatus: "completed",
              status: "draft",
            });
          } catch (err) {
            await Proposal.findByIdAndUpdate(p._id, {
              generationStatus: "failed",
              generationError: err.message,
            });
          }
        })
      );

      // Small delay between batches to respect OpenAI rate limits
      if (i + BATCH_SIZE < created.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

  } catch (error) {
    res.status(500).json({ message: "Bulk generation failed", error: error.message });
  }
};

// ─── GET /proposals/:id/status ────────────────────────────────────────────────
// Poll generation status (frontend polls this after initiating)
exports.getGenerationStatus = async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id)
      .select("generationStatus generationError status proposal.systemSizeKW proposal.netCost proposal.paybackYears proposal.monthlyEnergySavings");

    if (!proposal) return res.status(404).json({ message: "Proposal not found" });

    res.status(200).json({
      proposalId: proposal._id,
      generationStatus: proposal.generationStatus,
      status: proposal.status,
      error: proposal.generationError,
      preview: proposal.generationStatus === "completed" ? {
        systemSizeKW: proposal.proposal?.systemSizeKW,
        netCost: proposal.proposal?.netCost,
        paybackYears: proposal.proposal?.paybackYears,
        monthlyEnergySavings: proposal.proposal?.monthlyEnergySavings,
      } : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get status", error: error.message });
  }
};

// ─── PATCH /proposals/:id/status ──────────────────────────────────────────────
exports.updateProposalStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = ["draft", "sent", "opened", "accepted", "rejected", "expired", "revised"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ message: "Proposal not found" });

    proposal.status = status;

    if (status === "sent") {
      proposal.sentAt = new Date();
      proposal.sentVia = req.body.sentVia || ["manual"];
    }

    if (status === "opened" && !proposal.openedAt) {
      proposal.openedAt = new Date();
    }

    await proposal.save();

    res.status(200).json({ message: "Status updated", proposal });

  } catch (error) {
    res.status(500).json({ message: "Failed to update status", error: error.message });
  }
};

// ─── POST /proposals/:id/send ─────────────────────────────────────────────────
// Mark as sent + record delivery channels
exports.sendProposal = async (req, res) => {
  try {
    const { channels = ["manual"] } = req.body;

    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ message: "Proposal not found" });
    if (proposal.generationStatus !== "completed") {
      return res.status(400).json({ message: "Proposal is still being generated" });
    }

    proposal.status = "sent";
    proposal.sentAt = new Date();
    proposal.sentVia = channels;

    // In production: trigger WhatsApp API / Email API here
    // e.g. await sendWhatsApp(proposal.customer.whatsapp, proposal.pdfUrl)
    // e.g. await sendEmail(proposal.customer.email, proposal.pdfUrl)

    await proposal.save();

    res.status(200).json({
      message: "Proposal marked as sent",
      proposal,
      note: "Integrate WhatsApp/Email APIs in this function for automated delivery",
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to send proposal", error: error.message });
  }
};

// ─── GET /proposals/track/:token ──────────────────────────────────────────────
// Open tracking — called when customer opens the proposal link
exports.trackOpen = async (req, res) => {
  try {
    const proposal = await Proposal.findOneAndUpdate(
      { trackingToken: req.params.token },
      {
        $inc: { openCount: 1 },
        $set: { lastOpenedAt: new Date(), status: "opened" },
        $setOnInsert: { openedAt: new Date() },
      },
      { new: true }
    );

    if (!proposal) return res.status(404).json({ message: "Invalid tracking token" });

    // In production: send pixel / redirect to PDF
    res.status(200).json({ message: "Tracked", openCount: proposal.openCount });
  } catch (error) {
    res.status(500).json({ message: "Tracking failed", error: error.message });
  }
};

// ─── POST /proposals/:id/regenerate ──────────────────────────────────────────
exports.regenerateProposal = async (req, res) => {
  try {
    const original = await Proposal.findById(req.params.id);
    if (!original) return res.status(404).json({ message: "Proposal not found" });

    const surveyOverride = req.body.survey || {};
    const newSurvey = { ...original.survey.toObject(), ...surveyOverride };

    // Create new version
    const newProposal = new Proposal({
      leadId: original.leadId,
      customer: original.customer,
      survey: newSurvey,
      templateVariant: req.body.templateVariant || original.templateVariant,
      language: req.body.language || original.language,
      generationStatus: "generating",
      source: original.source,
      version: original.version + 1,
      previousVersions: [...(original.previousVersions || []), original._id],
      createdBy: req.admin?._id,
      createdByName: req.admin?.name,
      assignedTo: original.assignedTo,
      assignedToName: original.assignedToName,
    });

    await newProposal.save();

    res.status(202).json({
      message: "Re-generation started",
      proposalId: newProposal._id,
      version: newProposal.version,
    });

    setImmediate(async () => {
      try {
        // const calc = calculateSolarSystem(newSurvey.monthlyBill, newSurvey.existingSolarKW || 0);
        const monthlyBill = Number(newSurvey.monthlyBill);

if (!Number.isFinite(monthlyBill) || monthlyBill <= 0) {
  throw new Error("Invalid monthly bill amount");
}

const calc = calculateSolarSystem(
  monthlyBill,
  Number(newSurvey.existingSolarKW) || 0
);
        const narrative = await generateAINarrative(
          { name: original.customer.name, city: original.customer.city, pincode: original.customer.pincode, monthlyBill: newSurvey.monthlyBill },
          calc
        );
        await Proposal.findByIdAndUpdate(newProposal._id, {
          proposal: { ...calc, ...narrative },
          generationStatus: "completed",
          status: "draft",
        });
      } catch (err) {
        await Proposal.findByIdAndUpdate(newProposal._id, {
          generationStatus: "failed",
          generationError: err.message,
        });
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Regeneration failed", error: error.message });
  }
};

// ─── DELETE /proposals/:id ────────────────────────────────────────────────────
exports.deleteProposal = async (req, res) => {
  try {
    const proposal = await Proposal.findByIdAndDelete(req.params.id);
    if (!proposal) return res.status(404).json({ message: "Proposal not found" });
    res.status(200).json({ message: "Proposal deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete proposal", error: error.message });
  }
};

// ─── GET /proposals/leads/eligible ────────────────────────────────────────────
// Fetch leads eligible for proposal generation
exports.getEligibleLeads = async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;

    const filter = {
      status: { $in: ["Pending", "Connected", "In Progress"] },
    };
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { whatsapp: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select("name whatsapp email category status source bill monthlyBill commercialBill city pincode assignedToName createdAt score"),
      Lead.countDocuments(filter),
    ]);

    res.status(200).json({
      leads,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch eligible leads", error: error.message });
  }
};


