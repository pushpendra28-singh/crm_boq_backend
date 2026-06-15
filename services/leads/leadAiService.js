exports.analyzeLead = async (lead) => {
  try {
    const prompt = `
You are an expert CRM lead qualification AI for a solar energy company in India.
Leads come from Google Ads, Meta Ads, landing pages, WhatsApp, and manual entry.
Fields vary by category: Residential (name, phone, email, pincode, bill), 
Housing Society (societyName, designation, agmStatus, pincode, bill), 
Commercial (companyName, city, pincode, commercialBill).

Analyze this lead for authenticity, intent, and quality.

Lead Data:
${JSON.stringify(lead, null, 2)}

Return ONLY valid JSON, no markdown, no explanation:
{
  "isReal": true/false,
  "spamScore": 0-100,
  "authenticityScore": 0-100,
  "phoneVerified": true/false,
  "emailVerified": true/false,
  "isSpam": true/false,
  "isFake": true/false,
  "leadTemperature": "Hot|Warm|Cold",
  "intent": "High|Medium|Low",
  "buyingStage": "Ready to Buy|Evaluating|Researching|Just Browsing",
  "conversionProbability": 0-100,
  "summary": "2 sentence lead summary",
  "nextBestAction": "specific recommended action",
  "painPoints": ["array", "of", "identified", "pain", "points"],
  "tags": ["array", "of", "relevant", "tags"],
  "duplicateRisk": 0-100,
  "validationFlags": ["array of issues found"],
  "scoreBreakdown": {
    "aiIntent": 0-25,
    "emailTrust": 0-20,
    "phoneTrust": 0-20,
    "duplicateRisk": 0-20,
    "engagement": 0-15
  },
  "priorityTag": "Hot Lead|Warm Lead|Cold Lead",
  "reason": "brief explanation"
}

Scoring rules:
- phoneVerified: true if Indian mobile number format (10 digits, starts 6-9)
- emailVerified: true if looks like a real personal/business email, false for temp/fake domains
- isSpam: true if name/phone looks fake (test, asdf, 9999999999, 1234567890 etc)
- isFake: true if data is clearly fabricated
- authenticityScore: overall 0-100 combining all signals
- leadTemperature: Hot if score>75, Warm if >50, Cold otherwise
`;

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    const text = response.choices[0].message.content;
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);

  } catch (err) {
    console.log("AI Lead Analysis Error:", err.message);
    return {
      isReal: true,
      spamScore: 50,
      authenticityScore: 0,
      phoneVerified: false,
      emailVerified: false,
      isSpam: false,
      isFake: false,
      leadTemperature: "Cold",
      intent: "Low",
      buyingStage: "Researching",
      conversionProbability: 0,
      summary: "AI unavailable",
      nextBestAction: "Manual review required",
      painPoints: [],
      tags: [],
      duplicateRisk: 0,
      validationFlags: ["AI analysis unavailable"],
      scoreBreakdown: { aiIntent: 0, emailTrust: 0, phoneTrust: 0, duplicateRisk: 0, engagement: 0 },
      priorityTag: "Cold Lead",
      reason: "AI unavailable",
    };
  }
};