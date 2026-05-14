import sys
from agent_memory import PersistentAgentMemory


def main():
    mem = PersistentAgentMemory()
    print("--- 简易聊天示例，输入 exit 退出 ---")
    while True:
        user_input = input("You: ")
        if user_input.strip().lower() in {"exit", "quit"}:
            break
        # 将用户输入写入记忆
        mem.add_entry(role="user", content=user_input)
        # 构造带记忆的 prompt（这里仅展示，不调用真实 LLM）
        prompt = mem.build_prompt(user_input)
        # 假设 LLM 返回的答案是对 prompt 的简单回显
        assistant_reply = f"(mock reply) 我记得你说过: {user_input[:20]}..."
        print(f"Assistant: {assistant_reply}")
        mem.add_entry(role="assistant", content=assistant_reply)

    print("会话结束，记忆已持久化。")


if __name__ == "__main__":
    main()
