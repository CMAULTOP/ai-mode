export class AIModeError extends Error {
	readonly code: string

	constructor(message: string, code: string) {
		super(message)
		this.name = "AIModeError"
		this.code = code
	}
}

export class ModeNotFoundError extends AIModeError {
	constructor(id: string) {
		super(`Mode "${id}" not found`, "MODE_NOT_FOUND")
		this.name = "ModeNotFoundError"
	}
}

export class StepExecutionError extends AIModeError {
	constructor(
		message: string,
		code = "STEP_EXECUTION",
		options?: ErrorOptions,
	) {
		super(message, code)
		this.name = "StepExecutionError"
		if (options?.cause !== undefined) this.cause = options.cause
	}
}

export class AbortModeError extends AIModeError {
	constructor(message = "Mode execution was aborted") {
		super(message, "MODE_ABORTED")
		this.name = "AbortModeError"
	}
}
