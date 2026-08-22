package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.Users;
import com.cqu.vo.LoginRequest;
import com.cqu.vo.LoginVO;
import com.cqu.vo.RegisterRequest;

/**
 * 用户服务
 */
public interface IUsersService extends IService<Users> {

    LoginVO register(RegisterRequest request);

    LoginVO login(LoginRequest request);
}
