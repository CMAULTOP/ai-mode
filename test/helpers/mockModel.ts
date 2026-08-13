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

interface MockModelOptions {
	text?: string
}

export function mockModel(options: MockModelOptions = {}): LanguageModel {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: "text", text: options.text ?? "" }],
			finishReason: { unified: "stop", raw: "stop" },
			usage: {
				inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: 10, text: 10, reasoning: 0 },
			},
			warnings: [],
		},
	})
}
