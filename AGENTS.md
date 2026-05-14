# 项目开发指南

> **最后更新**: 2026-04-30
> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

## 铁律

- **手机聊天 = plan 模式**：通过手机和我聊天的，一律用 plan 模式（纯设计讨论，不写代码、不改文件、不跑命令）
- **禁止杀死无关 node 进程**：不要用 `taskkill /F /IM node.exe` 清理所有进程，会误杀无关的 node 进程（如 opencode、npm 等）

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
cd openchat-flutter

# 方式一：网络正常时
flutter pub get
flutter build apk --debug

# 方式二：网络受限时的离线构建 SOP
flutter pub get
flutter build bundle

# 使用本地 Gradle 绕过 Wrapper（关键步骤）
& "C:\Gradle\gradle-8.14.3\bin\gradle.bat" -p android assembleDebug
```

#### 优化配置（加速编译）

编辑 `android/gradle.properties`：

```properties
org.gradle.jvmargs=-Xmx4G -XX:MaxMetaspaceSize=1G -XX:+HeapDumpOnOutOfMemoryError -Dkotlin.compiler.execution.strategy=in-process
android.useAndroidX=true
kotlin.daemon.enabled=false
org.gradle.daemon=true
org.gradle.parallel=true
android.suppressUnsupportedCompileSdk=36
```

**关键优化点：**
| 配置 | 作用 |
|------|------|
| `org.gradle.daemon=true` | 复用 Gradle 进程，后续编译快 50%+ |
| `org.gradle.parallel=true` | 并行编译多个模块 |
| `kotlin.daemon.enabled=false` | 禁用 Kotlin daemon（避免跨驱动器缓存问题） |
| `-Dkotlin.compiler.execution.strategy=in-process` | Kotlin 编译器在进程内运行，避免 daemon 缓存错误 |

**编译时间参考：**
- 首次全新编译：~15 分钟
- 后续增量编译：2-5 分钟

**如遇 Kotlin daemon 缓存错误：**
```bash
# 1. 停止所有 Gradle/Kotlin 进程
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" --stop
taskkill /F /IM kotlin-daemon.exe 2>/dev/null

# 2. 清理缓存
cd openchat-flutter
rm -rf build android/.gradle

# 3. 重新编译
cd android
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" assembleDebug
```

**APK 输出位置：**
```
openchat-flutter/build/app/outputs/flutter-apk/app-debug.apk
```

> 提示：首次编译后，gradle 守护进程会保持运行，后续修改代码可直接重新执行构建命令，增量编译会自动进行。

---

### 经验教训总结（多次重启的代价）

#### ❌ 教训1：不要用 `--no-daemon`
```bash
# 错误 - 每次都重启 Gradle，慢！
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" -p android assembleDebug --no-daemon

