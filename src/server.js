/**
 * The core server that runs on a Cloudflare worker.
 */

import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { PING_COMMAND, REVIVE_COMMAND, TEST_COMMAND } from './commands.js';
import * as discord from './discord.js';
import { InteractionResponseFlags } from 'discord-interactions';

const router = new Hono();

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get('/', (c) => {
  return new Response(`👋 ${c.env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
// eslint-disable-next-line no-unused-vars
router.post('/interactions', async (c) => {
  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');
  const body = await c.req.text();
  if (!verifyKey(body, signature, timestamp, c.env.DISCORD_PUBLIC_KEY)) {
    console.error('Invalid Request');
    return c.text('Bad request signature.', 401);
  }
  const interaction = JSON.parse(body);

  switch (interaction.type) {
    case InteractionType.PING: {
      // The `PING` message is used during the initial webhook handshake, and is
      // required to configure the webhook in the developer portal.
      return c.json({ type: InteractionResponseType.PONG });
    }

    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE: {
      // The `APPLICATION_COMMAND_AUTOCOMPLETE_RESULT` message is sent when a
      // user is typing a command, and Discord is asking for autocomplete
      // options.
      return c.json({
        type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
        data: {
          choices: [
            {
              name: 'ping',
              value: 'ping',
            },
            {
              name: 'revive',
              value: 'revive',
            },
            {
              name: 'test',
              value: 'test',
            },
          ],
        },
      });
    }

    case InteractionType.MESSAGE_COMPONENT: {
      // The `MESSAGE_COMPONENT` message is sent when a user interacts with a
      // message component, such as a button or select menu.
      switch (interaction.data.custom_id) {
        case 'test': {
          return c.json({});
        }
        default:
          return c.json({ error: 'Unknown Type' }, { status: 400 });
      }
    }

    case InteractionType.MODAL_SUBMIT: {
      // The `MODAL_SUBMIT` message is sent when a user submits a modal form.
      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Thanks for submitting!',
        },
      });
    }

    case InteractionType.APPLICATION_COMMAND: {
      // Most user commands will come as `APPLICATION_COMMAND`.
      switch (interaction.data.name.toLowerCase()) {
        // Revive ping command - checks if a user has a role and pings a role if they do
        case REVIVE_COMMAND.name.toLowerCase(): {
          if (interaction.member.roles.includes('909724765026148402')) {
            console.log('handling revive request');
            return c.json({
              type: 4,
              data: {
                content:
                  "Hey there <@&879527848573042738> squad, it's time to make the chat active!",
                allowed_mentions: {
                  roles: ['879527848573042738'],
                },
              },
            });
          }
          return c.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content:
                'You do not have the correct role necessary to perform this action. If you believe this is an error, please contact CyberFlame United#0001 (<@218977195375329281>).',
              flags: InteractionResponseFlags.EPHEMERAL,
            },
          });
        }
        // Test command - for testing
        case TEST_COMMAND.name.toLowerCase(): {
          return c.json({
            type: InteractionResponseType.MODAL,
            data: {
              custom_id: 'test',
              title: 'Test',
              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 4,
                      custom_id: 'name',
                      label: 'Name',
                      style: 1,
                      min_length: 1,
                      max_length: 4000,
                      placeholder: 'John',
                      required: true,
                    },
                  ],
                },
              ],
            },
          });
        }
        // Ping command - for checking latency of the bot, returned as a non-ephemeral message
        case PING_COMMAND.name.toLowerCase(): {
          return c.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Pong! Latency: ${
                Date.now() -
                Math.round(interaction.id / 4194304 + 1420070400000)
              }ms (rounded to nearest integer)`,
            },
          });
        }
        default:
          return c.json({ error: 'Unknown Type' }, { status: 400 });
      }
    }
  }

  console.error('Unknown Type');
  return c.json({ error: 'Unknown Type' }, { status: 400 });
});

router.get('/linked-role', async (c) => {
  const { url, state } = discord.getOAuthUrl();

  setCookie(c, 'client_state', state, {
    maxAge: 1000 * 60 * 5,
    signed: true,
  });
  return c.redirect(url);
});

router.get('/oauth-callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (getCookie(c, 'client_state') !== state)
      return c.text('state verification failed', 403);

    const tokens = await discord.getOAuthTokens(code, c.env);
    const data = await discord.getUserData(tokens, c.env);

    await storage.storeDiscordTokens(data.user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });

    await updateMetadata(data.user.id);

    return c.text('connected! you may now close this window');
  } catch (e) {
    console.log(e);

    return c.text('oh uh, something wrong happened', 500);
  }
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

export default router;
