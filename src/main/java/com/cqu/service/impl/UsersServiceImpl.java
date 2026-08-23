package com.cqu.service.impl;

import cn.hutool.crypto.digest.BCrypt;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.Users;
import com.cqu.mapper.UsersMapper;
import com.cqu.service.IUsersService;
import com.cqu.utils.JwtProperties;
import com.cqu.utils.UserHolder;
import com.cqu.vo.LoginRequest;
import com.cqu.vo.LoginVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.RegisterRequest;
import com.cqu.vo.UserCreateRequest;
import com.cqu.vo.UserUpdateRequest;
import com.cqu.vo.UserVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

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
        if (request.getCommunityId() == null) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "请选择所属小区");
        }
        if (this.lambdaQuery().eq(Users::getUsername, request.getUsername()).count() > 0) {
            throw new BusinessException("用户名已存在");
        }

        Users user = new Users();
        user.setUsername(request.getUsername());
        user.setPassword(BCrypt.hashpw(request.getPassword()));
        // 注册强制为居民，忽略前端传入的 role，杜绝越权注册
        user.setRole(Role.RESIDENT.name());
        user.setCommunityId(request.getCommunityId());
        // 注册默认待审核
        user.setStatus("PENDING");
        user.setRealName(request.getRealName());
        user.setPhone(request.getPhone());
        this.save(user);

        return buildLoginVO(user);
    }

    @Override
    public LoginVO login(LoginRequest request) {
        Users user = this.lambdaQuery().eq(Users::getUsername, request.getUsername()).one();
        if (user == null || !BCrypt.checkpw(request.getPassword(), user.getPassword())) {
            throw new BusinessException("用户名或密码错误");
        }
        if ("PENDING".equals(user.getStatus())) {
            throw new BusinessException("账号待审核，请联系管理员");
        }
        if ("DISABLED".equals(user.getStatus())) {
            throw new BusinessException("账号已被禁用");
        }
        return buildLoginVO(user);
    }

    @Override
    public PageResult<UserVO> pageUsers(int page, int pageSize, String role, Long communityId, String status) {
        LambdaQueryWrapper<Users> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(role != null && !role.isBlank(), Users::getRole, role);
        wrapper.eq(status != null && !status.isBlank(), Users::getStatus, status);
        // 数据权限：小区管理员只能看本小区用户
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            wrapper.eq(Users::getCommunityId, UserHolder.getCommunityId());
        } else if (communityId != null) {
            wrapper.eq(Users::getCommunityId, communityId);
        }
        wrapper.orderByDesc(Users::getCreatedAt);

        Page<Users> pageResult = this.page(new Page<>(page, pageSize), wrapper);
        List<UserVO> records = pageResult.getRecords().stream().map(this::toUserVO).collect(Collectors.toList());
        return PageResult.of(pageResult.getTotal(), records);
    }

    @Override
    public void createUser(UserCreateRequest request) {
        if (request.getUsername() == null || request.getUsername().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "用户名不能为空");
        }
        if (request.getPassword() == null || request.getPassword().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "密码不能为空");
        }
        if (request.getRole() == null || request.getRole().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "角色不能为空");
        }
        Role role;
        try {
            role = Role.valueOf(request.getRole());
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "角色非法");
        }
        if (Role.SYSTEM_ADMIN == role) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "不能创建系统管理员");
        }
        if (this.lambdaQuery().eq(Users::getUsername, request.getUsername()).count() > 0) {
            throw new BusinessException("用户名已存在");
        }

        Users user = new Users();
        user.setUsername(request.getUsername());
        user.setPassword(BCrypt.hashpw(request.getPassword()));
        user.setRole(role.name());
        // 小区管理员只能在本小区创建用户
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            user.setCommunityId(UserHolder.getCommunityId());
        } else {
            user.setCommunityId(request.getCommunityId());
        }
        if ((role == Role.RESIDENT || role == Role.COMMUNITY_ADMIN) && user.getCommunityId() == null) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "居民或小区管理员必须归属小区");
        }
        user.setStatus("ACTIVE");
        user.setRealName(request.getRealName());
        user.setPhone(request.getPhone());
        this.save(user);
    }

    @Override
    public void updateUser(Long id, UserUpdateRequest request) {
        Users user = this.getById(id);
        if (user == null) {
            throw new BusinessException("用户不存在");
        }
        checkCommunityAccess(user);

        if (request.getRole() != null && !request.getRole().isBlank()) {
            Role role;
            try {
                role = Role.valueOf(request.getRole());
            } catch (Exception e) {
                throw new BusinessException(ErrorCode.BAD_REQUEST, "角色非法");
            }
            if (Role.SYSTEM_ADMIN == role) {
                throw new BusinessException(ErrorCode.BAD_REQUEST, "不能设置为系统管理员");
            }
            user.setRole(role.name());
        }
        if (request.getCommunityId() != null) {
            user.setCommunityId(request.getCommunityId());
        }
        if (request.getRealName() != null) {
            user.setRealName(request.getRealName());
        }
        if (request.getPhone() != null) {
            user.setPhone(request.getPhone());
        }
        this.updateById(user);
    }

    @Override
    public void updateStatus(Long id, String status) {
        Users user = this.getById(id);
        if (user == null) {
            throw new BusinessException("用户不存在");
        }
        checkCommunityAccess(user);
        if (!"ACTIVE".equals(status) && !"DISABLED".equals(status)) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "状态非法");
        }
        user.setStatus(status);
        this.updateById(user);
    }

    @Override
    public void resetPassword(Long id, String password) {
        Users user = this.getById(id);
        if (user == null) {
            throw new BusinessException("用户不存在");
        }
        checkCommunityAccess(user);
        if (password == null || password.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "密码不能为空");
        }
        user.setPassword(BCrypt.hashpw(password));
        this.updateById(user);
    }

    @Override
    public void auditUser(Long id, boolean approve) {
        Users user = this.getById(id);
        if (user == null) {
            throw new BusinessException("用户不存在");
        }
        checkCommunityAccess(user);
        if (!"PENDING".equals(user.getStatus())) {
            throw new BusinessException("该用户不在待审核状态");
        }
        user.setStatus(approve ? "ACTIVE" : "DISABLED");
        this.updateById(user);
    }

    @Override
    public void deleteUser(Long id) {
        Users user = this.getById(id);
        if (user == null) {
            throw new BusinessException("用户不存在");
        }
        if (Role.SYSTEM_ADMIN.name().equals(user.getRole())) {
            throw new BusinessException("不能删除系统管理员");
        }
        this.removeById(id);
    }

    /** 小区管理员只能操作本小区用户 */
    private void checkCommunityAccess(Users targetUser) {
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long currentCommunityId = UserHolder.getCommunityId();
            if (currentCommunityId == null || !currentCommunityId.equals(targetUser.getCommunityId())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "无权操作其他小区用户");
            }
        }
    }

    private UserVO toUserVO(Users user) {
        return UserVO.builder()
                .id(String.valueOf(user.getId()))
                .username(user.getUsername())
                .role(user.getRole())
                .communityId(user.getCommunityId())
                .status(user.getStatus())
                .realName(user.getRealName())
                .phone(user.getPhone())
                .createdAt(user.getCreatedAt() != null ? String.valueOf(user.getCreatedAt()) : null)
                .build();
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
