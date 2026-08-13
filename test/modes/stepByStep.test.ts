import { expect, test } from "bun:test"
import { MockLanguageModelV4 } from "ai/test"
import type { ModeContext, ModeEvent } from "../../src/core/types.ts"
import { stepByStepMode } from "../../src/modes/stepByStep.ts"
import { mockGenerateResult, mockModel } from "../helpers/mockModel.ts"

const planJson = JSON.stringify({
	steps: [
		{ title: "step 1", description: "first" },
		{ title: "step 2", description: "second" },
	],
})

function makeCtx(
	results: ReturnType<typeof mockGenerateResult>[],
): ModeContext {
	return { models: { default: mockModel({ results }) } }
}

async function collect(stream: AsyncIterable<ModeEvent>): Promise<ModeEvent[]> {
	const events: ModeEvent[] = []
	for await (const evt of stream) events.push(evt)
	return events
}

test("step-by-step runs plan then steps then synthesize", async () => {
	const ctx = makeCtx([
		mockGenerateResult(planJson),
		mockGenerateResult("result of step 1"),
		mockGenerateResult("result of step 2"),
		mockGenerateResult("final answer"),
	])
	const events = await collect(stepByStepMode.stream({ task: "solve" }, ctx))

	const types = events.map((e) => e.type)
	expect(types).toEqual([
		"start",
		"plan",
		"step",
		"step",
		"step",
		"step",
		"result",
	])

	const plan = events.find((e) => e.type === "plan")
	expect(plan).toMatchObject({
		type: "plan",
		steps: [
			{ title: "step 1", description: "first" },
			{ title: "step 2", description: "second" },
		],
	})

	const steps = events.filter((e) => e.type === "step")
	expect(steps).toMatchObject([
		{ index: 0, title: "step 1", status: "running" },
		{ index: 0, title: "step 1", status: "done", output: "result of step 1" },
		{ index: 1, title: "step 2", status: "running" },
		{ index: 1, title: "step 2", status: "done", output: "result of step 2" },
	])

	const result = events.at(-1)
	expect(result?.type).toBe("result")
	if (result?.type === "result") {
		const out = result.output as {
			plan: { title: string }[]
			steps: { status: string; output: string }[]
			answer: string
		}
		expect(out.plan).toHaveLength(2)
		expect(out.steps.map((s) => s.output)).toEqual([
			"result of step 1",
			"result of step 2",
		])
		expect(out.answer).toBe("final answer")
	}
})

test("step-by-step run() returns full result", async () => {
	const ctx = makeCtx([
		mockGenerateResult(planJson),
		mockGenerateResult("result of step 1"),
		mockGenerateResult("result of step 2"),
		mockGenerateResult("final answer"),
	])
	const result = await stepByStepMode.run({ task: "solve" }, ctx)
	expect(result.output.answer).toBe("final answer")
	expect(result.output.steps).toHaveLength(2)
	expect(result.output.plan).toHaveLength(2)
	expect(result.mode).toBe("step-by-step")
})

test("step-by-step sums usage across calls", async () => {
	const ctx = makeCtx([
		mockGenerateResult(planJson, { inputTokens: 5, outputTokens: 10 }),
		mockGenerateResult("r1", { inputTokens: 5, outputTokens: 10 }),
		mockGenerateResult("r2", { inputTokens: 5, outputTokens: 10 }),
		mockGenerateResult("final", { inputTokens: 5, outputTokens: 10 }),
	])
	const events = await collect(stepByStepMode.stream({ task: "solve" }, ctx))
	const result = events.find((e) => e.type === "result")
	expect(result?.type === "result" ? result.usage : undefined).toEqual({
		inputTokens: 20,
		outputTokens: 40,
		totalTokens: 60,
	})
})

test("step-by-step throws on step failure when stopOnFailure", async () => {
	const failOnStep = new MockLanguageModelV4({
		doGenerate: async (opts) => {
			const text = opts.prompt
				.filter((m) => m.role === "user")
				.map((m) =>
					Array.isArray(m.content)
						? m.content.map((c) => ("text" in c ? c.text : "")).join("")
						: m.content,
				)
				.join("\n")
			if (text.includes("Шаг 1/2")) {
				throw new Error("boom")
			}
			return mockGenerateResult(planJson)
		},
	})
	const ctx: ModeContext = { models: { default: failOnStep } }
	const events = await collect(
		stepByStepMode.stream({ task: "solve", stopOnFailure: true }, ctx),
	)
	const types = events.map((e) => e.type)
	expect(types).toContain("step")
	expect(types).toContain("error")
	expect(types).not.toContain("result")

	// run() должен бросить StepExecutionError
	await expect(
		stepByStepMode.run({ task: "solve", stopOnFailure: true }, ctx),
	).rejects.toThrow('Step 1 "step 1" failed')
})

