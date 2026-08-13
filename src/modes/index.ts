import type { ModeRegistry } from "../core/registry.ts"
import type { Mode } from "../core/types.ts"

const MODES: Mode[] = []

export function registerAllModes(registry: ModeRegistry): void {
	for (const mode of MODES) registry.register(mode)
}
