import { expect, test } from "bun:test"
import { AIModeError } from "../../src/core/errors.ts"
import { fromRun, fromStream } from "../../src/core/helpers.ts"
import type { ModeContext, ModeEvent } from "../../src/core/types.ts"
import { EMPTY_USAGE } from "../helpers/mockModel.ts"

const ctx: ModeContext = { models: {} }

async function collect(stream: AsyncIterable<ModeEvent>): Promise<ModeEvent[]> {
	const events: ModeEvent[] = []
	for await (const evt of stream) events.push(evt)
	return events
}

test("fromRun run() returns result and ignores emitted events", async () => {
	const mode = fromRun<string, string>("m", "desc", {
		async run(input, _ctx, emit) {
			emit({ type: "plan", steps: [] })
			return {
				output: `done:${input}`,
				usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
				mode: "m",
			}
		},
	})
	const result = await mode.run("hi", ctx)
	expect(result).toEqual({
		output: "done:hi",
		usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
		mode: "m",
	})
})

test("fromRun stream() emits start, proxied events, and result", async () => {
	const mode = fromRun<string, string>("m", "desc", {
		async run(input, _ctx, emit) {
			emit({ type: "plan", steps: ["a"] })
			emit({ type: "step", index: 0, title: "a", status: "done" })
			return {
				output: `done:${input}`,
				usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
				mode: "m",
			}
		},
	})
	const events = await collect(mode.stream("hi", ctx))
	expect(events.map((e) => e.type)).toEqual(["start", "plan", "step", "result"])
	expect(events[0]).toMatchObject({ type: "start", mode: "m", input: "hi" })
	const result = events.at(-1)
	expect(result).toMatchObject({ type: "result", output: "done:hi" })
})

test("fromRun stream() emits error event when run throws", async () => {
	const mode = fromRun<string, string>("m", "desc", {
		async run() {
			throw new AIModeError("boom", "X")
		},
	})
	const events = await collect(mode.stream("hi", ctx))
	expect(events.map((e) => e.type)).toEqual(["start", "error"])
	const error = events.at(-1)
	expect(error?.type).toBe("error")
	if (error?.type === "error") {
		expect(error.error).toBeInstanceOf(AIModeError)
		expect(error.error.message).toBe("boom")
	}
})

test("fromRun run() throws underlying error", async () => {
	const mode = fromRun<string, string>("m", "desc", {
		async run() {
			throw new AIModeError("boom", "X")
		},
	})
	await expect(mode.run("hi", ctx)).rejects.toThrow("boom")
})

test("fromStream run() collects result event", async () => {
	const mode = fromStream<string, string>("m", "desc", async function* () {
		yield { type: "start", mode: "m", input: "hi" }
		yield { type: "plan", steps: [] }
		yield {
			type: "result",
			output: "answer",
			usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
		}
	})
	const result = await mode.run("hi", ctx)
	expect(result).toEqual({
		output: "answer",
		usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
		mode: "m",
	})
})

test("fromStream stream() returns the underlying stream as-is", async () => {
	const mode = fromStream<string, string>("m", "desc", async function* () {
		yield { type: "start", mode: "m", input: "hi" }
		yield { type: "result", output: "answer" }
	})
	const events = await collect(mode.stream("hi", ctx))
	expect(events.map((e) => e.type)).toEqual(["start", "result"])
})

test("fromStream run() throws on error event", async () => {
	const mode = fromStream<string, string>("m", "desc", async function* () {
		yield { type: "error", error: new AIModeError("boom", "X") }
	})
	await expect(mode.run("hi", ctx)).rejects.toThrow("boom")
})

test("fromStream run() throws when stream ends without result", async () => {
	const mode = fromStream<string, string>("m", "desc", async function* () {
		yield { type: "start", mode: "m", input: "hi" }
	})
	const err = await mode.run("hi", ctx).then(
		() => null,
		(e: AIModeError) => e,
	)
	expect(err?.code).toBe("NO_RESULT")
})

test("fromRun honors abort signal in run()", async () => {
	const signal = AbortSignal.abort()
	const mode = fromRun<string, string>("m", "desc", {
		async run(input) {
			return { output: input, usage: EMPTY_USAGE, mode: "m" }
		},
	})
	const err = await mode.run("hi", { models: {}, signal }).then(
		() => null,
		(e: AIModeError) => e,
	)
	expect(err?.code).toBe("MODE_ABORTED")
})

test("fromRun stream() emits error on pre-aborted signal", async () => {
	const signal = AbortSignal.abort()
	const mode = fromRun<string, string>("m", "desc", {
		async run(input) {
			return { output: input, usage: EMPTY_USAGE, mode: "m" }
		},
	})
	const events = await collect(mode.stream("hi", { models: {}, signal }))
	expect(events.map((e) => e.type)).toEqual(["error"])
})
