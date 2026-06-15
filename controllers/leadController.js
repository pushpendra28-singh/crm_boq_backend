const Lead = require("../models/Lead");
const mongoose = require("mongoose");
const stringSimilarity = require("string-similarity");
const { validateLead } = require("../services/leads/leadValidationService");
const { analyzeLead } = require("../services/leads/leadAiService");
const { getValidationDetails } = require("../services/leads/leadValidationService");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detects duplicates by whatsapp OR email within the same category.
 * Returns existing lead or null.
 */
const normalizePhone = (phone = "") =>
  phone.replace(/\D/g, "").slice(-10);

const normalizeEmail = (email = "") =>
  email.trim().toLowerCase();

const findDuplicate = async (lead, excludeId = null) => {
  const phone = normalizePhone(lead.whatsapp);
  const email = normalizeEmail(lead.email || "");

  const candidates = await Lead.find({
    isDuplicate: false,
  });

  for (const existing of candidates) {
    const existingPhone = normalizePhone(existing.whatsapp);
    const existingEmail = normalizeEmail(existing.email || "");

    // Exact phone
    if (phone && existingPhone === phone) {
      return existing;
    }

    // Exact email
    if (email && existingEmail === email) {
      return existing;
    }

    // Name similarity
    const similarity = stringSimilarity.compareTwoStrings(
      lead.name.toLowerCase(),
      existing.name.toLowerCase()
    );

    if (similarity > 0.92 && existing.pincode === lead.pincode) {
      return existing;
    }
  }

  return null;
};

/**
 * Auto-assign lead to a sales agent based on territory (pincode prefix)
 * or round-robin by workload. Placeholder — wire to your Admin model.
 */
const autoAssign = async (lead) => {
  try {
    // Import Admin model lazily to avoid circular deps
    const Admin = require("../models/Admin");

    const salesAgents = await Admin.find({
      role: { $in: ["sales", "manager"] },
      isActive: true,
    });

    if (!salesAgents.length) return null;

    // Territory match: if lead has pincode, try to match agent territory
    if (lead.pincode) {
      const prefix = lead.pincode.substring(0, 3);
      const territoryMatch = salesAgents.find(
        (a) => a.territory && a.territory.startsWith(prefix)
      );
      if (territoryMatch) return territoryMatch;
    }

    // Round-robin: pick agent with least assigned leads
    const counts = await Promise.all(
      salesAgents.map(async (agent) => ({
        agent,
        count: await Lead.countDocuments({ assignedTo: agent._id, status: "Pending" }),
      }))
    );
    counts.sort((a, b) => a.count - b.count);
    return counts[0]?.agent || null;
  } catch {
    return null;
  }
};

/**
 * Build source details from request headers + body UTM params.
 */
const extractSourceDetails = (req) => {
  const {
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
    gclid, fbclid, landingPage, campaign, keyword, adSet,
    webhookId, externalId,
  } = req.body;

  return {
    campaign: campaign || utmCampaign,
    medium: utmMedium,
    keyword,
    adSet,
    landingPage,
    referrer: req.headers.referer || req.headers.referrer,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    gclid,
    fbclid,
    webhookId,
    ipAddress: req.ip || req.headers["x-forwarded-for"]?.split(",")[0]?.trim(),
  };
};

// ─── GET /leads ───────────────────────────────────────────────────────────────
exports.getLeads = async (req, res) => {
  try {
    const {
      category,
      status,
      source,
      assignedTo,
      search,
      page = 1,
      limit = 50,
      sortBy = "createdAt",
      sortOrder = "desc",
      startDate,
      endDate,
      minScore,
      territory,
      isDuplicate,
    

    } = req.query;

    const filter = {};

    if (category) filter.category = category;
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (territory) filter.territory = territory;
    if (isDuplicate !== undefined) filter.isDuplicate = isDuplicate === "true";
    

    if (minScore) {
  filter.$or = [
    { authenticityScore: { $gte: parseInt(minScore) } },
    { score: { $gte: parseInt(minScore) } },
  ];
}

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { whatsapp: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { societyName: { $regex: search, $options: "i" } },
      ];
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("assignedTo", "name email")
        .populate("duplicateOf", "name whatsapp"),
      Lead.countDocuments(filter),
    ]);

    res.status(200).json({
      leads,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch leads", error: error.message });
  }
};

