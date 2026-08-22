package com.cqu.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 注册认证拦截器与角色权限拦截器
 */
@Slf4j
@Component
public class WebMvcConfiguration implements WebMvcConfigurer {

    @Autowired
    private HttpAuthInterceptor httpAuthInterceptor;

    @Autowired
    private RoleInterceptor roleInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 硬件 HTTP 降级通道不校验 JWT（主通道为 MQTT，生产环境应改为设备密钥认证）
        registry.addInterceptor(httpAuthInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns("/users/register", "/users/login")
                .excludePathPatterns("/devices/heartbeat", "/devices/self-check")
                .excludePathPatterns("/smoke-readings/report");

        registry.addInterceptor(roleInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns("/users/register", "/users/login")
                .excludePathPatterns("/devices/heartbeat", "/devices/self-check")
                .excludePathPatterns("/smoke-readings/report");
    }
}
