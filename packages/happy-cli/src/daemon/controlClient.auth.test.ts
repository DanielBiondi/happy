import { afterAll, describe, expect, it, vi } from 'vitest'
import { rmSync, unlinkSync } from 'node:fs'

const home = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs'); const { tmpdir } = require('node:os'); const { join } = require('node:path')
  const d = mkdtempSync(join(tmpdir(), 'happy-ctl-client-')); process.env.HAPPY_HOME_DIR = d; return d
})
import { startDaemonControlServer } from './controlServer'
import { listDaemonSessions, stopDaemonSession, stopDaemonHttp, checkIfDaemonRunningAndCleanupStaleState } from './controlClient'
import { writeDaemonControlToken, writeDaemonState, readDaemonState } from '@/persistence'
import { configuration } from '@/configuration'

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('controlClient sends the token', () => {
  it('new client <-> new daemon works; missing/stale token is rejected; old client is treated as "running"', async () => {
    const token = 'd'.repeat(64)
    const requestShutdown = vi.fn()
    writeDaemonControlToken(token)
    const { port, stop } = await startDaemonControlServer({
      token, getChildren: () => [{ startedBy: 'daemon', happySessionId: 'abc', pid: 1 } as any],
      stopSession: () => true, spawnSession: async () => ({ type: 'error', errorMessage: 'n/a' }), requestShutdown, onHappySessionWebhook: () => {},
    })
    writeDaemonState({ pid: process.pid, httpPort: port, startTime: 'x', startedWithCliVersion: 'v' })
    expect(await listDaemonSessions()).toHaveLength(1)
    expect(await stopDaemonSession('abc')).toBe(true)
    expect(await checkIfDaemonRunningAndCleanupStaleState()).toBe(true)
    // token file gone (== old client / wrong home): every call 401s, health check still says "running" (HTTP answered)
    unlinkSync(configuration.daemonControlTokenFile)
    expect(await listDaemonSessions()).toHaveLength(0)
    expect(await stopDaemonSession('abc')).toBe(false)
    expect(await checkIfDaemonRunningAndCleanupStaleState()).toBe(true)
    // the health check must not have cleaned up the live daemon's state, and an unauthenticated
    // /stop resolves (no throw, no hang) without shutting the daemon down; stopDaemon then falls back to SIGKILL
    expect(await readDaemonState()).not.toBeNull()
    await expect(stopDaemonHttp()).resolves.toBeUndefined()
    expect(requestShutdown).not.toHaveBeenCalled()
    await stop()
  })
})
