/* eslint-disable import-x/first */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SandboxConfig, CapabilityReport, Capability } from '../types.js'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}))

// Mock capabilities to control what the sandbox sees
vi.mock('../capabilities.js', () => ({
  checkCapabilities: vi.fn(),
  formatReport: vi.fn()
}))

import { execFileSync } from 'node:child_process'
import { checkCapabilities } from '../capabilities.js'
import { createConfig, buildCommand, exec } from '../sandbox.js'

const mockExecFileSync = vi.mocked(execFileSync)
const mockCheckCapabilities = vi.mocked(checkCapabilities)

function makeCapability (name: string, available: boolean): Capability {
  return { name, available, reason: available ? `${name} is available` : `${name} not found` }
}

function makeFullReport (overrides: Partial<CapabilityReport> = {}): CapabilityReport {
  return {
    platform: 'linux',
    unshare: makeCapability('unshare', true),
    iptables: makeCapability('iptables', true),
    mountNamespace: makeCapability('mountNamespace', true),
    ...overrides
  }
}

function makeNoIsolationReport (): CapabilityReport {
  return {
    platform: 'linux',
    unshare: makeCapability('unshare', false),
    iptables: makeCapability('iptables', false),
    mountNamespace: makeCapability('mountNamespace', false)
  }
}

describe('createConfig', () => {
  it('creates a config with defaults', () => {
    const result = createConfig({})

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.readOnly).toBe(false)
      expect(result.value.noNetwork).toBe(false)
      expect(result.value.allowedPaths).toEqual([])
    }
  })

  it('creates a config with overrides', () => {
    const result = createConfig({
      readOnly: true,
      noNetwork: true,
      allowedPaths: ['/usr/bin', '/home/user/project']
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.readOnly).toBe(true)
      expect(result.value.noNetwork).toBe(true)
      expect(result.value.allowedPaths).toEqual(['/usr/bin', '/home/user/project'])
    }
  })

  it('rejects empty workDir', () => {
    const result = createConfig({ workDir: '' })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.kind).toBe('INVALID_CONFIG')
    }
  })
})

describe('buildCommand', () => {
  it('returns bare command when unshare is unavailable', () => {
    const config: SandboxConfig = {
      allowedPaths: [],
      readOnly: false,
      noNetwork: true,
      workDir: '/tmp'
    }

    const report = makeNoIsolationReport()
    const cmd = buildCommand(config, 'ls', ['-la'], report)

    expect(cmd).toEqual(['ls', '-la'])
  })

  it('returns bare command when no isolation flags are set', () => {
    const config: SandboxConfig = {
      allowedPaths: [],
      readOnly: false,
      noNetwork: false,
      workDir: '/tmp'
    }

    const report = makeFullReport()
    const cmd = buildCommand(config, 'echo', ['hello'], report)

    expect(cmd).toEqual(['echo', 'hello'])
  })

  it('wraps with unshare --net when noNetwork is set', () => {
    const config: SandboxConfig = {
      allowedPaths: [],
      readOnly: false,
      noNetwork: true,
      workDir: '/tmp'
    }

    const report = makeFullReport()
    const cmd = buildCommand(config, 'curl', ['https://example.com'], report)

    expect(cmd).toEqual(['unshare', '--map-root-user', '--net', '--', 'curl', 'https://example.com'])
  })

  it('wraps with unshare --mount when readOnly is set', () => {
    const config: SandboxConfig = {
      allowedPaths: [],
      readOnly: true,
      noNetwork: false,
      workDir: '/tmp'
    }

    const report = makeFullReport()
    const cmd = buildCommand(config, 'ls', ['/'], report)

    expect(cmd).toEqual(['unshare', '--map-root-user', '--mount', '--', 'ls', '/'])
  })

  it('combines --net and --mount flags', () => {
    const config: SandboxConfig = {
      allowedPaths: [],
      readOnly: true,
      noNetwork: true,
      workDir: '/tmp'
    }

    const report = makeFullReport()
    const cmd = buildCommand(config, 'bash', ['-c', 'echo hi'], report)

    expect(cmd).toEqual(['unshare', '--map-root-user', '--net', '--mount', '--', 'bash', '-c', 'echo hi'])
  })

  it('skips --mount when mountNamespace is unavailable', () => {
    const config: SandboxConfig = {
      allowedPaths: [],
      readOnly: true,
      noNetwork: true,
      workDir: '/tmp'
    }

    const report = makeFullReport({
      mountNamespace: makeCapability('mountNamespace', false)
    })
    const cmd = buildCommand(config, 'ls', [], report)

    expect(cmd).toEqual(['unshare', '--map-root-user', '--net', '--', 'ls'])
  })
})

