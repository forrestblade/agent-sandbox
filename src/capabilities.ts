import { execFileSync } from 'node:child_process'
import { ok, err } from '@valencets/resultkit'
import type { Result } from '@valencets/resultkit'
import type { Capability, CapabilityReport, SandboxError } from './types.js'

function checkBinary (name: string, testArgs: ReadonlyArray<string>): Capability {
  const result = probeCommand(name, testArgs)

  if (result.isOk()) {
    return { name, available: true, reason: `${name} is available` }
  }

  return { name, available: false, reason: result.error.message }
}

function probeCommand (command: string, args: ReadonlyArray<string>): Result<string, SandboxError> {
  const result = safeExecFileSync(command, args)

  if (result.isErr()) {
    return err({ kind: 'CAPABILITY_UNAVAILABLE', message: `${command} not found or not executable` })
  }

  return ok(result.value)
}

function safeExecFileSync (command: string, args: ReadonlyArray<string>): Result<string, SandboxError> {
  const execResult = captureExecFileSync(command, [...args])

  if (!execResult.success) {
    return err({ kind: 'EXEC_FAILED', message: execResult.message })
  }

  return ok(execResult.output)
}

function captureExecFileSync (command: string, args: Array<string>): { readonly success: boolean, readonly output: string, readonly message: string } {
  let output: Buffer
  /* eslint-disable no-restricted-syntax */
  try {
    output = execFileSync(command, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 })
  } catch {
    return { success: false, output: '', message: `Failed to execute ${command}` }
  }
  /* eslint-enable no-restricted-syntax */
  return { success: true, output: output.toString('utf-8').trim(), message: '' }
}

export function checkCapabilities (): CapabilityReport {
  const platform = detectPlatform()

  if (platform === 'unsupported') {
    const unavailable: Capability = { name: 'platform', available: false, reason: 'Only Linux is supported for namespace isolation' }
    return {
      unshare: unavailable,
      iptables: unavailable,
      mountNamespace: unavailable,
      platform: 'unsupported'
    }
  }

  const unshare = checkBinary('unshare', ['--help'])
  const iptables = checkBinary('iptables', ['--version'])
  const mountNamespace = checkMountNamespace()

  return { unshare, iptables, mountNamespace, platform }
}

function checkMountNamespace (): Capability {
  const result = safeExecFileSync('unshare', ['--mount', '--map-root-user', 'true'])

  if (result.isOk()) {
    return { name: 'mountNamespace', available: true, reason: 'Mount namespaces are available' }
  }

  return { name: 'mountNamespace', available: false, reason: 'Mount namespaces require privileges or user namespace support' }
}

function detectPlatform (): 'linux' | 'unsupported' {
  const platformMap: Readonly<Record<string, 'linux' | 'unsupported'>> = {
    linux: 'linux'
  }

  return platformMap[process.platform] ?? 'unsupported'
}

export function formatReport (report: CapabilityReport): string {
  const lines = [
    `Platform: ${report.platform}`,
    '',
    `unshare:        ${report.unshare.available ? 'YES' : 'NO'}  (${report.unshare.reason})`,
    `iptables:       ${report.iptables.available ? 'YES' : 'NO'}  (${report.iptables.reason})`,
    `mount namespace: ${report.mountNamespace.available ? 'YES' : 'NO'}  (${report.mountNamespace.reason})`
  ]

  return lines.join('\n')
}
