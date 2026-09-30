import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, statSync, existsSync, rmSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs'); const { tmpdir } = require('node:os'); const { join } = require('node:path')
  const d = mkdtempSync(join(tmpdir(), 'happy-ctl-auth-'))
  process.env.HAPPY_HOME_DIR = d
  return d
})

import { startDaemonControlServer } from './controlServer'
import { DAEMON_CONTROL_TOKEN_HEADER, daemonTokensEqual } from './controlAuth'
import { writeDaemonControlToken, readDaemonControlToken, ensureDaemonControlToken, clearDaemonState } from '@/persistence'
import { configuration } from '@/configuration'

const TOKEN = 'a'.repeat(64)
let port = 0
let stop: () => Promise<void>
const spawnSession = vi.fn(async () => ({ type: 'success' as const, sessionId: 's1' }))
const stopSession = vi.fn(() => true)
const requestShutdown = vi.fn()
const webhook = vi.fn()

const post = (path: string, headers: Record<string, string> = {}, body: any = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('daemon control server auth', () => {
  beforeAll(async () => {
    ;({ port, stop } = await startDaemonControlServer({ token: TOKEN, getChildren: () => [], stopSession, spawnSession, requestShutdown, onHappySessionWebhook: webhook }))
  })
  afterAll(async () => { await stop() })

  const routes: Array<[string, any]> = [
    ['/list', {}], ['/stop-session', { sessionId: 'x' }], ['/spawn-session', { directory: '/tmp' }],
    ['/stop', {}], ['/session-started', { sessionId: 'x', metadata: {} }],
  ]

  it.each(routes)('rejects %s without header / with wrong token, runs no handler', async (path, body) => {
    expect((await post(path, {}, body)).status).toBe(401)
    expect((await post(path, { [DAEMON_CONTROL_TOKEN_HEADER]: 'b'.repeat(64) }, body)).status).toBe(401)
    expect((await post(path, { [DAEMON_CONTROL_TOKEN_HEADER]: '' }, body)).status).toBe(401)
    expect(spawnSession).not.toHaveBeenCalled(); expect(stopSession).not.toHaveBeenCalled()
    expect(requestShutdown).not.toHaveBeenCalled(); expect(webhook).not.toHaveBeenCalled()
  })

  it('accepts the right token', async () => {
    const r = await post('/list', { [DAEMON_CONTROL_TOKEN_HEADER]: TOKEN })
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ children: [] })
    expect((await post('/spawn-session', { [DAEMON_CONTROL_TOKEN_HEADER]: TOKEN }, { directory: '/tmp' })).status).toBe(200)
    expect(spawnSession).toHaveBeenCalledTimes(1)
  })

  it('tokensEqual handles length mismatch / non-strings without throwing', () => {
    expect(daemonTokensEqual(undefined, TOKEN)).toBe(false)
    expect(daemonTokensEqual(['x'], TOKEN)).toBe(false)
    expect(daemonTokensEqual('short', TOKEN)).toBe(false)
    expect(daemonTokensEqual(TOKEN, TOKEN)).toBe(true)
  })
})

describe('token persistence', () => {
  it('writes 0600, round-trips, leaves no tmp file, and clearDaemonState removes it', async () => {
    expect(readDaemonControlToken()).toBeNull()
    writeDaemonControlToken(TOKEN)
    expect(statSync(configuration.daemonControlTokenFile).mode & 0o777).toBe(0o600)
    expect(readDaemonControlToken()).toBe(TOKEN)
    writeDaemonControlToken('c'.repeat(64)) // overwrite via rename
    expect(readDaemonControlToken()).toBe('c'.repeat(64))
    await clearDaemonState()
    expect(existsSync(configuration.daemonControlTokenFile)).toBe(false)
    expect(readDaemonControlToken()).toBeNull()
  })
})

describe('heartbeat token self-heal', () => {
  it('rewrites a deleted or replaced token file (0600) and is a no-op when it already matches', () => {
    writeDaemonControlToken(TOKEN)
    expect(ensureDaemonControlToken(TOKEN)).toBe(false)
    // client-side stale-state cleanup removed it
    unlinkSync(configuration.daemonControlTokenFile)
    expect(ensureDaemonControlToken(TOKEN)).toBe(true)
    expect(readDaemonControlToken()).toBe(TOKEN)
    expect(statSync(configuration.daemonControlTokenFile).mode & 0o777).toBe(0o600)
    // overwritten with another value, or emptied
    writeFileSync(configuration.daemonControlTokenFile, 'e'.repeat(64))
    expect(ensureDaemonControlToken(TOKEN)).toBe(true)
    expect(readDaemonControlToken()).toBe(TOKEN)
    writeFileSync(configuration.daemonControlTokenFile, '')
    expect(ensureDaemonControlToken(TOKEN)).toBe(true)
    expect(readDaemonControlToken()).toBe(TOKEN)
  })

  it('survives a leftover tmp file and leaves none behind', () => {
    writeFileSync(`${configuration.daemonControlTokenFile}.${process.pid}.tmp`, 'stale')
    writeDaemonControlToken(TOKEN)
    expect(readDaemonControlToken()).toBe(TOKEN)
    expect(readdirSync(configuration.happyHomeDir).filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})
afterAll(() => rmSync(home, { recursive: true, force: true }))
