package io.github.najaemin92.jminvest;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class Keys {
    private static final String ALIAS = "jm-invest-kiwoom";

    private static SecretKey key(boolean create) throws Exception {
        var store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        var existing = store.getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        if (!create) throw new IllegalStateException();
        var generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUnlockedDeviceRequired(true)
                .build());
        return generator.generateKey();
    }

    static void save(SharedPreferences preferences, JSONObject keys) throws Exception {
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        var encrypted = cipher.doFinal(keys.toString().getBytes(StandardCharsets.UTF_8));
        if (!preferences.edit().putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("keys", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
            throw new IllegalStateException();
    }

    static JSONObject read(SharedPreferences preferences) throws Exception {
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false),
                new GCMParameterSpec(128, Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP)));
        var data = cipher.doFinal(Base64.decode(preferences.getString("keys", ""), Base64.NO_WRAP));
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }
}
