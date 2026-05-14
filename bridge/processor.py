from abc import ABC, abstractmethod
import os
import time
import requests

class BridgeProcessor(ABC):
    @abstractmethod
    def process(self, input_text: str) -> str:
        pass

class LLMProcessor(BridgeProcessor):
    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {api_key}"})
        
    def process(self, input_text: str) -> str:
        try:
            response = self.session.post(
                self.api_url,
                json={"prompt": input_text, "max_tokens": 150},
                timeout=5
            )
            response.raise_for_status()
            return response.json()["choices"][0]["text"]
        except Exception as e:
            raise ConnectionError(f"LLM service unavailable: {str(e)}")

class FallbackProcessor(BridgeProcessor):
    def process(self, input_text: str) -> str:
        # 规则引擎实现核心功能
        if "hello" in input_text.lower():
            return "Hello! How can I help you?"
        elif "error" in input_text.lower():
            return "Error handling via fallback rules"
        else:
            return f"Processed via fallback: {input_text[:50]}"

def check_llm_health(api_url: str, api_key: str) -> bool:
    try:
        response = requests.get(
            f"{api_url}/health",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=3
        )
        return response.status_code == 200
    except:
        return False

def get_processor(api_url: str = None, api_key: str = None) -> BridgeProcessor:
    if api_url and api_key and check_llm_health(api_url, api_key):
        return LLMProcessor(api_url, api_key)
    return FallbackProcessor()

if __name__ == "__main__":
    # 示例使用
    llm_url = os.getenv("LLM_URL")
    llm_key = os.getenv("LLM_KEY")
    
    processor = get_processor(llm_url, llm_key)
    
    test_inputs = [
        "Hello, how are you?",
        "This is a test error case",
        "Complex request requiring LLM"
    ]
    
    for inp in test_inputs:
        print(f"Input: {inp}")
        try:
            result = processor.process(inp)
            print(f"Output: {result}\n")
        except Exception as e:
            print(f"Error: {str(e)}\n")