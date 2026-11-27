package io.github.najaemin92.jminvest;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.*;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class TradeActivity extends Activity {
    // Serialize all order attempts across activity recreation.
    private static final java.util.concurrent.ExecutorService broker = Executors.newSingleThreadExecutor();
    private android.content.SharedPreferences preferences;
    private EditText key, secret, symbol, quantity, price;
    private TextView status;
    private boolean busy;
    private static volatile boolean submitting;
    private CancellationSignal authentication;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        preferences = getSharedPreferences("broker", MODE_PRIVATE);
        var root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 32, 24, 24);
        var scroll = new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        scroll.addView(root);
        setContentView(scroll);
        status = new TextView(this);
        status.setText(preferences.contains("keys") ? "키움 계좌 연결됨" : "본인의 키움 계좌를 연결하세요.");
        root.addView(status);
        key = field(root, "App Key", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        secret = field(root, "App Secret", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        button(root, "계좌 연결", this::connect);
        symbol = field(root, "미국주식 티커", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        quantity = field(root, "수량 (주)", InputType.TYPE_CLASS_NUMBER);
        price = field(root, "USD 지정가", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        button(root, "매수 확인", () -> review(true));
        button(root, "매도 확인", () -> review(false));
        if (preferences.contains("unresolved")) showUnresolved();
    }

    private EditText field(LinearLayout parent, String hint, int type) {
        var field = new EditText(this);
        field.setHint(hint);
        field.setInputType(type);
        field.setSaveEnabled(false);
        parent.addView(field);
        return field;
    }

    private void button(LinearLayout parent, String title, Runnable action) {
        var button = new Button(this);
        button.setText(title);
        button.setOnClickListener(v -> { if (!busy) action.run(); });
        parent.addView(button);
    }

    private String text(EditText field) { return field.getText().toString().trim(); }

    private void finishWork(String message) {
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            busy = false;
            status.setText(message);
        });
    }

    private void connect() {
        String appKey = text(key), appSecret = text(secret);
        if (preferences.contains("unresolved")) { showUnresolved(); return; }
        if (appKey.isEmpty() || appSecret.isEmpty()) { status.setText("본인의 App Key와 App Secret을 입력하세요."); return; }
        if (!getSystemService(KeyguardManager.class).isDeviceSecure()) {
            status.setText("Android 화면 잠금을 설정하세요.");
            return;
        }
        busy = true;
        key.setText("");
        secret.setText("");
        broker.execute(() -> {
            try {
                var keys = new JSONObject().put("grant_type", "client_credentials")
                    .put("appkey", appKey).put("secretkey", appSecret);
                Kiwoom.token(keys);
                Keys.save(preferences, keys);
                finishWork("키움 계좌 연결됨");
            } catch (Exception e) { finishWork("연결 실패 · 키움 API 키와 등록 IP를 확인하세요."); }
        });
    }

    private void review(boolean buy) {
        if (preferences.contains("unresolved")) { showUnresolved(); return; }
        if (!preferences.contains("keys")) { status.setText("먼저 계좌를 연결하세요."); return; }
        String ticker = text(symbol).toUpperCase(Locale.ROOT), units = text(quantity), limit = text(price);
        if (!ticker.matches("[A-Z][A-Z0-9.-]{0,11}") || !units.matches("[1-9][0-9]{0,8}")
                || !limit.matches("[0-9]{1,7}(\\.[0-9]{1,4})?")) {
            status.setText("종목·수량·지정가를 확인하세요.");
            return;
        }
        var amount = new BigDecimal(limit);
        if (amount.signum() <= 0 || amount.scale() > (amount.compareTo(BigDecimal.ONE) >= 0 ? 2 : 4)) {
            status.setText("지정가는 $1 이상 소수점 2자리, $1 미만 4자리까지 입력하세요.");
            return;
        }
        busy = true;
        broker.execute(() -> {
            try {
                String token = Kiwoom.token(Keys.read(preferences));
                String exchange = Kiwoom.exchange(ticker, token);
                String details = ticker + " · " + exchange + "\n" + units + "주 × $" + limit;
                var order = new JSONObject().put("stk_cd", ticker).put("stex_tp", exchange)
                    .put("ord_qty", units).put("ord_uv", limit).put("trde_tp", "00");
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing()) return;
                    new AlertDialog.Builder(this).setTitle(buy ? "실계좌 매수 확인" : "실계좌 매도 확인")
                        .setMessage(details)
                        .setNegativeButton("취소", (d, w) -> busy = false)
                        .setOnCancelListener(d -> busy = false)
                        .setPositiveButton("기기 인증 후 주문", (d, w) -> authenticate(buy, details, token, order))
                        .show();
                });
            } catch (Exception e) { finishWork("계좌 연결 또는 미국주식 종목을 확인하세요."); }
        });
    }

    private void authenticate(boolean buy, String details, String token, JSONObject order) {
        int methods = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        if (getSystemService(BiometricManager.class).canAuthenticate(methods) != BiometricManager.BIOMETRIC_SUCCESS) {
            finishWork("기기 잠금 인증을 설정하세요.");
            return;
        }
        authentication = new CancellationSignal();
        new BiometricPrompt.Builder(this).setTitle(buy ? "매수 주문 인증" : "매도 주문 인증")
            .setSubtitle(details.replace('\n', ' ')).setAllowedAuthenticators(methods).build()
            .authenticate(authentication, getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (!isFinishing() && !isDestroyed()) {
                        broker.execute(() -> submit(buy, details, token, order));
                    } else finishWork("주문 화면을 다시 열고 확인하세요.");
                }
                @Override public void onAuthenticationError(int code, CharSequence message) {
                    finishWork("기기 인증이 완료되지 않았습니다.");
                }
            });
    }

    private void submit(boolean buy, String details, String token, JSONObject order) {
        submitting = true;
        if (preferences.contains("unresolved") ||
                !preferences.edit().putString("unresolved", (buy ? "매수 " : "매도 ") + details).commit()) {
            submitting = false;
            finishWork("미확인 주문 또는 기기 저장 상태를 확인하세요.");
            return;
        }
        try {
            String number = Kiwoom.post("/api/us/ordr", buy ? "ust20000" : "ust20001", token, order)
                .optString("ord_no").trim();
            if (!number.matches("[0-9]+") || number.matches("0+")) throw new IllegalStateException();
            preferences.edit().remove("unresolved").commit();
            finishWork("키움 접수 · 주문번호 " + number);
        } catch (Kiwoom.Rejected rejected) {
            preferences.edit().remove("unresolved").commit();
            finishWork("키움이 주문을 거절했습니다.");
        } catch (Exception e) { finishWork("접수 결과 미확인 · 키움 주문내역을 확인하세요."); }
        finally { submitting = false; }
    }

    private void showUnresolved() {
        if (submitting) { status.setText("키움 주문 접수 확인 중"); return; }
        new AlertDialog.Builder(this).setTitle("접수 결과 미확인")
            .setMessage(preferences.getString("unresolved", "") + "\n키움 주문내역에서 접수 상태를 먼저 확인하세요.")
            .setNegativeButton("닫기", null)
            .setPositiveButton("키움에서 확인했음", (d, w) -> { if (!submitting) preferences.edit().remove("unresolved").commit(); })
            .show();
    }

    @Override protected void onDestroy() {
        if (authentication != null) authentication.cancel();
        super.onDestroy();
    }
}
