import { expect, test } from "bun:test"
import { createModeContext } from "../../src/core/context.ts"
import { AIModeError } from "../../src/core/errors.ts"
import { mockModel } from "../helpers/mockModel.ts"

test("createModeContext requires default model", () => {
	expect(() => createModeContext({ models: {} })).toThrow(AIModeError)
	expect(() => createModeContext({ models: {} })).toThrow(/default/)
})

test("createModeContext passes through config", () => {
	const model = mockModel()
	const ctx = createModeContext({
		models: { default: model, "gpt-4": model },
		tokenBudget: 100,
	})
	expect(ctx.models.default).toBe(model)
	expect(ctx.tokenBudget).toBe(100)
	expect(ctx.search).toBeUndefined()
})