// ─── GET /leads/stats ─────────────────────────────────────────────────────────
exports.getLeadStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(new Date(endDate).setHours(23, 59, 59));

    const matchStage = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

    const [
      totalByStatus,
      totalByCategory,
      totalBySource,
      scoreDistribution,
      conversionRate,
      recentActivity,
      topAgents,
     
    ] = await Promise.all([
      // By status
      Lead.aggregate([
        { $match: matchStage },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // By category
      Lead.aggregate([
        { $match: matchStage },
        { $group: { _id: "$category", count: { $sum: 1 }, avgScore: { $avg: "$score" } } },
      ]),

      // By source (for ROI)
      Lead.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$source",
            count: { $sum: 1 },
            avgScore: { $avg: "$score" },
            converted: {
              $sum: { $cond: [{ $eq: ["$status", "Converted"] }, 1, 0] },
            },
          },
        },
        { $sort: { count: -1 } },
      ]),
           

      // Score buckets
      Lead.aggregate([
        { $match: matchStage },
        {
          $bucket: {
            groupBy: "$score",
            boundaries: [0, 20, 40, 60, 80, 101],
            default: "Unknown",
            output: { count: { $sum: 1 } },
          },
        },
      ]),

      // Conversion rate
      Lead.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ["$status", "Converted"] }, 1, 0] } },
            connected: { $sum: { $cond: [{ $eq: ["$status", "Connected"] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ["$status", "Rejected"] }, 1, 0] } },
            duplicates: { $sum: { $cond: ["$isDuplicate", 1, 0] } },
            avgScore: { $avg: "$score" },
          },
        },
      ]),

      // Daily trend (last 30 days)
      Lead.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Top performing agents
      Lead.aggregate([
        { $match: { ...matchStage, assignedTo: { $exists: true } } },
        {
          $group: {
            _id: "$assignedTo",
            agentName: { $first: "$assignedToName" },
            total: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ["$status", "Converted"] }, 1, 0] } },
            avgScore: { $avg: "$score" },
          },
        },
        { $sort: { converted: -1 } },
        { $limit: 5 },
      ]),
    ]);

    res.status(200).json({
      summary: conversionRate[0] || {
        total: 0, converted: 0, connected: 0, rejected: 0, duplicates: 0, avgScore: 0,
      },
      byStatus: totalByStatus,
      byCategory: totalByCategory,
      bySource: totalBySource,
      scoreDistribution,
      dailyTrend: recentActivity,
      topAgents,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stats", error: error.message });
  }
};

