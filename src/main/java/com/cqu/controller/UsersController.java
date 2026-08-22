package com.cqu.controller;

import com.cqu.service.IUsersService;
import com.cqu.vo.LoginRequest;
import com.cqu.vo.LoginVO;
import com.cqu.vo.RegisterRequest;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用户注册 / 登录
 */
@RestController
@RequestMapping("/users")
public class UsersController {

    @Autowired
    private IUsersService usersService;

    @PostMapping("/register")
    public Result<LoginVO> register(@RequestBody RegisterRequest request) {
        return Result.success(usersService.register(request));
    }

    @PostMapping("/login")
    public Result<LoginVO> login(@RequestBody LoginRequest request) {
        return Result.success(usersService.login(request));
    }
}
