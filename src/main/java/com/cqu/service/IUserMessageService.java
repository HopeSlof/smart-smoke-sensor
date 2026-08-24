package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.UserMessage;
import com.cqu.vo.MessageVO;

import java.util.List;

/**
 * 站内消息服务（居民-管理员双向消息）
 */
public interface IUserMessageService extends IService<UserMessage> {

    /** 居民发消息给管理员 */
    void sendMessage(String content);

    /** 管理员查消息（系统看全部/小区看本小区） */
    List<MessageVO> listMessages();

    /** 居民查「我的消息」含管理员回复 */
    List<MessageVO> listMyMessages();

    /** 管理员回复居民消息 */
    void replyToMessage(Long messageId, String content);

    /** 管理员标记已读 */
    void markRead(Long messageId);
}
