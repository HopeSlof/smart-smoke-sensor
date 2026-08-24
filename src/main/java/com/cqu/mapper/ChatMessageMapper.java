package com.cqu.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.cqu.entity.ChatMessage;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface ChatMessageMapper extends BaseMapper<ChatMessage> {
}