// ─── POST /leads ──────────────────────────────────────────────────────────────
exports.createLead = async (req, res) => {
  try {
    const { category, source = "Manual" } = req.body;

    // ── Build lead data ──
    let leadData = {
      name: req.body.name?.trim(),
      whatsapp: req.body.whatsapp?.trim(),
      email: req.body.email?.trim()?.toLowerCase() || undefined,
      category,
      source,
      sourceDetails: extractSourceDetails(req),
      externalId: req.body.externalId || undefined,
      tags: req.body.tags || [],
      followUpDate: req.body.followUpDate || undefined,
      followUpNote: req.body.followUpNote || undefined,
          
    };


  // ── Validation (enhanced) ──

const validation = getValidationDetails(leadData);

leadData.validationIssues = validation.issues;
leadData.phoneVerified    = validation.phoneVerified;
leadData.emailVerified    = validation.emailVerified;

// ── AI Analysis ──
const aiResult = await analyzeLead(leadData);

// Store raw AI result
leadData.aiAnalysis = {
  isReal:      aiResult.isReal,
  spamScore:   aiResult.spamScore,
  buyingIntent:aiResult.conversionProbability || 0,
  trustScore:  aiResult.authenticityScore || 0,
  leadQuality: aiResult.authenticityScore >= 70 ? "high" : aiResult.authenticityScore >= 40 ? "medium" : "low",
  reason:      aiResult.reason,
  tags:        aiResult.tags || [],
};

// ── Map AI result to flat model fields (what frontend reads) ──
leadData.authenticityScore = (aiResult.summary !== "AI unavailable" && aiResult.authenticityScore > 0)
  ? aiResult.authenticityScore
  : 0;
leadData.isSpam                = aiResult.isSpam                || false;
leadData.isFake                = aiResult.isFake                || false;
leadData.leadTemperature       = aiResult.leadTemperature       || "Cold";
leadData.intent                = aiResult.intent                || "Low";
leadData.buyingStage           = aiResult.buyingStage           || "Researching";
leadData.conversionProbability = aiResult.conversionProbability || 0;
leadData.summary               = aiResult.summary               || "";
leadData.nextBestAction        = aiResult.nextBestAction        || "";
leadData.painPoints            = aiResult.painPoints            || [];
leadData.tags                  = [...(leadData.tags || []), ...(aiResult.tags || [])];
leadData.duplicateRisk         = aiResult.duplicateRisk         || 0;
leadData.validationFlags       = [
  ...validation.validationFlags,
  ...(aiResult.validationFlags || []),
];
leadData.priorityTag           = aiResult.priorityTag || "Cold Lead";

// Override phoneVerified/emailVerified with AI result if more confident
if (aiResult.summary !== "AI unavailable") {
  if (aiResult.phoneVerified !== undefined) leadData.phoneVerified = aiResult.phoneVerified;
  if (aiResult.emailVerified !== undefined) leadData.emailVerified = aiResult.emailVerified;
}

// Merge scoreBreakdown (rule-based pre-save will run, then we overlay AI scores)
leadData._aiScoreBreakdown = aiResult.scoreBreakdown || {};

// Risk level
if (aiResult.spamScore > 80)      leadData.riskLevel = "high";
else if (aiResult.spamScore > 50) leadData.riskLevel = "medium";
else                               leadData.riskLevel = "low";

// Auto reject clearly bad leads
if (!validation.valid || aiResult.isReal === false || aiResult.spamScore > 85 || aiResult.isFake) {
  leadData.status = "Rejected";
}

    // Category-specific fields
    if (category === "Residential") {
      leadData.pincode = req.body.pincode;
      leadData.bill = req.body.bill;
    } else if (category === "Housing Society") {
      leadData.societyName = req.body.societyName;
      leadData.pincode = req.body.pincode;
      leadData.monthlyBill = req.body.monthlyBill;
      leadData.agmStatus = req.body.agmStatus;
      leadData.designation = req.body.designation;
    } else if (category === "Commercial") {
      leadData.companyName = req.body.companyName;
      leadData.city = req.body.city;
      leadData.pincode = req.body.pincode;
      leadData.commercialBill = req.body.commercialBill;
    }

    // ── Duplicate detection ──
    const existing = await findDuplicate(leadData);
    if (existing) {
      leadData.isDuplicate = true;
      leadData.duplicateOf = existing._id;

      // Log on original
      existing.activityLog.push({
        action: "merged",
        note: `Duplicate lead detected from ${source}`,
        to: `Lead from ${source}`,
      });
      await existing.save();
    }

    // ── Create lead ──
    const newLead = new Lead(leadData);

    // ── Auto-assign ──
    const assignedAgent = await autoAssign(newLead);
    if (assignedAgent) {
      newLead.assignedTo = assignedAgent._id;
      newLead.assignedToName = assignedAgent.name;
      newLead.assignedAt = new Date();
      newLead.territory = assignedAgent.territory;
    }

    // ── Initial activity log ──
    newLead.activityLog.push({
      action: "created",
      note: `Lead created via ${source}`,
      byName: req.admin?.name || "System",
      by: req.admin?._id,
    });



    // Overlay AI scoreBreakdown on top of rule-based scores
if (leadData._aiScoreBreakdown) {
  newLead.scoreBreakdown = {
    ...newLead.scoreBreakdown,        // rule-based scores from pre-save hook
    ...leadData._aiScoreBreakdown,    // AI scores overlay (zeros won't hurt display)
  };
}
// Always use rule-based score if AI unavailable
if (leadData.authenticityScore > 0) {
  newLead.score = leadData.authenticityScore;
  newLead.authenticityScore = leadData.authenticityScore;
} else {
  // Use the rule-based score calculated in pre-save
  newLead.authenticityScore = newLead.score;
}

    await newLead.save();

    res.status(201).json({
      message: newLead.isDuplicate
        ? "Lead saved (marked as duplicate)"
        : "Lead saved successfully",
      lead: newLead,
      isDuplicate: newLead.isDuplicate,
      assignedTo: assignedAgent
        ? { name: assignedAgent.name, id: assignedAgent._id }
        : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to save lead", error: error.message });
  }
};

// ─── POST /leads/webhook/:provider ───────────────────────────────────────────
exports.webhookLead = async (req, res) => {
  try {
    const { provider } = req.params;
    let leadData = {};

    // ── Google Ads webhook ──
    if (provider === "google") {
      const { lead_id, user_column_data } = req.body;
      const fields = {};
      (user_column_data || []).forEach((col) => {
        fields[col.column_name] = col.string_value;
      });

      leadData = {
        name: fields.FULL_NAME || fields.first_name || "Unknown",
        whatsapp: fields.PHONE_NUMBER || fields.phone_number || "",
        email: fields.EMAIL || fields.email || "",
        category: "Residential",
        source: "Google Ads",
        externalId: lead_id,
        sourceDetails: {
          campaign: req.body.campaign_name,
          keyword: fields.keyword,
          gclid: req.body.gcl_id,
          webhookId: "google_ads",
        },
      };
    }

    // ── Meta (Facebook/Instagram) Ads webhook ──
    else if (provider === "meta") {
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const fieldData = value?.field_data || [];

      const fields = {};
      fieldData.forEach((f) => { fields[f.name] = f.values?.[0]; });

      leadData = {
        name: fields.full_name || fields.name || "Unknown",
        whatsapp: fields.phone_number || fields.whatsapp || "",
        email: fields.email || "",
        category: "Residential",
        source: "Meta Ads",
        externalId: value?.leadgen_id,
        sourceDetails: {
          campaign: value?.ad_name,
          adSet: value?.adset_name,
          fbclid: value?.ad_id,
          webhookId: "meta_ads",
        },
      };
    }

    // ── Generic landing page webhook ──
    else if (provider === "landing") {
      leadData = {
        name: req.body.name || req.body.full_name,
        whatsapp: req.body.phone || req.body.whatsapp || req.body.mobile,
        email: req.body.email,
        category: req.body.category || "Residential",
        source: "Landing Page",
        bill: req.body.bill || req.body.monthly_bill,
        pincode: req.body.pincode,
        sourceDetails: {
          landingPage: req.body.page_url || req.headers.origin,
          utmSource: req.body.utm_source,
          utmMedium: req.body.utm_medium,
          utmCampaign: req.body.utm_campaign,
          utmContent: req.body.utm_content,
          utmTerm: req.body.utm_term,
          webhookId: "landing_page",
          ipAddress: req.ip,
        },
      };
    }

    else {
      return res.status(400).json({ message: `Unknown provider: ${provider}` });
    }

    if (!leadData.name || !leadData.whatsapp) {
      return res.status(422).json({ message: "Missing required fields: name, phone" });
    }

    // Reuse createLead logic
    req.body = { ...leadData, webhookPayload: req.body };
    return exports.createLead(req, res);
  } catch (error) {
    res.status(500).json({ message: "Webhook processing failed", error: error.message });
  }
};

// ─── PATCH /leads/:id/status ──────────────────────────────────────────────────
exports.updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const prevStatus = lead.status;
    lead.status = status;

      
   

    lead.activityLog.push({
      action: "status_changed",
      from: prevStatus,
      to: status,
      byName: req.admin?.name || "Admin",
      by: req.admin?._id,
    });

    await lead.save();

    res.status(200).json({ message: "Status updated", lead });
  } catch (error) {
    res.status(500).json({ message: "Failed to update status", error: error.message });
  }
};

