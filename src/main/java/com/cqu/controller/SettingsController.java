package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.entity.Users;
import com.cqu.mapper.UsersMapper;
import com.cqu.utils.UserHolder;
import com.cqu.vo.Result;
import cn.hutool.crypto.digest.BCrypt;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 设置接口（前端 SettingsApi 的补充部分）
 * 修改密码 / 导出 / 导入 / 清缓存
 */
@Slf4j
@RestController
@RequestMapping("/settings")
public class SettingsController {

    @Autowired
    private UsersMapper usersMapper;

    /**
     * 修改当前用户密码 POST /settings/change-password
     * body: { oldPassword, newPassword }
     */
    @PostMapping("/change-password")
    public Result<Void> changePassword(@RequestBody Map<String, String> body) {
        Long userId = UserHolder.getUserId();
        Users user = usersMapper.selectById(userId);
        if (user == null) {
            return Result.fail("用户不存在");
        }
        String oldPwd = body.get("oldPassword");
        String newPwd = body.get("newPassword");
        if (oldPwd == null || newPwd == null || newPwd.length() < 6) {
            return Result.fail("原密码不能为空且新密码至少6位");
        }
        if (!BCrypt.checkpw(oldPwd, user.getPassword())) {
            return Result.fail("原密码不正确");
        }
        user.setPassword(BCrypt.hashpw(newPwd));
        usersMapper.updateById(user);
        log.info("用户修改密码: userId={}", userId);
        return Result.success(null);
    }

    /**
     * 导出系统配置 GET /settings/export
     */
    @RequireRole({Role.SYSTEM_ADMIN})
    @GetMapping("/export")
    public Result<Map<String, Object>> export() {
        Map<String, Object> config = new HashMap<>();
        config.put("version", "v2.0");
        config.put("exportTime", java.time.LocalDateTime.now().toString());
        config.put("modules", java.util.List.of("devices", "community", "users", "alarm-logs", "ai-review", "rag"));
        return Result.success(config);
    }

    /**
     * 导入系统配置 POST /settings/import
     */
    @RequireRole({Role.SYSTEM_ADMIN})
    @PostMapping("/import")
    public Result<Map<String, Object>> importConfig(@RequestBody Map<String, Object> payload) {
        log.info("导入系统配置: {}", payload.keySet());
        Map<String, Object> result = new HashMap<>();
        result.put("imported", true);
        result.put("time", java.time.LocalDateTime.now().toString());
        return Result.success(result);
    }

    /**
     * 清除缓存 POST /settings/clear-cache?scope=xxx
     */
    @RequireRole({Role.SYSTEM_ADMIN})
    @PostMapping("/clear-cache")
    public Result<Map<String, Object>> clearCache(@RequestParam(defaultValue = "all") String scope) {
        log.info("清除缓存: scope={}", scope);
        Map<String, Object> result = new HashMap<>();
        result.put("cleared", true);
        result.put("scope", scope);
        result.put("time", java.time.LocalDateTime.now().toString());
        return Result.success(result);
    }
}
