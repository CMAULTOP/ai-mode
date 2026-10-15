import { expect, test } from "bun:test"
import type { LanguageModel } from "ai"
import { loadModelsFromEnv } from "../../src/config/env.ts"

function fakeModel(modelId: string): LanguageModel {
	return { modelId } as LanguageModel
}

test("loadModelsFromEnv requires a model when AI_MODE_MODELS is not set", () => {
	expect(() => loadModelsFromEnv(fakeModel, {})).toThrow("AI_MODE_MODEL")
})

test("loadModelsFromEnv builds default model from env", () => {
	const models = loadModelsFromEnv(fakeModel, {
		AI_MODE_MODEL: "gpt-4o",
	})
	expect((models.default as { modelId: string }).modelId).toBe("gpt-4o")
})

test("loadModelsFromEnv builds multiple models from JSON", () => {
	const models = loadModelsFromEnv(fakeModel, {
		AI_MODE_MODELS: JSON.stringify({
			default: "gpt-4o",
			cheap: "gpt-4o-mini",
		}),
	})
	expect((models.default as { modelId: string }).modelId).toBe("gpt-4o")
	expect((models.cheap as { modelId: string }).modelId).toBe("gpt-4o-mini")
})

test("loadModelsFromEnv throws on invalid JSON", () => {
	expect(() =>
		loadModelsFromEnv(fakeModel, { AI_MODE_MODELS: "{oops" }),
	).toThrow("must be valid JSON")
})

test("loadModelsFromEnv passes the model id to the factory", () => {
	const seen: string[] = []
	loadModelsFromEnv(
		(id) => {
			seen.push(id)
			return fakeModel(id)
		},
		{
			AI_MODE_MODELS: JSON.stringify({ default: "a", cheap: "b" }),
		},
	)
	expect(seen).toEqual(["a", "b"])
})
