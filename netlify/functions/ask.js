const { stream } = require("@netlify/functions");
const { Readable } = require("stream");

const ROUTER_URL = "https://9router.com";
const THINKING_BUDGETS = {
    disabled: { type: "disabled" },
    adaptive: { type: "adaptive" },
    high: { type: "enabled", budget_tokens: 4096 }
};

// Upstream sends Anthropic-style SSE frames. Simple HTTP clients (e.g. Roblox's
// HttpService, which blocks until the response is complete and can't parse SSE)
// just need the finished reply text, so we extract and re-stream that instead.
async function* extractTextDeltas(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            try {
                const parsed = JSON.parse(payload);
                if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                    yield parsed.delta.text;
                }
            } catch {
                // ignore malformed/partial SSE frames
            }
        }
    }
}

const handler = stream(async (event) => {
    // block non-POST operations
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    try {
        const { prompt, thinkingLevel } = JSON.parse(event.body || "{}");
        if (!prompt) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing prompt value" }) };
        }

        const thinkingConfig = THINKING_BUDGETS[thinkingLevel || "adaptive"];

        // Connect directly to the underlying free pipeline matrix
        const response = await fetch(ROUTER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer free-tier-access"
            },
            body: JSON.stringify({
                model: "claude-sonnet-4.6",
                messages: [{ role: "user", content: prompt }],
                thinking: thinkingConfig,
                stream: true // Enable continuous data passing to stay under 10s limits
            })
        });

        if (!response.ok || !response.body) {
            return {
                statusCode: 502,
                body: JSON.stringify({ error: "Upstream request failed" })
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: Readable.from(extractTextDeltas(response.body))
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Serverless execution failed", logs: error.message })
        };
    }
});

exports.handler = handler;
