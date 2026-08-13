import { expect, test } from "bun:test"
import { createAI } from "../src/index.ts"

test("createAI returns void stub", () => {
	expect(createAI({ models: { default: {} } })).toBeUndefined()
})
