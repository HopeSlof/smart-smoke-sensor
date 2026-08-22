package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IControlLogsService;
import com.cqu.vo.ControlLogVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 控制日志（审计）
 */
@RestController
@RequestMapping("/control-logs")
public class ControlLogsController {

    @Autowired
    private IControlLogsService controlLogsService;

    @RequireRole({Role.SYSTEM_ADMIN})
    @GetMapping
    public Result<PageResult<ControlLogVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) Long deviceId,
            @RequestParam(required = false) String command,
            @RequestParam(required = false) Long operatorId) {
        return Result.success(controlLogsService.pageLogs(page, pageSize, deviceId, command, operatorId));
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @GetMapping("/{id}")
    public Result<ControlLogVO> detail(@PathVariable Long id) {
        return Result.success(controlLogsService.getDetail(id));
    }
}
