import type { LanguageModel } from "ai"
import { AIModeError } from "./errors"
import type { ModeContext, ModeEvent, SearchProvider } from "./types"

export interface CreateModeContextConfig {
	models: Record<string, LanguageModel>
	search?: SearchProvider
	logger?: (evt: ModeEvent) => void
	signal?: AbortSignal
	tokenBudget?: number
}

export function createModeContext(
	config: CreateModeContextConfig,
): ModeContext {
	if (config.models.default === undefined) {
		throw new AIModeError(
			"A 'default' model is required in models",
			"MISSING_DEFAULT_MODEL",
		)
	}
	return {
		models: config.models,
		search: config.search,
		logger: config.logger,
		signal: config.signal,
		tokenBudget: config.tokenBudget,
	}
}