# 正确 - 复用守护进程
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" -p android assembleDebug
```

#### ❌ 教训2：splits.abi 与插件冲突
尝试只编译 arm64 时报错：
```
Conflicting configuration : 'armeabi-v7a,arm64-v8a,x86_64' in ndk abiFilters cannot be present when splits abi filters are set
```
Flutter 插件的 NDK 配置会与 splits 冲突，**不要在 build.gradle.kts 中添加 splits 配置**。

#### ❌ 教训3：Kotlin daemon 跨驱动器缓存问题
错误信息：
```
Could not close incremental caches in F:\openchat\openchat-flutter\build\xxx\kotlin\...
this and base files have different roots: C:\Users\Administrator\AppData\Local\Pub\Cache\... and F:\openchat\...
```
**解决方案：** 必须同时禁用 daemon 并使用 in-process 模式：
```properties
kotlin.daemon.enabled=false
-Dkotlin.compiler.execution.strategy=in-process
```

#### ❌ 教训4：Kotlin daemon 进程需要手动杀死
仅停止 Gradle daemon 不够：
```bash
# 必须同时杀死 Kotlin daemon
taskkill /F /IM kotlin-daemon.exe
taskkill /F /IM kotlinc.exe
```

#### ✅ 教训5：清理后直接编译比增量更稳
```bash
# 遇到连续失败时，先 clean 再 build
cd openchat-flutter/android
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" clean
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" assembleDebug
```

#### ✅ 教训6：flutter build bundle 是可选的
对于国内网络，直接用 Gradle 也能跑通，不一定要先 flutter build bundle。

#### ✅ 教训7：Gradle daemon 会记住旧配置
修改 gradle.properties 后需要完全停止 daemon：
```bash
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" --stop
# 然后再启动编译
```

#### ✅ 教训8：Windows 上 Gradle daemon 可能有 30+ 个
`Starting a Gradle Daemon, 35 busy Daemons could not be reused` 说明有很多旧的 daemon 进程，用 `--stop` 只能停止 1 个。需要多次执行或配合 `taskkill`。

#### ✅ 教训9：首次编译的正常表现
- 下载 Flutter 依赖（可能很慢）
- 编译 native 代码（jni、flutter_webrtc 等）- 最慢阶段
- Kotlin 编译插件代码

这些都是正常的，首次编译 15 分钟是正常的。

#### ✅ 教训10：build 目录可以放 SSD 上
如果编译在机械硬盘上太慢，可以把 `openchat-flutter/build` 整个目录复制到 SSD，然后在原位置创建 junction：
```cmd
mklink /J F:\openchat\openchat-flutter\build F:\ssd\openchat-build
```

#### ✅ 教训11：Gradle 8.14 版本的已知行为
- 37 个 stopped Daemons 无法复用是正常的（内存中的进程已死）
- `--status` 可以查看 daemon 状态

#### ✅ 教训12：Flutter 镜像源
中国区会自动使用 `https://storage.flutter-io.cn`，这是正常的。

#### ✅ 教训13：错误的日志颜色
Gradle 的警告和错误日志不一定是红色的，看 `e:` 开头的才是错误。

#### ✅ 教训14：编译成功后 APK 在哪里
- `app-debug.apk` - 通用 debug 版
- 如果用了 `splits.abi`（不推荐），会生成 `app-arm64-v8a-debug.apk` 等

#### ✅ 教训15：系统重启后 gradle.properties 会恢复
用户反馈 "重启了一下，再开始，它把你改的配置给恢复了"。这是因为：
- Flutter 项目创建时会在 `android/gradle.properties` 中写入默认值
- 某些清理操作会重置为默认值
- **解决：** 修改后立即测试，确保配置生效后再做其他操作

#### ✅ 教训16：Gradle 8.14 的 daemon 复用问题
`36 busy Daemons could not be reused` 每次都出现，但不影响使用。
实际复用的是当前运行的那个 daemon，不是之前那些"忙碌"的。

#### ✅ 教训17：编译时电脑会被占用
- Gradle 会占用大量 CPU 编译 native 代码
- 内存会占用 2-4GB
- 建议：编译时不要做其他 heavy 操作

#### ✅ 教训18：路径格式
- Windows 上 Gradle 路径用反斜杠或正斜杠都可以
- 命令行中用双引号包裹路径，避免空格问题
- 推荐使用绝对路径，如 `"C:\Gradle\gradle-8.14.3\bin\gradle.bat"`

#### ✅ 教训19：Kotlin 编译失败的错误日志特点
- 错误信息开头是 `e:` 而不是 "ERROR"
- stack trace 会很长，但真正的问题在前面
- `Daemon compilation failed: null` 是 daemon 问题的典型表现

---

**总结：最佳实践流程**
```bash
# 1. 确保 gradle.properties 配置正确（见上文）
# 2. 停止所有旧 daemon
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" --stop

# 3. 清理缓存（如有问题）
cd openchat-flutter
rm -rf build android/.gradle

# 4. 编译
cd android
"C:\Gradle\gradle-8.14.3\bin\gradle.bat" assembleDebug
```
