package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 注册请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RegisterRequest {

    private String username;
    private String password;
    /** 角色: RESIDENT / COMMUNITY_ADMIN / SYSTEM_ADMIN / FIREFIGHTER */
    private String role;
    /** 归属小区 */
    private Long communityId;
}
