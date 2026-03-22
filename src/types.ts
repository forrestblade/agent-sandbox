export const SANDBOX_ERROR_KINDS = [
  'CAPABILITY_UNAVAILABLE',
  'EXEC_FAILED',
  'INVALID_CONFIG',
  'COMMAND_REJECTED'
] as const

export type SandboxErrorKind = typeof SANDBOX_ERROR_KINDS[number]

export interface SandboxError {
  readonly kind: SandboxErrorKind
  readonly message: string
}

export interface SandboxConfig {
  readonly allowedPaths: ReadonlyArray<string>
  readonly readOnly: boolean
  readonly noNetwork: boolean
  readonly workDir: string
}

export interface SandboxResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface Capability {
  readonly name: string
  readonly available: boolean
  readonly reason: string
}

export interface CapabilityReport {
  readonly unshare: Capability
  readonly iptables: Capability
  readonly mountNamespace: Capability
  readonly platform: 'linux' | 'unsupported'
}

export const DEFAULT_CONFIG: SandboxConfig = {
  allowedPaths: [],
  readOnly: false,
  noNetwork: false,
  workDir: process.cwd()
}
