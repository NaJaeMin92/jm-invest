package io.github.najaemin92.jminvest;

import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;

final class Kiwoom {
    static JSONObject post(String path, String id, String token, JSONObject payload) throws Exception {
        var connection = (HttpsURLConnection) new URL("https://api.kiwoom.com" + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("api-id", id);
            if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (var output = connection.getOutputStream()) { output.write(body); }
            int status = connection.getResponseCode();
            var response = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            if (response == null) throw new IllegalStateException();
            JSONObject result;
            try (response) {
                result = new JSONObject(new String(response.readNBytes(1000000), StandardCharsets.UTF_8));
            }
            int code = result.optInt("return_code", Integer.MIN_VALUE);
            if (code != 0 && code != Integer.MIN_VALUE) throw new Rejected();
            if (status != 200 || code != 0) throw new IllegalStateException();
            return result;
        } finally {
            connection.disconnect();
        }
    }

    static String token(JSONObject keys) throws Exception {
        String token = post("/oauth2/token", "au10001", null, keys).optString("token");
        if (token.isEmpty()) throw new IllegalStateException();
        return token;
    }

    static String exchange(String symbol, String token) throws Exception {
        var rows = post("/api/us/stkinfo", "usa10098", token,
                new JSONObject().put("stk_cd", symbol)).getJSONArray("list");
        String exchange = null;
        for (int i = 0; i < rows.length(); i++) {
            var row = rows.getJSONObject(i);
            String market = row.optString("stex_tp");
            if (!symbol.equals(row.optString("stk_cd").trim()) || !market.matches("ND|NY|NA")) continue;
            if (exchange != null && !exchange.equals(market)) throw new IllegalArgumentException();
            exchange = market;
        }
        if (exchange == null) throw new IllegalArgumentException();
        return exchange;
    }

    static final class Rejected extends Exception {}
}
