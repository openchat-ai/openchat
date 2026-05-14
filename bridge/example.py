#!/usr/bin/env python3
"""Demo: Graceful degradation for LLM Bridge"""
from llm_bridge import LLMClient, create_simulated_llm

def main():
    # 创建正常LLM
    normal_llm = create_simulated_llm(fail_rate=0.0)
    client = LLMClient(normal_llm)
    print("=== Normal LLM ===")
    print(client.get_response("What is AI?"))
    print(client.get_response("What is AI?"))  # 缓存

    # 创建不稳定的LLM
    unstable_llm = create_simulated_llm(fail_rate=0.6)
    client2 = LLMClient(unstable_llm, fallback_response="[Fallback] LLM unavailable. Using cached data.")
    print("\n=== Unstable LLM ===")
    for _ in range(6):
        print(client2.get_response("Hello"))

if __name__ == "__main__":
    main()
