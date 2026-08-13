import { ModeNotFoundError } from "./errors"
import type { Mode, ModeID } from "./types"

export class ModeRegistry {
	private readonly modes = new Map<ModeID, Mode>()

	register(mode: Mode): void {
		if (this.modes.has(mode.id)) {
			throw new Error(`Mode "${mode.id}" is already registered`)
		}
		this.modes.set(mode.id, mode)
	}

	get(id: ModeID): Mode {
		const mode = this.modes.get(id)
		if (mode === undefined) throw new ModeNotFoundError(id)
		return mode
	}

	has(id: ModeID): boolean {
		return this.modes.has(id)
	}

	list(): Mode[] {
		return [...this.modes.values()]
	}
}
