const availableTools = [
    {
        type: "function_call",
        id: "fc_mock_1",
        call_id: "call_mock_1",
        name: "get_temperature",
        arguments: JSON.stringify({ city: "北京" })
    }
];

export async function callMock(input) {
    if (!Array.isArray(input) || input.findIndex(item => item.type === "function_call_output") === -1) {
        if (input.findIndex(item => item.type === "function_call") === -1) {
            return { output: availableTools };
        } else {
            throw new Error("Invalid input for callMock");
        }
    }

    if (input.findIndex(item => item.type === "function_call_output") !== -1) {
        let query = input.find(item => item.type === "function_call_output");
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
    }

    throw new Error("Invalid input for callMock");
}