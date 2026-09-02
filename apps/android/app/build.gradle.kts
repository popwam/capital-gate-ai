plugins {
    id("com.android.application")
}

fun asBuildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val configuredChatUrl = providers.gradleProperty("CHAT_URL")
    .orElse("http://10.0.2.2:3000")
    .get()

android {
    namespace = "ai.capitalgate.chat"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.capitalgate.chat"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "CHAT_URL", asBuildConfigString(configuredChatUrl))
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
