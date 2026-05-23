import { BaseGateway } from './gateway-base.js';

/**
 * TelegramGateway adapts the Telegram Bot API to the Bridge Router.
 */
export class TelegramGateway extends BaseGateway {
  constructor(id, router, botApi) {
    super(id, router);
    this.botApi = botApi;
  }

  async send(payload) {
    // Extract chatId from the context if available in payload
    const chatId = payload.chatId;
    if (!chatId) return;

    let messageText = '';
    if (payload.type === 'chat_response') {
      messageText = payload.data.content;
    } else if (payload.type === 'error') {
      messageText = `❌ Error: ${payload.data.message}`;
    } else {
      messageText = JSON.stringify(payload.data);
    }

    await this.botApi.sendMessage(chatId, messageText);
  }

  // Called by the Telegram Bot loop
  async onMessage(chatId, text) {
    await this.router.dispatch(this.id, {
      type: 'chat_message',
      data: { message: text },
      sessionId: `tg-${chatId}`,
      chatId: chatId
    });
  }
}
