import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ROUTE, apply } from '../lib/index.js'

/** Minimal Cordis-ish host context: services resolve through `get`, inject runs immediately. */
function fakeContext(services) {
  const captured = { contexts: [], routes: [] }
  const ctx = {
    get(name) {
      return services[name]
    },
    inject(_deps, callback) {
      callback(ctx)
    },
    effect(factory) {
      factory()
    },
    systemPrompt: {
      context(definition) {
        captured.contexts.push(definition)
      },
    },
    webServer: {
      register(route) {
        captured.routes.push(route)
        return () => {}
      },
    },
  }
  return { ctx, captured }
}

function fakeRequest({ method = 'GET', url = '/', body, remoteAddress = '127.0.0.1' } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: { host: '127.0.0.1:62810', origin: 'http://127.0.0.1:62810' },
    socket: { remoteAddress },
    on() {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
}

function fakeResponse() {
  const res = {
    status: 0,
    payload: undefined,
    writeHead(status) {
      res.status = status
    },
    end(text) {
      res.payload = JSON.parse(text)
    },
    on() {},
  }
  return res
}

async function call(route, options) {
  const res = fakeResponse()
  await route.handler(fakeRequest(options), res)
  return res
}

/**
 * Boot the plugin against a throwaway $DSH_HOME plus two real project
 * directories, then hand the test the registered route and context provider.
 */
async function withHost(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-linked-projects-route-'))
  const webPath = join(home, 'repos', 'web-app')
  const adminPath = join(home, 'repos', 'admin-app')
  await mkdir(webPath, { recursive: true })
  await mkdir(adminPath, { recursive: true })

  const working = new Map()
  const switched = []
  const session = { id: 'session-1', header: { cwd: adminPath } }
  const services = {
    agents: {
      get(id) {
        return id === 'session-1' ? { session } : undefined
      },
    },
    workingDirectory: {
      get(forSession) {
        return working.get(forSession.id) ?? forSession.header.cwd
      },
      async set(agent, directory) {
        switched.push(directory)
        working.set(agent.session.id, directory)
        return directory
      },
    },
    directoryPicker: {
      capability() {
        return { kind: 'native', pick: async () => webPath }
      },
    },
  }

  const { ctx, captured } = fakeContext(services)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    apply(ctx)
    const route = captured.routes.find((entry) => entry.path === ROUTE)
    assert.ok(route, 'route registered')
    assert.equal(captured.contexts.length, 1, 'context provider registered')
    await fn({ route, webPath, adminPath, working, switched, session, context: captured.contexts[0] })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('catalog, link and cwd round trip through the route', async () => {
  await withHost(async ({ route, webPath, adminPath, switched }) => {
    const catalog = await call(route, {
      method: 'POST',
      url: `${ROUTE}/catalog`,
      body: {
        projects: [
          { name: 'Web 前端', slug: 'web', path: webPath, description: '用户前台' },
          { name: '管理后台', path: adminPath, description: '内部管理' },
        ],
      },
    })
    assert.equal(catalog.status, 200)
    assert.equal(catalog.payload.projects.length, 2)
    const [web, admin] = catalog.payload.projects
    assert.equal(web.slug, 'web')
    assert.equal(admin.slug, 'admin-app')

    const state = await call(route, { url: `${ROUTE}/state?sessionId=session-1` })
    assert.equal(state.status, 200)
    assert.deepEqual(state.payload.linked, [])
    assert.equal(state.payload.current, adminPath)
    assert.equal(state.payload.workspace, adminPath)
    assert.equal(state.payload.currentProject, admin.id)

    const linked = await call(route, { method: 'POST', url: `${ROUTE}/link`, body: { sessionId: 'session-1', add: [web.id] } })
    assert.deepEqual(linked.payload.linked, [web.id])

    const unlinked = await call(route, { method: 'POST', url: `${ROUTE}/link`, body: { sessionId: 'session-1', remove: [web.id] } })
    assert.deepEqual(unlinked.payload.linked, [])

    const cwd = await call(route, { method: 'POST', url: `${ROUTE}/cwd`, body: { sessionId: 'session-1', projectId: web.id } })
    assert.equal(cwd.status, 200)
    assert.equal(cwd.payload.cwd, webPath)
    assert.deepEqual(switched, [webPath])

    // `workspace` stays the immutable root, and a bare path switch goes back to it.
    const moved = await call(route, { url: `${ROUTE}/state?sessionId=session-1` })
    assert.equal(moved.payload.current, webPath)
    assert.equal(moved.payload.workspace, adminPath)

    const back = await call(route, { method: 'POST', url: `${ROUTE}/cwd`, body: { sessionId: 'session-1', path: adminPath } })
    assert.equal(back.status, 200)
    assert.equal(back.payload.cwd, adminPath)
    assert.deepEqual(switched, [webPath, adminPath])
  })
})

test('context provider is silent for zero links and for the single current project', async () => {
  await withHost(async ({ route, webPath, adminPath, context }) => {
    const agent = { session: { id: 'session-2', header: { cwd: adminPath } } }
    assert.equal(context.text({ agent }), '')

    const saved = await call(route, {
      method: 'POST',
      url: `${ROUTE}/catalog`,
      body: { projects: [{ name: '管理后台', slug: 'admin', path: adminPath, description: '内部管理' }] },
    })
    const admin = saved.payload.projects[0]
    await call(route, { method: 'POST', url: `${ROUTE}/link`, body: { sessionId: 'session-2', add: [admin.id] } })
    assert.equal(context.text({ agent }), '')

    await call(route, {
      method: 'POST',
      url: `${ROUTE}/catalog`,
      body: {
        projects: [
          { id: admin.id, name: '管理后台', slug: 'admin', path: adminPath, description: '内部管理' },
          { name: 'Web 前端', slug: 'web', path: webPath, description: '用户前台' },
        ],
      },
    })
    const second = await call(route, { url: `${ROUTE}/state?sessionId=session-2` })
    const web = second.payload.projects[1]
    await call(route, { method: 'POST', url: `${ROUTE}/link`, body: { sessionId: 'session-2', add: [web.id] } })

    const text = context.text({ agent })
    assert.match(text, /^本会话已关联 2 个项目：/)
    assert.match(text, /管理后台（admin） — 内部管理/)
    assert.match(text, /Web 前端（web） — 用户前台/)
    assert.ok(text.includes(adminPath))
    assert.ok(text.includes(webPath))
  })
})

test('route rejects non-loopback callers and invalid catalog entries', async () => {
  await withHost(async ({ route }) => {
    const forbidden = fakeResponse()
    await route.handler(fakeRequest({ url: `${ROUTE}/state`, remoteAddress: '10.0.0.7' }), forbidden)
    assert.equal(forbidden.status, 403)

    const bad = await call(route, {
      method: 'POST',
      url: `${ROUTE}/catalog`,
      body: { projects: [{ path: 'relative/dir' }] },
    })
    assert.equal(bad.status, 400)
    assert.match(bad.payload.error, /绝对路径/)

    const missing = await call(route, {
      method: 'POST',
      url: `${ROUTE}/catalog`,
      body: { projects: [{ path: '/definitely/not/here' }] },
    })
    assert.equal(missing.status, 400)
    assert.match(missing.payload.error, /目录不存在/)
  })
})

test('directory picker route returns the picked path', async () => {
  await withHost(async ({ route, webPath }) => {
    const picked = await call(route, { method: 'POST', url: `${ROUTE}/pick`, body: {} })
    assert.equal(picked.status, 200)
    assert.deepEqual(picked.payload, { available: true, path: webPath })
  })
})

test('cwd switch reports a clear error when the session is not live', async () => {
  await withHost(async ({ route, webPath }) => {
    const failed = await call(route, { method: 'POST', url: `${ROUTE}/cwd`, body: { sessionId: 'gone', path: webPath } })
    assert.equal(failed.status, 400)
    assert.match(failed.payload.error, /未在运行/)
  })
})
