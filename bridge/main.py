from bridge_llm import EnhancedMessageProcessor

def main():
    # Test with LLM unavailable (no API key)
    processor = EnhancedMessageProcessor()
    print("=== Testing without LLM ===")
    print(processor.process("hello world"))
    print(processor.process("help me"))
    print(processor.process("unknown command"))
    
    # Test switching to LLM
    print("\n=== Switching to LLM ===")
    success = processor.switch_to_llm("test-api-key")
    print(f"Switch successful: {success}")
    print(processor.process("hello world"))

if __name__ == "__main__":
    main()