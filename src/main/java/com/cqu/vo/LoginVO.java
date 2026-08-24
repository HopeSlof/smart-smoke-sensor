package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 登录/注册返回
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LoginVO {

    private String token;
    private String userId;
    private String username;
    private String role;
    private String realName;
    private String phone;
    private Long communityId;
    private String communityName;
    private String status;
}
