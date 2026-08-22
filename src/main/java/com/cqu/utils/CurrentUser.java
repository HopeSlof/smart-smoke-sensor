package com.cqu.utils;

/**
 * 当前登录用户上下文（从 JWT 解析后写入 ThreadLocal）
 */
public record CurrentUser(Long userId, String role, Long communityId) {
}
