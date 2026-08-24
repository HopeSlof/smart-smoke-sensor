package com.cqu.service.impl;

import cn.hutool.crypto.digest.BCrypt;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.Community;
import com.cqu.entity.UserDevice;
import com.cqu.entity.Users;
import com.cqu.mapper.CommunityMapper;
import com.cqu.mapper.UserDeviceMapper;
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
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 用户服务实现
 */
@Slf4j
@Service
public class UsersServiceImpl extends ServiceImpl<UsersMapper, Users> implements IUsersService {

    @Autowired
    private JwtProperties jwtProperties;

    @Autowired
    private CommunityMapper communityMapper;

    @Autowired
    private UserDeviceMapper userDeviceMapper;

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
        // 注册角色白名单：仅允许 RESIDENT / COMMUNITY_ADMIN，非法角色降级为 RESIDENT，防止越权注册
        String registerRole = request.getRole();
        if (registerRole == null || registerRole.isBlank()) {
            registerRole = Role.RESIDENT.name();
        } else {
            registerRole = registerRole.trim().toUpperCase();
        }
        if (!Role.RESIDENT.name().equals(registerRole) && !Role.COMMUNITY_ADMIN.name().equals(registerRole)) {
            log.warn("register 收到非法角色 {}，账号 {}，已降级为 RESIDENT", registerRole, request.getUsername());
            registerRole = Role.RESIDENT.name();
        }
        user.setRole(registerRole);
        user.setCommunityId(request.getCommunityId());
        // 注册默认待审核
        user.setStatus("PENDING");
        user.setRealName(request.getRealName());
        user.setPhone(request.getPhone());
        this.save(user);
        log.info("用户注册: username={}, communityId={}, role={}", request.getUsername(), request.getCommunityId(), registerRole);

        // 待审核用户不发放 token，审核通过后登录
        return LoginVO.builder()
                .userId(String.valueOf(user.getId()))
                .username(user.getUsername())
                .role(user.getRole())
                .realName(user.getRealName())
                .phone(user.getPhone())
                .communityId(user.getCommunityId())
                .communityName(resolveCommunityName(user.getCommunityId()))
                .status(user.getStatus())
                .build();
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
        log.info("用户登录: username={}, userId={}", request.getUsername(), user.getId());
        return buildLoginVO(user);
    }

    @Override
    public PageResult<UserVO> pageUsers(int page, int pageSize, String role, Long communityId, String status) {
        LambdaQueryWrapper<Users> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(role != null && !role.isBlank(), Users::getRole, role);
        wrapper.eq(status != null && !status.isBlank(), Users::getStatus, status);
        // 数据权限：小区管理员只能看本小区用户
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long currentCommunityId = UserHolder.getCommunityId();
            if (currentCommunityId == null) {
                wrapper.eq(Users::getId, 0L); // 小区管理员未绑定小区，看不到住户
            } else {
                wrapper.eq(Users::getCommunityId, currentCommunityId);
            }
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
        // 小区管理员只能创建居民
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole()) && role != Role.RESIDENT) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "小区管理员只能创建居民");
        }
        if (this.lambdaQuery().eq(Users::getUsername, request.getUsername()).count() > 0) {
            throw new BusinessException("用户名已存在");
        }

        Users user = new Users();
        user.setUsername(request.getUsername());
        user.setPassword(BCrypt.hashpw(request.getPassword()));
        user.setRole(role.name());
        // 小区管理员只能在本小区创建用户；消防员不归属小区
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            user.setCommunityId(UserHolder.getCommunityId());
        } else if (role == Role.FIREFIGHTER) {
            user.setCommunityId(null);
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
        log.info("创建用户: username={}, role={}, operatorId={}", request.getUsername(), role.name(), UserHolder.getUserId());
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
            // 小区管理员不能设置管理员或消防员角色
            if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole()) && role != Role.RESIDENT) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "小区管理员不能设置管理员或消防员角色");
            }
            user.setRole(role.name());
            // 消防员不归属小区
            if (role == Role.FIREFIGHTER) {
                user.setCommunityId(null);
            }
        }
        if (request.getCommunityId() != null) {
            // 小区管理员不能修改用户所属小区
            if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "小区管理员不能修改用户所属小区");
            }
            user.setCommunityId(request.getCommunityId());
        }
        if (request.getRealName() != null) {
            user.setRealName(request.getRealName());
        }
        if (request.getPhone() != null) {
            user.setPhone(request.getPhone());
        }
        this.updateById(user);
        log.info("修改用户: id={}, operatorId={}", id, UserHolder.getUserId());
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
        log.info("用户状态变更: id={}, status={}, operatorId={}", id, status, UserHolder.getUserId());
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
        log.info("重置密码: userId={}, operatorId={}", id, UserHolder.getUserId());
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
        log.info("审核用户: id={}, approve={}, operatorId={}", id, approve, UserHolder.getUserId());
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
        // 清理绑定关系
        userDeviceMapper.delete(new LambdaQueryWrapper<UserDevice>().eq(UserDevice::getUserId, id));
        // 清除小区负责人引用
        communityMapper.update(null, new LambdaUpdateWrapper<Community>()
                .eq(Community::getAdminUserId, id)
                .set(Community::getAdminUserId, null));
        this.removeById(id);
        log.info("删除用户: id={}, username={}, operatorId={}", id, user.getUsername(), UserHolder.getUserId());
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
                .realName(user.getRealName())
                .phone(user.getPhone())
                .communityId(user.getCommunityId())
                .communityName(resolveCommunityName(user.getCommunityId()))
                .status(user.getStatus())
                .build();
    }

    /** 查询小区名称（供登录返回） */
    private String resolveCommunityName(Long communityId) {
        if (communityId == null) {
            return null;
        }
        Community community = communityMapper.selectById(communityId);
        return community != null ? community.getName() : null;
    }

    @Override
    public void resetPasswordByPhone(String username, String phone, String newPassword) {
        if (username == null || username.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "账号不能为空");
        }
        if (phone == null || phone.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "手机号不能为空");
        }
        if (newPassword == null || newPassword.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "新密码不能为空");
        }
        Users user = this.lambdaQuery().eq(Users::getUsername, username).one();
        if (user == null) {
            throw new BusinessException("账号不存在");
        }
        if (user.getPhone() == null || !user.getPhone().equals(phone)) {
            throw new BusinessException("账号与绑定手机号不匹配");
        }
        user.setPassword(BCrypt.hashpw(newPassword));
        this.updateById(user);
        log.info("忘记密码重置: username={}, userId={}", username, user.getId());
    }
}
