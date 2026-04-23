# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

## 技术栈
<!-- 填写项目技术栈 -->

## 关键命令
<!-- 填写构建/测试/运行命令 -->

## 代码规范
<!-- 填写代码规范 -->

### 3.3 前端 (zipai_flutter)

```bash
cd zipai_flutter

# 安装依赖
flutter pub get

# 运行应用
flutter run -d chrome     # Web
flutter run -d windows    # Windows
flutter run -d ios        # iOS

# 代码分析
flutter analyze

# 运行全部测试
flutter test

# 按类别运行
flutter test test/deck_test.dart test/player_test.dart test/hu_detector*.dart
flutter test test/hu_scorer*.dart test/game_core*.dart

# 运行单个测试
flutter test test/hu_detector_test.dart
flutter test test/game_core_advanced_test.dart
```

### 3.4 Android APK 构建（重要！）

> **网络受限时（国内常见）**：禁止直接使用 `flutter build apk`，会因 Gradle Wrapper 联网超时而死循环！
> **正确做法**：先 `flutter build bundle`，再使用本地 Gradle 绝对路径打包。详见 [BUILD.md](BUILD.md)

```bash
cd zipai_flutter

# 方式一：网络正常时
flutter pub get
flutter build apk --debug

# 方式二：网络受限时的离线构建 SOP
flutter pub get
flutter build bundle

# 使用本地 Gradle 绕过 Wrapper（关键步骤）
& "C:\Gradle\gradle-8.14.3\bin\gradle.bat" -p android assembleDebug --no-daemon
```
