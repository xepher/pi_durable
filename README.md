# 从零手写一个 ReAct 式 Agent

这是一份动手教程。在当前仓库里，你将用 Node.js 写一个命令行 Agent。它根据用户问题调用工具，把结果交回模型，再根据结果决定下一步。你会亲手写这段循环。第一轮学习使用本地假模型，第 5 课接入 OpenAI Responses API，第 6 课练习在进程重启后恢复运行。每一课完成验收后再进入下一课。

## 我们要做出什么

用户输入「找出候选的两个城市，比较哪个更冷」。Agent 先调用 `find_cities`，从返回结果中得到两个城市，再分别调用 `get_temperature`，最后给出比较。温度和城市均来自本地固定数据，全程不需要天气 API。

```mermaid
flowchart LR
    U[用户输入] --> M[模型读取上下文]
    M -->|工具请求| T[程序执行工具]
    T -->|带调用 ID 的结果| M
    M -->|最终答案| F[返回给用户]
```

图里的箭头由你的代码驱动。模型负责提出动作，程序决定允许执行哪些动作，并且保证循环能结束。练习中可以观察工具名、参数、结果和最终答案，足以解释 Agent 的外部行为。

## 准备

在当前仓库根目录打开 PowerShell。你的 Node.js 26 已经满足要求，课程只使用 Node.js 内置模块，直接运行 `.mjs` 文件。

```powershell
node --version
New-Item -ItemType Directory -Path src -Force | Out-Null
```

按课程进度创建以下文件：

| 文件 | 职责 |
|---|---|
| `src/tools.mjs` | 固定数据、工具描述、参数校验和工具分发 |
| `src/mock-model.mjs` | 返回可预测的模型响应，并检查上一轮结果 |
| `src/agent.mjs` | 手写模型与工具之间的循环 |
| `src/openai.mjs` | 用 `fetch` 调用 OpenAI Responses API |
| `src/cli.mjs` | 读取命令行问题，选择假模型或真实模型 |

## 第 1 课：先把工具写成普通函数

**任务。** 创建 `src/tools.mjs`，实现一个工具：`get_temperature`。把以下数据作为固定的练习输入：

| 城市 | 温度（摄氏度） |
|---|---:|
| 北京 | 6 |
| 杭州 | 14 |

先写好 `getTemperature(city)`，再写 `dispatchTool(name, argumentsJson)`。分发函数应导出，便于命令行直接调用。这一课的约定如下：

- `name` 必须是工具白名单里的名称。现在白名单只有 `get_temperature`。
- `argumentsJson` 是 JSON 字符串。解析后要求它是普通对象，有且仅有一个非空字符串字段 `city`。可以先对城市名做 `trim()`。
- 成功返回 `{ ok: true, city, celsius }`。未知工具、无效 JSON、参数不合法和未知城市分别返回 `{ ok: false, error: 'unknown_tool' }`、`invalid_json`、`invalid_arguments`、`unknown_city`。

**验收。** 在仓库根目录把整个代码块粘贴到 PowerShell。单引号 here-string 将 JavaScript 作为标准输入传给 Node。城市名用 Unicode 转义，兼容 Windows PowerShell 的默认管道编码。

```powershell
@'
import { dispatchTool } from './src/tools.mjs';
console.log(dispatchTool('get_temperature', JSON.stringify({ city: '\u5317\u4eac' })));
console.log(dispatchTool('get_temperature', '{'));
console.log(dispatchTool('get_temperature', JSON.stringify({ city: '\u4e0d\u5b58\u5728' })));
console.log(dispatchTool('unknown', '{}'));
'@ | node --input-type=module -
```

预期依次看到北京 `6` 度、`invalid_json`、`unknown_city`、`unknown_tool`。再自己补一条 `city: 123` 或 `city: " "`，应该得到 `invalid_arguments`。

**想一想。** 为什么模型提供了合法 JSON 以后，工具仍要校验参数和允许的工具名？

## 第 2 课：让假模型发出一次工具请求

**任务。** 创建 `src/mock-model.mjs`，导出 `async function callMock(input)`。`input` 是发给模型的上下文数组。第一次调用时，返回以下对象。这里的 `id` 是输出项 ID，`call_id` 是稍后用来匹配工具结果的调用 ID。

```js
{
  output: [
    {
      type: "function_call",
      id: "fc_mock_1",
      call_id: "call_mock_1",
      name: "get_temperature",
      arguments: JSON.stringify({ city: "北京" })
    }
  ]
}
```

