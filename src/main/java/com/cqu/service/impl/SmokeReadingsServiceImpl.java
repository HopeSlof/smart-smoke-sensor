package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.OnlineStatus;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.Devices;
import com.cqu.entity.SmokeReadings;
import com.cqu.mapper.DevicesMapper;
import com.cqu.mapper.SmokeReadingsMapper;
import com.cqu.service.IAlertRuleEngine;
import com.cqu.service.ISmokeReadingsService;
import com.cqu.utils.WebSocketNotifier;
import com.cqu.vo.LatestSmokeVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.SmokeReadingsVO;
import com.cqu.vo.TrendPointVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 烟雾浓度数据服务实现
 */
@Slf4j
@Service
public class SmokeReadingsServiceImpl extends ServiceImpl<SmokeReadingsMapper, SmokeReadings>
        implements ISmokeReadingsService {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private IAlertRuleEngine alertRuleEngine;

    @Autowired
    private WebSocketNotifier webSocketNotifier;

    @Override
    public PageResult<SmokeReadingsVO> pageReadings(int page, int pageSize, Long deviceId,
                                                    LocalDateTime startTime, LocalDateTime endTime) {
        LambdaQueryWrapper<SmokeReadings> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(deviceId != null, SmokeReadings::getDeviceId, deviceId);
        wrapper.ge(startTime != null, SmokeReadings::getCreatedAt, startTime);
        wrapper.le(endTime != null, SmokeReadings::getCreatedAt, endTime);
        wrapper.orderByDesc(SmokeReadings::getCreatedAt);

        Page<SmokeReadings> pageResult = this.page(new Page<>(page, pageSize), wrapper);
        Map<Long, String> deviceNameMap = buildDeviceNameMap(pageResult.getRecords());

        List<SmokeReadingsVO> records = pageResult.getRecords().stream()
                .map(r -> toVO(r, deviceNameMap.get(r.getDeviceId())))
                .collect(Collectors.toList());

        return PageResult.of(pageResult.getTotal(), records);
    }

    @Override
    public LatestSmokeVO getLatest(Long deviceId) {
        LambdaQueryWrapper<SmokeReadings> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SmokeReadings::getDeviceId, deviceId)
                .orderByDesc(SmokeReadings::getCreatedAt)
                .last("LIMIT 1");
        SmokeReadings reading = this.getOne(wrapper);
        if (reading == null) {
            throw new BusinessException("该设备暂无烟雾数据");
        }
        return toLatestVO(reading);
    }

    @Override
    public List<TrendPointVO> getTrend(Long deviceId, LocalDateTime startTime, LocalDateTime endTime) {
        LambdaQueryWrapper<SmokeReadings> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SmokeReadings::getDeviceId, deviceId)
                .ge(startTime != null, SmokeReadings::getCreatedAt, startTime)
                .le(endTime != null, SmokeReadings::getCreatedAt, endTime)
                .orderByAsc(SmokeReadings::getCreatedAt);

        return this.list(wrapper).stream()
                .map(r -> TrendPointVO.builder()
                        .time(String.valueOf(r.getCreatedAt()))
                        .value(String.valueOf(r.getSmokeConcentration()))
                        .build())
                .collect(Collectors.toList());
    }

    @Override
    public void reportReading(String deviceSn, BigDecimal smokeConcentration,
                              BigDecimal temperature, BigDecimal coConcentration) {
        if (smokeConcentration == null) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "烟雾浓度不能为空");
        }

        Devices device = devicesMapper.selectOne(
                new LambdaQueryWrapper<Devices>().eq(Devices::getDeviceSn, deviceSn));
        if (device == null) {
            log.warn("烟雾上报：未找到设备 deviceSn={}，数据丢弃", deviceSn);
            return;
        }
        Long deviceId = device.getId();

        // 上报即视为心跳，刷新在线状态
        boolean wasOffline = !OnlineStatus.ONLINE.name().equals(device.getOnlineStatus());
        device.setOnlineStatus(OnlineStatus.ONLINE.name());
        device.setLastHeartbeatTime(LocalDateTime.now());
        devicesMapper.updateById(device);

        if (wasOffline) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("deviceId", deviceId);
            data.put("deviceName", device.getDeviceName());
            data.put("onlineStatus", device.getOnlineStatus());
            data.put("lastHeartbeatTime", device.getLastHeartbeatTime());
            webSocketNotifier.pushDeviceOnline(data);
        }

        // 保存记录
        SmokeReadings reading = new SmokeReadings();
        reading.setDeviceId(deviceId);
        reading.setSmokeConcentration(smokeConcentration);
        reading.setTemperature(temperature);
        reading.setCoConcentration(coConcentration);
        this.save(reading);

        // WebSocket 推送
        webSocketNotifier.pushSmokeReading(toLatestVO(reading));

        // 规则引擎分级判定（触发告警）
        alertRuleEngine.evaluate(deviceId, smokeConcentration, temperature, coConcentration);
    }

    private Map<Long, String> buildDeviceNameMap(List<SmokeReadings> readings) {
        List<Long> ids = readings.stream().map(SmokeReadings::getDeviceId).distinct().collect(Collectors.toList());
        if (ids.isEmpty()) return Map.of();
        return devicesMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(Devices::getId, Devices::getDeviceName));
    }

    private SmokeReadingsVO toVO(SmokeReadings reading, String deviceName) {
        return SmokeReadingsVO.builder()
                .id(String.valueOf(reading.getId()))
                .deviceId(String.valueOf(reading.getDeviceId()))
                .deviceName(deviceName)
                .smokeConcentration(reading.getSmokeConcentration())
                .temperature(reading.getTemperature())
                .coConcentration(reading.getCoConcentration())
                .createdAt(String.valueOf(reading.getCreatedAt()))
                .build();
    }

    private LatestSmokeVO toLatestVO(SmokeReadings reading) {
        return LatestSmokeVO.builder()
                .deviceId(String.valueOf(reading.getDeviceId()))
                .smokeConcentration(reading.getSmokeConcentration())
                .temperature(reading.getTemperature())
                .coConcentration(reading.getCoConcentration())
                .createdAt(String.valueOf(reading.getCreatedAt()))
                .build();
    }
}
