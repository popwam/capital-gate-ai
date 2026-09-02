plugins {
    id("com.android.application")
}

fun asBuildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val configuredChatUrl = providers.gradleProperty("CHAT_URL").orNull?.trim()
val debugChatUrl = configuredChatUrl?.takeIf(String::isNotEmpty) ?: "http://10.0.2.2:3000"
val releaseChatUrl = configuredChatUrl?.takeIf(String::isNotEmpty) ?: ""

val validateReleaseChatUrl by tasks.registering {
    doLast {
        require(releaseChatUrl.startsWith("https://")) {
            "Release builds require -PCHAT_URL=https://your-production-chat.example"
        }
    }
}

android {
    namespace = "ai.capitalgate.chat"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.capitalgate.chat"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            buildConfigField("String", "CHAT_URL", asBuildConfigString(debugChatUrl))
        }
        release {
            buildConfigField("String", "CHAT_URL", asBuildConfigString(releaseChatUrl))
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

tasks.configureEach {
    if (name == "preReleaseBuild") dependsOn(validateReleaseChatUrl)
}
