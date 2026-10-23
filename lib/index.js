/**
 * dsh-linked-projects — host half.
 *
 * Owns three things:
 *   1. the project catalog (preset project name / directory / description),
 *   2. the per-session linked-project list,
 *   3. the runtime-context entry that tells the model which projects are linked.
 *
 * Plus a small loopback HTTP route the browser half (composer chip, `@project`
 * mentions, plugin detail page) talks to. No Remote/Typert codegen, no build
 * step, no third-party dependencies.
 *
 * Reads are synchronous and memory-backed because the context provider runs on
 * every model request and must never await; writes go through this module and
 * land on disk atomically.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

/** Route prefix owned by this plugin. */
export const ROUTE = '/api/linked-projects'

/** Package name used as the plugin-manager bundle key and the client module id. */
export const BUNDLE = 'dsh-linked-projects'

/** Runtime-context order: right after the working directory (100) / sandbox (110). */
const CONTEXT_ORDER = 105

const MAX_BODY_BYTES = 1 << 20

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

/** Directory holding this plugin's two JSON documents. */
export function storageDir(env = process.env) {
  const home = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'storages', 'linked-projects')
}

function readJsonSync(file, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await mkdir(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * In-memory view of both documents.
 *
 * Writes go through this store, so the context hot path never touches the disk.
 * External edits of the JSON files are picked up on the next DSH restart.
 */
export function createStore(env = process.env) {
  const dir = storageDir(env)
  const catalogFile = join(dir, 'catalog.json')
  const sessionsFile = join(dir, 'sessions.json')
  let catalog
  let sessions

  const loadCatalog = () => {
    if (catalog !== undefined) return catalog
    const raw = readJsonSync(catalogFile, { version: 1, projects: [] })
    catalog = { version: 1, projects: Array.isArray(raw.projects) ? raw.projects.map(normalizeStored) : [] }
    return catalog
  }

  const loadSessions = () => {
    if (sessions !== undefined) return sessions
    const raw = readJsonSync(sessionsFile, { version: 1, sessions: {} })
    const map = raw.sessions !== null && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions) ? raw.sessions : {}
    sessions = { version: 1, sessions: {} }
    for (const [key, value] of Object.entries(map)) {
      if (Array.isArray(value)) sessions.sessions[key] = value.filter((id) => typeof id === 'string')
    }
    return sessions
  }

  return {
    dir,
    projects() {
      return loadCatalog().projects
    },
    project(id) {
      return loadCatalog().projects.find((entry) => entry.id === id)
    },
    async replaceProjects(next) {
      catalog = { version: 1, projects: next }
      await writeJson(catalogFile, catalog)
      return next
    },
    linkedIds(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      return loadSessions().sessions[sessionId] ?? []
    },
    linkedProjects(sessionId) {
      const linked = new Set(this.linkedIds(sessionId))
      return loadCatalog().projects.filter((entry) => linked.has(entry.id))
    },
    async setLinked(sessionId, ids) {
      const doc = loadSessions()
      const known = new Set(loadCatalog().projects.map((entry) => entry.id))
      const unique = [...new Set(ids.filter((id) => known.has(id)))]
      if (unique.length === 0) delete doc.sessions[sessionId]
      else doc.sessions[sessionId] = unique
      await writeJson(sessionsFile, doc)
      return unique
    },
  }
}

// ---------------------------------------------------------------------------
// catalog normalization
// ---------------------------------------------------------------------------

function normalizeStored(entry) {
  const path = typeof entry?.path === 'string' ? entry.path : ''
  const name = typeof entry?.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : basename(path)
  return {
    id: typeof entry?.id === 'string' && entry.id !== '' ? entry.id : randomUUID(),
    name,
    slug: typeof entry?.slug === 'string' && entry.slug !== '' ? entry.slug : slugFor(name, path),
    path,
    description: typeof entry?.description === 'string' ? entry.description : '',
  }
}

/**
 * ASCII-ish identifier used by `@project:<slug>` mentions and menu rows.
 *
 * A purely ascii name wins; a name carrying CJK (or a slug shorter than two
 * characters) would produce a meaningless stub, so it falls back to the
 * directory name instead.
 */
export function slugFor(name, path) {
  const raw = String(name ?? '')
  const fromName = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const hasCjk = /[\u3400-\u9fff]/.test(raw)
  if (!hasCjk && fromName.length >= 2) return fromName
  const base = String(path ?? '')
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop()
  const fromPath = String(base ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (fromPath !== '') return fromPath
  return fromName === '' ? 'project' : fromName
}

function uniqueSlug(base, taken, selfId) {
  const fallback = base === '' ? 'project' : base
  if (!taken.has(fallback)) return fallback
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${fallback}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${fallback}-${(selfId ?? randomUUID()).slice(0, 4)}`
}

/**
 * Validate and normalize one catalog edit.
 *
 * @param input - raw client payload.
 * @param taken - slugs already used by other projects.
 * @param selfId - id of the project being edited, when updating.
 * @returns a normalized project.
 * @throws Error with a human-readable message on invalid input.
 */
export function normalizeProjectInput(input, taken = new Set(), selfId) {
  if (input === null || typeof input !== 'object') throw new Error('项目格式不正确')
  const rawPath = typeof input.path === 'string' ? input.path.trim() : ''
  if (rawPath === '') throw new Error('项目目录不能为空')
  if (!isAbsolute(rawPath)) throw new Error('项目目录必须是绝对路径')
  const path = resolve(rawPath)
  const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim() : basename(path)
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  const wanted =
    typeof input.slug === 'string' && input.slug.trim() !== '' ? slugFor(input.slug.trim(), path) : slugFor(name, path)
  return {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : randomUUID(),
    name,
    slug: uniqueSlug(wanted, taken, selfId ?? input.id),
    path,
    description,
  }
}

/** Check that a catalog path still points at a directory; returns its real path. */
export async function assertDirectory(path) {
  let info
  try {
    info = await stat(path)
  } catch {
    throw new Error(`目录不存在：${path}`)
  }
  if (!info.isDirectory()) throw new Error(`不是目录：${path}`)
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

// ---------------------------------------------------------------------------
// context rendering
// ---------------------------------------------------------------------------

/**
 * Render the model-facing context for a linked-project list.
 *
 * Deliberately a plain list: project name, slug, one-line description, path.
 * No instructions, no "you must", no coupling prose — the selection itself is
 * the user's way of saying what this conversation is about.
 *
 * @param projects - linked projects, in catalog order.
 * @returns the context text, or an empty string when nothing is linked.
 */
export function renderLinkedProjectsText(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return ''
  const lines = [`本会话已关联 ${projects.length} 个项目：`, '']
  for (const project of projects) {
    const tail = project.description === undefined || project.description === '' ? '' : ` — ${project.description}`
    lines.push(`- ${project.name}（${project.slug}）${tail}`)
    lines.push(`  ${project.path}`)
  }
  return lines.join('\n')
}

/** Compare two directories without requiring them to exist any more. */
export function sameDirectory(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left === '' || right === '') return false
  const strip = (value) => resolve(value).replace(/[/\\]+$/, '')
  return strip(left) === strip(right)
}

/**
 * Whether the whole context block should be suppressed.
 *
 * Suppressed when nothing is linked, and when the only linked project IS the
 * directory the session is working in — that is the default single-workspace
 * situation DSH already describes with `Current working directory`.
 */
export function shouldSuppressContext(projects, currentDirectory) {
  if (!Array.isArray(projects) || projects.length === 0) return true
  if (projects.length !== 1) return false
  return sameDirectory(projects[0].path, currentDirectory)
}

// ---------------------------------------------------------------------------
// http helpers
// ---------------------------------------------------------------------------

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Guard the data route the way the bundled plugins do: a concrete socket
 * address decides, and header spellings are only consulted when the socket
 * address is unavailable (e.g. a recycled request object in tests).
 */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress
  if (typeof addr === 'string' && addr !== '') return LOOPBACK_ADDRESSES.has(addr)
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  if (origin === '') {
    const host = typeof req.headers.host === 'string' ? req.headers.host : ''
    return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)
  }
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() === '' ? {} : JSON.parse(text)
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

/**
 * Cordis plugin entry (host half).
 *
 * @param ctx - host context.
 */
export function apply(ctx) {
  const store = createStore()

  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'linked-projects',
      order: CONTEXT_ORDER,
      required: true,
      text: (context) => {
        const session = context.agent?.session
        if (session === undefined) return ''
        const projects = store.linkedProjects(session.id)
        const current = currentDirectoryOf(ctx, session)
        if (shouldSuppressContext(projects, current)) return ''
        return renderLinkedProjectsText(projects)
      },
    })
  })

  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'prefix', path: ROUTE, handler: (req, res) => handleRoute(ctx, store, req, res) }),
      'linked-projects: data route',
    )
  })
}

/** Current working directory of a live session, falling back to its workspace root. */
function currentDirectoryOf(ctx, session) {
  const workingDirectory = ctx.get('workingDirectory', false)
  if (workingDirectory !== undefined) {
    try {
      const cwd = workingDirectory.get(session)
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch {
      // fall through to the immutable workspace root
    }
  }
  return typeof session.header?.cwd === 'string' ? session.header.cwd : ''
}

/** Best-effort current directory for a session addressed by id from the browser. */
function resolveCurrentDirectory(ctx, sessionId, fallbackCwd) {
  const agents = ctx.get('agents', false)
  if (agents !== undefined) {
    const agent = agents.get(sessionId)
    if (agent !== undefined && agent.session !== undefined) {
      const cwd = currentDirectoryOf(ctx, agent.session)
      if (cwd !== '') return cwd
    }
  }
  return fallbackCwd
}

function matchProject(projects, directory) {
  if (typeof directory !== 'string' || directory === '') return null
  return projects.find((project) => sameDirectory(project.path, directory)) ?? null
}

/**
 * Route handler: catalog CRUD, per-session links, working-directory switch and
 * the native directory picker.
 */
async function handleRoute(ctx, store, req, res) {
  if (!isLoopback(req)) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }
  let url
  try {
    url = new URL(req.url ?? '/', 'http://dsh.local')
  } catch {
    sendJson(res, 400, { error: 'bad url' })
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === `${ROUTE}/state`) {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const fallbackCwd = url.searchParams.get('cwd') ?? ''
      const projects = store.projects()
      const current = resolveCurrentDirectory(ctx, sessionId, fallbackCwd)
      sendJson(res, 200, {
        projects,
        linked: store.linkedIds(sessionId),
        current,
        currentProject: matchProject(projects, current)?.id ?? null,
      })
      return
    }

    if (req.method === 'POST' && url.pathname === `${ROUTE}/link`) {
      const body = await readBody(req)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      if (sessionId === '') throw new Error('缺少 sessionId')
      const existing = store.linkedIds(sessionId)
      let next = existing
      if (Array.isArray(body.set)) next = body.set.filter((id) => typeof id === 'string')
      if (Array.isArray(body.add)) next = [...next, ...body.add.filter((id) => typeof id === 'string')]
      if (Array.isArray(body.remove)) {
        const drop = new Set(body.remove)
        next = next.filter((id) => !drop.has(id))
      }
      const saved = await store.setLinked(sessionId, next)
      sendJson(res, 200, { linked: saved })
      return
    }

    if (req.method === 'POST' && url.pathname === `${ROUTE}/catalog`) {
      const body = await readBody(req)
      if (!Array.isArray(body.projects)) throw new Error('projects 必须是数组')
      const taken = new Set()
      const next = []
      for (const entry of body.projects) {
        const project = normalizeProjectInput(entry, taken)
        await assertDirectory(project.path)
        taken.add(project.slug)
        next.push(project)
      }
      const saved = await store.replaceProjects(next)
      sendJson(res, 200, { projects: saved })
      return
    }

    if (req.method === 'POST' && url.pathname === `${ROUTE}/cwd`) {
      const body = await readBody(req)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      const direct = typeof body.path === 'string' && body.path !== '' ? body.path : undefined
      const project = typeof body.projectId === 'string' ? store.project(body.projectId) : undefined
      const directory = direct ?? project?.path
      if (sessionId === '' || directory === undefined) throw new Error('缺少 sessionId 或目标目录')
      const agents = ctx.get('agents', false)
      const workingDirectory = ctx.get('workingDirectory', false)
      if (agents === undefined || workingDirectory === undefined) throw new Error('工作目录服务不可用')
      const agent = agents.get(sessionId)
      if (agent === undefined) throw new Error('会话未在运行，无法切换工作目录')
      const cwd = await workingDirectory.set(agent, directory, new AbortController().signal)
      sendJson(res, 200, { cwd })
      return
    }

    if (req.method === 'POST' && url.pathname === `${ROUTE}/pick`) {
      const picker = ctx.get('directoryPicker', false)
      if (picker === undefined) {
        sendJson(res, 200, { available: false, path: null })
        return
      }
      const capability = picker.capability()
      if (capability?.kind !== 'native') {
        sendJson(res, 200, { available: false, path: null, kind: capability?.kind ?? 'none' })
        return
      }
      const controller = new AbortController()
      res.on('close', () => controller.abort())
      const picked = await capability.pick(controller.signal)
      sendJson(res, 200, { available: true, path: picked ?? null })
      return
    }

    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}
