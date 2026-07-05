/**
 * `happy send-message` — send a user text message to an EXISTING Happy session
 * via the server, exactly the way the mobile app does. This wakes an idle
 * session so it takes a turn.
 *
 * Built for the "supervisor → worker" channel: a supervisor session messages a
 * (mostly-idle) worker session to ask it questions / task it.
 *
 * - The Authorization token comes from the CURRENT install's credentials
 *   (`$HAPPY_HOME_DIR/access.key`). The server is account-scoped, so you may
 *   message any session belonging to your own account.
 * - The TARGET session's end-to-end encryption key is read from a persisted
 *   sessions file — either the current install's (default) or one given with
 *   `--sessions-file` (e.g. the worker's `sessions.json`, mounted read-only into
 *   the supervisor) — or passed explicitly with `--key`/`--variant`.
 *
 * Reuses Happy's own `encrypt()` so the ciphertext is byte-for-byte what the
 * session expects (a wrong reimplementation would fail to decrypt silently).
 */
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { configuration } from '@/configuration';
import { encrypt, encodeBase64, decodeBase64 } from '@/api/encryption';
import { readCredentials, readPersistedSessions, type PersistedSession } from '@/persistence';

type EncryptionVariant = 'legacy' | 'dataKey';

interface SendMessageArgs {
  sessionId: string;
  text: string;
  sessionsFile?: string;
  key?: string;
  variant?: EncryptionVariant;
}

const HELP = `${chalk.bold('happy send-message')} - send a user message to an existing session (wakes it)

Usage:
  happy send-message --to <sessionId> --text "<message>" [key source]

Key source (how to get the target session's E2E key; first match wins):
  --key <base64> --variant <legacy|dataKey>   provide it explicitly
  --sessions-file <path>                       read it from another install's sessions.json
  (default)                                    read it from this install's sessions

Options:
  --to <sessionId>        target session id (required)
  --text "<message>"      message text (required)
  -h, --help              show this help

The Authorization token always comes from this install ($HAPPY_HOME_DIR/access.key);
the server only allows messaging sessions on your own account.`;

function parseArgs(argv: string[]): SendMessageArgs {
  const out: Partial<SendMessageArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return v;
    };
    switch (arg) {
      case '--to': case '--session': case '--session-id': out.sessionId = next(); break;
      case '--text': case '-m': out.text = next(); break;
      case '--sessions-file': out.sessionsFile = next(); break;
      case '--key': out.key = next(); break;
      case '--variant': {
        const v = next();
        if (v !== 'legacy' && v !== 'dataKey') {
          throw new Error(`--variant must be 'legacy' or 'dataKey', got '${v}'`);
        }
        out.variant = v;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!out.sessionId) throw new Error('--to <sessionId> is required');
  if (out.text === undefined) throw new Error('--text "<message>" is required');
  return out as SendMessageArgs;
}

function resolveSessionKey(args: SendMessageArgs): { key: Uint8Array; variant: EncryptionVariant } {
  if (args.key && args.variant) {
    return { key: decodeBase64(args.key), variant: args.variant };
  }
  let persisted: PersistedSession | undefined;
  if (args.sessionsFile) {
    const parsed = JSON.parse(readFileSync(args.sessionsFile, 'utf8')) as { sessions?: Record<string, PersistedSession> };
    persisted = parsed.sessions?.[args.sessionId];
    if (!persisted) {
      throw new Error(`Session ${args.sessionId} not found in ${args.sessionsFile}`);
    }
  } else {
    persisted = readPersistedSessions()[args.sessionId];
    if (!persisted) {
      throw new Error(`Session ${args.sessionId} not found in this install's sessions. Use --sessions-file or --key/--variant.`);
    }
  }
  return { key: decodeBase64(persisted.encryptionKey), variant: persisted.encryptionVariant };
}

export async function handleSendMessageCommand(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP);
    return;
  }

  const args = parseArgs(argv);

  const credentials = await readCredentials();
  if (!credentials) {
    throw new Error('Not logged in (no credentials for this HAPPY_HOME_DIR). Run "happy" to authenticate.');
  }

  const { key, variant } = resolveSessionKey(args);

  // Exactly the shape an incoming user message must have to trigger a turn
  // (UserMessageSchema in src/api/types.ts -> routeIncomingMessage).
  const payload = { role: 'user' as const, content: { type: 'text' as const, text: args.text } };
  const content = encodeBase64(encrypt(key, variant, payload));

  const url = `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(args.sessionId)}/messages`;
  try {
    const res = await axios.post(
      url,
      { messages: [{ content, localId: randomUUID() }] },
      { headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' } }
    );
    const seq = res.data?.messages?.[0]?.seq;
    console.log(chalk.green(`Message delivered to session ${args.sessionId}${seq !== undefined ? ` (seq ${seq})` : ''}.`));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const s = error.response.status;
      const hint =
        s === 401 ? ' (token rejected — this install may need re-auth)' :
        s === 403 ? ' (forbidden — the session is not on this account)' :
        s === 404 ? ' (session not found on the server)' : '';
      throw new Error(`Server returned ${s}${hint}: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}
