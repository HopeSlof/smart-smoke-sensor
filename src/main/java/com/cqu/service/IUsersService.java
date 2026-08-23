package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.Users;
import com.cqu.vo.LoginRequest;
import com.cqu.vo.LoginVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.RegisterRequest;
import com.cqu.vo.UserCreateRequest;
import com.cqu.vo.UserUpdateRequest;
import com.cqu.vo.UserVO;

/**
 * 用户服务
 */
public interface IUsersService extends IService<Users> {

    LoginVO register(RegisterRequest request);

    LoginVO login(LoginRequest request);

    PageResult<UserVO> pageUsers(int page, int pageSize, String role, Long communityId, String status);

    void createUser(UserCreateRequest request);

    void updateUser(Long id, UserUpdateRequest request);

    void updateStatus(Long id, String status);

    void resetPassword(Long id, String password);

    void auditUser(Long id, boolean approve);

    void deleteUser(Long id);
}
