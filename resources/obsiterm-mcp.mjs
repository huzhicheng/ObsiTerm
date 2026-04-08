#!/usr/bin/env node

const SERVER_INFO = {
  name: 'obsiterm-context',
  version: '0.1.0',
};

const MCP_PROTOCOL_VERSION = '2024-11-05';

const TOOL_DEFINITIONS = [
  {
    name: 'get_obsidian_context',
    description: 'Get the current Obsidian note context, including file path, cursor, and selection metadata.',
    endpoint: process.env.OBSITERM_CONTEXT_ENDPOINT ?? '',
    mode: 'json',
  },
  {
    name: 'get_current_selection',
    description: 'Get the current Obsidian text selection and selected line count.',
    endpoint: process.env.OBSITERM_SELECTION_ENDPOINT ?? '',
    mode: 'json',
  },
  {
    name: 'get_active_note',
    description: 'Get the current active Obsidian note path and current line.',
    endpoint: process.env.OBSITERM_ACTIVE_NOTE_ENDPOINT ?? '',
    mode: 'json',
  },
  {
    name: 'get_selection_prompt',
    description: 'Get a Claude-style prompt built from the current Obsidian selection.',
    endpoint: process.env.OBSITERM_SELECTION_PROMPT_ENDPOINT ?? '',
    mode: 'prompt',
  },
  {
    name: 'get_active_note_prompt',
    description: 'Get a Claude-style prompt built from the current active Obsidian note path.',
    endpoint: process.env.OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT ?? '',
    mode: 'prompt',
  },
];

const toolByName = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

let inputBuffer = Buffer.alloc(0);
let hasLoggedStartup = false;
let hasLoggedInput = false;
let transportMode = null;

logStderr('startup');

