package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.ControlLogs;
import com.cqu.vo.ControlLogVO;
import com.cqu.vo.PageResult;

/**
 * 控制日志服务
 */
public interface IControlLogsService extends IService<ControlLogs> {

    PageResult<ControlLogVO> pageLogs(int page, int pageSize, Long deviceId, String command, Long operatorId);

    ControlLogVO getDetail(Long id);

    void recordLog(Long deviceId, String command, String result);

    void recordLog(Long deviceId, String command, String result, String source);
}
