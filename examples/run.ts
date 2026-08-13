import { createAI, loadModelsFromEnv } from "../src/index.ts"

const ai = createAI({ models: loadModelsFromEnv() })

const id = Bun.env.AI_MODE_ID ?? "step-by-step"
const task = Bun.env.AI_MODE_TASK ?? "Explain what a TCP handshake is."

console.log(`Running mode "${id}" with task: ${task}\n`)

for await (const event of ai.stream(id, { task })) {
	switch (event.type) {
		case "start":
			console.log("[start]")
			break
		case "plan": {
			const plan = event.steps as
				| { steps?: { title: string }[] }
				| { title: string }[]
			const steps = Array.isArray(plan)
				? plan
				: (plan as { steps?: { title: string }[] }).steps
			console.log("[plan]")
			for (const step of steps ?? []) console.log(`  - ${step.title}`)
			break
		}
		case "step":
			console.log(
				`[step ${event.index}] ${event.status}${event.output !== undefined ? `: ${String(event.output)}` : ""}`,
			)
			break
		case "text-delta":
			Bun.stdout.write(event.delta)
			break
		case "result":
			console.log("\n[result]")
			console.dir(event.output, { depth: 10 })
			break
		case "error":
			console.error("[error]", event.error)
			break
	}
}
