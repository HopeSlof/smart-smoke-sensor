package com.cqu.config;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.utils.CurrentUser;
import com.cqu.utils.UserHolder;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;

/**
 * 方法级角色权限拦截器（配合 @RequireRole 注解）
 */
@Slf4j
@Component
public class RoleInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }

        RequireRole requireRole = handlerMethod.getMethodAnnotation(RequireRole.class);
        if (requireRole == null) {
            return true;
        }

        CurrentUser user = UserHolder.get();
        if (user == null || user.role() == null) {
            writeForbidden(response);
            return false;
        }

        for (Role role : requireRole.value()) {
            if (role.name().equals(user.role())) {
                return true;
            }
        }

        log.warn("权限不足: userId={}, role={}, 需要角色={}", user.userId(), user.role(), requireRole.value());
        writeForbidden(response);
        return false;
    }

    private void writeForbidden(HttpServletResponse response) throws IOException {
        response.setStatus(403);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":403,\"errorMsg\":\"无权限访问\",\"data\":null}");
    }
}
