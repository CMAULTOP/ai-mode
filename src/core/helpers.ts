import { AbortModeError, AIModeError } from "./errors"
import type {
	Mode,
	ModeContext,
	ModeEvent,
	ModeID,
	ModeImpl,
	ModeResult,
	TokenUsage,
} from "./types"

const EMPTY_USAGE: TokenUsage = {
	inputTokens: undefined,
	outputTokens: undefined,
	totalTokens: undefined,
}

export function aggregateUsage(usages: TokenUsage[]): TokenUsage {
	const sum = (
		pick: (u: TokenUsage) => number | undefined,
	): number | undefined => {
		let total = 0
		let seen = false
		for (const usage of usages) {
			const value = pick(usage)
			if (value !== undefined) {
				total += value
				seen = true
			}
		}
		return seen ? total : undefined
	}
	return {
		inputTokens: sum((u) => u.inputTokens),
		outputTokens: sum((u) => u.outputTokens),
		totalTokens: sum((u) => u.totalTokens),
	}
}

export function emitLogger(
	logger: ((evt: ModeEvent) => void) | undefined,
	evt: ModeEvent,
): void {
	if (logger === undefined) return
	try {
		logger(evt)
	} catch {
		// logger не должен ронять выполнение режима
	}
}

export function isAbortError(error: unknown): boolean {
	return (
		error instanceof AbortModeError ||
		(error instanceof Error && error.name === "AbortError")
	)
}

function asError(error: unknown): Error {
	if (error instanceof Error) return error
	if (typeof error === "string") return new Error(error)
	return new AIModeError("Unknown mode error", "UNKNOWN_MODE_ERROR")
}

export function fromRun<Input, Output>(
	id: ModeID,
	description: string,
	impl: ModeImpl<Input, Output>,
): Mode<Input, Output> {
	return {
		id,
		description,
		async run(input, ctx) {
			if (ctx.signal?.aborted === true) throw new AbortModeError()
			const result = await impl.run(input, ctx, () => {})
			return result
		},
		async *stream(input, ctx) {
			if (ctx.signal?.aborted === true) {
				yield { type: "error", error: new AbortModeError() }
				return
			}

			const buffer: ModeEvent[] = []
			let settled = false
			let settleValue: ModeResult<Output> | undefined
			let settleError: unknown
			let wake: (() => void) | undefined

			const emit = (evt: ModeEvent) => {
				buffer.push(evt)
				wake?.()
			}

			const execution = impl.run(input, ctx, emit).then(
				(result) => {
					settleValue = result
					settled = true
					wake?.()
				},
				(error: unknown) => {
					settleError = error
					settled = true
					wake?.()
				},
			)

			yield { type: "start", mode: id, input }
			try {
				// поток emit-событий: yield сразу, как только событие появилось
				while (!settled || buffer.length > 0) {
					if (buffer.length > 0) {
						const evt = buffer.shift()
						if (evt !== undefined) yield evt
						continue
					}
					if (settled) break
					await new Promise<void>((resolve) => {
						wake = resolve
					})
					wake = undefined
				}
				await execution
				if (settleError !== undefined) {
					throw settleError
				}
				if (settleValue !== undefined) {
					yield {
						type: "result",
						output: settleValue.output,
						usage: settleValue.usage,
					}
				}
			} catch (error) {
				yield { type: "error", error: asError(error) }
			}
		},
	}
}

export function fromStream<Input, Output>(
	id: ModeID,
	description: string,
	stream: (input: Input, ctx: ModeContext) => AsyncIterable<ModeEvent>,
): Mode<Input, Output> {
	return {
		id,
		description,
		async run(input, ctx) {
			if (ctx.signal?.aborted === true) throw new AbortModeError()
			let output: unknown
			let usage: TokenUsage | undefined
			let sawResult = false
			for await (const evt of stream(input, ctx)) {
				if (evt.type === "error") throw evt.error
				if (evt.type === "result") {
					output = evt.output
					usage = evt.usage
					sawResult = true
				}
			}
			if (!sawResult) {
				throw new AIModeError(
					`Stream for mode "${id}" ended without a result event`,
					"NO_RESULT",
				)
			}
			return {
				output: output as Output,
				usage: usage ?? EMPTY_USAGE,
				mode: id,
			}
		},
		async *stream(input, ctx) {
			try {
				for await (const evt of stream(input, ctx)) {
					yield evt
				}
			} catch (error) {
				yield { type: "error", error: asError(error) }
			}
		},
	}
}

export function isMode(value: unknown): value is Mode {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		"description" in value &&
		typeof (value as Mode).run === "function" &&
		typeof (value as Mode).stream === "function"
	)
}
