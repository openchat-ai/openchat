import logger from './logger.js';
/**
 * Router is the central dispatcher of the Bridge.
 * It routes messages from Gateways to the appropriate Core Logic and then to Providers/Tools.
 */
export class Router {
  constructor() {
    this.gateways = new Map();
    this.plugins = new Map();
    this.handlers = new Map();
  }

  /**
   * Register a gateway (e.g., CLI, WebSocket, Telegram)
   */
  registerGateway(id, gateway) {
    this.gateways.set(id, gateway);
    logger.info(`[Router] Gateway registered: ${id}`);
  }

  /**
   * Register a plugin/tool
   */
  registerPlugin(id, plugin) {
    this.plugins.set(id, plugin);
    logger.info(`[Router] Plugin registered: ${id}`);
  }

  /**
   * Main dispatch method
   * @param {string} gatewayId The source of the message
   * @param {Object} payload The message payload { type, data, sessionId }
   */
  async dispatch(gatewayId, payload) {
    const { type, data, sessionId } = payload;
    logger.info(`[Router] Dispatching ${type} from ${gatewayId} (Session: ${sessionId})`);

    // This will be expanded to a more complex pipeline:
    // Gateway -> Middleware (Auth/Session) -> Memory -> Agent/Router -> Provider/Tool -> Response
    
    try {
      const result = await this.handleRequest(payload);
      
      const gateway = this.gateways.get(gatewayId);
      if (gateway && gateway.send) {
        await gateway.send(result);
      }
      
      return result;
    } catch (error) {
      logger.error(`[Router] Dispatch error: ${error.message}`);
      throw error;
    }
  }

  async handleRequest(payload) {
    // Temporary implementation: route to core handlers
    // In the future, this will be handled by the Agent's reasoning loop
    const handler = this.handlers.get(payload.type);
    if (handler) {
      return await handler(payload);
    }
    
    return {
      type: 'error',
      data: { message: `No handler registered for type: ${payload.type}` }
    };
  }

  registerHandler(type, handler) {
    this.handlers.set(type, handler);
  }
}

export const router = new Router();
