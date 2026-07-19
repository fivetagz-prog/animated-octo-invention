import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const MODEL = "claude-sonnet-4-6";

export default async (req) => {
    // block non-POST operations
    if (req.method !== "POST") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }

    let payload;
    try {
        payload = await req.json();
    } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { prompt, thinkingLevel } = payload;
    if (!prompt) {
        return Response.json({ error: "Missing prompt value" }, { status: 400 });
    }

    const useExtendedThinking = thinkingLevel === "high";

    try {
        const message = await anthropic.messages.create({
            model: MODEL,
            max_tokens: useExtendedThinking ? 8192 : 1024,
            messages: [{ role: "user", content: prompt }],
            ...(useExtendedThinking && { thinking: { type: "enabled", budget_tokens: 4096 } })
        });

        const reply = message.content.find((block) => block.type === "text")?.text ?? "";

        return Response.json({ reply });
    } catch (error) {
        return Response.json({ error: "AI request failed", logs: error.message }, { status: 500 });
    }
};
