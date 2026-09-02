package com.cqu.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.entity.AiReviewLog;
import com.cqu.entity.AlarmLogs;
import com.cqu.entity.Cameras;
import com.cqu.entity.Devices;
import com.cqu.mapper.AiReviewLogMapper;
import com.cqu.mapper.AlarmLogsMapper;
import com.cqu.mapper.CamerasMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.service.IAiReviewService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.AiReviewVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * AI 视觉复核接口
 * <p>
 * 提供两套路径：
 * <ul>
 *   <li>原路径 {@code /ai-review/{alarmLogId}}、{@code /ai-review/{alarmLogId}/retry}（按告警 ID 操作）</li>
 *   <li>前端期望路径 {@code /ai/reviews}（列表）、{@code /ai/reviews}（触发）、{@code /ai/reviews/by-alert/{alertId}}（按告警查）</li>
 * </ul>
 */
@RestController
public class AiReviewController {

    @Autowired
    private IAiReviewService aiReviewService;

    @Autowired
    private AlarmLogsMapper alarmLogsMapper;

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private AiReviewLogMapper aiReviewLogMapper;

    @Autowired
    private CamerasMapper camerasMapper;

    /* ======================== 原路径（向后兼容） ======================== */

    /**
     * 查询某条告警的 AI 复核结果（带数据权限校验）
     */
    @GetMapping("/ai-review/{alarmLogId}")
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
    @PostMapping("/ai-review/{alarmLogId}/retry")
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

    /* ======================== 前端期望路径 /ai/reviews ======================== */

    /**
     * 复核记录列表（前端 ReviewApi.getReviewList）
     * GET /ai/reviews?limit=10
     */
    @GetMapping("/ai/reviews")
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    public Result<List<AiReviewVO>> reviewList(@RequestParam(defaultValue = "10") int limit) {
        LambdaQueryWrapper<AiReviewLog> wrapper = new LambdaQueryWrapper<AiReviewLog>()
                .orderByDesc(AiReviewLog::getCreatedAt);
        // 小区管理员只能看本小区
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long cid = UserHolder.getCommunityId();
            if (cid == null) {
                return Result.success(new ArrayList<>());
            }
            // 先查本小区设备 ID 集合，再过滤
            List<Devices> devices = devicesMapper.selectList(
                    new LambdaQueryWrapper<Devices>().eq(Devices::getCommunityId, cid));
            if (devices.isEmpty()) {
                return Result.success(new ArrayList<>());
            }
            List<Long> deviceIds = devices.stream().map(Devices::getId).toList();
            wrapper.in(AiReviewLog::getSmokeDeviceId, deviceIds);
        }
        wrapper.last("LIMIT " + Math.max(1, Math.min(limit, 100)));
        List<AiReviewLog> logs = aiReviewLogMapper.selectList(wrapper);
        List<AiReviewVO> voList = new ArrayList<>();
        for (AiReviewLog log : logs) {
            voList.add(toVO(log));
        }
        return Result.success(voList);
    }

    /**
     * 触发 AI 复核（前端 ReviewApi.triggerReview）
     * POST /ai/reviews  body: { alertId }
     */
    @PostMapping("/ai/reviews")
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    public Result<Void> triggerReview(@RequestBody Map<String, Object> body) {
        Object alertIdObj = body != null ? body.get("alertId") : null;
        if (alertIdObj == null) {
            throw new BusinessException("alertId 不能为空");
        }
        Long alertId = Long.valueOf(alertIdObj.toString());
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            checkAlarmAccess(alertId);
        }
        aiReviewService.triggerReview(alertId, null);
        return Result.success(null);
    }

    /**
     * 按告警 ID 查复核结果（前端 ReviewApi.getReviewByAlert）
     * GET /ai/reviews/by-alert/{alertId}
     */
    @GetMapping("/ai/reviews/by-alert/{alertId}")
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    public Result<AiReviewVO> getReviewByAlert(@PathVariable Long alertId) {
        checkAlarmAccess(alertId);
        AiReviewVO vo = aiReviewService.getReviewByAlarmId(alertId);
        return Result.success(vo);
    }

    /* ======================== 工具方法 ======================== */

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

    /** 实体转 VO（查摄像头名称） */
    private AiReviewVO toVO(AiReviewLog log) {
        String cameraName = null;
        if (log.getCameraDeviceId() != null) {
            Cameras camera = camerasMapper.selectById(log.getCameraDeviceId());
            if (camera != null) {
                cameraName = camera.getCameraName();
            }
        }
        return AiReviewVO.builder()
                .id(String.valueOf(log.getId()))
                .alarmLogId(String.valueOf(log.getAlarmLogId()))
                .smokeDeviceId(log.getSmokeDeviceId() != null ? String.valueOf(log.getSmokeDeviceId()) : null)
                .cameraDeviceId(log.getCameraDeviceId() != null ? String.valueOf(log.getCameraDeviceId()) : null)
                .cameraDeviceName(cameraName)
                .imageUrl(log.getImageUrl())
                .aiResult(log.getAiResult())
                .confidence(log.getConfidence() != null ? String.valueOf(log.getConfidence()) : null)
                .aiDescription(log.getAiDescription())
                .status(log.getStatus())
                .errorMessage(log.getErrorMessage())
                .reviewTime(log.getReviewTime() != null ? String.valueOf(log.getReviewTime()) : null)
                .createdAt(log.getCreatedAt() != null ? String.valueOf(log.getCreatedAt()) : null)
                .build();
    }
}
