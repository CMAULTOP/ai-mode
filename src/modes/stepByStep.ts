import type { LanguageModel } from "ai"
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

export type RoleModel = LanguageModel | string

export interface StepByStepInput {
	task: string
	maxSteps?: number
	stopOnFailure?: boolean
	promptPerStep?: string
	/** Изолировать контекст шагов (по умолчанию true). */
	isolated?: boolean
	/** Модели по ролям: planner, executor, synthesizer. По умолчанию — ctx.models.default. */
	models?: {
		planner?: RoleModel
		executor?: RoleModel
		synthesizer?: RoleModel
	}
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

function resolveModel(
	ctx: ModeContext,
	role: "planner" | "executor" | "synthesizer",
	modelOrId: RoleModel | undefined,
): LanguageModel {
	if (modelOrId === undefined) {
		const model = ctx.models.default
		if (model === undefined) {
			throw new StepExecutionError(
				`A 'default' model is required for step-by-step mode (role: ${role})`,
				"MISSING_MODEL",
			)
		}
		return model
	}
	if (typeof modelOrId === "string") {
		const model = ctx.models[modelOrId]
		if (model === undefined) {
			throw new StepExecutionError(
				`Model "${modelOrId}" not found in context (role: ${role})`,
				"MISSING_MODEL",
			)
		}
		return model
	}
	return modelOrId
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
	const planner = resolveModel(ctx, "planner", input.models?.planner)
	const executor = resolveModel(ctx, "executor", input.models?.executor)
	const synthesizer = resolveModel(
		ctx,
		"synthesizer",
		input.models?.synthesizer,
	)
	const maxSteps = Math.max(1, input.maxSteps ?? 5)
	const stopOnFailure = input.stopOnFailure ?? false
	const isolated = input.isolated ?? true
	const usages: TokenUsage[] = []

	yield {
		type: "start",
		mode: "step-by-step",
		input,
	}

	// Фаза 1: план (planner)
	const planResult = await generateText({
		model: planner,
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
	const results: string[] = []

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

		const promptParts = [
			input.promptPerStep ?? "Выполни следующий шаг задачи.",
			`Шаг ${i + 1}/${plan.length}: ${step.title}`,
			step.description.length > 0 ? `Описание: ${step.description}` : "",
		]
		// Каскад ролей: при изоляции executor не видит результаты предыдущих шагов.
		if (!isolated && results.length > 0) {
			promptParts.push(`Результаты предыдущих шагов:\n${results.join("\n")}`)
		}
		promptParts.push(`Исходная задача: ${input.task}`)
		const prompt = promptParts.filter(Boolean).join("\n")

		try {
			const stepResult = await generateText({
				model: executor,
				system:
					"Ты решаешь задачу по шагам. Верни только результат текущего шага.",
				prompt,
				abortSignal: ctx.signal,
			})
			usages.push(usage(stepResult))
			results.push(`- ${step.title}: ${stepResult.text}`)
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

	// Фаза 3: синтез (synthesizer) — собирает результаты всех шагов
	const synthesizeResult = await generateText({
		model: synthesizer,
		system: "Собери финальный ответ на основе результатов шагов.",
		prompt: [
			`Исходная задача: ${input.task}`,
			`Результаты шагов:\n${results.join("\n")}`,
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
		"Планирует задачу, изолированно выполняет шаги разными ролями и собирает ответ",
		stepByStep,
	)
