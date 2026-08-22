package com.cqu.common.annotation;

import com.cqu.common.enums.Role;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 方法级角色权限校验注解
 * <p>标注在 Controller 方法上，由 RoleInterceptor 校验当前用户角色是否命中。</p>
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireRole {

    /** 允许访问的角色集合 */
    Role[] value();
}
