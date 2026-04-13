import { EventEmitter } from 'events';

export const MESSAGE_TYPES = {
  REQUEST: 'agent:request',
  RESPONSE: 'agent:response',
  BROADCAST: 'agent:broadcast',
  DELEGATE: 'agent:delegate',
  RESULT: 'agent:result',
  HEARTBEAT: 'agent:heartbeat',
  TERMINATE: 'agent:terminate'
};

export class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  subscribe(topic, handler) {
    this.on(topic, handler);
    return () => this.off(topic, handler);
  }

  publish(topic, message) {
    this.emit(topic, message);
  }

  sendTo(fromAgentId, toAgentId, message) {
    this.emit(`agent:${toAgentId}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.REQUEST,
      from: fromAgentId,
      to: toAgentId,
      content: message,
      timestamp: Date.now()
    });
  }

  broadcast(fromAgentId, message) {
    this.emit(`agent:broadcast:${fromAgentId}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.BROADCAST,
      from: fromAgentId,
      to: '*',
      content: message,
      timestamp: Date.now()
    });
  }

  reply(originalMessage, content) {
    this.emit(`agent:${originalMessage.from}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.RESPONSE,
      from: originalMessage.to,
      to: originalMessage.from,
      content,
      timestamp: Date.now(),
      replyTo: originalMessage.id
    });
  }

  delegate(fromAgentId, toAgentId, task) {
    this.emit(`agent:${toAgentId}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.DELEGATE,
      from: fromAgentId,
      to: toAgentId,
      content: task,
      timestamp: Date.now()
    });
  }
}

export const messageBus = new MessageBus();
export default messageBus;