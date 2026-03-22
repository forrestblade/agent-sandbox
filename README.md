# agent-sandbox

Wrapper for running commands with OS-level isolation. Restricts filesystem and network access for untrusted operations.

## Install

```bash
npm install -g agent-sandbox-cli
```

## Usage

```bash
agent-sandbox exec <command>              # run in sandbox
agent-sandbox exec --no-network <command> # no network access
agent-sandbox exec --readonly <command>   # read-only filesystem
agent-sandbox check                       # verify capabilities
```

Requires Linux with namespace support for full isolation. Falls back gracefully when unavailable.

## License

MIT
