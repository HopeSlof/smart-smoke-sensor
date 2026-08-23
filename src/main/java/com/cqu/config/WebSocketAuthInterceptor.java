package com.cqu.config;

import com.cqu.utils.JwtProperties;
import io.jsonwebtoken.Claims;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

/**
 * WebSocket 握手阶段 JWT 校验（连接时携带 ?token=xxx）
 */
@Slf4j
@Component
public class WebSocketAuthInterceptor implements HandshakeInterceptor {

    @Autowired
    private JwtProperties jwtProperties;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        String query = request.getURI().getQuery();
        if (query == null || !query.contains("token=")) {
            log.warn("WebSocket 握手失败：缺少 token 参数");
            return false;
        }

        String token = extractToken(query);
        if (token == null || token.isEmpty()) {
            log.warn("WebSocket 握手失败：token 为空");
            return false;
        }

        try {
            Claims claims = jwtProperties.parseJWT(token);
            Object userIdValue = claims.get("userId");
            if (userIdValue instanceof Number userIdNumber) {
                String role = claims.get("role", String.class);
                Long communityId = null;
                Object communityIdValue = claims.get("communityId");
                if (communityIdValue instanceof Number communityIdNumber) {
                    communityId = communityIdNumber.longValue();
                }
                attributes.put("userId", userIdNumber.longValue());
                attributes.put("role", role);
                attributes.put("communityId", communityId);
                return true;
            }
        } catch (Exception e) {
            log.warn("WebSocket 握手失败：token 校验异常 - {}", e.getMessage());
        }
        return false;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }

    private String extractToken(String query) {
        String[] params = query.split("&");
        for (String param : params) {
            if (param.startsWith("token=")) {
                return param.substring("token=".length());
            }
        }
        return null;
    }
}
