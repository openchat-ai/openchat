// Research by 小红: 如何用观察者模式实现 Bridge 内部的松耦合通信？
// Generated: 2026-05-13T03:49:05.753Z

// ========================================================
//  observer_bridge_demo.js
//  使用观察者模式实现 Bridge 内部的松耦合通信
//  运行方式：node observer_bridge_demo.js
// ========================================================

// 1. 定义观察者（Observer）需要实现的接口
class Observer {
  // 每个观察者必须实现 update 方法
  update(event, payload) {
    throw new Error('update(event, payload) must be implemented');
  }
}

// 2. Bridge（桥梁） —— 被观察者（Subject）
class Bridge {
  constructor() {
    // 保存所有已订阅的观察者，按事件名分组
    this._observers = {}; // { eventName: [observer1, observer2, ...] }
  }

  // 订阅单个事件
  subscribe(event, observer) {
    if (!(observer instanceof Observer)) {
      throw new TypeError('Only Observer instances can subscribe');
    }
    if (!this._observers[event]) {
      this._observers[event] = [];
    }
    this._observers[event].push(observer);
    console.log(`[Bridge] ${observer.constructor.name} subscribed to event "${event}"`);
  }

  // 退出订阅
  unsubscribe(event, observer) {
    if (!this._observers[event]) return;
    const idx = this._observers[event].indexOf(observer);
    if (idx !== -1) {
      this._observers[event].splice(idx, 1);
      console.log(`[Bridge] ${observer.constructor.name} unsubscribed from event "${event}"`);
    }
  }

  // 发布事件（内部调用）
  _publish(event, payload) {
    const listeners = this._observers[event] || [];
    listeners.forEach(obs => {
      try {
        obs.update(event, payload);
      } catch (e) {
        console.error(`[Bridge] Error in observer "${obs.constructor.name}" for event "${event}":`, e);
      }
    });
  }

  // 对外提供的发布入口（示例中用于演示）
  trigger(event, payload) {
    console.log(`[Bridge] Triggering event "${event}" with payload:`, payload);
    this._publish(event, payload);
  }
}

// --------------------------------------------------------
// 3. 示例业务模块（Observer 实现）
// --------------------------------------------------------

// 3.1 支付处理器（不需要了解 NotificationService 的实现细节）
class PaymentProcessor extends Observer {
  constructor(bridge) {
    super();
    this.bridge = bridge;
    // 这里订阅我们感兴趣的事件
    this.bridge.subscribe('orderCreated', this);
    this.bridge.subscribe('paymentSucceeded', this);
  }

  update(event, payload) {
    if (event === 'orderCreated') {
      console.log('[PaymentProcessor] 收到新订单，准备进入支付流程。');
      // 假装立刻发起支付
      setTimeout(() => this._processPayment(payload), 100);
    } else if (event === 'paymentSucceeded') {
      console.log('[PaymentProcessor] 支付成功，可继续后续业务。');
    }
  }

  _processPayment(order) {
    console.log(`[PaymentProcessor] 正在处理订单 ${order.id} 的支付...`);
    // 模拟支付成功后发送事件
    setTimeout(() => {
      this.bridge.trigger('paymentSucceeded', { orderId: order.id, amount: order.amount });
    }, 500);
  }
}

// 3.2 通知服务（负责发送邮件/短信等）
class NotificationService extends Observer {
  constructor(bridge) {
    super();
    this.bridge = bridge;
    this.bridge.subscribe('paymentSucceeded', this);
    this.bridge.subscribe('orderCreated', this);
  }

  update(event, payload) {
    if (event === 'orderCreated') {
      console.log(`[NotificationService] 检测到新订单 ${payload.id}，准备发送确认邮件。`);
      // 模拟发送确认邮件的延迟
      setTimeout(() => this._sendConfirmation(payload), 300);
    } else if (event === 'paymentSucceeded') {
      console.log(`[NotificationService] 检测到支付成功，准备发送成功通知。`);
      setTimeout(() => this._sendSuccessNotice(payload), 200);
    }
  }

  _sendConfirmation(order) {
    console.log(`[NotificationService] 已发送订单确认邮件给用户（订单号: ${order.id}）`);
  }

  _sendSuccessNotice(info) {
    console.log(`[NotificationService] 已发送支付成功通知（订单号: ${info.orderId}，金额: ${info.amount}）`);
  }
}

// --------------------------------------------------------
// 4. 组装演示// --------------------------------------------------------
const bridge = new Bridge();

// 创建业务组件
const paymentProcessor = new PaymentProcessor(bridge);
const notificationService = new NotificationService(bridge);

// 演示：模拟一个新订单的到来
const fakeOrder = { id: 'ORD-2025-001', amount: 199.99 };
console.log(`[Demo] 模拟创建订单 ${fakeOrder.id}（金额 ${fakeOrder.amount}）`);
bridge.trigger('orderCreated', fakeOrder);

// 运行结束后，打印松耦合性分析
setTimeout(() => {
  console.log('\n=== 松耦合性分析 ===');
  console.log('• Bridge 只知道“谁”订阅了事件，而不关心“他们”如何实现。');
  console.log('• 业务模块只关心自己感兴趣的事件，可随时添加或移除订阅。');
  console.log('• 通过事件驱动的方式，业务之间可以自由扩展、替换或重用。');
}, 1000);