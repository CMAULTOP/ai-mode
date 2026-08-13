import type { LanguageModel } from "ai"
import { generateText, Output, streamText } from "ai"
import { z } from "zod"
import { AIModeError } from "../core/errors.ts"
import { aggregateUsage, emitLogger, fromStream } from "../core/helpers.ts"
import type {
	Mode,
	ModeContext,
	ModeEvent,
	ModeResult,
	TokenUsage,
} from "../core/types.ts"

export interface RoutingCatalogEntry {
	id: string
	model: LanguageModel
	description: string
	capabilities?: string[]
	cost?: number
	speed?: number
}

export interface RoutingInput {
	task: string
	catalog: RoutingCatalogEntry[]
	strategy?: "llm" | "round-robin" | "priority"
}

export interface RoutingOutput {
	choice: string
	reason: string
	answer: string
}

const choiceSchema = z.object({
	choice: z.string(),
	reason: z.string(),
})

const MAX_LLM_RETRIES = 1

let roundRobinIndex = 0

function formatCatalog(catalog: RoutingCatalogEntry[]): string {
	return catalog
		.map((entry) => {
			const parts = [`- ${entry.id}: ${entry.description}`]
			if (entry.capabilities !== undefined && entry.capabilities.length > 0) {
				parts.push(`  Возможности: ${entry.capabilities.join(", ")}`)
			}
			if (entry.cost !== undefined) parts.push(`  Стоимость: ${entry.cost}`)
			if (entry.speed !== undefined) parts.push(`  Скорость: ${entry.speed}`)
			return parts.join("\n")
		})
		.join("\n")
}

function pickRoundRobin(catalog: RoutingCatalogEntry[]): RoutingCatalogEntry {
	const entry = catalog[roundRobinIndex % catalog.length]
	if (entry === undefined)
		throw new AIModeError("Catalog is empty", "EMPTY_CATALOG")
	roundRobinIndex += 1
	return entry
}

function pickPriority(catalog: RoutingCatalogEntry[]): RoutingCatalogEntry {
	const sorted = [...catalog].sort((a, b) => {
		const costA = a.cost ?? Number.POSITIVE_INFINITY
		const costB = b.cost ?? Number.POSITIVE_INFINITY
		if (costA !== costB) return costA - costB
		const speedA = a.speed ?? -1
		const speedB = b.speed ?? -1
		return speedB - speedA
	})
	const entry = sorted[0]
	if (entry === undefined)
		throw new AIModeError("Catalog is empty", "EMPTY_CATALOG")
	return entry
}

async function pickByLlm(
	input: RoutingInput,
	ctx: ModeContext,
): Promise<{ entry: RoutingCatalogEntry; reason: string }> {
	const model = ctx.models.default
	if (model === undefined) {
		throw new AIModeError(
			"A 'default' model is required for llm routing",
			"MISSING_MODEL",
		)
	}
	const prompt = [
		`Задача: ${input.task}`,
		"Каталог моделей:",
		formatCatalog(input.catalog),
		"Выбери самую подходящую модель из каталога.",
	].join("\n")

	for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
		const result = await generateText({
			model,
			output: Output.object({ schema: choiceSchema }),
			system: "Ты маршрутизатор запросов к моделям.",
			prompt,
			abortSignal: ctx.signal,
		})
		const entry = input.catalog.find((e) => e.id === result.output.choice)
		if (entry !== undefined) {
			return { entry, reason: result.output.reason }
		}
		if (attempt === MAX_LLM_RETRIES) {
			throw new AIModeError(
				`Model ${result.output.choice} not found in catalog`,
				"UNKNOWN_MODEL_CHOICE",
			)
		}
	}
	// недостижимо: цикл гарантирует return или throw
	throw new AIModeError("Routing failed", "ROUTING_FAILED")
}

function routing(
	input: RoutingInput,
	ctx: ModeContext,
): AsyncIterable<ModeEvent> {
	return run(input, ctx)
}

async function* run(
	input: RoutingInput,
	ctx: ModeContext,
): AsyncGenerator<ModeEvent> {
	const strategy = input.strategy ?? "llm"
	if (input.catalog.length === 0) {
		throw new AIModeError("Catalog is empty", "EMPTY_CATALOG")
	}

	yield {
		type: "start",
		mode: "routing",
		input,
	}

	let entry: RoutingCatalogEntry
	let reason: string
	switch (strategy) {
		case "round-robin": {
			entry = pickRoundRobin(input.catalog)
			reason = "round-robin"
			break
		}
		case "priority": {
			entry = pickPriority(input.catalog)
			reason = "priority: lowest cost, then highest speed"
			break
		}
		case "llm": {
			const picked = await pickByLlm(input, ctx)
			entry = picked.entry
			reason = picked.reason
			break
		}
		default: {
			throw new AIModeError(
				`Unknown routing strategy: ${String(strategy)}`,
				"UNKNOWN_STRATEGY",
			)
		}
	}

	emitLogger(ctx.logger, { type: "plan", steps: { choice: entry.id, reason } })
	yield { type: "plan", steps: { choice: entry.id, reason } }

	const usages: TokenUsage[] = []
	const textParts: string[] = []

	const stream = streamText({
		model: entry.model,
		system: "Реши задачу. Верни только ответ.",
		prompt: input.task,
		abortSignal: ctx.signal,
	})

	for await (const part of stream.fullStream) {
		if (part.type === "text-delta") {
			textParts.push(part.text)
			emitLogger(ctx.logger, { type: "text-delta", delta: part.text })
			yield { type: "text-delta", delta: part.text }
		}
		if (part.type === "finish") {
			usages.push({
				inputTokens: part.totalUsage.inputTokens,
				outputTokens: part.totalUsage.outputTokens,
				totalTokens: part.totalUsage.totalTokens,
			})
		}
	}

	const answer = textParts.join("")
	const totalUsage = aggregateUsage(usages)
	const result: ModeResult<RoutingOutput> = {
		output: { choice: entry.id, reason, answer },
		usage: totalUsage,
		mode: "routing",
	}
	yield { type: "result", output: result.output, usage: totalUsage }
}

export const routingMode: Mode<RoutingInput, RoutingOutput> = fromStream(
	"routing",
	"Выбирает лучшую модель для задачи и выполняет её",
	routing,
)

// сброс счётчика для тестов
export function resetRoutingRoundRobin(): void {
	roundRobinIndex = 0
}
