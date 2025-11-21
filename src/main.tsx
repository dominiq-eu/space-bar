import { render } from "preact"
import { App } from "./components/app.tsx"
import "./input.css"
import {
  runtimePromise,
  ServiceContext,
} from "./components/service-context.tsx"

runtimePromise.then(([syncService, dragDropService]) => {
  render(
    <ServiceContext.Provider value={{ syncService, dragDropService }}>
      <App />
    </ServiceContext.Provider>,
    document.getElementById("app")!,
  )
})
