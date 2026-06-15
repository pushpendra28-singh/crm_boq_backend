const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const Proposal = require("../models/Proposal");

exports.downloadProposalPDF = async (req, res) => {
  const proposal = await Proposal.findById(req.params.id);

  if (!proposal) {
    return res.status(404).json({ message: "Proposal not found" });
  }

  const p = proposal.proposal;

  const doc = new PDFDocument({
    margin: 40,
    size: "A4",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=proposal-${proposal._id}.pdf`
  );
  res.setHeader("Cache-Control", "no-store");

  doc.pipe(res);

  doc.fontSize(24).text("Solar Proposal", {
    align: "center",
  });

  doc.moveDown();

  const sections = [
    p.executiveSummary,
    p.systemDescription,
    p.financialHighlights,
    p.installationProcess,
    p.maintenanceSupport,
    p.environmentBenefits,
    p.whyChooseUs,
  ];

  sections.forEach((text) => {
    if (text) {
      doc.moveDown();
      doc.fontSize(12).text(text, {
        lineGap: 5,
      });
    }
  });

  doc.end();
};

exports.downloadProposalDOCX = async (req, res) => {
  const proposal = await Proposal.findById(req.params.id);

  if (!proposal) {
    return res.status(404).json({ message: "Proposal not found" });
  }

  const p = proposal.proposal;

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "Solar Proposal",
                bold: true,
                size: 36,
              }),
            ],
          }),

          new Paragraph(p.executiveSummary || ""),
          new Paragraph(p.systemDescription || ""),
          new Paragraph(p.financialHighlights || ""),
          new Paragraph(p.installationProcess || ""),
          new Paragraph(p.maintenanceSupport || ""),
          new Paragraph(p.environmentBenefits || ""),
          new Paragraph(p.whyChooseUs || ""),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=proposal-${proposal._id}.docx`
  );

  res.setHeader(
  "Content-Type",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
);

  res.send(buffer);
};