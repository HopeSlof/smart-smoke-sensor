package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IAlarmLogsService;
import com.cqu.vo.AlarmLogVO;
import com.cqu.vo.AlarmStatisticsVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 告警管理
 */
@RestController
@RequestMapping("/alarm-logs")
public class AlarmLogsController {

    @Autowired
    private IAlarmLogsService alarmLogsService;

    @GetMapping
    public Result<PageResult<AlarmLogVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) Long deviceId,
            @RequestParam(required = false) String alarmType,
            @RequestParam(required = false) String alarmLevel,
            @RequestParam(required = false) String status) {
        return Result.success(alarmLogsService.pageAlarms(page, pageSize, deviceId, alarmType, alarmLevel, status));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @GetMapping("/statistics")
    public Result<AlarmStatisticsVO> statistics() {
        return Result.success(alarmLogsService.getStatistics());
    }

    @GetMapping("/{id}")
    public Result<AlarmLogVO> detail(@PathVariable Long id) {
        return Result.success(alarmLogsService.getAlarmDetail(id));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @PutMapping("/{id}/resolve")
    public Result<String> resolve(@PathVariable Long id) {
        alarmLogsService.resolveAlarm(id);
        return Result.success("处理成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}/acknowledge")
    public Result<String> acknowledge(@PathVariable Long id) {
        alarmLogsService.acknowledgeAlarm(id);
        return Result.success("确认成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @PutMapping("/{id}/confirm")
    public Result<String> confirm(@PathVariable Long id, @RequestBody Map<String, String> body) {
        alarmLogsService.confirmAlarm(id, body.get("disposition"));
        return Result.success("确认成功");
    }
}
