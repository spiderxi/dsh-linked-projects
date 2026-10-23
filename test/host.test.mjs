import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createStore,
  normalizeProjectInput,
  renderLinkedProjectsText,
  sameDirectory,
  shouldSuppressContext,
  slugFor,
  storageDir,
} from '../lib/index.js'

const project = (overrides = {}) => ({
  id: 'p1',
  name: 'Web 前端',
  slug: 'web',
  path: '/repos/web-app',
  description: '面向用户的前台页面',
  ...overrides,
})

test('slugFor keeps ascii names and falls back to the directory name', () => {
  assert.equal(slugFor('Web Frontend', '/x/y'), 'web-frontend')
  assert.equal(slugFor('Web 前端', '/repos/web-app'), 'web-app')
  assert.equal(slugFor('', '/repos/admin-app'), 'admin-app')
})

test('normalizeProjectInput derives name and slug, rejects relative paths', () => {
  const normalized = normalizeProjectInput({ path: '/repos/web-app/' })
  assert.equal(normalized.path, '/repos/web-app')
  assert.equal(normalized.name, 'web-app')
  assert.equal(normalized.slug, 'web-app')
  assert.ok(normalized.id.length > 0)

  assert.throws(() => normalizeProjectInput({ path: 'repos/web-app' }), /绝对路径/)
  assert.throws(() => normalizeProjectInput({ path: '   ' }), /不能为空/)
  assert.throws(() => normalizeProjectInput(null), /格式不正确/)
})

test('normalizeProjectInput deduplicates slugs and keeps explicit ones', () => {
  const taken = new Set(['admin'])
  const second = normalizeProjectInput({ path: '/repos/admin', slug: 'admin' }, new Set(taken))
  assert.equal(second.slug, 'admin-2')
  taken.add('admin-2')

  const third = normalizeProjectInput({ path: '/repos/admin', slug: 'admin' }, new Set(taken))
  assert.equal(third.slug, 'admin-3')
})

test('renderLinkedProjectsText renders a plain list', () => {
  const text = renderLinkedProjectsText([
    project(),
    project({ id: 'p2', name: '管理后台', slug: 'admin', description: '内部运营管理界面', path: '/repos/admin-app' }),
  ])
  assert.match(text, /^本会话已关联 2 个项目：/)
  assert.match(text, /- Web 前端（web） — 面向用户的前台页面/)
  assert.match(text, /\/repos\/web-app$/m)
  assert.match(text, /- 管理后台（admin） — 内部运营管理界面/)

  assert.equal(renderLinkedProjectsText([]), '')
  assert.equal(renderLinkedProjectsText(undefined), '')
})

test('renderLinkedProjectsText omits the dash when there is no description', () => {
  const text = renderLinkedProjectsText([project({ description: '' })])
  assert.match(text, /- Web 前端（web）$/m)
})

test('sameDirectory ignores trailing separators', () => {
  assert.equal(sameDirectory('/a/b', '/a/b/'), true)
  assert.equal(sameDirectory('/a/b', '/a/c'), false)
  assert.equal(sameDirectory('', '/a/b'), false)
})

test('context is suppressed for zero projects and for the single current project', () => {
  assert.equal(shouldSuppressContext([], '/repos/web-app'), true)
  assert.equal(shouldSuppressContext([project()], '/repos/web-app'), true)
  assert.equal(shouldSuppressContext([project()], '/repos/web-app/'), true)
  assert.equal(shouldSuppressContext([project()], '/repos/elsewhere'), false)
  assert.equal(shouldSuppressContext([project(), project({ id: 'p2', path: '/repos/web-app-manage' })], '/repos/web-app'), false)
})

test('store persists catalog and per-session links', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-linked-projects-'))
  try {
    const env = { DSH_HOME: home }
    assert.equal(storageDir(env), join(home, 'storages', 'linked-projects'))

    const store = createStore(env)
    assert.deepEqual(store.projects(), [])

    const saved = await store.replaceProjects([project(), project({ id: 'p2', path: '/repos/admin-app', slug: 'admin' })])
    assert.equal(saved.length, 2)

    await store.setLinked('session-1', ['p2', 'missing'])
    assert.deepEqual(store.linkedIds('session-1'), ['p2'])
    assert.deepEqual(
      store.linkedProjects('session-1').map((entry) => entry.slug),
      ['admin'],
    )

    await store.setLinked('session-1', [])
    assert.deepEqual(store.linkedIds('session-1'), [])

    const reopened = createStore(env)
    assert.equal(reopened.projects().length, 2)
    assert.equal(reopened.projects()[0].name, 'Web 前端')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
