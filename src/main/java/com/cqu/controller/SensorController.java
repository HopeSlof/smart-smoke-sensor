package com.cqu.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.entity.Devices;
import com.cqu.entity.SmokeReadings;
import com.cqu.mapper.DevicesMapper;
import com.cqu.mapper.SmokeReadingsMapper;
import com.cqu.utils.UserHolder;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 传感器聚合接口（前端 SensorApi）
 */
@RestController
@RequestMapping("/sensors")
public class SensorController {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private SmokeReadingsMapper smokeReadingsMapper;

    /**
     * 当前关键气体指标（前端 SensorApi.getGasIndex）
     * GET /sensors/gas/current
     * 聚合各设备最新读数返回
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @GetMapping("/gas/current")
    public Result<List<Map<String, Object>>> gasCurrent() {
        LambdaQueryWrapper<Devices> wrapper = new LambdaQueryWrapper<>();
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long cid = UserHolder.getCommunityId();
            if (cid == null) return Result.success(new ArrayList<>());
            wrapper.eq(Devices::getCommunityId, cid);
        }
        wrapper.eq(Devices::getDeviceType, "SMOKE_SENSOR");
        wrapper.orderByDesc(Devices::getCreatedAt);
        wrapper.last("LIMIT 6");
        List<Devices> devices = devicesMapper.selectList(wrapper);

        List<Map<String, Object>> result = new ArrayList<>();
        for (Devices d : devices) {
            // 取最新一条读数
            SmokeReadings latest = smokeReadingsMapper.selectOne(
                    new LambdaQueryWrapper<SmokeReadings>()
                            .eq(SmokeReadings::getDeviceId, d.getId())
                            .orderByDesc(SmokeReadings::getCreatedAt)
                            .last("LIMIT 1"));
            Map<String, Object> item = new HashMap<>();
            item.put("deviceId", String.valueOf(d.getId()));
            item.put("deviceName", d.getDeviceName());
            item.put("location", d.getLocation());
            item.put("smokeConcentration", latest != null ? latest.getSmokeConcentration() : 0);
            item.put("temperature", latest != null ? latest.getTemperature() : 0);
            item.put("coConcentration", latest != null && latest.getCoConcentration() != null ? latest.getCoConcentration() : 0);
            item.put("time", latest != null ? String.valueOf(latest.getCreatedAt()) : null);
            result.add(item);
        }
        return Result.success(result);
    }

    /**
     * 设备快速指标总览（前端 SensorApi.getMetricsOverview）
     * GET /sensors/metrics/overview
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @GetMapping("/metrics/overview")
    public Result<Map<String, Object>> metricsOverview() {
        LambdaQueryWrapper<Devices> wrapper = new LambdaQueryWrapper<>();
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long cid = UserHolder.getCommunityId();
            if (cid == null) return Result.success(new HashMap<>());
            wrapper.eq(Devices::getCommunityId, cid);
        }
        wrapper.eq(Devices::getDeviceType, "SMOKE_SENSOR");
        List<Devices> devices = devicesMapper.selectList(wrapper);

        int online = 0, offline = 0, alarmCount = 0;
        double avgSmoke = 0, avgTemp = 0;
        int count = 0;
        for (Devices d : devices) {
            if ("ONLINE".equals(d.getOnlineStatus())) online++; else offline++;
            SmokeReadings latest = smokeReadingsMapper.selectOne(
                    new LambdaQueryWrapper<SmokeReadings>()
                            .eq(SmokeReadings::getDeviceId, d.getId())
                            .orderByDesc(SmokeReadings::getCreatedAt)
                            .last("LIMIT 1"));
            if (latest != null) {
                if (latest.getSmokeConcentration() != null) {
                    avgSmoke += latest.getSmokeConcentration().doubleValue();
                }
                if (latest.getTemperature() != null) {
                    avgTemp += latest.getTemperature().doubleValue();
                }
                count++;
                if (latest.getSmokeConcentration() != null && latest.getSmokeConcentration().doubleValue() > 50) {
                    alarmCount++;
                }
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("totalDevices", devices.size());
        result.put("onlineDevices", online);
        result.put("offlineDevices", offline);
        result.put("alarmDevices", alarmCount);
        result.put("avgSmokeConcentration", count > 0 ? Math.round(avgSmoke / count * 10) / 10.0 : 0);
        result.put("avgTemperature", count > 0 ? Math.round(avgTemp / count * 10) / 10.0 : 0);
        return Result.success(result);
    }
}
