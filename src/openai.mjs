const tools = [
    {
        type: "function",
        name: "get_temperature",
        description: "使用练习数据查询指定城市的摄氏温度。",
        parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "find_cities",
        description: "查找用于比较温度的两个候选城市。",
        parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
        },
        strict: true
    }
];

export async function callOpenAI(input) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_MODEL?.trim();
    if (!apiKey || !model) {
        throw new Error("请设置 OPENAI_API_KEY 和 OPENAI_MODEL。可以通过 node --env-file=.env 加载本地配置。");
    }

    const body = JSON.stringify({
        model,
        input,
        tools,
        store: false,
        include: ["reasoning.encrypted_content"],
        instructions: "比较候选城市时，先用 find_cities 查候选，再用 get_temperature 查询每个城市并根据结果比较。查询指定城市时直接用 get_temperature。以工具返回的数据为准。"
    });

    const signal = AbortSignal.timeout(30_000);
    let response;
    try {
        response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body,
            signal
        });
    } catch {
        throw new Error(signal.aborted ? "OpenAI 请求超时。" : "无法连接 OpenAI Responses API。");
    }

    if (!response.ok) {
        // 丢弃上游错误正文，只显示本地生成的摘要。
        await response.body?.cancel().catch(() => {});
        const summaries = {
            400: "请求参数无效",
            401: "身份验证失败",
            403: "访问被拒绝",
            404: "模型或资源不可用",
            429: "请求受限或额度不足"
        };
        const summary = summaries[response.status] ?? "请求失败";
        throw new Error(`OpenAI Responses API HTTP ${response.status}。${summary}。`);
    }

    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error(signal.aborted ? "OpenAI 响应读取超时。" : "无法读取 OpenAI 响应 JSON。");
    }

    if (result?.status === "failed" || result?.status === "cancelled" || result?.error) {
        throw new Error("OpenAI Responses API 未能完成请求。");
    }
    if (result?.status !== "incomplete" && !Array.isArray(result?.output)) {
        throw new Error("OpenAI 响应缺少 output 数组。");
    }
    return result;
}
