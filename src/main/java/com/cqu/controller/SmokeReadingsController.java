package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.ISmokeReadingsService;
import com.cqu.vo.LatestSmokeVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import com.cqu.vo.SmokeReadingsVO;
import com.cqu.vo.SmokeReportRequest;
import com.cqu.vo.TrendVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;

/**
 * 烟雾浓度监测
 */
@RestController
@RequestMapping("/smoke-readings")
public class SmokeReadingsController {

    @Autowired
    private ISmokeReadingsService smokeReadingsService;

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT})
    @GetMapping
    public Result<PageResult<SmokeReadingsVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) Long deviceId,
            @RequestParam(required = false) @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime startTime,
            @RequestParam(required = false) @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime endTime) {
        return Result.success(smokeReadingsService.pageReadings(page, pageSize, deviceId, startTime, endTime));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT})
    @GetMapping("/latest/{deviceId}")
    public Result<LatestSmokeVO> latest(@PathVariable Long deviceId) {
        return Result.success(smokeReadingsService.getLatest(deviceId));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT})
    @GetMapping("/trend")
    public Result<TrendVO> trend(
            @RequestParam Long deviceId,
            @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime startTime,
            @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime endTime) {
        return Result.success(smokeReadingsService.getTrend(deviceId, startTime, endTime));
    }

    /** 烟雾数据上报（HTTP 降级通道，不校验 JWT） */
    @PostMapping("/report")
    public Result<String> report(@RequestBody SmokeReportRequest request) {
        smokeReadingsService.reportReading(request.getDeviceSn(), request.getSmokeConcentration(),
                request.getTemperature(), request.getCoConcentration());
        return Result.success("ok");
    }
}
