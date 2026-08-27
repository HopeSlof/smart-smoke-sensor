package com.cqu.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.entity.AlarmLogs;
import com.cqu.entity.Devices;
import com.cqu.mapper.AlarmLogsMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.service.IAiReviewService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.AiReviewVO;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * AI 视觉复核接口
 */
@RestController
@RequestMapping("/ai-review")
public class AiReviewController {

    @Autowired
    private IAiReviewService aiReviewService;

    @Autowired
    private AlarmLogsMapper alarmLogsMapper;

    @Autowired
    private DevicesMapper devicesMapper;

    /**
     * 查询某条告警的 AI 复核结果（带数据权限校验）
     */
    @GetMapping("/{alarmLogId}")
    public Result<AiReviewVO> getReview(@PathVariable Long alarmLogId) {
        AiReviewVO vo = aiReviewService.getReviewByAlarmId(alarmLogId);
        if (vo != null) {
            checkAlarmAccess(alarmLogId);
        }
        return Result.success(vo);
    }

    /**
     * 手动触发 / 重试 AI 复核（仅管理员）
     */
    @PostMapping("/{alarmLogId}/retry")
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    public Result<Void> retryReview(@PathVariable Long alarmLogId,
                                    @RequestBody(required = false) Map<String, String> body) {
        // 小区管理员只能重试本小区告警
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            checkAlarmAccess(alarmLogId);
        }
        String imageUrl = body != null ? body.get("imageUrl") : null;
        aiReviewService.triggerReview(alarmLogId, imageUrl);
        return Result.success(null);
    }

    /** 非系统管理员只能访问本小区告警 */
    private void checkAlarmAccess(Long alarmLogId) {
        String role = UserHolder.getRole();
        if (Role.SYSTEM_ADMIN.name().equals(role) || Role.FIREFIGHTER.name().equals(role)) {
            return;
        }
        AlarmLogs alarm = alarmLogsMapper.selectById(alarmLogId);
        if (alarm == null) {
            throw new BusinessException("告警不存在");
        }
        Devices device = devicesMapper.selectById(alarm.getDeviceId());
        if (device == null) {
            throw new BusinessException("告警关联设备不存在");
        }
        Long userCommunityId = UserHolder.getCommunityId();
        if (userCommunityId == null || !userCommunityId.equals(device.getCommunityId())) {
            throw new BusinessException("无权访问其他小区数据");
        }
    }
}
