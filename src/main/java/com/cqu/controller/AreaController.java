package com.cqu.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.entity.Community;
import com.cqu.entity.Devices;
import com.cqu.mapper.CommunityMapper;
import com.cqu.mapper.DevicesMapper;
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
 * 区域/楼栋接口（前端 AreaApi）
 */
@RestController
@RequestMapping("/areas")
public class AreaController {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private CommunityMapper communityMapper;

    /**
     * 楼栋列表（从设备 location 字段聚合）
     * GET /areas/buildings
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @GetMapping("/buildings")
    public Result<List<Map<String, Object>>> buildings() {
        LambdaQueryWrapper<Devices> wrapper = new LambdaQueryWrapper<>();
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole()) || Role.RESIDENT.name().equals(UserHolder.getRole())) {
            Long cid = UserHolder.getCommunityId();
            if (cid == null) return Result.success(new ArrayList<>());
            wrapper.eq(Devices::getCommunityId, cid);
        }
        wrapper.isNotNull(Devices::getLocation);
        List<Devices> devices = devicesMapper.selectList(wrapper);

        // 按 location 聚合
        Map<String, Map<String, Object>> buildingMap = new java.util.LinkedHashMap<>();
        for (Devices d : devices) {
            String loc = d.getLocation();
            if (loc == null || loc.isBlank()) continue;
            // 提取楼栋名（取第一个空格或数字栋前的部分）
            String building = loc.replaceAll("[\\d]+单元.*$", "").trim();
            if (building.isEmpty()) building = loc;

            if (!buildingMap.containsKey(building)) {
                Map<String, Object> b = new HashMap<>();
                b.put("name", building);
                b.put("communityId", d.getCommunityId());
                b.put("deviceCount", 0);
                buildingMap.put(building, b);
            }
            buildingMap.get(building).put("deviceCount", (int) buildingMap.get(building).get("deviceCount") + 1);
        }
        return Result.success(new ArrayList<>(buildingMap.values()));
    }
}
