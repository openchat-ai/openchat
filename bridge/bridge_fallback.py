import os
import json
from typing import Any, Dict

class LLMClient:
    def __init__(self):
        # Detect LLM availability via environment variable or import test
        self.available = os.getenv('LLM_AVAILABLE', 'true').lower() == 'true'

    def generate(self, prompt: str) -> str:
        if self.available:
            # Placeholder for real LLM call
            return f"[LLM] response to: {prompt}"
        else:
            raise RuntimeError("LLM is not available")

def call_llm(prompt: str) -> str:
    client = LLMClient()
    try:
        return client.generate(prompt)
    except Exception as e:
        # Graceful degradation: fallback logic
        return fallback_response(prompt)

def fallback_response(prompt: str) -> str:
    """Simple deterministic fallback when LLM is unreachable.
    This keeps core functionality by providing a predictable response.
    """
    # Very naive heuristic: echo key terms
    lowered = prompt.lower()
    if 'bridge' in lowered:
        return "Fallback: Bridge related response"
    if 'fallback' in lowered:
        return "Fallback: Using deterministic logic"
    return f"Fallback: {prompt}"

def main() -> None:
    # Example usage
    user_input = "Explain bridge degradation when LLM is down"
    result = call_llm(user_input)
    print(result)

if __name__ == "__main__":
    main()
