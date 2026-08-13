import { expect, test } from "bun:test"
import { AbortModeError } from "../../src/core/errors.ts"
import {
	aggregateUsage,
	emitLogger,
	isAbortError,
} from "../../src/core/helpers.ts"

test("aggregateUsage sums defined fields", () => {
	expect(
		aggregateUsage([
			{ inputTokens: 10, outputTokens: 20, totalTokens: 30 },
			{ inputTokens: 5, outputTokens: 2, totalTokens: 7 },
		]),
	).toEqual({ inputTokens: 15, outputTokens: 22, totalTokens: 37 })
})

test("aggregateUsage ignores undefined fields", () => {
	expect(
		aggregateUsage([
			{ inputTokens: undefined, outputTokens: 20, totalTokens: 30 },
			{ inputTokens: 5, outputTokens: undefined, totalTokens: undefined },
		]),
	).toEqual({ inputTokens: 5, outputTokens: 20, totalTokens: 30 })
})

test("aggregateUsage returns undefined when no fields defined", () => {
	expect(
		aggregateUsage([
			{
				inputTokens: undefined,
				outputTokens: undefined,
				totalTokens: undefined,
			},
		]),
	).toEqual({
		inputTokens: undefined,
		outputTokens: undefined,
		totalTokens: undefined,
	})
})

test("emitLogger forwards events and never throws", () => {
	const seen: string[] = []
	const logger = (evt: { type: string }) => seen.push(evt.type)
	emitLogger(logger, { type: "start", mode: "m", input: null })
	emitLogger(undefined, { type: "start", mode: "m", input: null })
	expect(seen).toEqual(["start"])
})

test("emitLogger swallows throwing logger", () => {
	const logger = () => {
		throw new Error("boom")
	}
	expect(() =>
		emitLogger(logger, { type: "start", mode: "m", input: null }),
	).not.toThrow()
})

test("isAbortError detects AbortModeError", () => {
	expect(isAbortError(new AbortModeError())).toBe(true)
})

test("isAbortError detects DOMException AbortError", () => {
	expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true)
})

test("isAbortError rejects regular errors", () => {
	expect(isAbortError(new Error("boom"))).toBe(false)
})
