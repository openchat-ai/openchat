import org.gradle.api.initialization.resolve.RepositoriesMode

pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  // PREFER_SETTINGS: tolerate user ~/.gradle/init.gradle mirrors (common in CN)
  repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "mobile-agent-android"
include(":app")