// ─── PATCH /leads/:id/assign ──────────────────────────────────────────────────
exports.assignLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId, agentName } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const prevAgent = lead.assignedToName;
    lead.assignedTo = agentId;
    lead.assignedToName = agentName;
    lead.assignedAt = new Date();

    lead.activityLog.push({
      action: "assigned",
      from: prevAgent || "Unassigned",
      to: agentName,
      byName: req.admin?.name || "Admin",
      by: req.admin?._id,
    });

    await lead.save();

    res.status(200).json({ message: "Lead assigned successfully", lead });
  } catch (error) {
    res.status(500).json({ message: "Failed to assign lead", error: error.message });
  }
};

// ─── POST /leads/:id/notes ────────────────────────────────────────────────────
exports.addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text?.trim()) return res.status(400).json({ message: "Note text required" });

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const note = {
      text: text.trim(),
      addedBy: req.admin?.name || "Admin",
      addedById: req.admin?._id,
      createdAt: new Date(),
    };

    lead.notes.push(note);
    lead.activityLog.push({
      action: "note_added",
      note: text.trim().substring(0, 100),
      byName: req.admin?.name || "Admin",
      by: req.admin?._id,
    });

    if (!lead.scoreBreakdown) {
  lead.scoreBreakdown = {};
}

