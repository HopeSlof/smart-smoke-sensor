package com.cqu.utils;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;

/**
 * JWT 工具：创建 / 解析 Token
 */
@Component
public class JwtProperties {

    @Value("${jwt.secret-key}")
    private String jwtSecretKey;

    /** Token 有效期：15 小时 */
    private static final long ACCESS_EXPIRATION_TIME = 15 * 60 * 60 * 1000L;

    public String createAccessToken(Map<String, Object> claims) {
        SecretKeySpec secretKeySpec = new SecretKeySpec(jwtSecretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        return Jwts.builder()
                .setClaims(claims)
                .setExpiration(new Date(System.currentTimeMillis() + ACCESS_EXPIRATION_TIME))
                .signWith(secretKeySpec)
                .compact();
    }

    public Claims parseJWT(String token) {
        SecretKeySpec secretKeySpec = new SecretKeySpec(jwtSecretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        return Jwts.parserBuilder()
                .setSigningKey(secretKeySpec)
                .build()
                .parseClaimsJws(token)
                .getBody();
    }
}
