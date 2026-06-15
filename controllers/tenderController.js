const Tender = require("../models/Tender");
const tenderAI = require("../services/tender/TenderAIService");
const { generateBOQDocx } = require("../services/tender/BoqDocxGenerator");
const path = require("path");
const { extractText } = require("../services/tender/fileExtractor");
const Admin  = require("../models/Admin");
const nodemailer = require("nodemailer");
const { generateBOQExcel } = require("../services/tender/generateBOQExcel");
const { MULTI_WORK_SYSTEM_PROMPT, buildMultiWorkBOQPrompt, buildMultiWorkDocBOQPrompt } = require("../services/tender/multiWorkPrompts");
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



/**
 * Extracts the Project Title from the AI-generated BOQ markdown.
 * Looks for "Project Title: ..." line inside the ## 1. PROJECT OVERVIEW section.
 */
const extractTitleFromBOQ = (markdown) => {
  if (!markdown) return null;
  // Match "Project Title: Some Title" or "**Project Title:** Some Title"
  const match = markdown.match(/project\s+title[:\s*]+([^\n\r]+)/i);
  if (match?.[1]) {
    return match[1]
      .replace(/\*\*/g, "")   // strip bold markers
      .replace(/^[-:]\s*/, "") // strip leading dash or colon
      .trim();
  }
  return null;
};

/* ─────────────────────────────────────────────────────────────
   POST /api/tender/start  — unchanged
───────────────────────────────────────────────────────────── */
const startTender = async (req, res) => {
  try {
    const firstQuestion =
      "Let's get started! 🚀 Briefly describe your project — what do you need done? (e.g. 'Office interior renovation for 5000 sq ft', 'E-commerce website development', 'Residential construction 3BHK')";

    const tender = await Tender.create({
      createdBy: req.admin?._id || null,
      conversationHistory: [],
      status: "in_progress",
    });

    res.json({ success: true, tenderId: tender._id, message: firstQuestion });
  } catch (err) {
    console.error("startTender error:", err);
    res.status(500).json({ success: false, error: "Failed to start session." });
  }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/tender/:id/message  — unchanged interface
───────────────────────────────────────────────────────────── */
const sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message?.trim())
      return res.status(400).json({ success: false, error: "Message is required." });

    const tender = await Tender.findById(id);
    if (!tender)
      return res.status(404).json({ success: false, error: "Tender not found." });
    if (tender.status !== "in_progress")
      return res.status(400).json({ success: false, error: "This tender is already completed." });

    const { aiMessage, isReady } = await tenderAI.chat(
      tender.conversationHistory,
      message.trim()
    );

    tender.conversationHistory.push(
      { role: "user", content: message.trim() },
      { role: "assistant", content: aiMessage || "Understood. Let me proceed." }
    );

    if (isReady) {
      const boqMarkdown = await tenderAI.generateProposal(tender.conversationHistory);

      // Extract a clean title from the first user message
      const firstUserMsg = tender.conversationHistory.find((m) => m.role === "user");
      tender.title = firstUserMsg?.content?.slice(0, 100) || "Untitled BOQ";
      tender.generatedProposal = boqMarkdown;
      tender.status = "draft";
      await tender.save();

      return res.json({
        success: true,
        message: aiMessage || "",
        isReady: true,
        proposal: boqMarkdown,
        tenderId: tender._id,
      });
    }

    await tender.save();
    res.json({ success: true, message: aiMessage, isReady: false });
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ success: false, error: "AI service error. Please try again." });
  }
};

/* ─────────────────────────────────────────────────────────────
   POST /api/tender/from-doc  — unchanged interface
───────────────────────────────────────────────────────────── */
// ─────────────────────────────────────────────────────────────
// CHANGE IN tenderController.js
// Only this ONE function changes — replace createFromDoc with this.
// All other handlers (startTender, sendMessage, getAllTenders,
// getTenderById, updateStatus, downloadDocx) remain exactly the same.
// ─────────────────────────────────────────────────────────────

// ADD this require at the top of tenderController.js (with the other requires):
// const { extractText } = require("../services/tender/fileExtractor");

