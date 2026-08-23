package com.cqu.utils;

import com.cqu.common.enums.Role;

/**
 * 数据权限解析：根据当前登录用户角色返回数据范围。
 * <p>
 * - SYSTEM_ADMIN：all = true，查全量。
 * - FIREFIGHTER：communityId 为 null，告警类查询不按小区过滤（全量），其余资源由 @RequireRole 限制。
 * - RESIDENT / COMMUNITY_ADMIN：按 communityId 过滤。
 * </p>
 */
public class DataScope {

    public record Scope(boolean all, Long communityId) {
    }

    public static Scope resolve() {
        String role = UserHolder.getRole();
        if (role == null) {
            return new Scope(false, null);
        }
        if (Role.SYSTEM_ADMIN.name().equals(role)) {
            return new Scope(true, null);
        }
        return new Scope(false, UserHolder.getCommunityId());
    }
}
