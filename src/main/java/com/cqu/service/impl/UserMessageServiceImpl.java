package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.UserMessage;
import com.cqu.entity.Users;
import com.cqu.mapper.UserMessageMapper;
import com.cqu.mapper.UsersMapper;
import com.cqu.service.IUserMessageService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.MessageVO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 站内消息服务实现（居民-管理员双向消息）
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserMessageServiceImpl extends ServiceImpl<UserMessageMapper, UserMessage>
        implements IUserMessageService {

    private final UsersMapper usersMapper;

    @Override
    public void sendMessage(String content) {
        if (content == null || content.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "消息内容不能为空");
        }
        Long userId = UserHolder.getUserId();
        Users user = usersMapper.selectById(userId);
        UserMessage msg = new UserMessage();
        msg.setSenderUserId(userId);
        msg.setSenderUsername(user != null ? user.getUsername() : null);
        msg.setSenderRole("RESIDENT");
        msg.setCommunityId(UserHolder.getCommunityId());
        msg.setType("OTHER");
        msg.setContent(content);
        msg.setStatus("UNREAD");
        msg.setCreatedAt(LocalDateTime.now());
        this.save(msg);
        log.info("居民发消息: userId={}, communityId={}", userId, UserHolder.getCommunityId());
    }

    @Override
    public List<MessageVO> listMessages() {
        LambdaQueryWrapper<UserMessage> wrapper = new LambdaQueryWrapper<>();
        applyAdminScope(wrapper);
        wrapper.orderByDesc(UserMessage::getCreatedAt);
        return this.list(wrapper).stream().map(this::toVO).collect(Collectors.toList());
    }

    @Override
    public List<MessageVO> listMyMessages() {
        Long userId = UserHolder.getUserId();
        List<Long> myIds = this.lambdaQuery().eq(UserMessage::getSenderUserId, userId).list()
                .stream().map(UserMessage::getId).collect(Collectors.toList());
        if (myIds.isEmpty()) {
            return List.of();
        }
        LambdaQueryWrapper<UserMessage> wrapper = new LambdaQueryWrapper<>();
        wrapper.and(w -> w.eq(UserMessage::getSenderUserId, userId)
                .or()
                .in(UserMessage::getReplyToId, myIds));
        wrapper.orderByAsc(UserMessage::getCreatedAt);
        return this.list(wrapper).stream().map(this::toVO).collect(Collectors.toList());
    }

    @Override
    public void replyToMessage(Long messageId, String content) {
        if (content == null || content.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "回复内容不能为空");
        }
        UserMessage original = this.getById(messageId);
        if (original == null) {
            throw new BusinessException("原消息不存在");
        }
        checkAdminCommunity(original);

        Long userId = UserHolder.getUserId();
        Users admin = usersMapper.selectById(userId);
        UserMessage reply = new UserMessage();
        reply.setSenderUserId(userId);
        reply.setSenderUsername(admin != null ? admin.getUsername() : null);
        reply.setSenderRole("ADMIN");
        reply.setCommunityId(original.getCommunityId());
        reply.setType(original.getType());
        reply.setContent(content);
        reply.setStatus("UNREAD");
        reply.setReplyToId(messageId);
        reply.setCreatedAt(LocalDateTime.now());
        this.save(reply);
        log.info("管理员回复消息: replyToId={}, operatorId={}", messageId, userId);
    }

    @Override
    public void markRead(Long messageId) {
        UserMessage msg = this.getById(messageId);
        if (msg == null) {
            throw new BusinessException("消息不存在");
        }
        checkAdminCommunity(msg);
        msg.setStatus("READ");
        this.updateById(msg);
    }

    /** 管理员查消息时的小区隔离：系统看全部，小区看本小区 */
    private void applyAdminScope(LambdaQueryWrapper<UserMessage> wrapper) {
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long communityId = UserHolder.getCommunityId();
            wrapper.eq(communityId != null, UserMessage::getCommunityId, communityId);
        }
    }

    /** 小区管理员只能操作本小区消息 */
    private void checkAdminCommunity(UserMessage msg) {
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long communityId = UserHolder.getCommunityId();
            if (communityId == null || !communityId.equals(msg.getCommunityId())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "无权操作其他小区消息");
            }
        }
    }

    private MessageVO toVO(UserMessage m) {
        return MessageVO.builder()
                .id(String.valueOf(m.getId()))
                .senderUserId(m.getSenderUserId())
                .senderUsername(m.getSenderUsername())
                .communityId(m.getCommunityId())
                .type(m.getType())
                .content(m.getContent())
                .status(m.getStatus())
                .replyToId(m.getReplyToId())
                .senderRole(m.getSenderRole())
                .createdAt(m.getCreatedAt() != null ? String.valueOf(m.getCreatedAt()) : null)
                .build();
    }
}