/* ─────────────────────────────────────────────────────────────
   POST /api/tender/from-doc
   FIXED: now extracts actual file text and passes it to AI.
───────────────────────────────────────────────────────────── */
const createFromDoc = async (req, res) => {
  try {
    const { prompt }    = req.body;
    const docFileName   = req.file?.originalname || null;
    const docFilePath   = req.file?.path || null;

    // Extract text from the uploaded file
    let docText = "";
    if (docFilePath && docFileName) {
      const { text, error } = await extractText(docFilePath, docFileName);
      if (error) {
        console.warn("File extraction warning:", error);
        // Non-fatal — continue with whatever text we got (may be empty)
      }
      docText = text;
    }

    // Need either a prompt or readable document content
    const hasPrompt  = prompt?.trim().length > 0;
    const hasDocText = docText.trim().length > 50; // at least some meaningful content

    if (!hasPrompt && !hasDocText) {
      return res.status(400).json({
        success: false,
        error: "Please provide a description or upload a readable document (PDF/DOCX/TXT).",
      });
    }

    const boqMarkdown = await tenderAI.generateProposalFromPrompt(
      prompt?.trim() || "",
      docFileName || "uploaded-document",
      docText
    );

    const extractedTitle = extractTitleFromBOQ(boqMarkdown) 
  || (docFileName ? path.basename(docFileName, path.extname(docFileName)) : null)
  || "Project Requirements";

const tender = await Tender.create({
  title: extractedTitle.slice(0, 100),
      generatedProposal: boqMarkdown,
      docFileName:       docFileName || null,
      docPrompt:         prompt?.trim() || null,
      status:            "draft",
      createdBy:         req.admin?._id || null,
    });

    res.json({ success: true, proposal: boqMarkdown, tenderId: tender._id });
  } catch (err) {
    console.error("createFromDoc error:", err);
    res.status(500).json({ success: false, error: "Failed to generate BOQ from document." });
  }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/tender/:id/download-docx
   NEW: Stream the generated BOQ as a .docx file
───────────────────────────────────────────────────────────── */
const downloadDocx = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.id);
    if (!tender || !tender.generatedProposal)
      return res.status(404).json({ success: false, error: "BOQ not found." });

    const buffer = await generateBOQDocx(tender.generatedProposal, tender.title);

    const safeTitle = (tender.title || "BOQ")
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_BOQ.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error("downloadDocx error:", err);
    res.status(500).json({ success: false, error: "Failed to generate DOCX." });
  }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/tender  — unchanged
───────────────────────────────────────────────────────────── */
const getAllTenders = async (req, res) => {
  try {
    const tenders = await Tender.find()
      .select("title status docFileName createdAt updatedAt")
      .sort({ createdAt: -1 });
    res.json({ success: true, tenders });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch tenders." });
  }
};

/* ─────────────────────────────────────────────────────────────
   GET /api/tender/:id  — unchanged
───────────────────────────────────────────────────────────── */
const getTenderById = async (req, res) => {
  try {
    const tender = await Tender.findById(req.params.id);
    if (!tender) return res.status(404).json({ success: false, error: "Not found." });
    res.json({ success: true, tender });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch tender." });
  }
};

/* ─────────────────────────────────────────────────────────────
   PATCH /api/tender/:id/status  — unchanged
───────────────────────────────────────────────────────────── */
const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["draft", "pending", "approved", "rejected"];
    if (!allowed.includes(status))
      return res.status(400).json({ success: false, error: "Invalid status." });

    const tender = await Tender.findByIdAndUpdate(req.params.id, { status }, { new: true })
      .select("title status updatedAt");
    res.json({ success: true, tender });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to update status." });
  }
};


