const { stream } = require("@netlify/functions");

const ROUTER_URL = "https://9router.com";
const THINKING_BUDGETS = {
    disabled: { type: "disabled" },
    adaptive: { type: "adaptive" },
    high: { type: "enabled", budget_tokens: 4096 }
};

const handler = async (event, context) => {
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

        // Use Netlify's native text stream wrapper to route real-time chunks back down the wire
        return stream(async (streamResponse) => {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                streamResponse.write(chunk);
            }
            streamResponse.end();
        });

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Serverless execution failed", logs: error.message })
        };
    }
};

exports.handler = handler;
