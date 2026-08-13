import { expect, test } from "bun:test"
import { fromRun } from "../src/core/helpers.ts"
import type { Mode } from "../src/core/types.ts"
import { createAI } from "../src/index.ts"
import { EMPTY_USAGE, mockModel } from "./helpers/mockModel.ts"

const echoMode: Mode = fromRun<string, string>("echo", "Echoes input back", {
	async run(input) {
		return { output: `echo:${input}`, usage: EMPTY_USAGE, mode: "echo" }
	},
})

test("createAI requires default model", () => {
	expect(() => createAI({ models: {} })).toThrow(/default/)
})

test("run dispatches to registered custom mode", async () => {
	const ai = createAI({
		models: { default: mockModel() },
		modes: [echoMode],
	})
	const result = await ai.run("echo", "world")
	expect(result.output).toBe("echo:world")
	expect(result.mode).toBe("echo")
})

test("run on unknown mode throws ModeNotFoundError", async () => {
	const ai = createAI({ models: { default: mockModel() } })
	await expect(ai.run("nope", {})).rejects.toThrow(/not found/)
})

test("list returns registered mode descriptors", async () => {
	const ai = createAI({
		models: { default: mockModel() },
		modes: [echoMode],
	})
	const list = ai.list()
	expect(list).toContainEqual({ id: "echo", description: "Echoes input back" })
})

test("mode() handle runs with overridable context", async () => {
	const ai = createAI({
		models: { default: mockModel() },
		modes: [echoMode],
	})
	const handle = ai.mode<string, string>("echo")
	const result = await handle.run("x")
	expect(result.output).toBe("echo:x")
})

test("mode() handle streams", async () => {
	const ai = createAI({
		models: { default: mockModel() },
		modes: [echoMode],
	})
	const events: string[] = []
	for await (const evt of ai.mode("echo").stream("x")) events.push(evt.type)
	expect(events).toEqual(["start", "result"])
})

test("registerAllModes filters non-Mode exports without crashing", async () => {
	const { registerAllModes } = await import("../src/modes/index.ts")
	const { ModeRegistry } = await import("../src/core/registry.ts")
	const registry = new ModeRegistry()
	// index.ts ��� ������������ ������� registerAllModes � isMode ������ � �������������,
	// �� ����� ����������� � �� ����� ������.
	expect(() => registerAllModes(registry)).not.toThrow()
})
