package com.cqu.service;

/**
 * 设备指令下发抽象
 * <p>业务层依赖本接口而非具体 MQTT 实现，便于替换通道（MQTT / HTTP）与单元测试。</p>
 */
public interface IDeviceCommander {

    /**
     * 向指定设备下发指令
     *
     * @param deviceSn 设备序列号
     * @param command  指令（如 EVACUATE_BROADCAST / SPRINKLER_ON 等）
     */
    void publishCommand(String deviceSn, String command);
}
