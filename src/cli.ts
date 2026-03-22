import { checkCapabilities, formatReport } from './capabilities.js'
import { createConfig, exec } from './sandbox.js'

interface ParsedArgs {
  readonly command: string
  readonly subcommand: string
  readonly noNetwork: boolean
  readonly readOnly: boolean
  readonly execArgs: ReadonlyArray<string>
}

function parseArgs (argv: ReadonlyArray<string>): ParsedArgs {
  const command = argv[0] ?? ''
  let noNetwork = false
  let readOnly = false
  const execArgs: Array<string> = []
  let foundCommand = false

  for (const arg of argv.slice(1)) {
    if (foundCommand) {
      execArgs.push(arg)
      continue
    }

    const flagHandlers: Readonly<Record<string, () => void>> = {
      '--no-network': () => { noNetwork = true },
      '--readonly': () => { readOnly = true }
    }

    const handler = flagHandlers[arg]
    if (handler) {
      handler()
    } else {
      foundCommand = true
      execArgs.push(arg)
    }
  }

  return {
    command,
    subcommand: execArgs[0] ?? '',
    noNetwork,
    readOnly,
    execArgs
  }
}

const COMMANDS: Readonly<Record<string, (parsed: ParsedArgs) => void>> = {
  exec: (parsed) => {
    if (parsed.subcommand === '') {
      console.error('Usage: agent-sandbox exec [--no-network] [--readonly] <command> [args...]')
      process.exitCode = 1
      return
    }

    const configResult = createConfig({
      noNetwork: parsed.noNetwork,
      readOnly: parsed.readOnly
    })

    if (configResult.isErr()) {
      console.error(`Config error: ${configResult.error.message}`)
      process.exitCode = 1
      return
    }

    const binary = parsed.execArgs[0]
    const binaryArgs = parsed.execArgs.slice(1)

    if (!binary) {
      console.error('No command specified')
      process.exitCode = 1
      return
    }

    const result = exec(configResult.value, binary, binaryArgs)

    if (result.isErr()) {
      console.error(`Sandbox error: ${result.error.message}`)
      process.exitCode = 1
      return
    }

    const output = result.value
    if (output.stdout) {
      process.stdout.write(output.stdout)
    }
    if (output.stderr) {
      process.stderr.write(output.stderr)
    }
    process.exitCode = output.exitCode
  },

  check: () => {
    const report = checkCapabilities()
    console.log(formatReport(report))
  }
}

export function run (argv: ReadonlyArray<string>): void {
  const parsed = parseArgs(argv)

  if (parsed.command === '') {
    console.error('Usage: agent-sandbox <exec|check> [options...]')
    process.exitCode = 1
    return
  }

  const handler = COMMANDS[parsed.command]
  if (!handler) {
    console.error(`Unknown command: ${parsed.command}`)
    console.error('Available commands: exec, check')
    process.exitCode = 1
    return
  }

  handler(parsed)
}
