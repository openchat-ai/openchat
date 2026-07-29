# Project specific ProGuard rules.

# Keep coroutines (used reflectively by ServiceLoader)
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}

# Keep JSON serialization
-keepclassmembers class * {
    @org.json.JSONObject <fields>;
}
-keep class org.json.** { *; }

# Keep model data classes (serialized to JSON)
-keep class ai.openchat.mobile.agent.** { *; }

# Keep AndroidX lifecycle
-keep class androidx.lifecycle.** { *; }
