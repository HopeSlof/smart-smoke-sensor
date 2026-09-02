package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IControlLogsService;
import com.cqu.vo.ControlLogVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 系统日志接口（前端 AlertApi.getSystemLogs → /system/logs）
 * 复用 ControlLogsService 数据
 */
@RestController
@RequestMapping("/system")
public class SystemController {

    @Autowired
    private IControlLogsService controlLogsService;

    /**
     * 系统操作日志（前端 GET /system/logs?limit=N）
     */
    @RequireRole({Role.SYSTEM_ADMIN})
    @GetMapping("/logs")
    public Result<List<ControlLogVO>> logs(@RequestParam(defaultValue = "20") int limit) {
        PageResult<ControlLogVO> page = controlLogsService.pageLogs(1, limit, null, null, null);
        return Result.success(page.getRecords());
    }
}
