/**
 * BaseGateway defines the interface for all input/output channels.
 */
export class BaseGateway {
  constructor(id, router) {
    this.id = id;
    this.router = router;
  }

  /**
   * Standardized sending method to push responses back to the user.
   */
  async send(payload) {
    throw new Error('Method send() must be implemented');
  }

  /**
   * Receives a message and dispatches it to the central router.
   */
  async receive(payload) {
    await this.router.dispatch(this.id, payload);
  }
}

/**
 * CLIGateway implements the local terminal interface.
 */
export class CLIGateway extends BaseGateway {
  constructor(id, router, stdOut) {
    super(id, router);
    this.stdOut = stdOut;
  }

  async send(payload) {
    if (payload.type === 'error') {
      this.stdOut.write(`\n[Error]: ${payload.data?.message || 'Unknown error'}\n`);
    } else if (payload.type === 'chat_response') {
      this.stdOut.write(`\nAgent: ${payload.data.content}\n`);
    } else {
      this.stdOut.write(`\n[Bridge]: ${JSON.stringify(payload.data, null, 2)}\n`);
    }
    this.stdOut.write('> ');
  }
}

/**
 * WSGateway implements the WebSocket interface for App/Web clients.
 */
export class WSGateway extends BaseGateway {
  constructor(id, router, wsClient) {
    super(id, router);
    this.wsClient = wsClient;
  }

  async send(payload) {
    if (this.wsClient && this.wsClient.readyState === 1) { // OPEN
      this.wsClient.send(JSON.stringify(payload));
    }
  }
}
