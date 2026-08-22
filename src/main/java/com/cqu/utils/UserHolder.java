package com.cqu.utils;

/**
 * 当前登录用户 ThreadLocal 持有器
 */
public class UserHolder {

    private static final ThreadLocal<CurrentUser> CURRENT = new ThreadLocal<>();

    public static void set(CurrentUser user) {
        CURRENT.set(user);
    }

    public static CurrentUser get() {
        return CURRENT.get();
    }

    public static Long getUserId() {
        CurrentUser user = CURRENT.get();
        return user == null ? null : user.userId();
    }

    public static String getRole() {
        CurrentUser user = CURRENT.get();
        return user == null ? null : user.role();
    }

    public static Long getCommunityId() {
        CurrentUser user = CURRENT.get();
        return user == null ? null : user.communityId();
    }

    public static void remove() {
        CURRENT.remove();
    }
}
