package ai.capitalgate.chat;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.util.Locale;

public final class MainActivity extends Activity {
    private WebView webView;
    private View loadingView;
    private View errorView;
    private Uri chatOrigin;
    private boolean mainFrameFailed;
    private OnBackInvokedCallback backInvokedCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        getWindow().setStatusBarColor(getColor(R.color.cg_forest));
        getWindow().setNavigationBarColor(getColor(R.color.cg_surface));
        applySystemBarInsets(findViewById(R.id.root_container));

        webView = findViewById(R.id.chat_web_view);
        loadingView = findViewById(R.id.loading_view);
        errorView = findViewById(R.id.error_view);
        Button retryButton = findViewById(R.id.retry_button);
        retryButton.setOnClickListener(view -> loadChat());

        chatOrigin = validatedChatOrigin(BuildConfig.CHAT_URL);
        configureWebView();
        configureBackNavigation();

        if (savedInstanceState == null) {
            loadChat();
        } else if (webView.restoreState(savedInstanceState) == null) {
            loadChat();
        }
    }

    private Uri validatedChatOrigin(String rawUrl) {
        Uri uri = Uri.parse(rawUrl == null ? "" : rawUrl.trim());
        String scheme = uri.getScheme();
        if (uri.getHost() == null || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
            return null;
        }
        return uri;
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarInsets(View root) {
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(
                        windowInsets.getSystemWindowInsetLeft(),
                        windowInsets.getSystemWindowInsetTop(),
                        windowInsets.getSystemWindowInsetRight(),
                        windowInsets.getSystemWindowInsetBottom()
                );
            }
            return windowInsets;
        });
        root.requestApplyInsets();
    }

    private void configureBackNavigation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backInvokedCallback = this::handleBackNavigation;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    backInvokedCallback
            );
        }
    }

    private void handleBackNavigation() {
        if (webView.canGoBack()) webView.goBack();
        else finishAfterTransition();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        settings.setUserAgentString(settings.getUserAgentString() + " CGChatAndroid/1.0");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameFailed = false;
                showLoading();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!mainFrameFailed) showChat();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    mainFrameFailed = true;
                    showError();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 400) {
                    mainFrameFailed = true;
                    showError();
                }
            }

        });
    }

    private boolean handleNavigation(Uri target) {
        String scheme = target.getScheme() == null ? "" : target.getScheme().toLowerCase(Locale.ROOT);
        if (("https".equals(scheme) || "http".equals(scheme)) && isChatOrigin(target)) {
            String path = target.getPath() == null ? "/" : target.getPath();
            return path.equals("/admin") || path.startsWith("/admin/");
        }

        if ("https".equals(scheme) || "http".equals(scheme) || "tel".equals(scheme)
                || "mailto".equals(scheme) || "whatsapp".equals(scheme)) {
            openExternal(target);
        }
        return true;
    }

    private boolean isChatOrigin(Uri target) {
        if (chatOrigin == null) return false;
        return equalsIgnoreCase(chatOrigin.getScheme(), target.getScheme())
                && equalsIgnoreCase(chatOrigin.getHost(), target.getHost())
                && effectivePort(chatOrigin) == effectivePort(target);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private boolean equalsIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private void openExternal(Uri target) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        } catch (ActivityNotFoundException ignored) {
            showError();
        }
    }

    private void loadChat() {
        if (chatOrigin == null) {
            showError();
            return;
        }
        showLoading();
        webView.loadUrl(chatOrigin.toString());
    }

    private void showLoading() {
        loadingView.setVisibility(View.VISIBLE);
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
    }

    private void showChat() {
        loadingView.setVisibility(View.GONE);
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private void showError() {
        loadingView.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        errorView.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        handleBackNavigation();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
        }
        webView.stopLoading();
        webView.setWebViewClient(null);
        webView.destroy();
        super.onDestroy();
    }
}