describe('exec', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('executes a simple command successfully', () => {
    mockCheckCapabilities.mockReturnValue(makeNoIsolationReport())
    mockExecFileSync.mockReturnValue(Buffer.from('hello world\n'))

    const configResult = createConfig({})
    expect(configResult.isOk()).toBe(true)
    if (!configResult.isOk()) return

    const result = exec(configResult.value, 'echo', ['hello', 'world'])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.stdout).toBe('hello world\n')
      expect(result.value.exitCode).toBe(0)
    }
  })

  it('returns error for rejected command path', () => {
    mockCheckCapabilities.mockReturnValue(makeNoIsolationReport())

    const configResult = createConfig({
      allowedPaths: ['/usr/bin']
    })
    expect(configResult.isOk()).toBe(true)
    if (!configResult.isOk()) return

    const result = exec(configResult.value, '/opt/evil/hack', [])

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.kind).toBe('COMMAND_REJECTED')
    }
  })

  it('allows commands without path separator when allowedPaths is set', () => {
    mockCheckCapabilities.mockReturnValue(makeNoIsolationReport())
    mockExecFileSync.mockReturnValue(Buffer.from('ok'))

    const configResult = createConfig({
      allowedPaths: ['/usr/bin']
    })
    expect(configResult.isOk()).toBe(true)
    if (!configResult.isOk()) return

    const result = exec(configResult.value, 'ls', ['-la'])

    expect(result.isOk()).toBe(true)
  })

  it('captures non-zero exit code', () => {
    mockCheckCapabilities.mockReturnValue(makeNoIsolationReport())
    mockExecFileSync.mockImplementation(() => {
      const error = new Error('Command failed') as unknown as Record<string, unknown>
      error.status = 1
      error.stdout = Buffer.from('')
      error.stderr = Buffer.from('error output\n')
      throw error
    })

    const configResult = createConfig({})
    expect(configResult.isOk()).toBe(true)
    if (!configResult.isOk()) return

    const result = exec(configResult.value, 'false', [])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(1)
      expect(result.value.stderr).toBe('error output\n')
    }
  })

  it('returns exec error when command not found', () => {
    mockCheckCapabilities.mockReturnValue(makeNoIsolationReport())
    mockExecFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const configResult = createConfig({})
    expect(configResult.isOk()).toBe(true)
    if (!configResult.isOk()) return

    const result = exec(configResult.value, 'nonexistent-binary', [])

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.kind).toBe('EXEC_FAILED')
    }
  })

  it('wraps command with unshare when capabilities available and isolation requested', () => {
    mockCheckCapabilities.mockReturnValue(makeFullReport())
    mockExecFileSync.mockReturnValue(Buffer.from('isolated output'))

    const configResult = createConfig({ noNetwork: true })
    expect(configResult.isOk()).toBe(true)
    if (!configResult.isOk()) return

    const result = exec(configResult.value, 'curl', ['https://example.com'])

    expect(result.isOk()).toBe(true)

    // Verify execFileSync was called with unshare wrapping
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'unshare',
      expect.arrayContaining(['--net', '--', 'curl', 'https://example.com']),
      expect.objectContaining({ cwd: expect.any(String) })
    )
  })
})
