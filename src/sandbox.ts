import { execFileSync } from 'node:child_process'
import { ok, err } from '@valencets/resultkit'
import type { Result } from '@valencets/resultkit'
import { checkCapabilities } from './capabilities.js'
import type { SandboxConfig, SandboxError, SandboxResult, CapabilityReport } from './types.js'
import { DEFAULT_CONFIG } from './types.js'

export function createConfig (overrides: Partial<SandboxConfig>): Result<SandboxConfig, SandboxError> {
  const config: SandboxConfig = {
    allowedPaths: overrides.allowedPaths ?? DEFAULT_CONFIG.allowedPaths,
    readOnly: overrides.readOnly ?? DEFAULT_CONFIG.readOnly,
    noNetwork: overrides.noNetwork ?? DEFAULT_CONFIG.noNetwork,
    workDir: overrides.workDir ?? DEFAULT_CONFIG.workDir
  }

  if (config.workDir === '') {
    return err({ kind: 'INVALID_CONFIG', message: 'workDir must not be empty' })
  }

  return ok(config)
}

export function buildCommand (config: SandboxConfig, command: string, args: ReadonlyArray<string>, capabilities: CapabilityReport): ReadonlyArray<string> {
  if (!capabilities.unshare.available) {
    return [command, ...args]
  }

  const unshareArgs: Array<string> = []

  if (config.noNetwork && capabilities.unshare.available) {
    unshareArgs.push('--net')
  }

  if (config.readOnly && capabilities.mountNamespace.available) {
    unshareArgs.push('--mount')
  }

  if (unshareArgs.length === 0) {
    return [command, ...args]
  }

  return ['unshare', '--map-root-user', ...unshareArgs, '--', command, ...args]
}

export function exec (config: SandboxConfig, command: string, args: ReadonlyArray<string>): Result<SandboxResult, SandboxError> {
  const pathValidation = validatePaths(config, command)
  if (pathValidation.isErr()) {
    return err(pathValidation.error)
  }

  const capabilities = checkCapabilities()
  const fullCommand = buildCommand(config, command, args, capabilities)

  const binary = fullCommand[0]
  const binaryArgs = fullCommand.slice(1)

  if (!binary) {
    return err({ kind: 'EXEC_FAILED', message: 'Empty command' })
  }

  if (!capabilities.unshare.available && (config.noNetwork || config.readOnly)) {
    console.warn('[agent-sandbox] Warning: unshare not available, running without isolation')
  }

  return execInSandbox(binary, binaryArgs, config.workDir)
}

function validatePaths (config: SandboxConfig, command: string): Result<true, SandboxError> {
  if (config.allowedPaths.length === 0) {
    return ok(true)
  }

  const isAllowed = config.allowedPaths.some(
    (allowed) => command.startsWith(allowed) || !command.includes('/')
  )

  if (!isAllowed) {
    return err({
      kind: 'COMMAND_REJECTED',
      message: `Command "${command}" is not within allowed paths: ${config.allowedPaths.join(', ')}`
    })
  }

  return ok(true)
}

function execInSandbox (binary: string, args: ReadonlyArray<string>, workDir: string): Result<SandboxResult, SandboxError> {
  const result = captureExec(binary, [...args], workDir)

  if (!result.executed) {
    return err({ kind: 'EXEC_FAILED', message: result.errorMessage })
  }

  return ok({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  })
}

interface ExecCapture {
  readonly executed: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly errorMessage: string
}

function captureExec (binary: string, args: Array<string>, workDir: string): ExecCapture {
  /* eslint-disable no-restricted-syntax */
  try {
    const stdout = execFileSync(binary, args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    })

    return {
      executed: true,
      stdout: stdout.toString('utf-8'),
      stderr: '',
      exitCode: 0,
      errorMessage: ''
    }
  } catch (e: unknown) {
    const error = e as { status?: number, stdout?: Buffer, stderr?: Buffer, message?: string }

    if (error.status !== undefined && error.status !== null) {
      return {
        executed: true,
        stdout: error.stdout?.toString('utf-8') ?? '',
        stderr: error.stderr?.toString('utf-8') ?? '',
        exitCode: error.status,
        errorMessage: ''
      }
    }

    return {
      executed: false,
      stdout: '',
      stderr: '',
      exitCode: 1,
      errorMessage: error.message ?? 'Unknown execution error'
    }
  }
  /* eslint-enable no-restricted-syntax */
}
