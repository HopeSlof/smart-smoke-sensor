package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.KnowledgeChunks;
import com.cqu.vo.ChatMessageVO;
import com.cqu.vo.ChatRequest;
import com.cqu.vo.ChatResponse;
import com.cqu.vo.ChatSessionVO;
import com.cqu.vo.KnowledgeImportRequest;

import java.util.List;

/**
 * RAG 知识库问答服务
 */
public interface IKnowledgeChunksService extends IService<KnowledgeChunks> {

    /** 基于 RAG 的警情/应急预案问答（返回回答 + 引用来源，支持多轮对话） */
    ChatResponse ask(ChatRequest request);

    /** 导入知识文档（切分 + 向量化并存储） */
    int importDocuments(KnowledgeImportRequest request);

    /** 查询当前用户的会话列表 */
    List<ChatSessionVO> listSessions();

    /** 查询某会话的历史消息 */
    List<ChatMessageVO> getMessages(Long sessionId);

    /** 删除会话及其消息 */
    void deleteSession(Long sessionId);
}
