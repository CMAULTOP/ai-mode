import { expect, test } from "bun:test"
import { createAI } from "../src/index.ts"
import { mockModel } from "./helpers/mockModel.ts"

test("createAI builds an AI instance", () => {
	const ai = createAI({ models: { default: mockModel() } })
	expect(ai.list()).toEqual([])
})
