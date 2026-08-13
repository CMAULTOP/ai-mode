import { expect, test } from "bun:test"
import { ModeNotFoundError } from "../../src/core/errors.ts"
import { ModeRegistry } from "../../src/core/registry.ts"
import type { Mode } from "../../src/core/types.ts"
import { EMPTY_USAGE } from "../helpers/mockModel.ts"

function fakeMode(id: string): Mode {
	return {
		id,
		description: `desc of ${id}`,
		async run() {
			return { output: undefined, usage: EMPTY_USAGE, mode: id }
		},
		async *stream() {
			yield { type: "start", mode: id, input: undefined }
		},
	}
}

test("register and get", () => {
	const registry = new ModeRegistry()
	registry.register(fakeMode("a"))
	expect(registry.get("a").id).toBe("a")
	expect(registry.has("a")).toBe(true)
	expect(registry.has("b")).toBe(false)
})

test("get throws ModeNotFoundError for unknown id", () => {
	const registry = new ModeRegistry()
	expect(() => registry.get("nope")).toThrow(ModeNotFoundError)
})

test("register throws on duplicate id", () => {
	const registry = new ModeRegistry()
	registry.register(fakeMode("a"))
	expect(() => registry.register(fakeMode("a"))).toThrow(/already registered/)
})

test("list returns registered modes", () => {
	const registry = new ModeRegistry()
	registry.register(fakeMode("a"))
	registry.register(fakeMode("b"))
	expect(
		registry
			.list()
			.map((m) => m.id)
			.sort(),
	).toEqual(["a", "b"])
})