第二次调用时，从 `input` 找到一个 `type: "function_call_output"` 的项，校验它的 `call_id` 为 `call_mock_1`。解析它的 `output` 字符串，然后用解析出的温度生成答案。把答案放在 `output` 数组内的 `message` 项中，其 `content` 数组包含 `{ type: "output_text", text: "北京是 6°C。" }`。收到错误的调用 ID 或缺少工具结果时抛出异常，让接线问题在本地立即暴露。

**验收。** 手工调用 `callMock` 两次。第一次拿到工具名和调用 ID，第二次传入正确的工具结果并得到答案。把传入的温度改为 `9`，答案应该随之变为 `9°C`。这可以验证假模型确实读取了工具结果。

## 第 3 课：写出 Agent 循环

**任务。** 在 `src/agent.mjs` 导出 `runAgent({ question, callModel, dispatchTool, maxRounds = 6 })`。函数内部维护一个 `input` 数组，初始内容是 `{ role: "user", content: question }`。`callModel(input)` 可以传入上一课的假模型，后面再替换成真实模型。

用带上限的循环实现以下顺序：

1. 调用 `callModel(input)`。检查返回结果，再把 `response.output` 的**所有项按原顺序**追加到 `input`。
2. 从本轮 `output` 取出 `type === "function_call"` 的项。如果本轮有工具请求，逐个调用 `dispatchTool(call.name, call.arguments)`，等待工具结果。为每个请求追加一个 `{ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) }`，然后再次请求模型。
3. 如果本轮没有工具请求，提取本轮 `message` 的 `content` 中所有 `output_text` 的 `text` 并返回。模型有时会同时返回文本和工具请求，先完成工具分支。
4. 没有工具请求也没有最终文本时，报告模型未给出可用答案。遇到 API 失败、拒绝或 `status: "incomplete"` 时，报告相应情况。到达 `maxRounds` 仍没有最终答案时，抛出明确的轮数上限错误。

在 `src/cli.mjs` 从 `process.argv.slice(2).join(" ")` 取问题，调用 `runAgent` 并输出最终答案。空问题时提示用法。加入简短的事件输出，例如轮次、工具名称和成功状态，方便观察真实流程。

**验收。** 运行 `node src/cli.mjs '北京几度？'`，应依次看到以下输出（省略空行）：

```text
=== Round 1 ===
=== Tool: get_temperature Execution result: ok=true ===
=== Round 2 ===
北京是 6°C。
```

不传参数或只传空格时，应显示 `用法：node src/cli.mjs "你的问题"`。把 `maxRounds` 设成 `1`，确认程序以轮数上限错误结束。再把假模型的工具请求改成未知工具，确认下一轮模型能收到 `ok: false` 的结果。

