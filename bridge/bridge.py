import os
import json
from typing import Any, Dict

# Mock LLM call (replace with actual LLM integration)
def call_llm(prompt: str) -> Dict[str, Any]:
    # Simulate LLM availability
    if os.getenv("USE_LLM", "true").lower() == "false":
        raise RuntimeError("LLM not available")
    # Placeholder for real LLM response
    return {"response": "LLM result"}

# Fallback rule‑based function
def fallback_process(text: str) -> Dict[str, Any]:
    # Simple heuristic: count words
    words = text.split()
    return {"response": f"Fallback result ({len(words)} words)"}

class Bridge:
    def __init__(self):
        self.use_llm = os.getenv("USE_LLM", "true").lower() == "true"

    def generate(self, prompt: str) -> Dict[str, Any]:
        try:
            if self.use_llm:
                return call_llm(prompt)
            else:
                # LLM disabled, use fallback
                return fallback_process(prompt)
        except Exception as e:
            # If LLM fails, gracefully fall back
            print(f"LLM error: {e}, falling back to rule‑based")
            return fallback_process(prompt)

# Example usage
if __name__ == "__main__":
    bridge = Bridge()
    result = bridge.generate("Hello world")
    print(result)
