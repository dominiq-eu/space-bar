import { render } from "preact"
import { App } from "./components/App.tsx"
import "./input.css"
import { runtimePromise, ServiceContext } from "./components/ServiceContext.tsx"

runtimePromise.then(([syncService, dragDropService]) => {
  render(
    <ServiceContext.Provider value={{ syncService, dragDropService }}>
      <App />
    </ServiceContext.Provider>,
    document.getElementById("app")!,
  )
})
