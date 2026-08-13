import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { AIModeError } from "../core/errors.ts"

const DEFAULT_MODEL_VAR = "AI_MODE_MODEL"
const BASE_URL_VAR = "AI_MODE_BASE_URL"
const API_KEY_VAR = "AI_MODE_API_KEY"
const MODELS_JSON_VAR = "AI_MODE_MODELS"

/**
 * Reads environment variables and returns a Record<string, LanguageModel>
 * ready for createAI({ models }).
 *
 * Supported variables:
 * - AI_MODE_BASE_URL  — URL of an OpenAI-compatible API (e.g. https://api.openai.com/v1)
 * - AI_MODE_API_KEY   — access token
 * - AI_MODE_MODEL     — default model id (key "default")
 * - AI_MODE_MODELS    — JSON object like { "default": "model-id", "cheap": "model-id" }
 *                       overrides AI_MODE_MODEL
 */
export function loadModelsFromEnv(
	env: Record<string, string | undefined> = Bun.env,
): Record<string, LanguageModel> {
	const baseURL = env[BASE_URL_VAR]
	const apiKey = env[API_KEY_VAR]
	if (baseURL === undefined || apiKey === undefined) {
		throw new AIModeError(
			`${BASE_URL_VAR} and ${API_KEY_VAR} are required to load models from env`,
			"MISSING_ENV",
		)
	}
	const provider = createOpenAICompatible({
		name: "ai-mode",
		baseURL,
		apiKey,
	})

	let modelsById: Record<string, string>
	const modelsJson = env[MODELS_JSON_VAR]
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
		models[key] = provider(modelId)
	}
	return models
}
