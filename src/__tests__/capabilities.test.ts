/* eslint-disable import-x/first */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CapabilityReport } from '../types.js'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}))

import { execFileSync } from 'node:child_process'
import { checkCapabilities, formatReport } from '../capabilities.js'

const mockExecFileSync = vi.mocked(execFileSync)

describe('checkCapabilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns linux platform on linux', () => {
    // The actual platform detection reads process.platform
    // On a linux CI box this should return linux
    mockExecFileSync.mockReturnValue(Buffer.from('ok'))

    const report = checkCapabilities()

    if (process.platform === 'linux') {
      expect(report.platform).toBe('linux')
    } else {
      expect(report.platform).toBe('unsupported')
    }
  })

  it('detects unshare availability when binary succeeds', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('unshare help output'))

    const report = checkCapabilities()

    if (report.platform === 'linux') {
      expect(report.unshare.available).toBe(true)
      expect(report.unshare.name).toBe('unshare')
    }
  })

  it('detects unshare unavailability when binary fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found')
    })

    const report = checkCapabilities()

    if (report.platform === 'linux') {
      expect(report.unshare.available).toBe(false)
    }
  })

  it('detects iptables availability', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('iptables v1.8'))

    const report = checkCapabilities()

    if (report.platform === 'linux') {
      expect(report.iptables.available).toBe(true)
    }
  })

  it('marks all capabilities unavailable on unsupported platform', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true })

    const report = checkCapabilities()

    expect(report.platform).toBe('unsupported')
    expect(report.unshare.available).toBe(false)
    expect(report.iptables.available).toBe(false)
    expect(report.mountNamespace.available).toBe(false)

    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true })
  })
})

describe('formatReport', () => {
  it('formats a full report with available capabilities', () => {
    const report: CapabilityReport = {
      platform: 'linux',
      unshare: { name: 'unshare', available: true, reason: 'unshare is available' },
      iptables: { name: 'iptables', available: true, reason: 'iptables is available' },
      mountNamespace: { name: 'mountNamespace', available: true, reason: 'Mount namespaces are available' }
    }

    const output = formatReport(report)

    expect(output).toContain('Platform: linux')
    expect(output).toContain('unshare:        YES')
    expect(output).toContain('iptables:       YES')
    expect(output).toContain('mount namespace: YES')
  })

  it('formats a report with unavailable capabilities', () => {
    const report: CapabilityReport = {
      platform: 'unsupported',
      unshare: { name: 'platform', available: false, reason: 'Only Linux is supported' },
      iptables: { name: 'platform', available: false, reason: 'Only Linux is supported' },
      mountNamespace: { name: 'platform', available: false, reason: 'Only Linux is supported' }
    }

    const output = formatReport(report)

    expect(output).toContain('Platform: unsupported')
    expect(output).toContain('unshare:        NO')
    expect(output).toContain('iptables:       NO')
    expect(output).toContain('mount namespace: NO')
  })
})
