import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/** Load the hand-written loader bundle against a tiny fake module system. */
async function loadBundle(extra = {}) {
  const source = await readFile(CLIENT_PATH, 'utf8')
  let loaded
  const sandbox = {
    console,
    URLSearchParams,
    URL,
    setImmediate,
    window: {
      innerWidth: 1200,
      innerHeight: 800,
      __ModuleLoader__: {
        load(entry) {
          loaded = entry
        },
      },
    },
    ...extra,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  assert.ok(loaded, 'bundle calls window.__ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-linked-projects')

  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: () => ({ current: null }),
  }
  const fakeRequire = (id) => {
    if (id === 'react') return fakeReact
    throw new Error(`unexpected require: ${id}`)
  }
  const bundle = loaded.factory(fakeRequire)
  return { bundle, sandbox }
}

function fakeClientContext() {
  const slots = []
  const sources = []
  const ctx = {
    effect(factory) {
      factory()
    },
    get() {
      return undefined
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(definition, component) {
        slots.push({ definition, component })
        return () => {}
      },
    },
    inputTriggers: {
      registerSource(source) {
        sources.push(source)
        return () => {}
      },
    },
  }
  return { ctx, slots, sources }
}

test('client bundle registers the chip, the config page and the @project source', async () => {
  const { bundle } = await loadBundle()
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(Array.from(bundle.inject), ['inputTriggers', 'slots', 'locale'])

  const { ctx, slots, sources } = fakeClientContext()
  bundle.apply(ctx)

  const names = slots.map((entry) => entry.definition.name)
  assert.deepEqual(names, ['conversation.input.left', 'plugins.bundle.config'])
  assert.equal(slots[0].definition.id, 'linked-projects')
  assert.equal(slots[1].definition.key, 'dsh-linked-projects')
  for (const slot of slots) assert.equal(typeof slot.component, 'function')

  assert.equal(sources.length, 1)
  const source = sources[0]
  assert.equal(source.trigger, '@')
  assert.equal(source.name, 'linked-project')
  assert.equal(typeof source.candidates, 'function')
  assert.equal(typeof source.onPick, 'function')
})

test('@project candidates filter by query and pick links without inserting text', async () => {
  const posts = []
  let handler
  const { bundle } = await loadBundle({ fetch: (...args) => handler(...args) })
  const { ctx, sources } = fakeClientContext()

  handler = async (url, init = {}) => {
    if (init.method === 'POST') {
      posts.push({ url: String(url), body: JSON.parse(init.body) })
      return { ok: true, status: 200, async text() { return JSON.stringify({ linked: [] }) } }
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          projects: [
            { id: 'p1', name: 'Web 前端', slug: 'web', path: '/repos/web-app', description: '用户前台' },
            { id: 'p2', name: '管理后台', slug: 'admin', path: '/repos/admin-app', description: '内部管理' },
          ],
          linked: [],
          current: '/repos/admin-app',
          currentProject: 'p2',
        })
      },
    }
  }

  try {
    bundle.apply(ctx)
    const source = sources[0]

    const all = await source.candidates({ sessionId: 's1' }, { query: '', signal: undefined })
    assert.deepEqual(Array.from(all, (row) => row.name), ['project:web', 'project:admin'])
    assert.equal(all[0].icon, 'folder')
    assert.match(all[0].description, /用户前台/)
    const firstValue = JSON.parse(all[0].value)
    assert.equal(firstValue.id, 'p1')
    assert.equal(firstValue.path, '/repos/web-app')
    assert.equal(firstValue.name, 'Web 前端')

    const filtered = await source.candidates({ sessionId: 's1' }, { query: 'admin', signal: undefined })
    assert.deepEqual(Array.from(filtered, (row) => row.name), ['project:admin'])

    const outcome = source.onPick({
      candidate: { value: JSON.stringify({ id: 'p1', name: 'Web 前端', path: '/repos/web-app' }) },
      session: { sessionId: 's1' },
    })
    // The mention both links the project and stays in the prompt as `dir(path)`.
    assert.equal(outcome.text, 'web-app(/repos/web-app)')
    assert.deepEqual(Array.from(Object.keys(outcome)), ['text'])
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts.length, 1)
    assert.equal(posts[0].url, '/api/linked-projects/link')
    assert.equal(posts[0].body.sessionId, 's1')
    assert.deepEqual(Array.from(posts[0].body.add), ['p1'])
  } finally {
    handler = undefined
  }
})
