import type { LanguageModel } from "ai"
import { AIModeError } from "../core/errors.ts"

const DEFAULT_MODEL_VAR = "AI_MODE_MODEL"
const MODELS_JSON_VAR = "AI_MODE_MODELS"

/**
 * Reads environment variables and returns a Record<string, LanguageModel>
 * ready for createAI({ models }).
 *
 * The provider is injected by the caller, so the library has no dependency
 * on any specific model provider. Pass a factory that maps a model id to a
 * LanguageModel (e.g. created with @ai-sdk/openai-compatible).
 *
 * Supported variables:
 * - AI_MODE_BASE_URL  — URL of an OpenAI-compatible API (e.g. https://api.openai.com/v1)
 * - AI_MODE_API_KEY   — access token
 * - AI_MODE_MODEL     — default model id (key "default")
 * - AI_MODE_MODELS    — JSON object like { "default": "model-id", "cheap": "model-id" }
 *                       overrides AI_MODE_MODEL
 */
export function loadModelsFromEnv(
	createModel: (modelId: string) => LanguageModel,
	env: Record<string, string | undefined> = Bun.env,
): Record<string, LanguageModel> {
	const modelsJson = env[MODELS_JSON_VAR]
	let modelsById: Record<string, string>
	if (modelsJson !== undefined) {
		try {
			modelsById = JSON.parse(modelsJson) as Record<string, string>
		} catch (error) {
			throw new AIModeError(
				`${MODELS_JSON_VAR} must be valid JSON: ${String(error)}`,
				"INVALID_ENV",
			)
		}
	} else {
		const model = env[DEFAULT_MODEL_VAR]
		if (model === undefined) {
			throw new AIModeError(
				`${DEFAULT_MODEL_VAR} or ${MODELS_JSON_VAR} is required`,
				"MISSING_ENV",
			)
		}
		modelsById = { default: model }
	}

	const models: Record<string, LanguageModel> = {}
	for (const [key, modelId] of Object.entries(modelsById)) {
		models[key] = createModel(modelId)
	}
	return models
}