test("step-by-step routes roles to separate models", async () => {
	const plannerModel = mockModel({ results: [mockGenerateResult(planJson)] })
	const executorModel = mockModel({
		results: [
			mockGenerateResult("executor result 1"),
			mockGenerateResult("executor result 2"),
		],
	})
	const synthesizerModel = mockModel({
		results: [mockGenerateResult("synthesizer answer")],
	})
	const ctx: ModeContext = { models: { default: plannerModel } }

	const result = await stepByStepMode.run(
		{
			task: "solve",
			models: { executor: executorModel, synthesizer: synthesizerModel },
		},
		ctx,
	)
	expect(result.output.steps.map((s) => s.output)).toEqual([
		"executor result 1",
		"executor result 2",
	])
	expect(result.output.answer).toBe("synthesizer answer")
})

test("step-by-step resolves role models by id from context", async () => {
	const plannerModel = mockModel({ results: [mockGenerateResult(planJson)] })
	const executorModel = mockModel({
		results: [
			mockGenerateResult("id executor 1"),
			mockGenerateResult("id executor 2"),
		],
	})
	const synthesizerModel = mockModel({
		results: [mockGenerateResult("id answer")],
	})
	const ctx: ModeContext = {
		models: {
			default: plannerModel,
			exec: executorModel,
			synth: synthesizerModel,
		},
	}
	const result = await stepByStepMode.run(
		{
			task: "solve",
			models: { executor: "exec", synthesizer: "synth" },
		},
		ctx,
	)
	expect(result.output.answer).toBe("id answer")
	expect(result.output.steps[0]?.output).toBe("id executor 1")
})

test("step-by-step throws when role model id is missing", async () => {
	const ctx: ModeContext = { models: { default: mockModel() } }
	await expect(
		stepByStepMode.run({ task: "solve", models: { synthesizer: "nope" } }, ctx),
	).rejects.toThrow('Model "nope" not found')
})

test("step-by-step isolated mode does not leak previous step results into executor prompt", async () => {
	const seenPrompts: string[] = []
	const executorModel = new MockLanguageModelV4({
		doGenerate: async (opts) => {
			const text = opts.prompt
				.filter((m) => m.role === "user")
				.map((m) =>
					Array.isArray(m.content)
						? m.content.map((c) => ("text" in c ? c.text : "")).join("")
						: m.content,
				)
				.join("\n")
			seenPrompts.push(text)
			return mockGenerateResult("step output")
		},
	})
	const ctx: ModeContext = {
		models: {
			default: mockModel({
				results: [mockGenerateResult(planJson), mockGenerateResult("answer")],
			}),
		},
	}
	const result = await stepByStepMode.run(
		{ task: "solve", models: { executor: executorModel } },
		ctx,
	)
	expect(result.output.answer).toBe("answer")
	expect(seenPrompts[0] ?? "").not.toContain("Результаты предыдущих шагов")
	expect(seenPrompts[1] ?? "").not.toContain("Результаты предыдущих шагов")
})

test("step-by-step non-isolated mode includes previous step results in executor prompt", async () => {
	const seenPrompts: string[] = []
	const executorModel = new MockLanguageModelV4({
		doGenerate: async (opts) => {
			const text = opts.prompt
				.filter((m) => m.role === "user")
				.map((m) =>
					Array.isArray(m.content)
						? m.content.map((c) => ("text" in c ? c.text : "")).join("")
						: m.content,
				)
				.join("\n")
			seenPrompts.push(text)
			return mockGenerateResult("step output")
		},
	})
	const ctx: ModeContext = {
		models: {
			default: mockModel({
				results: [mockGenerateResult(planJson), mockGenerateResult("answer")],
			}),
		},
	}
	const result = await stepByStepMode.run(
		{ task: "solve", isolated: false, models: { executor: executorModel } },
		ctx,
	)
	expect(result.output.answer).toBe("answer")
	expect(seenPrompts[1] ?? "").toContain("Результаты предыдущих шагов")
})
