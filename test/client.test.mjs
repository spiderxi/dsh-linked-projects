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
  }
  return { ctx, slots }
}

test('client bundle registers the composer chip and the catalog page', async () => {
  const { bundle } = await loadBundle()
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(Array.from(bundle.inject), ['slots', 'locale'])

  const { ctx, slots } = fakeClientContext()
  bundle.apply(ctx)

  const names = slots.map((entry) => entry.definition.name)
  assert.deepEqual(names, ['conversation.input.left', 'plugins.bundle.config'])
  assert.equal(slots[0].definition.id, 'linked-projects')
  assert.equal(slots[1].definition.key, 'dsh-linked-projects')
  for (const slot of slots) assert.equal(typeof slot.component, 'function')
  assert.equal(ctx.inputTriggers, undefined, 'no @project source is registered')
})
