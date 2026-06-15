// ─────────────────────────────────────────────────────────────────────────────
// AI Narrative Service
//
// IMPORTANT: Add your OpenAI API key to your .env file:
//   OPENAI_API_KEY=sk-...
//
// Install: npm install openai
// ─────────────────────────────────────────────────────────────────────────────

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─── AI Engine: Generate Narrative via OpenAI ────────────────────────────────
const generateAINarrative = async (customerData, proposalCalc) => {
 const prompt = `You are a senior solar energy consultant in India creating a highly detailed, customer-friendly solar proposal.

Your task is to generate a PROFESSIONAL and EASY-TO-UNDERSTAND solar proposal explanation for a residential customer.

Customer Details:
- Customer Name: ${customerData.name}
- City: ${customerData.city || "India"}
- Pincode: ${customerData.pincode || "N/A"}
- Monthly Electricity Bill: ₹${customerData.monthlyBill}

Recommended Solar System:
- System Capacity: ${proposalCalc.systemSizeKW} kW
- Solar Panels: ${proposalCalc.panelCount} panels
- Panel Wattage: ${proposalCalc.panelWattage}Wp
- Daily Energy Generation: ${proposalCalc.unitsGeneratedPerDay} units/day

Financial Details:
- Total Installation Cost: ₹${proposalCalc.installationCost.toLocaleString("en-IN")}
- Government Subsidy: ₹${proposalCalc.subsidyAmount.toLocaleString("en-IN")}
- Net Investment: ₹${proposalCalc.netCost.toLocaleString("en-IN")}
- Monthly Savings: ₹${proposalCalc.monthlyEnergySavings.toLocaleString("en-IN")}
- Annual Savings: ₹${proposalCalc.annualEnergySavings.toLocaleString("en-IN")}
- Payback Period: ${proposalCalc.paybackYears} years
- 25-Year Savings: ₹${proposalCalc.roi25Years.toLocaleString("en-IN")}
- CO2 Offset: ${proposalCalc.co2OffsetTonsPerYear} tonnes/year

Generate VERY DETAILED proposal content in JSON format.

Return ONLY valid JSON:

{
  "executiveSummary": "minimum 8-10 detailed sentences explaining customer's current electricity problem, rising electricity costs, how solar helps, long-term benefits, energy independence, environmental impact, and savings",

  "systemDescription": "minimum 8-10 detailed sentences explaining panel quantity, panel technology, inverter type, daily generation, rooftop usage, net metering, monitoring system, system performance, and installation quality",

  "financialHighlights": "minimum 8-10 detailed sentences explaining installation cost, subsidy benefit, monthly savings, annual savings, EMI benefits, return on investment, payback period, 25-year savings, and electricity inflation protection",

  "installationProcess": "minimum 8-10 detailed sentences explaining site survey, engineering design, material delivery, mounting structure installation, panel installation, inverter setup, wiring, net meter approval, testing, commissioning, and handover process",

  "maintenanceSupport": "minimum 8-10 detailed sentences explaining cleaning requirements, monitoring support, warranty coverage, after-sales support, annual maintenance, service response, performance guarantee, and customer assistance",

  "environmentBenefits": "minimum 6-8 detailed sentences explaining carbon reduction, environmental benefits, green energy impact, pollution reduction, and sustainability contribution",

  "whyChooseUs": "minimum 8-10 detailed sentences explaining company experience, certifications, engineering expertise, quality standards, customer support, warranty, trusted installation process, and commitment"
}

Return ONLY pure JSON.
`;

  try {
   const completion = await openai.responses.create({
  model: "gpt-4o-mini",
  input: prompt,
});

    const content = completion.output_text;
    return JSON.parse(content);
  } catch (err) {
    // Fallback narrative if OpenAI fails
    return {
  executiveSummary: `Dear ${customerData.name}, your current electricity expenses of approximately ₹${customerData.monthlyBill?.toLocaleString("en-IN")} per month indicate a significant dependency on conventional grid electricity. Due to continuously increasing electricity tariffs across India, your annual power expenses are expected to rise substantially in the coming years. Our recommended ${proposalCalc.systemSizeKW} kW rooftop solar system is specially designed to reduce your electricity bills and provide long-term financial security. By generating clean electricity directly from sunlight, this system will help you achieve energy independence while protecting you from future tariff hikes. In addition to reducing your electricity expenses, solar energy also increases your property value and contributes positively toward environmental sustainability. With this investment, you will enjoy reliable power generation for the next 25 years with minimal maintenance requirements.`,

  systemDescription: `We recommend installing ${proposalCalc.panelCount} premium high-efficiency ${proposalCalc.panelWattage}Wp solar panels connected to a modern ${proposalCalc.inverterType}. The complete system capacity will be approximately ${proposalCalc.systemSizeKW} kW, capable of generating nearly ${proposalCalc.unitsGeneratedPerDay} units of electricity every day under standard sunlight conditions. The panels will be installed using corrosion-resistant mounting structures specially designed for Indian weather conditions. The system includes high-quality DC and AC protection systems, solar-grade wiring, and a smart monitoring solution that allows you to track generation performance in real time. This on-grid system will synchronize with your local electricity supply through net metering, allowing excess electricity generated during daytime to be exported to the grid for additional savings.`,

  financialHighlights: `The estimated total installation cost for your solar project is ₹${proposalCalc.installationCost?.toLocaleString("en-IN")}. Under the ${proposalCalc.subsidyScheme}, you are eligible for a government subsidy of ₹${proposalCalc.subsidyAmount?.toLocaleString("en-IN")}, significantly reducing your effective investment amount to ₹${proposalCalc.netCost?.toLocaleString("en-IN")}. Based on your current electricity usage, the system is expected to save approximately ₹${proposalCalc.monthlyEnergySavings?.toLocaleString("en-IN")} every month and nearly ₹${proposalCalc.annualEnergySavings?.toLocaleString("en-IN")} annually. Your investment is expected to recover within approximately ${proposalCalc.paybackYears} years, after which the electricity generated becomes essentially free. Over a 25-year system lifespan, the estimated total savings can exceed ₹${proposalCalc.roi25Years?.toLocaleString("en-IN")}.`,

  installationProcess: `Our installation process begins with a detailed technical site survey and rooftop inspection conducted by certified solar engineers. After design approval, all required materials including solar panels, inverter systems, mounting structures, and protection accessories are delivered to your location. The installation team then completes structure fabrication, panel mounting, inverter setup, cabling, earthing, and electrical safety integration. After installation, complete testing and commissioning are performed to ensure optimal system performance. We also assist with net metering documentation and DISCOM approvals for seamless grid integration.`,

  maintenanceSupport: `The solar system requires very minimal maintenance and is designed for long-term reliable performance. Periodic panel cleaning and regular inspection help maintain maximum energy generation efficiency. We provide complete technical support, warranty assistance, and after-sales service to ensure uninterrupted operation. The solar panels come with long-term performance warranties while the inverter and associated equipment are covered under manufacturer warranty policies. Our support team remains available for troubleshooting, monitoring assistance, and maintenance guidance whenever required.`,

  environmentBenefits: `By switching to solar energy, your system will reduce approximately ${proposalCalc.co2OffsetTonsPerYear} tonnes of carbon emissions every year. This contributes directly toward reducing pollution and promoting sustainable clean energy adoption. Over the lifetime of the system, your contribution toward environmental protection will be equivalent to planting hundreds of trees and significantly reducing dependency on fossil-fuel-based electricity generation.`,

  whyChooseUs: `We are an experienced MNRE-empanelled solar installation company committed to delivering high-quality solar solutions across India. Our engineering team follows strict quality standards and uses only trusted components from reputed manufacturers. From project planning and engineering design to installation, testing, subsidy support, and after-sales service, we provide complete end-to-end project execution. Our commitment to customer satisfaction, transparent pricing, reliable support, and long-term service makes us a trusted solar partner for residential customers.`,
};
  }
};

module.exports = { generateAINarrative };