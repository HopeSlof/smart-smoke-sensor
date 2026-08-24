package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IUserDeviceService;
import com.cqu.service.IUsersService;
import com.cqu.vo.DeviceVO;
import com.cqu.vo.LoginRequest;
import com.cqu.vo.LoginVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.RegisterRequest;
import com.cqu.vo.Result;
import com.cqu.vo.UserCreateRequest;
import com.cqu.vo.UserUpdateRequest;
import com.cqu.vo.UserVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 用户注册 / 登录 / 管理
 */
@RestController
@RequestMapping("/users")
public class UsersController {

    @Autowired
    private IUsersService usersService;

    @Autowired
    private IUserDeviceService userDeviceService;

    @PostMapping("/register")
    public Result<LoginVO> register(@RequestBody RegisterRequest request) {
        return Result.success(usersService.register(request));
    }

    @PostMapping("/login")
    public Result<LoginVO> login(@RequestBody LoginRequest request) {
        return Result.success(usersService.login(request));
    }

    /** 忘记密码：账号 + 绑定手机号校验后重置（无需登录态） */
    @PostMapping("/reset-password")
    public Result<String> resetPasswordByPhone(@RequestBody Map<String, String> body) {
        usersService.resetPasswordByPhone(body.get("username"), body.get("phone"), body.get("newPassword"));
        return Result.success("密码重置成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping
    public Result<PageResult<UserVO>> list(@RequestParam(defaultValue = "1") int page,
                                           @RequestParam(defaultValue = "10") int pageSize,
                                           @RequestParam(required = false) String role,
                                           @RequestParam(required = false) Long communityId,
                                           @RequestParam(required = false) String status) {
        return Result.success(usersService.pageUsers(page, pageSize, role, communityId, status));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PostMapping
    public Result<String> create(@RequestBody UserCreateRequest request) {
        usersService.createUser(request);
        return Result.success("创建成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}")
    public Result<String> update(@PathVariable Long id, @RequestBody UserUpdateRequest request) {
        usersService.updateUser(id, request);
        return Result.success("修改成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}/status")
    public Result<String> updateStatus(@PathVariable Long id, @RequestBody Map<String, String> body) {
        usersService.updateStatus(id, body.get("status"));
        return Result.success("操作成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}/password")
    public Result<String> resetPassword(@PathVariable Long id, @RequestBody Map<String, String> body) {
        usersService.resetPassword(id, body.get("password"));
        return Result.success("重置成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}/audit")
    public Result<String> audit(@PathVariable Long id, @RequestBody Map<String, Boolean> body) {
        boolean approve = Boolean.TRUE.equals(body.get("approve"));
        usersService.auditUser(id, approve);
        return Result.success("审核完成");
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @DeleteMapping("/{id}")
    public Result<String> delete(@PathVariable Long id) {
        usersService.deleteUser(id);
        return Result.success("删除成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT})
    @GetMapping("/{userId}/devices")
    public Result<List<DeviceVO>> listDevices(@PathVariable Long userId) {
        return Result.success(userDeviceService.listBoundDevices(userId));
    }
}