**检查点。** 同轮出现多个工具调用时，每个请求都需要一条匹配的结果。对模型推理项等其他输出项，按 API 合同原样放回上下文。程序提取和展示的是工具调用与答案。 [OpenAI 工具调用指南](https://developers.openai.com/api/docs/guides/function-calling)

## 第 4 课：用两种工具验证多步决策

**任务。** 在 `src/tools.mjs` 增加 `find_cities`，接受空对象并返回 `{ ok: true, cities: ["北京", "杭州"] }`。给 `callMock` 增加一个场景，依次返回城市工具请求、两个温度工具请求、最终比较。发出两个温度工具请求前，假模型要读取 `find_cities` 的结果，并从中构造参数。

**验收。** 运行 `node src/cli.mjs '找出两个候选城市，比较谁更冷'`。第 1 轮应成功执行 `find_cities`，第 2 轮应成功执行两次 `get_temperature`，第 3 轮应输出 `北京更冷，相差 8°C`。检查第 2 轮的模型响应，确认两条温度请求使用不同的 `call_id`。反转 `find_cities` 返回的城市顺序后，温度查询也应反转，最终结论相同。第 3 课的 Agent 循环可以直接处理这一流程。

## 第 5 课：接上 OpenAI Responses API

**任务。** 先将 `.env` 写入 `.gitignore`，再创建本地 `.env`，配置 `OPENAI_API_KEY` 和 `OPENAI_MODEL`。模型 ID 使用你的账号可访问且支持工具调用的模型。在 `src/openai.mjs` 实现 `callOpenAI(input)`，使其和 `callMock(input)` 有相同的调用方式。由 CLI 用 `--real` 选择真实模型，默认走假模型。

用 `fetch` 向 `https://api.openai.com/v1/responses` 发送 POST 请求。请求头使用 `Authorization: Bearer ...` 和 `Content-Type: application/json`。请求体包含 `model`、`input`、`tools`、`store: false`、`include: ["reasoning.encrypted_content"]`，以及一条简短的 `instructions`，告诉模型何时先查候选城市、何时查温度。每轮携带当前 `input`。如果模型返回推理项，加密字段让 API 在 `store: false` 时也能接续这一轮。应用只需保留相应输出项。

`get_temperature` 的一个工具定义如下。另一个工具的 `properties` 用 `{}`，`required` 用 `[]`。

```js
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
}
```

如果 HTTP 状态不是成功，报告 HTTP 状态和可安全显示的错误摘要，确保输出里没有 API Key。为 `fetch` 设置有限的请求超时，例如 `AbortSignal.timeout(30_000)`。客户端解析 JSON 后把响应交给已有的循环。 [Responses API](https://platform.openai.com/docs/api-reference/responses/create) · [函数工具定义和结果回填](https://developers.openai.com/api/docs/guides/function-calling)

**验收。** 先用假模型重跑第 4 课，并确认单城问题「杭州几度？」返回 `杭州是 14°C。`。再运行真实模型。真实模型可能把两个温度调用分开，也可能放在同一轮。验收看是否先查候选、是否正确回填每条调用的结果，以及结论是否使用工具返回的数据。

```powershell
node src/cli.mjs '找出两个候选城市，比较谁更冷'
node --env-file=.env src/cli.mjs --real '请先查询候选城市，再用工具比较哪个城市更冷。'
```

## 接下来的学习路线

先在本地解决单次运行的恢复，再给执行过程加上明确的计划和步骤状态。接着把记忆扩展到同一用户的多个会话，最后把已经验证的执行和记忆流程接到 Cloudflare。

**先完成第五课的真实模型验收。** 运行上面的 `--real` 命令，确认模型先查候选城市，再查询北京和杭州，并根据工具结果得出北京更冷、相差 `8°C`。工具调用可以分在不同轮次，检查每条工具结果是否回填到对应的 `call_id`。

## 第 6 课：用本地文件保存并恢复一次运行

先用假模型和本地 JSON 文件练习。目标是在进程退出后，下一次启动能从最近一次完整保存的模型轮次继续执行。

1. **定义要保存的数据。** 用运行 ID 区分不同任务，保存原始问题、完整的 `input` 数组、已完成轮数、运行状态和最终答案。恢复时沿用已保存的轮数，继续遵守 `maxRounds`。
2. **在每轮工具全部完成后保存。** 把本轮模型的所有输出项和每条匹配的工具结果一起写入临时文件，写完后替换该运行的状态文件。这样可以从完整的上下文开始下一轮。拿到最终答案后，保存完成状态和答案。
3. **给 CLI 增加按运行 ID 恢复的入口。** 读取保存的上下文并继续调用模型。若该运行已经完成，直接输出保存的答案。

**验收。** 用假模型运行候选城市比较。在 `find_cities` 的结果保存后退出进程，再使用同一个运行 ID 恢复。日志应直接进入第二轮，发出两条温度请求，最终输出 `北京更冷，相差 8°C`。再恢复一次，应该直接输出已保存的答案，模型和工具调用次数都为零。若进程在一轮保存前退出，恢复时会重跑这一轮。本课的查询工具只读，适合用来验证这一行为。

## 第 7 课：在本地从 ReAct 切换到 Plan and Execute

基于第 6 课的本地恢复流程，先生成一份可检查的计划，再逐步执行。单个步骤可以复用现有的 ReAct 循环和工具分发。

1. **生成计划。** 先用假规划器为城市比较生成三步计划。每步包含 ID、目标、依赖和完成条件。执行前检查步骤 ID 唯一、依赖存在且没有循环。
2. **逐步执行。** 先找候选城市，再用候选结果查询温度，最后根据查询结果计算温差。执行器只运行依赖已完成的步骤。
3. **保存并恢复。** 扩展第 6 课的本地 JSON 断点，保存计划版本、步骤状态和结果。恢复时沿用运行 ID，复用已保存为完成的步骤结果。
4. **处理失败。** 在正常执行和恢复跑通后，再加入有上限的重试和重新规划。重新规划只调整未完成的步骤。超过上限时记录失败原因并结束运行。

**验收。** 先用假规划器跑通三步城市比较，得到 `北京更冷，相差 8°C`。在候选城市步骤保存后重启，确认直接进入温度查询。再模拟前置结果缺失，确认执行器跳过尚未满足依赖的步骤，并按规则重新规划或报告失败。最后可替换为真实规划器，复验同一组流程。

## 第 8 课：用关系型数据库和向量数据库保存长期记忆

前两课保存的是一次运行的执行状态。第 8 课保存的是**同一用户在新会话中仍可使用的事实和偏好**。例如，用户说「以后显示温度时用摄氏度」，结束会话并重启程序后，再问「气温应该用哪个单位？」，Agent 能召回这条偏好。

**任务。** 本课可以先用 SQLite 保存记忆正文和状态，用 Qdrant 保存向量索引。两边用同一个记忆 ID 关联。

1. **保存记忆正文。** 关系型数据库保存记忆 ID、用户 ID、正文、来源会话 ID、版本和更新时间。练习时先只保存用户明确要求记住的内容，并区分记忆写入与执行断点保存。
2. **建立向量索引。** 从记忆正文生成嵌入，按记忆 ID 写入向量数据库，并附上用户 ID 和版本。先在关系库保存正文及待索引状态，再更新向量索引。索引写入失败时可以重试，同一 ID 的重试更新原索引。只有当前版本索引成功后才清除待索引状态。
3. **在新会话召回。** 对新问题生成嵌入，在向量数据库按用户 ID 过滤并检索少量相关记忆。按返回的 ID 从关系库读正文，跳过已删除或版本不一致的记录，再把相关正文交给模型作为参考。更新或删除记忆时，同步更新索引，清理完成前也应以关系库记录为准。

**验收。** 记住一条偏好，退出程序后用同一用户开新会话，换一种问法仍能召回。换一个用户，查不到这条偏好。再验证更新、删除，以及向量数据库暂时不可用的情况。索引失败时正文仍可在关系库查到，恢复索引后能按语义召回，重试不会产生重复条目。优先用假模型和固定测试向量验证存储、恢复与隔离，再用真实嵌入验证换一种问法的语义召回。

## 第 9 课：接入 Cloudflare Workers 和 Durable Objects

先用 Wrangler 在本地接通 HTTP 和假模型，把第 6、7 课的运行断点和计划执行迁入 Durable Object。恢复流程验证通过后，再接入第 8 课的长期记忆和真实模型。

1. **Worker 接收请求。** 从已验证的身份取得用户 ID，检查用户是否有权访问该会话，再通过 Durable Object binding 把请求路由到对应的会话对象。先用 HTTP 提交问题、查询状态和读取结果。
2. **Durable Object 管理会话执行。** 每个会话对应一个对象，沿用运行 ID。将上下文、轮数、计划版本和步骤结果写入对象自带的 SQLite 存储，对象重新创建时从已保存状态恢复。同一运行 ID 的重复请求返回现有状态或已完成的答案。
3. **让未完成的运行继续执行。** 在需要后台续跑时，用 Alarm 唤醒会话对象，从最近一次保存的位置继续。先验证不依赖客户端保持连接也能完成，再考虑用 WebSocket 推送轮次和工具事件。
4. **接入跨会话记忆。** 复用第 8 课的用户隔离、版本校验和索引重试规则。部署时可选用 D1 保存用户级记忆正文、Vectorize 保存向量索引。会话内的运行状态继续由该会话的 Durable Object 保存。

**验收。** 通过 Worker 提交候选城市比较。在候选城市步骤保存后断开客户端并重启本地 Worker，用原运行 ID 恢复。确认执行直接进入温度查询，最终得到 `北京更冷，相差 8°C`，已完成的运行可直接读取结果。接入长期记忆后，再验证其他用户无法访问该会话，同一用户可以在新会话中召回自己的记忆。 [Durable Objects](https://developers.cloudflare.com/durable-objects/) · [D1](https://developers.cloudflare.com/d1/) · [Vectorize](https://developers.cloudflare.com/vectorize/)

## 对照 Pi Durable 示例

实现第 9 课时，可以用 `src/chat.ts` 对照自己的模型和工具配置，再看 `src/session.ts` 如何保存会话状态、通过 WebSocket 发出事件，以及用 Alarm 唤醒会话。 [官方 Cloudflare 示例](https://github.com/earendil-works/pi-durable-cloudflare)
