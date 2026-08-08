# Spec / 设计规则（按需）
R1 ≤200 行/文件 · R2 >100 行 invariants · R3 新>50 行 .spec.md · R4 diff≤500 · R5 [C{N}] 检查点 · R6 一文件一责

Spec-First（新>50 / 重构>100 / 白名单接口）:
1 读现状 → 2 写 .spec.md(流/API/边界/清单/C点/不变量) → 3 按 spec 改 → 4 同提交
白名单: lmdn_codec, audio_pipeline, qiniu_client, sdui_config, chat_voice_recorder, room_screen, voice_room_screen
反模式: 先码后 spec · spec 空话 · 签名漂移
钩子: `scripts/verify-commit.mjs`
