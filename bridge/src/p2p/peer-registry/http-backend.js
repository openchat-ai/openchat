/**
 * HttpBackend — 通过 HTTP GET /peers 发现其他公网 Bridge 节点
 *
 * 适用场景：
 *  - 公网 Bridge 暴露 /peers 端点
 *  - 内网 Bridge 通过配置的 cores URL 列表拉取在线节点
 *
 * publish / unpublish → NOOP
 * 因为 HTTP peer 自己是公网节点，无需写回其他人。
 */

class HttpBackend {
  /**
   * @param {string[]} urls  /peers 端点 URL 列表
   */
  constructor(urls) {
    this.urls = urls;
  }

  /**
   * 依次请求各 URL，第一个返回成功的数据即返回
   */
  async discover() {
    for (const url of this.urls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const body = await resp.json();
          // 兼容数组和 {peers: [...]} 两种格式
          const list = Array.isArray(body) ? body : (body.peers || []);
          if (list.length > 0) return list;
        }
      } catch (e) {
        // 单个 URL 失败，继续下一个
      }
    }
    return [];
  }

  /**
   * HTTP 注册是 NOOP — 存在即注册
   */
  async publish(peerId, info) {
    // 无需操作
  }

  /**
   * HTTP 注销是 NOOP
   */
  async unpublish(peerId) {
    // 无需操作
  }
}

export default HttpBackend;
export { HttpBackend };
