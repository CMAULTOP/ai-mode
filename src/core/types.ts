import type { LanguageModel, LanguageModelUsage } from "ai"

export type ModeID = string

export type TokenUsage = Pick<
	LanguageModelUsage,
	"inputTokens" | "outputTokens" | "totalTokens"
>

export interface ModeResult<Output> {
	output: Output
	usage: TokenUsage
	mode: ModeID
}

export type ModeEvent =
	| { type: "start"; mode: ModeID; input: unknown }
	| { type: "plan"; steps: unknown }
	| {
			type: "step"
			index: number
			title: string
			status: "running" | "done" | "failed"
			output?: unknown
	  }
	| { type: "tool"; tool: string; input: unknown; output?: unknown }
	| { type: "text-delta"; delta: string }
	| { type: "result"; output: unknown; usage?: TokenUsage }
	| { type: "error"; error: Error }

export interface ModeContext {
	models: Record<string, LanguageModel>
	search?: SearchProvider
	logger?: (evt: ModeEvent) => void
	signal?: AbortSignal
	tokenBudget?: number
}

export interface SearchResult {
	title: string
	url: string
	snippet?: string
}

export interface SearchProvider {
	search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]>
}

export interface Mode<Input = unknown, Output = unknown> {
	id: ModeID
	description: string
	run(input: Input, ctx: ModeContext): Promise<ModeResult<Output>>
	stream(input: Input, ctx: ModeContext): AsyncIterable<ModeEvent>
}

export interface ModeImpl<Input, Output> {
	run(
		input: Input,
		ctx: ModeContext,
		emit: (evt: ModeEvent) => void,
	): Promise<ModeResult<Output>>
}
