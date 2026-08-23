package com.cqu.config;

import com.cqu.entity.Users;
import com.cqu.mapper.UsersMapper;
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
 * JWT 认证拦截器 —— 解析 token，校验账号状态，并将 userId / role / communityId 写入 UserHolder。
 * <p>角色、所属小区、账号状态均从数据库实时读取，保证禁用/角色变更即时生效。</p>
 */
@Slf4j
@Component
public class HttpAuthInterceptor implements HandlerInterceptor {

    @Autowired
    private JwtProperties jwtProperties;

    @Autowired
    private UsersMapper usersMapper;

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
            // 从数据库实时读取账号，校验状态（禁用/待审核即时失效）
            Users user = usersMapper.selectById(userId);
            if (user == null) {
                writeUnauthorized(response);
                return false;
            }
            String status = user.getStatus() == null ? "ACTIVE" : user.getStatus();
            if ("DISABLED".equals(status) || "PENDING".equals(status)) {
                writeForbidden(response);
                return false;
            }

            String role = user.getRole();
            Long communityId = user.getCommunityId();
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

    private void writeForbidden(HttpServletResponse response) throws IOException {
        response.setStatus(403);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":403,\"errorMsg\":\"账号已禁用或待审核\",\"data\":null}");
    }
}
