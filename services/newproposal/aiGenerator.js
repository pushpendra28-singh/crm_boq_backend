const OpenAI = require("openai");
const {
  buildProposalPrompt,
} = require("./proposalPromptBuilder");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.generateProposalAI =
  async (proposal) => {
    const prompt =
      buildProposalPrompt(proposal);

    const response =
      await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
You are a world-class proposal designer.

Create premium business proposals.

Return ONLY clean HTML.
No markdown.
No explanations.
`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.8,
      });

    const html =
      response.choices[0].message.content;

    return {
      executiveSummary: html,
      fullProposal: html,
    };
  };