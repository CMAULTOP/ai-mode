import type { ModeRegistry } from "../core/registry.ts"
import type { Mode } from "../core/types.ts"
import { routingMode } from "./routing.ts"
import { stepByStepMode } from "./stepByStep.ts"

const MODES: Mode[] = [stepByStepMode, routingMode]

export function registerAllModes(registry: ModeRegistry): void {
	for (const mode of MODES) registry.register(mode)
}
