export async function runAgent({ question, callModel, dispatchTool, maxRounds = 6 }) {
    let input = [{ role: "user", content: question }];

    while (maxRounds-- > 0) {
        try {
            const response = await callModel(input);
            if (response.status === "incomplete") {
                throw new Error("The model's response was incomplete.");
            }
            input = input.concat(response.output);

            const functionCalls = response.output.filter(item => item.type === "function_call");
            if (functionCalls.length === 0) {
                const contents = response.output.filter(item => item.type === "message").flatMap(item => item.content);
                if (contents.findIndex(item => item.type === "refusal") !== -1) {
                    throw new Error("The model refused to answer the question.");
                }
                const answer = contents.filter(item => item.type === "output_text").map(item => item.text).join("\n");
                if (answer.trim() === '') {
                    throw new Error("No answer found in the model's response.");
                }
                return answer;
            }
            for (const call of functionCalls) {
                const callResponse = await dispatchTool(call.name, call.arguments);
                input.push({
                    type: "function_call_output",
                    call_id: call.call_id,
                    output: JSON.stringify(callResponse)
                });
            };
        } catch (error) {
            throw new Error(`Error during agent execution: ${error.message}`);
        }
    }

    throw new Error("Max rounds exceeded without a final answer.");
}