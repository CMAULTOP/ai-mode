import { expect, test } from "bun:test"
import { loadModelsFromEnv } from "../../src/config/env.ts"

function modelId(model: unknown): string | undefined {
	if (typeof model === "object" && model !== null && "modelId" in model) {
		return (model as { modelId: string }).modelId
	}
	return typeof model === "string" ? model : undefined
}

test("loadModelsFromEnv requires base url and api key", () => {
	expect(() => loadModelsFromEnv({})).toThrow("AI_MODE_BASE_URL")
})

test("loadModelsFromEnv requires a model when AI_MODE_MODELS is not set", () => {
	expect(() =>
		loadModelsFromEnv({
			AI_MODE_BASE_URL: "https://example.com/v1",
			AI_MODE_API_KEY: "k",
		}),
	).toThrow("AI_MODE_MODEL")
})

test("loadModelsFromEnv builds default model from env", () => {
	const models = loadModelsFromEnv({
		AI_MODE_BASE_URL: "https://example.com/v1",
		AI_MODE_API_KEY: "k",
		AI_MODE_MODEL: "gpt-4o",
	})
	expect(models.default).toBeDefined()
	expect(modelId(models.default)).toBe("gpt-4o")
})

test("loadModelsFromEnv builds multiple models from JSON", () => {
	const models = loadModelsFromEnv({
		AI_MODE_BASE_URL: "https://example.com/v1",
		AI_MODE_API_KEY: "k",
		AI_MODE_MODELS: JSON.stringify({
			default: "gpt-4o",
			cheap: "gpt-4o-mini",
		}),
	})
	expect(modelId(models.default)).toBe("gpt-4o")
	expect(modelId(models.cheap)).toBe("gpt-4o-mini")
})

test("loadModelsFromEnv throws on invalid JSON", () => {
	expect(() =>
		loadModelsFromEnv({
			AI_MODE_BASE_URL: "https://example.com/v1",
			AI_MODE_API_KEY: "k",
			AI_MODE_MODELS: "{oops",
		}),
	).toThrow("must be valid JSON")
})
