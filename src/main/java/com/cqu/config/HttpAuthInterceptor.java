package com.cqu.config;

import com.cqu.utils.CurrentUser;
import com.cqu.utils.JwtProperties;
import com.cqu.utils.UserHolder;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;

/**
 * JWT 认证拦截器 —— 解析 token，将 userId / role / communityId 写入 UserHolder
 */
@Slf4j
@Component
public class HttpAuthInterceptor implements HandlerInterceptor {

    @Autowired
    private JwtProperties jwtProperties;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod)) {
            return true;
        }

        String token = request.getHeader("token");
        try {
            Claims claims = jwtProperties.parseJWT(token);
            Object userIdValue = claims.get("userId");
            if (!(userIdValue instanceof Number userIdNumber)) {
                writeUnauthorized(response);
                return false;
            }

            Long userId = userIdNumber.longValue();
            String role = claims.get("role", String.class);
            Long communityId = null;
            Object communityIdValue = claims.get("communityId");
            if (communityIdValue instanceof Number communityIdNumber) {
                communityId = communityIdNumber.longValue();
            }

            UserHolder.set(new CurrentUser(userId, role, communityId));
            return true;
        } catch (Exception e) {
            writeUnauthorized(response);
            return false;
        }
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        UserHolder.remove();
    }

    private void writeUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(401);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":401,\"errorMsg\":\"未登录或登录已过期\",\"data\":null}");
    }
}
