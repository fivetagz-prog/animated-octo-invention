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

    const thinkingConfig = THINKING_BUDGETS[thinkingLevel || "adaptive"];

    let upstream;
    try {
        // Connect directly to the underlying free pipeline matrix
        upstream = await fetch(ROUTER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer free-tier-access"
            },
            body: JSON.stringify({
                model: "claude-sonnet-4.6",
                messages: [{ role: "user", content: prompt }],
                thinking: thinkingConfig,
                stream: true // Enable continuous data passing to stay under execution time limits
            })
        });
    } catch (error) {
        return Response.json({ error: "Serverless execution failed", logs: error.message }, { status: 500 });
    }

    if (!upstream.ok || !upstream.body) {
        return Response.json({ error: "Upstream request failed" }, { status: 502 });
    }

    const textStream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const chunk of extractTextDeltas(upstream.body)) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        }
    });

    return new Response(textStream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
};
