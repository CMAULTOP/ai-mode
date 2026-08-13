import { expect, test } from "bun:test"
import type { LanguageModel } from "ai"
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import type { ModeContext, ModeEvent } from "../../src/core/types.ts"
import { resetRoutingRoundRobin, routingMode } from "../../src/modes/routing.ts"
import { mockGenerateResult, mockModel } from "../helpers/mockModel.ts"

const planJson = JSON.stringify({ choice: "b", reason: "fastest" })

function streamingModel(
	text: string,
	inputTokens = 5,
	outputTokens = 10,
): LanguageModel {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: [
					{ type: "text-start" as const, id: "t" },
					...text
						.split("")
						.map((ch) => ({ type: "text-delta" as const, id: "t", delta: ch })),
					{
						type: "finish" as const,
						finishReason: { unified: "stop" as const, raw: "stop" },
						usage: {
							inputTokens: {
								total: inputTokens,
								noCache: inputTokens,
								cacheRead: 0,
								cacheWrite: 0,
							},
							outputTokens: {
								total: outputTokens,
								text: outputTokens,
								reasoning: 0,
							},
						},
					},
				],
				chunkDelayInMs: 0,
			}),
		}),
	})
}

const catalog = [
	{
		id: "a",
		model: streamingModel("answer A", 5, 10),
		description: "cheap",
		cost: 1,
		speed: 1,
	},
	{
		id: "b",
		model: streamingModel("answer B", 10, 20),
		description: "fast",
		cost: 5,
		speed: 10,
	},
	{
		id: "c",
		model: streamingModel("answer C", 15, 30),
		description: "expensive",
		cost: 10,
		speed: 5,
	},
]

function ctxWithDefault(model: LanguageModel): ModeContext {
	return { models: { default: model } }
}

async function collect(stream: AsyncIterable<ModeEvent>): Promise<ModeEvent[]> {
	const events: ModeEvent[] = []
	for await (const evt of stream) events.push(evt)
	return events
}

test("routing round-robin picks next model deterministically", async () => {
	resetRoutingRoundRobin()
	const ctx = ctxWithDefault(mockModel())

	const first = await routingMode.run(
		{ task: "t", catalog, strategy: "round-robin" },
		ctx,
	)
	expect(first.output.choice).toBe("a")

	const second = await routingMode.run(
		{ task: "t", catalog, strategy: "round-robin" },
		ctx,
	)
	expect(second.output.choice).toBe("b")

	resetRoutingRoundRobin()
})

test("routing priority picks lowest cost", async () => {
	const ctx = ctxWithDefault(mockModel())
	const result = await routingMode.run(
		{ task: "t", catalog, strategy: "priority" },
		ctx,
	)
	expect(result.output.choice).toBe("a")
	expect(result.output.answer).toBe("answer A")
})

test("routing llm picks model from catalog via default model", async () => {
	const defaultModel = mockModel({ results: [mockGenerateResult(planJson)] })
	const ctx = ctxWithDefault(defaultModel)
	const result = await routingMode.run(
		{ task: "t", catalog, strategy: "llm" },
		ctx,
	)
	expect(result.output.choice).toBe("b")
	expect(result.output.reason).toBe("fastest")
	expect(result.output.answer).toBe("answer B")
})

test("routing llm retries once on unknown choice then throws", async () => {
	const badJson = JSON.stringify({ choice: "nope", reason: "oops" })
	const goodJson = JSON.stringify({ choice: "c", reason: "ok" })
	const defaultModel = mockModel({
		results: [mockGenerateResult(badJson), mockGenerateResult(goodJson)],
	})
	const ctx = ctxWithDefault(defaultModel)
	const result = await routingMode.run(
		{ task: "t", catalog, strategy: "llm" },
		ctx,
	)
	expect(result.output.choice).toBe("c")
})

test("routing llm throws when choice stays unknown after retry", async () => {
	const badJson = JSON.stringify({ choice: "nope", reason: "oops" })
	const defaultModel = mockModel({
		results: [mockGenerateResult(badJson), mockGenerateResult(badJson)],
	})
	const ctx = ctxWithDefault(defaultModel)
	await expect(
		routingMode.run({ task: "t", catalog, strategy: "llm" }, ctx),
	).rejects.toThrow("not found in catalog")
})

test("routing stream emits plan and text-delta events", async () => {
	resetRoutingRoundRobin()
	const ctx = ctxWithDefault(mockModel())
	const events = await collect(
		routingMode.stream({ task: "t", catalog, strategy: "round-robin" }, ctx),
	)
	const types = events.map((e) => e.type)
	expect(types[0]).toBe("start")
	expect(types[1]).toBe("plan")
	expect(types).toContain("text-delta")
	expect(types).toContain("result")

	const plan = events[1]
	expect(plan?.type === "plan" ? plan.steps : undefined).toEqual({
		choice: "a",
		reason: "round-robin",
	})

	const deltas = events
		.filter((e) => e.type === "text-delta")
		.map((e) => (e.type === "text-delta" ? e.delta : ""))
		.join("")
	expect(deltas).toBe("answer A")

	const result = events.at(-1)
	expect(result?.type).toBe("result")
	if (result?.type === "result") {
		const out = result.output as { choice: string; answer: string }
		expect(out.choice).toBe("a")
		expect(out.answer).toBe("answer A")
	}
})

test("routing throws on empty catalog", async () => {
	const ctx = ctxWithDefault(mockModel())
	await expect(
		routingMode.run({ task: "t", catalog: [], strategy: "round-robin" }, ctx),
	).rejects.toThrow("Catalog is empty")
})