lead.scoreBreakdown.engagementScore = Math.min(
  20,
  (lead.scoreBreakdown.engagementScore || 0) + 5
);

lead.score = Math.min(100, (lead.score || 0) + 5);

   

    await lead.save();

    res.status(201).json({ message: "Note added", note, lead });
  } catch (error) {
    res.status(500).json({ message: "Failed to add note", error: error.message });
  }
};

// ─── POST /leads/merge ────────────────────────────────────────────────────────
exports.mergeLeads = async (req, res) => {
  try {
    const { primaryId, duplicateIds } = req.body;

    if (!primaryId || !duplicateIds?.length) {
      return res.status(400).json({ message: "primaryId and duplicateIds required" });
    }

    const primary = await Lead.findById(primaryId);
    if (!primary) return res.status(404).json({ message: "Primary lead not found" });

    const duplicates = await Lead.find({ _id: { $in: duplicateIds } });

    // Merge notes and tags
    duplicates.forEach((dup) => {
      primary.notes.push(...dup.notes);
      dup.tags?.forEach((tag) => {
        if (!primary.tags.includes(tag)) primary.tags.push(tag);
      });
      primary.mergedLeads.push(dup._id);
    });

    primary.activityLog.push({
      action: "merged",
      note: `Merged ${duplicates.length} duplicate lead(s)`,
      byName: req.admin?.name || "Admin",
      by: req.admin?._id,
    });

    await primary.save();

    // Mark duplicates
    await Lead.updateMany(
      { _id: { $in: duplicateIds } },
      { isDuplicate: true, duplicateOf: primaryId }
    );

    res.status(200).json({
      message: `Merged ${duplicates.length} lead(s) into primary`,
      lead: primary,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to merge leads", error: error.message });
  }
};

// ─── DELETE /leads/:id ────────────────────────────────────────────────────────
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.status(200).json({ message: "Lead deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete lead", error: error.message });
  }
};

// ─── GET /leads/:id ───────────────────────────────────────────────────────────
exports.getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedTo", "name email")
      .populate("duplicateOf", "name whatsapp category createdAt");

    if (!lead) return res.status(404).json({ message: "Lead not found" });

    res.status(200).json(lead);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch lead", error: error.message });
  }
};


exports.getQualifiedLeads = async (req, res) => {
  try {
    const leads = await Lead.find({
      "aiAnalysis.isReal": true,
      "aiAnalysis.spamScore": { $lt: 50 },
      isDuplicate: false,
      riskLevel: "low",
    })
      .sort({ score: -1 })
      .limit(200);

    res.status(200).json(leads);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch qualified leads",
    });
  }
};




// const Lead = require("../models/Lead");

// exports.getLeads = async (req, res) => {
//   try {

//     const leads = await Lead.find().sort({ createdAt: -1 });

//     res.status(200).json(leads);

//   } catch (error) {

//     res.status(500).json({
//       message: "Failed to fetch leads",
//       error: error.message
//     });

//   }
// };

// // ADD THIS NEW FUNCTION (no change above)
// exports.createLead = async (req, res) => {
//   try {

//     const { name, whatsapp, pincode, bill, category } = req.body;

//     const newLead = new Lead({
//       name,
//       whatsapp,
//       pincode,
//       bill,
//       category
//     });

//     await newLead.save();

//     res.status(201).json({
//       message: "Lead saved successfully",
//       lead: newLead
//     });

//   } catch (error) {

//     res.status(500).json({
//       message: "Failed to save lead",
//       error: error.message
//     });

//   }
// };

// exports.updateLeadStatus = async (req, res) => {
//   try {

//     const { id } = req.params;
//     const { status } = req.body;

//     const lead = await Lead.findByIdAndUpdate(
//       id,
//       { status },
//       { new: true }
//     );

//     res.status(200).json({
//       message: "Status updated",
//       lead
//     });

//   } catch (error) {

//     res.status(500).json({
//       message: "Failed to update status",
//       error: error.message
//     });

//   }
// };

// exports.deleteLead = async (req, res) => {
//   try {

//     const lead = await Lead.findByIdAndDelete(req.params.id);

//     if (!lead) {
//       return res.status(404).json({ message: "Lead not found" });
//     }

//     res.status(200).json({ message: "Lead deleted successfully" });

//   } catch (error) {

//     res.status(500).json({
//       message: "Failed to delete lead",
//       error: error.message
//     });

//   }
// };