process.stdin.on('data', (chunk) => {
  if (!hasLoggedInput) {
    hasLoggedInput = true;
    logStderr(`stdin-data bytes=${chunk.length}`);
    logStderr(`stdin-preview=${JSON.stringify(chunk.toString('utf8'))}`);
  }
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void drainMessages().catch((error) => {
    logStderr(`drain-error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
});

process.stdin.on('end', () => {
  process.exit(0);
});

async function drainMessages() {
  while (true) {
    const lineMessage = extractLineDelimitedMessage();
    if (lineMessage) {
      const { payload } = lineMessage;
      logStderr(`line-payload=${payload}`);
      let request;
      try {
        request = JSON.parse(payload);
      } catch {
        writeError(null, -32700, 'Invalid JSON');
        continue;
      }

      try {
        transportMode ??= 'line';
        logStderr(`method=${request.method ?? 'unknown'}`);
        await handleRequest(request);
      } catch (error) {
        const id = isObject(request) && 'id' in request ? request.id : null;
        logStderr(`handler-error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        writeError(id, -32603, error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    const headerInfo = findHeaderBoundary(inputBuffer);
    if (!headerInfo) {
      if (inputBuffer.length > 0) {
        logStderr(`header-boundary-not-found buffer=${JSON.stringify(inputBuffer.toString('utf8'))}`);
      }
      return;
    }

    const { boundary, separatorLength } = headerInfo;
    const headerText = inputBuffer.subarray(0, boundary).toString('utf8');
    logStderr(`header=${JSON.stringify(headerText)}`);
    const contentLength = parseContentLength(headerText);
    if (contentLength === null) {
      writeError(null, -32700, 'Missing Content-Length header');
      inputBuffer = Buffer.alloc(0);
      return;
    }
    logStderr(`content-length=${contentLength}`);

    const messageStart = boundary + separatorLength;
    const messageEnd = messageStart + contentLength;
    if (inputBuffer.length < messageEnd) {
      logStderr(`waiting-for-body buffered=${inputBuffer.length} expected=${messageEnd}`);
      return;
    }

    const payload = inputBuffer.subarray(messageStart, messageEnd).toString('utf8');
    logStderr(`payload=${payload}`);
    inputBuffer = inputBuffer.subarray(messageEnd);

    let request;
    try {
      request = JSON.parse(payload);
    } catch {
      writeError(null, -32700, 'Invalid JSON');
      continue;
    }

    try {
      transportMode ??= 'content-length';
      logStderr(`method=${request.method ?? 'unknown'}`);
      await handleRequest(request);
    } catch (error) {
      const id = isObject(request) && 'id' in request ? request.id : null;
      logStderr(`handler-error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      writeError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
}

function extractLineDelimitedMessage() {
  const text = inputBuffer.toString('utf8');
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith('{') && !trimmedStart.startsWith('[')) {
    return null;
  }

  const newlineIndex = text.indexOf('\n');
  if (newlineIndex === -1) {
    return null;
  }

  const line = text.slice(0, newlineIndex).trim();
  inputBuffer = Buffer.from(text.slice(newlineIndex + 1), 'utf8');

  if (!line) {
    return null;
  }

  return { payload: line };
}

function findHeaderBoundary(buffer) {
  const crlfBoundary = buffer.indexOf('\r\n\r\n');
  const lfBoundary = buffer.indexOf('\n\n');

  if (crlfBoundary === -1 && lfBoundary === -1) {
    return null;
  }

  if (crlfBoundary !== -1 && (lfBoundary === -1 || crlfBoundary <= lfBoundary)) {
    return { boundary: crlfBoundary, separatorLength: 4 };
  }

  return { boundary: lfBoundary, separatorLength: 2 };
}

async function handleRequest(request) {
  if (!isObject(request)) {
    writeError(null, -32600, 'Invalid request');
    return;
  }

  const { id = null, method, params } = request;
  if (typeof method !== 'string') {
    writeError(id, -32600, 'Invalid request method');
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  switch (method) {
    case 'initialize':
      writeResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      });
      return;
    case 'ping':
      writeResult(id, {});
      return;
    case 'tools/list':
      writeResult(id, {
        tools: TOOL_DEFINITIONS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        })),
      });
      return;
    case 'tools/call':
      await handleToolCall(id, params);
      return;
    case 'resources/list':
      writeResult(id, { resources: [] });
      return;
    case 'prompts/list':
      writeResult(id, { prompts: [] });
      return;
    default:
      writeError(id, -32601, `Method not found: ${method}`);
  }
}

async function handleToolCall(id, params) {
  if (!isObject(params) || typeof params.name !== 'string') {
    writeError(id, -32602, 'Invalid tool call params');
    return;
  }

  const tool = toolByName.get(params.name);
  if (!tool) {
    writeError(id, -32602, `Unknown tool: ${params.name}`);
    return;
  }

  if (!tool.endpoint) {
    writeError(id, -32603, `Tool endpoint is unavailable: ${tool.name}`);
    return;
  }

  const payload = await fetchBridgePayload(tool.endpoint);
  const content = buildToolContent(tool, payload);

  writeResult(id, {
    content,
    isError: false,
  });
}

async function fetchBridgePayload(endpoint) {
  const token = process.env.OBSITERM_CONTEXT_BRIDGE_TOKEN ?? '';
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bridge request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
  }

  return response.json();
}

function buildToolContent(tool, payload) {
  if (tool.mode === 'prompt' && typeof payload?.prompt === 'string') {
    return [
      {
        type: 'text',
        text: payload.prompt,
      },
    ];
  }

  return [
    {
      type: 'text',
      text: JSON.stringify(payload, null, 2),
    },
  ];
}

function parseContentLength(headerText) {
  const lines = headerText.split(/\r?\n/);
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'content-length') {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
}

function writeResult(id, result) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  });
}

function writeMessage(message) {
  const body = JSON.stringify(message);
  if (!hasLoggedStartup) {
    hasLoggedStartup = true;
    logStderr('writing-first-response');
  }
  if (transportMode === 'line') {
    process.stdout.write(`${body}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logStderr(message) {
  process.stderr.write(`[obsiterm-mcp] ${message}\n`);
}
