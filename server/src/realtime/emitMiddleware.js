// Wraps an Express Router so that successful create/update/delete responses
// broadcast a `resource:changed` event to all internal users. Mounted per
// module router in server.js, keyed by `resource` name.
//
// A router's router.use() appends middleware AFTER existing routes, so a plain
// router.use here would never run for an already-matched route (the handler
// replies first). Instead we split the router's layer stack: keep any
// top-level middleware such as `protect` at the front, insert the emit
// middleware next, then re-append the route layers — so it runs before the
// route handler responds.
import { emitResource } from './index.js'

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function withEmit(router, resource) {
  const emitMw = (req, res, next) => {
    if (!WRITE.has(req.method)) return next()
    const oJson = res.json.bind(res)
    let body
    res.json = (payload) => {
      body = payload
      return oJson(payload)
    }
    res.on('finish', () => {
      if (body && res.statusCode < 400) emitResource(resource, req.method.toLowerCase(), body)
    })
    next()
  }

  // router.use registers the middleware as a Layer and pushes it to the stack.
  // We then move it to sit right after the leading middleware (e.g. `protect`)
  // and before the route layers.
  router.use(emitMw)
  const added = router.stack.pop() // the emitMw layer we just added (last)
  // Place emitMw at the FRONT of the stack so it wraps res.json for every
  // request entering this router — including requests handled by nested
  // sub-routers. This matters for mount-based routers (hr, attendance,
  // finance/project sub-resources) which have no direct route
  // layers at this level; the previous insertion logic pushed emitMw *after*
  // those sub-router mounts, so it never executed and no event was broadcast.
  // It only emits on successful (status < 400) responses, so unauthenticated
  // or error responses never broadcast.
  router.stack.unshift(added)
  return router
}
