import time
import logging
from functools import wraps
from typing import Optional, Callable, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CircuitBreaker:
    """断路器状态管理"""
    def __init__(self, failure_threshold: int = 3, recovery_timeout: float = 30.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0.0
        self.state = 'closed'  # closed, open, half-open

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = 'open'
            logger.warning("Circuit breaker opened")

    def record_success(self):
        self.failure_count = 0
        self.state = 'closed'
        logger.info("Circuit breaker closed")

    def allow_request(self) -> bool:
        if self.state == 'closed':
            return True
        if self.state == 'open':
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = 'half-open'
                logger.info("Circuit breaker half-open, trying request")
                return True
            return False
        # half-open: allow single request
        return True

class LLMClient:
    """LLM客户端，支持优雅降级：缓存、断路器、默认回复"""
    def __init__(self, llm_function: Callable, cache: Optional[dict] = None,
                 fallback_response: str = "I'm sorry, I cannot process your request right now.",
                 max_retries: int = 2, backoff_base: float = 1.0):
        self.llm_function = llm_function
        self.cache = cache if cache is not None else {}
        self.fallback_response = fallback_response
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.circuit_breaker = CircuitBreaker()

    def get_response(self, prompt: str) -> str:
        # 1. 检查缓存
        cache_key = prompt.strip().lower()
        if cache_key in self.cache:
            logger.info("Cache hit for prompt")
            return self.cache[cache_key]

        # 2. 检查断路器
        if not self.circuit_breaker.allow_request():
            logger.warning("Circuit breaker open, using fallback")
            return self.fallback_response

        # 3. 调用LLM，带重试
        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.llm_function(prompt)
                # 成功：更新断路器，写入缓存
                self.circuit_breaker.record_success()
                self.cache[cache_key] = response
                return response
            except Exception as e:
                logger.error(f"LLM call failed (attempt {attempt}): {e}")
                if attempt < self.max_retries:
                    sleep_time = self.backoff_base * (2 ** (attempt - 1))
                    time.sleep(sleep_time)
                else:
                    # 所有重试失败，记录断路器失败
                    self.circuit_breaker.record_failure()
                    # 尝试缓存（如果有之前的类似结果？这里简单返回fallback）
                    return self.fallback_response

        return self.fallback_response


def create_simulated_llm(fail_rate: float = 0.0, response_prefix: str = "LLM: "):
    """创建模拟LLM函数，可控制失败率"""
    import random
    def llm(prompt: str) -> str:
        if random.random() < fail_rate:
            raise ConnectionError("Simulated LLM failure")
        return response_prefix + prompt[::-1]  # 简单的返回反转字符串模拟
    return llm

# 示例使用
if __name__ == "__main__":
    # 构造一个失败率50%的模拟LLM
    simulated_llm = create_simulated_llm(fail_rate=0.5)
    client = LLMClient(simulated_llm, fallback_response="Fallback: Service unavailable.")

    print("\n--- Test 1: Normal requests ---")
    for i in range(5):
        resp = client.get_response(f"Hello {i}")
        print(f"Prompt: Hello {i} -> {resp}")

    print("\n--- Test 2: Cache check ---")
    resp = client.get_response("hello 0")  # 应该从缓存取
    print(f"Cached response: {resp}")

    print("\n--- Test 3: Force circuit breaker (high failure) ---")
    # 重置客户端并设置高失败率
    client2 = LLMClient(create_simulated_llm(fail_rate=1.0), fallback_response="Fallback active!")
    for i in range(5):
        resp = client2.get_response(f"Test {i}")
        print(f"Prompt: Test {i} -> {resp}")
