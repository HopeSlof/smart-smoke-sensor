package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IThresholdConfigService;
import com.cqu.vo.Result;
import com.cqu.vo.ThresholdConfigVO;
import com.cqu.vo.ThresholdUpdateRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 阈值配置
 */
@RestController
@RequestMapping("/threshold-config")
public class ThresholdConfigController {

    @Autowired
    private IThresholdConfigService thresholdConfigService;

    @GetMapping
    public Result<ThresholdConfigVO> get() {
        return Result.success(thresholdConfigService.getConfig());
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @PutMapping
    public Result<String> update(@RequestBody ThresholdUpdateRequest request) {
        thresholdConfigService.updateConfig(request);
        return Result.success("更新成功");
    }
}
