import { expect, test } from "bun:test"
import { createAI } from "../src/index.ts"
import { mockModel } from "./helpers/mockModel.ts"

test("createAI builds an AI instance", () => {
	const ai = createAI({ models: { default: mockModel() } })
	const ids = ai.list().map((m) => m.id)
	expect(ids).toContain("step-by-step")
})
