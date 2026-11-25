const availableTools = [
    {
        type: "function_call",
        id: "fc_mock_1",
        call_id: "call_mock_1",
        name: "get_temperature",
        arguments: JSON.stringify({ city: "北京" })
    },
    {
        type: "function_call",
        id: "fc_mock_2",
        call_id: "call_mock_2",
        name: "find_cities",
        arguments: JSON.stringify({})
    }
];

export async function callMock(input) {
    if (!Array.isArray(input))
        throw new Error("Invalid input for callMock");

    if (input.findIndex(item => item.type === "function_call_output") !== -1) {
        const functionCallOutputs = input.filter(item => item.type === "function_call_output");
        const returnedCallIds = new Set();
        for (const { call_id } of functionCallOutputs) {
            if (returnedCallIds.has(call_id) || !input.some(item => item.type === "function_call" && item.call_id === call_id)) {
                throw new Error("Invalid input for callMock");
            }
            returnedCallIds.add(call_id);
        }
        const callMockTempsCount = functionCallOutputs.filter(item => item.call_id.startsWith("call_mock_temp_")).length;
        if (callMockTempsCount > 0) {
            if (callMockTempsCount === 1) {
                throw new Error("Only one temperature function call output is expected.");
            }

            if (callMockTempsCount === 2) {
                const callMockTemps = functionCallOutputs.filter(item => item.call_id.startsWith("call_mock_temp_"));
                const [first, second] = callMockTemps.map(item => JSON.parse(item.output));
                const colder = first.celsius < second.celsius ? first : second;
                const difference = Math.abs(first.celsius - second.celsius);
                const text = `${colder.city}更冷，相差 ${difference}°C`;

                return {
                    output: [
                        {
                            type: "message",
                            content: [
                                { type: "output_text", text: text }
                            ]
                        }
                    ]
                };
            }
        }

        let query = input.find(item => item.type === "function_call_output");
        // 获取天气
        if (query.call_id === "call_mock_1") {
            let output = JSON.parse(query.output);
            return {
                output: [
                    {
                        type: "message",
                        content: [
                            { type: "output_text", text: output.city + "是 " + output.celsius + "°C。" }
                        ]
                    }
                ]
            };
        }
        // 获取城市列表并额外新加两个function_call
        if (query.call_id === "call_mock_2") {
            const output = JSON.parse(query.output);
            let result = [];
            for (const [index, city] of output.cities.entries()) {
                result.push({
                    type: "function_call",
                    name: "get_temperature",
                    call_id: `call_mock_temp_${index + 1}`,
                    arguments: JSON.stringify({ city: city })
                });
            }
            return { output: result };
        }
    } else {
        if (input.findIndex(item => item.type === "function_call") === -1) {
            const userMessage = input.find(item => item.role === "user");
            if (!userMessage && input.length !== 0) {
                throw new Error("Invalid input for callMock");
            }
            const question = userMessage?.content ?? "";
            const toolName = question.includes("比较")
                ? "find_cities"
                : "get_temperature";

            const tool = availableTools.find(tool => tool.name === toolName);

            if (toolName === "get_temperature") {
                const city = question.includes("杭州") ? "杭州" : "北京";
                return { output: [{ ...tool, arguments: JSON.stringify({ city }) }] };
            }

            return { output: [tool] };
        }
    }

    throw new Error("Invalid input for callMock");
}