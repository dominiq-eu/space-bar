import { render } from "preact"
import { App } from "./components/app.tsx"
import {
  runtimePromise,
  ServiceContext,
} from "./components/service-context.tsx"

// Initialize all services, then render the app
runtimePromise.then((services) => {
  render(
    <ServiceContext.Provider value={services}>
      <App />
    </ServiceContext.Provider>,
    document.getElementById("app")!,
  )
})
