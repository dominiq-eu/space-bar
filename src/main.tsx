import { Console, Effect } from "effect"
import { render } from "preact"
import { App } from "./components/App.tsx"

const program = Effect.sync(() => {
  const outputElement = document.getElementById("output")
  if (outputElement) {
    render(<App />, outputElement)
  }
  Console.log("Effect-TS program executed successfully!")
})

Effect.runSync(program)
