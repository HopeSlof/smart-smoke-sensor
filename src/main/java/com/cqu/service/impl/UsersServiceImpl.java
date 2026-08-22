package com.cqu.service.impl;

import cn.hutool.crypto.digest.BCrypt;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.Users;
import com.cqu.mapper.UsersMapper;
import com.cqu.service.IUsersService;
import com.cqu.utils.JwtProperties;
import com.cqu.vo.LoginRequest;
import com.cqu.vo.LoginVO;
import com.cqu.vo.RegisterRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

/**
 * 用户服务实现
 */
@Service
public class UsersServiceImpl extends ServiceImpl<UsersMapper, Users> implements IUsersService {

    @Autowired
    private JwtProperties jwtProperties;

    @Override
    public LoginVO register(RegisterRequest request) {
        if (request.getUsername() == null || request.getUsername().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "用户名不能为空");
        }
        if (request.getPassword() == null || request.getPassword().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "密码不能为空");
        }
        if (this.lambdaQuery().eq(Users::getUsername, request.getUsername()).count() > 0) {
            throw new BusinessException("用户名已存在");
        }

        Users user = new Users();
        user.setUsername(request.getUsername());
        user.setPassword(BCrypt.hashpw(request.getPassword()));
        user.setRole(request.getRole() != null && !request.getRole().isBlank()
                ? request.getRole() : Role.RESIDENT.name());
        user.setCommunityId(request.getCommunityId());
        this.save(user);

        return buildLoginVO(user);
    }

    @Override
    public LoginVO login(LoginRequest request) {
        Users user = this.lambdaQuery().eq(Users::getUsername, request.getUsername()).one();
        if (user == null || !BCrypt.checkpw(request.getPassword(), user.getPassword())) {
            throw new BusinessException("用户名或密码错误");
        }
        return buildLoginVO(user);
    }

    private LoginVO buildLoginVO(Users user) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("userId", user.getId());
        claims.put("role", user.getRole());
        if (user.getCommunityId() != null) {
            claims.put("communityId", user.getCommunityId());
        }
        String token = jwtProperties.createAccessToken(claims);

        return LoginVO.builder()
                .token(token)
                .userId(String.valueOf(user.getId()))
                .username(user.getUsername())
                .role(user.getRole())
                .build();
    }
}