/* ─────────────────────────────────────────────────────────────
   GET /api/tender/vendors
   Returns all users whose role slug === "vendor"
   Uses the existing Admin/User model + roles lookup
───────────────────────────────────────────────────────────── */
const getVendors = async (req, res) => {
  try {
    // Admin model stores role as a slug string (e.g. "vendor")
    // We find the vendor role slug from the Role collection first,
    // then query users — this handles both hardcoded and custom role names.
    const Role  = require("../models/Role");
    const Admin = require("../models/Admin");
 
    // Find all roles whose slug or name contains "vendor" (case-insensitive)
    const vendorRoles = await Role.find({
      $or: [
        { slug: /vendor/i },
        { name: /vendor/i },
      ],
    }).select("slug");
 
    const vendorSlugs = vendorRoles.map((r) => r.slug);
 
    // Fallback: also include literal "vendor" in case it's a system role not in Role collection
    if (!vendorSlugs.includes("vendor")) vendorSlugs.push("vendor");
 
    const vendors = await Admin.find({
      role: { $in: vendorSlugs },
      isActive: { $ne: false }, // only active vendors
    }).select("name email role");
 
    res.json({ success: true, vendors });
  } catch (err) {
    console.error("getVendors error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch vendors." });
  }
};


/* ─────────────────────────────────────────────────────────────
   POST /api/tender/:id/send
   Body: { vendorId: string, docType: "generated" | "custom", customDocName?: string }
   File: req.file (optional — for custom doc upload)
   
   Marks the tender as sent to vendor + records dispatch log.
   Sends email if nodemailer/mailer is configured.
───────────────────────────────────────────────────────────── */
const sendToVendor = async (req, res) => {
  try {
    const { id }        = req.params;
    const { vendorId, docType, customDocName } = req.body;
    const Admin = require("../models/Admin");
 
    if (!vendorId) {
      return res.status(400).json({ success: false, error: "vendorId is required." });
    }
 
    const [tender, vendor] = await Promise.all([
      Tender.findById(id),
      Admin.findById(vendorId).select("name email"),
    ]);
 
    if (!tender) return res.status(404).json({ success: false, error: "Tender not found." });
    if (!vendor) return res.status(404).json({ success: false, error: "Vendor not found." });
 
    // ── Record the dispatch in the tender document ──
    if (!tender.sentTo) tender.sentTo = [];
 
    const alreadySent = tender.sentTo.some(
      (s) => String(s.vendorId) === String(vendorId)
    );
 
    if (!alreadySent) {
      tender.sentTo.push({
        vendorId: vendor._id,
        vendorName: vendor.name,
        vendorEmail: vendor.email,
        docType: docType || "generated",
        customDocName: customDocName || null,
        sentAt: new Date(),
      });
    }
 
    // Update status to pending (awaiting vendor response)
    if (tender.status === "draft") tender.status = "pending";
    await tender.save();
 
    // ── Optional email dispatch ──
    // Uncomment and configure if you have nodemailer set up:
    //
    // try {
    //   const transporter = nodemailer.createTransport({ /* your config */ });
    //   await transporter.sendMail({
    //     from: process.env.MAIL_FROM || "noreply@yourapp.com",
    //     to: vendor.email,
    //     subject: `BOQ / Requirement Document: ${tender.title}`,
    //     text: `Dear ${vendor.name},\n\nPlease find the attached BOQ for "${tender.title}".\n\nRegards,\nProcurement Team`,
    //   });
    // } catch (mailErr) {
    //   console.warn("Email send failed (non-fatal):", mailErr.message);
    // }
 
    res.json({
      success: true,
      message: `Proposal sent to ${vendor.name} (${vendor.email})`,
      vendor: { _id: vendor._id, name: vendor.name, email: vendor.email },
      alreadySent,
    });
  } catch (err) {
    console.error("sendToVendor error:", err);
    res.status(500).json({ success: false, error: "Failed to send to vendor." });
  }
};

// ═══════════════════════════════════════════════
//  MULTI-WORK BOQ HANDLERS — Added below existing
// ═══════════════════════════════════════════════

