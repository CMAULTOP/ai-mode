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
