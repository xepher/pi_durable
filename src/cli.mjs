import { runAgent } from "./agent.mjs";
import { callMock } from "./mock-model.mjs";
import { callOpenAI } from "./openai.mjs";
import { dispatchTool } from "./tools.mjs";

const args = process.argv.slice(2);
const useRealModel = args.includes("--real");
const question = args.filter(arg => arg !== "--real").join(" ");
const model = useRealModel ? callOpenAI : callMock;
try {
    if (question.trim() === "") {
        console.log(`用法：node src/cli.mjs [--real] "你的问题"`);
        process.exit(0);
    }

    let round = 0;
    const answer = await runAgent({
        question, callModel(input) {
            round += 1;
            console.log(`\n=== Round ${round} ===`);
            return model(input);
        }, async dispatchTool(name, argumentsJson) {
            const result = await dispatchTool(name, argumentsJson);
            console.log(`\n=== Tool: ${name} Execution result: ok=${result.ok} ===`);
            return result;
        }
    });
    console.log(answer);
} catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
}