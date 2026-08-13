import { expect, test } from "bun:test"
import { fromRun, isMode } from "../../src/core/helpers.ts"
import type { Mode } from "../../src/core/types.ts"
import { EMPTY_USAGE } from "../helpers/mockModel.ts"

test("isMode detects Mode-shaped objects", () => {
	const mode = fromRun<string, string>("m", "desc", {
		async run() {
			return { output: "x", usage: EMPTY_USAGE, mode: "m" }
		},
	})
	expect(isMode(mode)).toBe(true)
	expect(isMode({})).toBe(false)
	expect(isMode(null)).toBe(false)
	expect(isMode(undefined)).toBe(false)
	expect(isMode("string")).toBe(false)
	const partial = { id: "x" } as unknown
	expect(isMode(partial)).toBe(false)
	const noRun = {
		id: "x",
		description: "d",
		stream: () => {},
	} as unknown as Mode
	expect(isMode(noRun)).toBe(false)
})
