import { generateText, Output } from "ai"
import { z } from "zod"
import { StepExecutionError } from "../core/errors.ts"
import { aggregateUsage, emitLogger, fromStream } from "../core/helpers.ts"
import type {
	Mode,
	ModeContext,
	ModeEvent,
	ModeResult,
	TokenUsage,
} from "../core/types.ts"

export interface StepByStepInput {
	task: string
	maxSteps?: number
	stopOnFailure?: boolean
	promptPerStep?: string
}

export interface StepByStepOutput {
	plan: StepPlan[]
	steps: StepResult[]
	answer: string
}

export interface StepPlan {
	title: string
	description: string
}

export interface StepResult {
	title: string
	output: string
	status: "done" | "failed"
}

const planSchema = z.object({
	steps: z.array(
		z.object({
			title: z.string(),
			description: z.string(),
		}),
	),
})

function usage(result: { usage: TokenUsage }): TokenUsage {
	return {
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		totalTokens: result.usage.totalTokens,
	}
}

function stepByStep(
	input: StepByStepInput,
	ctx: ModeContext,
): AsyncIterable<ModeEvent> {
	return run(input, ctx)
}

async function* run(
	input: StepByStepInput,
	ctx: ModeContext,
): AsyncGenerator<ModeEvent> {
	const model = ctx.models.default
	if (model === undefined) {
		throw new StepExecutionError(
			"A 'default' model is required for step-by-step mode",
			"MISSING_MODEL",
		)
	}
	const maxSteps = Math.max(1, input.maxSteps ?? 5)
	const stopOnFailure = input.stopOnFailure ?? false
	const usages: TokenUsage[] = []

	yield {
		type: "start",
		mode: "step-by-step",
		input,
	}

	// Фаза 1: план
	const planResult = await generateText({
		model,
		output: Output.object({ schema: planSchema }),
		system: `Разбей задачу на шаги. Верни максимум ${maxSteps} шагов.`,
		prompt: input.task,
		abortSignal: ctx.signal,
	})
	usages.push(usage(planResult))
	emitLogger(ctx.logger, { type: "plan", steps: planResult.output.steps })
	yield { type: "plan", steps: planResult.output.steps }

	const plan = planResult.output.steps.slice(0, maxSteps)
	const stepResults: StepResult[] = []
	const context: string[] = []

	for (const [i, step] of plan.entries()) {
		emitLogger(ctx.logger, {
			type: "step",
			index: i,
			title: step.title,
			status: "running",
		})
		yield {
			type: "step",
			index: i,
			title: step.title,
			status: "running",
		}

		const prompt = [
			input.promptPerStep ?? "Выполни следующий шаг задачи.",
			`Шаг ${i + 1}/${plan.length}: ${step.title}`,
			step.description.length > 0 ? `Описание: ${step.description}` : "",
			context.length > 0
				? `Результаты предыдущих шагов:\n${context.join("\n")}`
				: "",
			`Исходная задача: ${input.task}`,
		]
			.filter(Boolean)
			.join("\n")

		try {
			const stepResult = await generateText({
				model,
				system:
					"Ты решаешь задачу по шагам. Верни только результат текущего шага.",
				prompt,
				abortSignal: ctx.signal,
			})
			usages.push(usage(stepResult))
			context.push(`- ${step.title}: ${stepResult.text}`)
			stepResults.push({
				title: step.title,
				output: stepResult.text,
				status: "done",
			})
			emitLogger(ctx.logger, {
				type: "step",
				index: i,
				title: step.title,
				status: "done",
				output: stepResult.text,
			})
			yield {
				type: "step",
				index: i,
				title: step.title,
				status: "done",
				output: stepResult.text,
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (stopOnFailure) {
				yield {
					type: "step",
					index: i,
					title: step.title,
					status: "failed",
					output: message,
				}
				throw new StepExecutionError(
					`Step ${i + 1} "${step.title}" failed: ${message}`,
					"STEP_EXECUTION",
					{ cause: error },
				)
			}
			stepResults.push({ title: step.title, output: "", status: "failed" })
			emitLogger(ctx.logger, {
				type: "step",
				index: i,
				title: step.title,
				status: "failed",
				output: message,
			})
			yield {
				type: "step",
				index: i,
				title: step.title,
				status: "failed",
				output: message,
			}
		}
	}

	// Фаза 3: синтез
	const synthesizeResult = await generateText({
		model,
		system: "Собери финальный ответ на основе результатов шагов.",
		prompt: [
			`Исходная задача: ${input.task}`,
			`Результаты шагов:\n${context.join("\n")}`,
		].join("\n"),
		abortSignal: ctx.signal,
	})
	usages.push(usage(synthesizeResult))

	const totalUsage = aggregateUsage(usages)
	const result: ModeResult<StepByStepOutput> = {
		output: { plan, steps: stepResults, answer: synthesizeResult.text },
		usage: totalUsage,
		mode: "step-by-step",
	}
	yield { type: "result", output: result.output, usage: totalUsage }
}

export const stepByStepMode: Mode<StepByStepInput, StepByStepOutput> =
	fromStream(
		"step-by-step",
		"Разбивает задачу на шаги, выполняет их последовательно и собирает ответ",
		stepByStep,
	)
