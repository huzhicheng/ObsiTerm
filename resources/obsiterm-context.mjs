#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  printHelp();
  process.exit(0);
}

const command = args[0] ?? 'context';
const bridgeToken = process.env.OBSITERM_CONTEXT_BRIDGE_TOKEN ?? '';

const endpointByCommand = {
  context: process.env.OBSITERM_CONTEXT_ENDPOINT ?? '',
  selection: process.env.OBSITERM_SELECTION_ENDPOINT ?? '',
  note: process.env.OBSITERM_ACTIVE_NOTE_ENDPOINT ?? '',
  'selection-prompt': process.env.OBSITERM_SELECTION_PROMPT_ENDPOINT ?? '',
  'note-prompt': process.env.OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT ?? '',
  'mcp-config': '',
};

const endpoint = endpointByCommand[command];
if (command !== 'mcp-config' && !endpoint) {
  console.error(`Unknown or unavailable command: ${command}`);
  printHelp();
  process.exit(1);
}

const outputMode = resolveOutputMode(args.slice(1));

try {
  if (command === 'mcp-config') {
    writePayload(buildMcpConfig(resolveServerName(args.slice(1))), 'json');
    process.exit(0);
  }

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${bridgeToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Request failed: ${response.status} ${response.statusText}`);
    if (body) {
      console.error(body);
    }
    process.exit(1);
  }

  const payload = await response.json();
  writePayload(payload, outputMode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function resolveOutputMode(extraArgs) {
  if (extraArgs.includes('--text')) return 'text';
  return 'json';
}

function resolveServerName(extraArgs) {
  const nameFlagIndex = extraArgs.indexOf('--name');
  if (nameFlagIndex !== -1) {
    return extraArgs[nameFlagIndex + 1] ?? 'obsiterm';
  }

  return 'obsiterm';
}

function writePayload(payload, outputMode) {
  if (outputMode === 'text') {
    if (typeof payload?.prompt === 'string') {
      process.stdout.write(`${payload.prompt}\n`);
      return;
    }

    if (typeof payload?.selection === 'string') {
      process.stdout.write(`${payload.selection}\n`);
      return;
    }

    if (typeof payload?.activeFileAbsolutePath === 'string' && payload.activeFileAbsolutePath.length > 0) {
      process.stdout.write(`${payload.activeFileAbsolutePath}\n`);
      return;
    }
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function buildMcpConfig(serverName) {
  const mcpPath = process.env.OBSITERM_CONTEXT_MCP ?? '';
  if (!mcpPath) {
    throw new Error('OBSITERM_CONTEXT_MCP is not set in this terminal session.');
  }

  return {
    mcpServers: {
      [serverName]: {
        command: 'node',
        args: [mcpPath],
        env: {
          OBSITERM_CONTEXT_BRIDGE_TOKEN: process.env.OBSITERM_CONTEXT_BRIDGE_TOKEN ?? '',
          OBSITERM_CONTEXT_ENDPOINT: process.env.OBSITERM_CONTEXT_ENDPOINT ?? '',
          OBSITERM_SELECTION_ENDPOINT: process.env.OBSITERM_SELECTION_ENDPOINT ?? '',
          OBSITERM_ACTIVE_NOTE_ENDPOINT: process.env.OBSITERM_ACTIVE_NOTE_ENDPOINT ?? '',
          OBSITERM_SELECTION_PROMPT_ENDPOINT: process.env.OBSITERM_SELECTION_PROMPT_ENDPOINT ?? '',
          OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT: process.env.OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT ?? '',
        },
      },
    },
  };
}

function printHelp() {
  console.log(`Usage: obsiterm-context.mjs <command> [--text]

Commands:
  context            Print full Obsidian context JSON
  selection          Print current selection JSON
  note               Print current active note JSON
  selection-prompt   Print Claude-style selection prompt JSON
  note-prompt        Print Claude-style active note prompt JSON
  mcp-config         Print an MCP config snippet for the current terminal session

Options:
  --text             Print the main text field only when available
  --name <value>     Override the MCP server name for mcp-config`);
}
