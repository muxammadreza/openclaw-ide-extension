/**
 * wellKnownPlugins.ts
 *
 * Hardcoded schema contributions for officially-known OpenClaw plugins and
 * third-party channel/tool extensions.  These act as a reliable baseline when
 * a plugin does not ship its own schema file.
 *
 * Each entry follows the PluginContribution shape from schemaManager.ts.
 */
import { PluginContribution } from './schemaManager';

export interface WellKnownPluginSchema {
  /** npm package name (e.g. "@openclaw/mattermost"). */
  id: string;
  contribution: PluginContribution;
}

export const WELL_KNOWN_PLUGIN_SCHEMAS: WellKnownPluginSchema[] = [

  // ── @openclaw/matrix ───────────────────────────────────────────────────────
  {
    id: '@openclaw/matrix',
    contribution: {
      channels: {
        matrix: {
          type: 'object',
          description: 'Matrix channel configuration (plugin: @openclaw/matrix).',
          properties: {
            enabled: { type: 'boolean', default: true },
            homeserverUrl: { type: 'string', description: 'Matrix homeserver URL (e.g. https://matrix.org).' },
            accessToken: { type: 'string', description: 'Matrix bot access token. Prefer an env-var reference.' },
            userId: { type: 'string', description: 'Full Matrix user ID of the bot (e.g. @openclaw:matrix.org).' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            groupPolicy: { $ref: '#/definitions/GroupPolicy' },
            rooms: {
              type: 'object',
              description: 'Per-room configuration. Keys are room IDs.',
              additionalProperties: {
                type: 'object',
                properties: {
                  allow: { type: 'boolean' },
                  requireMention: { type: 'boolean' },
                  skills: { type: 'array', items: { type: 'string' } },
                  systemPrompt: { type: 'string' },
                },
              },
            },
            historyLimit: { type: 'integer', default: 50 },
            mediaMaxMb: { type: 'number', default: 20 },
            encryptionEnabled: { type: 'boolean', default: false, description: 'Enable end-to-end encryption (requires libolm).' },
            configWrites: { type: 'boolean', default: true },
          },
        },
      },
    },
  },

  // ── @openclaw/feishu (Lark) ────────────────────────────────────────────────
  {
    id: '@openclaw/feishu',
    contribution: {
      channels: {
        feishu: {
          type: 'object',
          description: 'Feishu / Lark channel configuration (plugin: @openclaw/feishu).',
          properties: {
            enabled: { type: 'boolean', default: true },
            appId: { type: 'string', description: 'Feishu app ID.' },
            appSecret: { type: 'string', description: 'Feishu app secret. Prefer an env-var reference.' },
            verificationToken: { type: 'string' },
            encryptKey: { type: 'string' },
            webhookPath: { type: 'string', default: '/feishu' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            groupPolicy: { $ref: '#/definitions/GroupPolicy' },
            historyLimit: { type: 'integer', default: 50 },
            mediaMaxMb: { type: 'number', default: 20 },
            configWrites: { type: 'boolean', default: true },
          },
        },
      },
    },
  },

  // ── @openclaw/line ────────────────────────────────────────────────────────
  {
    id: '@openclaw/line',
    contribution: {
      channels: {
        line: {
          type: 'object',
          description: 'LINE channel configuration (plugin: @openclaw/line).',
          properties: {
            enabled: { type: 'boolean', default: true },
            channelAccessToken: { type: 'string', description: 'LINE channel access token. Prefer an env-var reference.' },
            channelSecret: { type: 'string', description: 'LINE channel secret.' },
            webhookPath: { type: 'string', default: '/line' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            groupPolicy: { $ref: '#/definitions/GroupPolicy' },
            historyLimit: { type: 'integer', default: 50 },
            mediaMaxMb: { type: 'number', default: 10 },
          },
        },
      },
    },
  },

  // ── @openclaw/nostr ───────────────────────────────────────────────────────
  {
    id: '@openclaw/nostr',
    contribution: {
      channels: {
        nostr: {
          type: 'object',
          description: 'Nostr channel configuration (plugin: @openclaw/nostr).',
          properties: {
            enabled: { type: 'boolean', default: true },
            privateKey: { type: 'string', description: 'Nostr private key (nsec or hex). Prefer an env-var reference.' },
            relays: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'WebSocket relay URLs.' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            historyLimit: { type: 'integer', default: 50 },
          },
        },
      },
    },
  },

  // ── @openclaw/twitch ──────────────────────────────────────────────────────
  {
    id: '@openclaw/twitch',
    contribution: {
      channels: {
        twitch: {
          type: 'object',
          description: 'Twitch channel configuration (plugin: @openclaw/twitch).',
          properties: {
            enabled: { type: 'boolean', default: true },
            accessToken: { type: 'string', description: 'Twitch OAuth access token. Prefer an env-var reference.' },
            clientId: { type: 'string' },
            channels: { type: 'array', items: { type: 'string' }, description: 'Twitch channel names to join.' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            commandPrefix: { type: 'string', default: '!' },
          },
        },
      },
    },
  },

  // ── @openclaw/zalo ────────────────────────────────────────────────────────
  {
    id: '@openclaw/zalo',
    contribution: {
      channels: {
        zalo: {
          type: 'object',
          description: 'Zalo channel configuration (plugin: @openclaw/zalo).',
          properties: {
            enabled: { type: 'boolean', default: true },
            accessToken: { type: 'string', description: 'Zalo OA access token. Prefer an env-var reference.' },
            oaId: { type: 'string', description: 'Zalo Official Account ID.' },
            webhookPath: { type: 'string', default: '/zalo' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            historyLimit: { type: 'integer', default: 50 },
            mediaMaxMb: { type: 'number', default: 10 },
          },
        },
        zalop: {
          type: 'object',
          description: 'Zalo Personal channel configuration (plugin: @openclaw/zalo).',
          properties: {
            enabled: { type: 'boolean', default: true },
            phone: { type: 'string', description: 'Zalo personal account phone number.' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },

  // ── @openclaw/nextcloud-talk ──────────────────────────────────────────────
  {
    id: '@openclaw/nextcloud-talk',
    contribution: {
      channels: {
        nextcloudtalk: {
          type: 'object',
          description: 'Nextcloud Talk channel configuration (plugin: @openclaw/nextcloud-talk).',
          properties: {
            enabled: { type: 'boolean', default: true },
            baseUrl: { type: 'string', description: 'Nextcloud instance URL.' },
            username: { type: 'string' },
            password: { type: 'string', description: 'Prefer an env-var reference.' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            groupPolicy: { $ref: '#/definitions/GroupPolicy' },
            pollIntervalMs: { type: 'integer', default: 3000 },
          },
        },
      },
    },
  },

  // ── @openclaw/synology-chat ───────────────────────────────────────────────
  {
    id: '@openclaw/synology-chat',
    contribution: {
      channels: {
        synologychat: {
          type: 'object',
          description: 'Synology Chat channel configuration (plugin: @openclaw/synology-chat).',
          properties: {
            enabled: { type: 'boolean', default: true },
            incomingWebhook: { type: 'string', description: 'Synology Chat incoming webhook URL.' },
            token: { type: 'string', description: 'Synology Chat outgoing webhook token.' },
            webhookPath: { type: 'string', default: '/synologychat' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },

  // ── @openclaw/tlon ────────────────────────────────────────────────────────
  {
    id: '@openclaw/tlon',
    contribution: {
      channels: {
        tlon: {
          type: 'object',
          description: 'Tlon / Urbit channel configuration (plugin: @openclaw/tlon).',
          properties: {
            enabled: { type: 'boolean', default: true },
            ship: { type: 'string', description: 'Urbit ship name (e.g. ~sampel-palnet).' },
            desk: { type: 'string', default: 'openclaw' },
            url: { type: 'string', description: 'Urbit ship URL.' },
            code: { type: 'string', description: 'Urbit web login code. Prefer an env-var reference.' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },

  // ── @openclaw/webchat ─────────────────────────────────────────────────────
  {
    id: '@openclaw/webchat',
    contribution: {
      channels: {
        webchat: {
          type: 'object',
          description: 'WebChat (embedded web widget) channel configuration (plugin: @openclaw/webchat).',
          properties: {
            enabled: { type: 'boolean', default: true },
            path: { type: 'string', default: '/chat', description: 'URL path for the web chat widget.' },
            allowOrigins: { type: 'array', items: { type: 'string' }, description: 'Allowed CORS origins for the widget.' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            historyLimit: { type: 'integer', default: 50 },
            theme: {
              type: 'object',
              properties: {
                primaryColor: { type: 'string' },
                fontFamily: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },

  // ── @openclaw/mattermost ──────────────────────────────────────────────────
  // (also covered in the base schema but with richer detail here)
  {
    id: '@openclaw/mattermost',
    contribution: {
      channels: {
        mattermost: {
          type: 'object',
          description: 'Mattermost channel configuration (plugin: @openclaw/mattermost).',
          properties: {
            enabled: { type: 'boolean', default: true },
            botToken: { type: 'string', description: 'Mattermost bot access token. Prefer an env-var reference.' },
            baseUrl: { type: 'string', description: 'Mattermost server base URL (e.g. https://chat.example.com).' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            chatmode: {
              type: 'string',
              enum: ['oncall', 'onmessage', 'onchar'],
              description: '"oncall": respond on @mention (default). "onmessage": every message. "onchar": messages starting with trigger prefix.',
              default: 'oncall',
            },
            oncharPrefixes: { type: 'array', items: { type: 'string' } },
            requireMention: { type: 'boolean', default: true },
            commands: {
              type: 'object',
              properties: {
                native: { type: 'boolean', default: true },
                nativeSkills: { type: 'boolean' },
                callbackPath: { type: 'string', description: 'Path for slash command callbacks (not a full URL).' },
                callbackUrl: { type: 'string', description: 'Full callback URL for Mattermost slash commands.' },
              },
            },
            textChunkLimit: { type: 'integer', default: 4000 },
            chunkMode: { type: 'string', enum: ['length', 'newline'], default: 'length' },
            configWrites: { type: 'boolean', default: true },
            defaultAccount: { type: 'string' },
            accounts: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  botToken: { type: 'string' },
                  baseUrl: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },

  // ── @openclaw/irc ─────────────────────────────────────────────────────────
  {
    id: '@openclaw/irc',
    contribution: {
      channels: {
        irc: {
          type: 'object',
          description: 'IRC channel configuration (plugin: @openclaw/irc).',
          properties: {
            enabled: { type: 'boolean', default: true },
            server: { type: 'string', description: 'IRC server hostname.' },
            port: { type: 'integer', default: 6697 },
            tls: { type: 'boolean', default: true },
            nick: { type: 'string', description: 'IRC nickname for the bot.' },
            username: { type: 'string' },
            realname: { type: 'string' },
            channels: {
              type: 'array',
              items: { type: 'string' },
              description: 'IRC channels to join (e.g. ["#general"]).',
            },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            configWrites: { type: 'boolean', default: true },
            nickserv: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean', default: true },
                service: { type: 'string', default: 'NickServ' },
                password: { type: 'string', description: 'Prefer an env-var reference.' },
                register: { type: 'boolean', default: false },
                registerEmail: { type: 'string' },
              },
            },
            sasl: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean', default: false },
                mechanism: { type: 'string', enum: ['PLAIN', 'EXTERNAL'], default: 'PLAIN' },
                username: { type: 'string' },
                password: { type: 'string', description: 'Prefer an env-var reference.' },
              },
            },
            defaultAccount: { type: 'string' },
          },
        },
      },
    },
  },

  // ── @openclaw/microsoft-teams ─────────────────────────────────────────────
  {
    id: '@openclaw/microsoft-teams',
    contribution: {
      channels: {
        msteams: {
          type: 'object',
          description: 'Microsoft Teams channel configuration (plugin: @openclaw/microsoft-teams).',
          properties: {
            enabled: { type: 'boolean', default: true },
            appId: { type: 'string', description: 'Azure AD app (client) ID.' },
            appPassword: { type: 'string', description: 'Azure AD app client secret. Prefer an env-var reference.' },
            tenantId: { type: 'string', description: 'Azure AD tenant ID. Use "common" for multi-tenant.' },
            webhookPath: { type: 'string', default: '/msteams' },
            dmPolicy: { $ref: '#/definitions/DmPolicy' },
            allowFrom: { type: 'array', items: { type: 'string' } },
            groupPolicy: { $ref: '#/definitions/GroupPolicy' },
            teams: {
              type: 'object',
              description: 'Per-team configuration. Keys are team IDs.',
              additionalProperties: {
                type: 'object',
                properties: {
                  allow: { type: 'boolean' },
                  requireMention: { type: 'boolean' },
                  channels: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        allow: { type: 'boolean' },
                        requireMention: { type: 'boolean' },
                        skills: { type: 'array', items: { type: 'string' } },
                        systemPrompt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            historyLimit: { type: 'integer', default: 50 },
            mediaMaxMb: { type: 'number', default: 20 },
            configWrites: { type: 'boolean', default: true },
            streaming: {
              type: 'string',
              enum: ['off', 'partial', 'block', 'progress'],
              default: 'off',
            },
          },
        },
      },
    },
  },

  // ── Generic ACP / skill plugins ───────────────────────────────────────────
  // These contribute skill names rather than channels
  {
    id: '@openclaw/skills-search',
    contribution: {
      skills: ['search', 'web-search', 'bing', 'brave', 'perplexity'],
    },
  },
  {
    id: '@openclaw/skills-git',
    contribution: {
      skills: ['git', 'github', 'gitlab', 'bitbucket'],
    },
  },
  {
    id: '@openclaw/skills-docs',
    contribution: {
      skills: ['docs', 'notion', 'confluence', 'obsidian'],
    },
  },
  {
    id: '@openclaw/skills-calendar',
    contribution: {
      skills: ['calendar', 'gcal', 'outlook-calendar'],
    },
  },
  {
    id: '@openclaw/skills-email',
    contribution: {
      skills: ['email', 'gmail', 'sendgrid'],
    },
  },
];