const multiSessions = new Map();
const generateId = () => `mw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const startMultiSession = async (req, res) => {
  try {
    const sessionId = generateId();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: MULTI_WORK_SYSTEM_PROMPT },
        { role: "user",   content: "I need to create a multi-work BOQ for my project." },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });
    const aiMessage = response.choices[0].message.content.trim();
    multiSessions.set(sessionId, { history: [{ role: "assistant", content: aiMessage }], proposal: null, title: null });
    return res.json({ success: true, sessionId, message: aiMessage });
  } catch (err) {
    console.error("startMultiSession error:", err);
    return res.status(500).json({ success: false, error: "Failed to start session." });
  }
};

const multiMessage = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const session = multiSessions.get(id);
  if (!session) return res.status(404).json({ success: false, error: "Session not found." });
  session.history.push({ role: "user", content: message });
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: MULTI_WORK_SYSTEM_PROMPT }, ...session.history],
      temperature: 0.4,
      max_tokens: 700,
    });
    const aiMessage = response.choices[0].message.content.trim();
    const isReady = aiMessage.includes("##READY_TO_GENERATE##");
    const displayMessage = aiMessage.replace("##READY_TO_GENERATE##", "").trim();
    session.history.push({ role: "assistant", content: displayMessage });
    if (isReady) {
      const boqMarkdown = await generateMultiWorkBOQ(session.history);
      session.proposal = boqMarkdown;
      session.title = extractMultiProjectTitle(boqMarkdown);
      return res.json({ success: true, isReady: true, message: displayMessage, proposal: boqMarkdown, sessionId: id });
    }
    return res.json({ success: true, isReady: false, message: displayMessage });
  } catch (err) {
    console.error("multiMessage error:", err);
    return res.status(500).json({ success: false, error: "AI error. Please retry." });
  }
};

const multiFromDoc = async (req, res) => {
  const userPrompt = req.body.prompt || "";
  const file = req.file;
  let docText = "";
  if (file) {
    const extracted = await extractText(file.path, file.originalname);
    docText = extracted.text || "";
  }
  try {
    const prompt = buildMultiWorkDocBOQPrompt(userPrompt, file?.originalname || "", docText);
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
    });
    const boqMarkdown = response.choices[0].message.content.trim();
    const sessionId = generateId();
    multiSessions.set(sessionId, { history: [], proposal: boqMarkdown, title: extractMultiProjectTitle(boqMarkdown) });
    return res.json({ success: true, sessionId, proposal: boqMarkdown });
  } catch (err) {
    console.error("multiFromDoc error:", err);
    return res.status(500).json({ success: false, error: "Failed to generate BOQ." });
  }
};

const downloadMultiDocx = async (req, res) => {
  const session = multiSessions.get(req.params.id);
  if (!session?.proposal) return res.status(404).json({ error: "BOQ not found." });
  try {
    const buffer = await generateBOQDocx(session.proposal, session.title || "Multi-Work BOQ");
    const filename = `BOQ_${(session.title || "MultiWork").replace(/\s+/g, "_").slice(0, 40)}_${Date.now()}.docx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (err) {
    console.error("downloadMultiDocx error:", err);
    res.status(500).json({ error: "Failed to generate DOCX." });
  }
};

const downloadMultiXlsx = async (req, res) => {
  const session = multiSessions.get(req.params.id);
  if (!session?.proposal) return res.status(404).json({ error: "BOQ not found." });
  try {
    const buffer = await generateBOQExcel(session.proposal, session.title || "Multi-Work BOQ");
    const filename = `BOQ_${(session.title || "MultiWork").replace(/\s+/g, "_").slice(0, 40)}_${Date.now()}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    console.error("downloadMultiXlsx error:", err);
    res.status(500).json({ error: "Failed to generate Excel." });
  }
};

// Helpers
const generateMultiWorkBOQ = async (history) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: buildMultiWorkBOQPrompt(history) }],
    temperature: 0.3,
    max_tokens: 4000,
  });
  return response.choices[0].message.content.trim();
};

const extractMultiProjectTitle = (markdown) => {
  const match = markdown.match(/Project Title\s*:\s*(.+)/i);
  return match?.[1]?.trim().slice(0, 60) || "BOQ Document";
};

module.exports = {
  startTender, sendMessage, createFromDoc,
  getAllTenders, getTenderById, updateStatus,
  downloadDocx, getVendors, sendToVendor,
  multiMessage, multiFromDoc, downloadMultiDocx, downloadMultiXlsx, startMultiSession,
};