/**
 * 响应解析器
 * 支持多种 LLM 提供商的响应格式
 */
import { providerManager } from '../../providers/provider-manager.js';
import logger from '../monitoring/logger.js';

export class ResponseParser {
  constructor() {
    this._parsers = new Map();
    this._registerDefaultParsers();
  }

  _registerDefaultParsers() {
    this.registerParser('openai', (data) => {
      if (data.choices && data.choices.length > 0) {
        const choice = data.choices[0];
        if (choice.message?.content) {
          return { type: 'text', content: choice.message.content };
        }
        if (choice.text) {
          return { type: 'text', content: choice.text };
        }
        if (choice.delta?.content) {
          return { type: 'text', content: choice.delta.content, partial: true };
        }
      }
      return null;
    });

    this.registerParser('anthropic', (data) => {
      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find(b => b.type === 'text');
        if (textBlock?.text) {
          return { type: 'text', content: textBlock.text };
        }
      }
      return null;
    });

    this.registerParser('generic', (data) => {
      if (typeof data === 'string') {
        return { type: 'text', content: data };
      }
      if (data.text) {
        return { type: 'text', content: data.text };
      }
      if (data.message?.content) {
        return { type: 'text', content: data.message.content };
      }
      if (data.result?.text) {
        return { type: 'text', content: data.result.text };
      }
      return null;
    });

    this.registerParser('stream', (data) => {
      if (data.choices && data.choices[0]?.delta?.content) {
        return { type: 'text', content: data.choices[0].delta.content, partial: true };
      }
      if (data.content_block?.text) {
        return { type: 'text', content: data.content_block.text, partial: true };
      }
      if (data.text) {
        return { type: 'text', content: data.text, partial: true };
      }
      return null;
    });
  }

  registerParser(name, parser) {
    this._parsers.set(name, parser);
  }

  parse(data, provider = 'generic') {
    let parserName = provider;
    const config = providerManager.getProviderConfig(provider);
    if (config && config.transport === 'openai_chat') {
      parserName = 'openai';
    }
    logger.info(`[ResponseParser] provider=${provider}, transport=${config?.transport}, parserName=${parserName}`);
    const parser = this._parsers.get(parserName) || this._parsers.get('generic');
    const result = parser(data);

    if (result) {
      return {
        success: true,
        ...result,
        raw: data
      };
    }

    return this._parseAsError(data);
  }

  _parseAsError(data) {
    if (data.error) {
      const error = data.error;
      return {
        success: false,
        type: 'api_error',
        content: error.message || error.type || JSON.stringify(error),
        code: error.code,
        raw: data
      };
    }

    if (data.message) {
      return {
        success: false,
        type: 'error',
        content: data.message,
        raw: data
      };
    }

    return {
      success: false,
      type: 'parse_error',
      content: 'Failed to parse response',
      raw: data
    };
  }

  detectStream(data) {
    if (data.choices || data.choices?.[0]?.delta) return true;
    if (data.event === 'message_delta' || data.event === 'content_block_delta') return true;
    if (data._type === 'chunk' || data.type === 'chunk') return true;
    return false;
  }
}

export default ResponseParser;
