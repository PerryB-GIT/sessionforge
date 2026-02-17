import { router } from './trpc'
import { machineRouter } from './routers/machine'
import { sessionRouter } from './routers/session'
import { orgRouter } from './routers/org'
import { billingRouter } from './routers/billing'

export const appRouter = router({
  machine: machineRouter,
  session: sessionRouter,
  org: orgRouter,
  billing: billingRouter,
})

// Export type for use in client-side tRPC setup
export type AppRouter = typeof appRouter
