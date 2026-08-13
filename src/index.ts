import type { LanguageModel } from "ai"
import { createModeContext } from "./core/context.ts"
import { ModeRegistry } from "./core/registry.ts"
import type {
	Mode,
	ModeContext,
	ModeEvent,
	ModeID,
	ModeResult,
	SearchProvider,
} from "./core/types.ts"
import { registerAllModes } from "./modes/index.ts"

export { loadModelsFromEnv } from "./config/env.ts"
export { createModeContext } from "./core/context.ts"
export type {
	AbortModeError,
	AIModeError,
	ModeNotFoundError,
	StepExecutionError,
} from "./core/errors.ts"
export { aggregateUsage, fromRun, fromStream, isMode } from "./core/helpers.ts"
export { ModeRegistry } from "./core/registry.ts"
export type {
	Mode,
	ModeContext,
	ModeEvent,
	ModeID,
	ModeImpl,
	ModeResult,
	SearchProvider,
	SearchResult,
	TokenUsage,
} from "./core/types.ts"

export interface CreateAIConfig {
	models: Record<string, LanguageModel>
	search?: SearchProvider
	logger?: (evt: ModeEvent) => void
	signal?: AbortSignal
	tokenBudget?: number
	modes?: Mode[]
}

export interface ModeDescriptor {
	id: ModeID
	description: string
}

export interface ModeHandle<Input = unknown, Output = unknown> {
	run(input: Input, ctx?: Partial<ModeContext>): Promise<ModeResult<Output>>
	stream(input: Input, ctx?: Partial<ModeContext>): AsyncIterable<ModeEvent>
}

export interface AI {
	run<Output = unknown>(id: ModeID, input: unknown): Promise<ModeResult<Output>>
	stream(id: ModeID, input: unknown): AsyncIterable<ModeEvent>
	list(): ModeDescriptor[]
	mode<Input = unknown, Output = unknown>(id: ModeID): ModeHandle<Input, Output>
}

export function createAI(config: CreateAIConfig): AI {
	const baseCtx = createModeContext(config)
	const registry = new ModeRegistry()
	registerAllModes(registry)
	for (const mode of config.modes ?? []) registry.register(mode)

	function resolveCtx(extra?: Partial<ModeContext>): ModeContext {
		return { ...baseCtx, ...extra }
	}

	return {
		async run<Output>(id: ModeID, input: unknown): Promise<ModeResult<Output>> {
			return registry.get(id).run(input, baseCtx) as Promise<ModeResult<Output>>
		},
		stream(id: ModeID, input: unknown): AsyncIterable<ModeEvent> {
			return registry.get(id).stream(input, baseCtx)
		},
		list(): ModeDescriptor[] {
			return registry.list().map(({ id, description }) => ({ id, description }))
		},
		mode<Input, Output>(id: ModeID): ModeHandle<Input, Output> {
			return {
				run: (input, ctx) =>
					registry.get(id).run(input as Input, resolveCtx(ctx)) as Promise<
						ModeResult<Output>
					>,
				stream: (input, ctx) =>
					registry.get(id).stream(input as Input, resolveCtx(ctx)),
			}
		},
	}
}
