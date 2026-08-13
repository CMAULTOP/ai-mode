import type { LanguageModel, LanguageModelUsage } from "ai"
import { MockLanguageModelV4 } from "ai/test"

export const EMPTY_USAGE: LanguageModelUsage = {
	inputTokens: undefined,
	inputTokenDetails: {
		noCacheTokens: undefined,
		cacheReadTokens: undefined,
		cacheWriteTokens: undefined,
	},
	outputTokens: undefined,
	outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
	totalTokens: undefined,
}

export interface SpyCall {
	system: string
	user: string
}

export function promptText(
	prompt: { role: string; content: unknown }[],
): string {
	return prompt
		.map((m) => {
			if (typeof m.content === "string") return m.content
			if (Array.isArray(m.content)) {
				return m.content.map((c) => ("text" in c ? c.text : "")).join("")
			}
			return ""
		})
		.join("\n")
}

export interface SpyModelHandle {
	model: LanguageModel
	calls: SpyCall[]
}

export function mockGenerateResult(
	text: string,
	opts: { inputTokens?: number; outputTokens?: number } = {},
) {
	return {
		content: [{ type: "text" as const, text }],
		finishReason: { unified: "stop" as const, raw: "stop" },
		usage: {
			inputTokens: {
				total: opts.inputTokens ?? 5,
				noCache: opts.inputTokens ?? 5,
				cacheRead: 0,
				cacheWrite: 0,
			},
			outputTokens: {
				total: opts.outputTokens ?? 10,
				text: opts.outputTokens ?? 10,
				reasoning: 0,
			},
		},
		warnings: [],
	}
}

interface MockModelOptions {
	text?: string
	results?: ReturnType<typeof mockGenerateResult>[]
}

export function mockModel(options: MockModelOptions = {}): LanguageModel {
	const results = options.results ?? [
		options.text !== undefined
			? mockGenerateResult(options.text)
			: mockGenerateResult(""),
	]
	return new MockLanguageModelV4({ doGenerate: results })
}

/**
 * Creates a model that records every doGenerate call (system + user text)
 * and returns mock results in order.
 */
export function spyModel(
	results: ReturnType<typeof mockGenerateResult>[],
): SpyModelHandle {
	const calls: SpyCall[] = []
	const model = new MockLanguageModelV4({
		doGenerate: async (opts) => {
			const prompt = opts.prompt as { role: string; content: unknown }[]
			const system = prompt.find((m) => m.role === "system")
			calls.push({
				system: typeof system?.content === "string" ? system.content : "",
				user: promptText(prompt.filter((m) => m.role === "user")),
			})
			return results.shift() ?? mockGenerateResult("")
		},
	})
	return { model, calls }
}
