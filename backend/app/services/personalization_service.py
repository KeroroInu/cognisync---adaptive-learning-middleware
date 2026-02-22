"""
Personalization Service - 个性化服务

根据用户画像生成初始知识图谱和个性化对话内容
"""
import logging
from typing import List, Dict
from app.schemas.profile import UserProfile
from app.services.llm_provider import get_provider
from app.services.graph_service import GraphService

logger = logging.getLogger(__name__)


class PersonalizationService:
    """个性化服务"""

    def __init__(self):
        self.llm_provider = get_provider()
        self.graph_service = GraphService()

    def get_cognition_level(self, cognition: int) -> str:
        """
        获取认知水平等级

        Args:
            cognition: 认知维度 [0-100]

        Returns:
            等级: basic | intermediate | advanced | expert
        """
        if cognition <= 30:
            return "basic"
        elif cognition <= 60:
            return "intermediate"
        elif cognition <= 80:
            return "advanced"
        else:
            return "expert"

    def get_cognition_description(self, cognition: int, language: str = "zh") -> str:
        """获取认知水平描述"""
        level = self.get_cognition_level(cognition)
        descriptions = {
            "zh": {
                "basic": "基础认知水平，需要详细指导",
                "intermediate": "中等认知水平，需要一定指导",
                "advanced": "较高认知水平，需要较少指导",
                "expert": "高级认知水平，可自主学习"
            },
            "en": {
                "basic": "Basic cognitive level, needs detailed guidance",
                "intermediate": "Intermediate cognitive level, needs some guidance",
                "advanced": "Advanced cognitive level, needs minimal guidance",
                "expert": "Expert cognitive level, can learn independently"
            }
        }
        return descriptions[language][level]

    def get_affect_level(self, affect: int) -> str:
        """
        获取情感水平等级

        Args:
            affect: 情感维度 [0-100]

        Returns:
            等级: low | medium | high | very_high
        """
        if affect <= 30:
            return "low"
        elif affect <= 60:
            return "medium"
        elif affect <= 80:
            return "high"
        else:
            return "very_high"

    def get_affect_description(self, affect: int, language: str = "zh") -> str:
        """获取情感水平描述"""
        level = self.get_affect_level(affect)
        descriptions = {
            "zh": {
                "low": "消极情绪，容易放弃",
                "medium": "中性情绪，动力不足",
                "high": "积极情绪，有兴趣",
                "very_high": "非常积极，高度投入"
            },
            "en": {
                "low": "Negative emotions, tends to give up",
                "medium": "Neutral emotions, lacks motivation",
                "high": "Positive emotions, interested",
                "very_high": "Very positive, highly engaged"
            }
        }
        return descriptions[language][level]

    def get_behavior_level(self, behavior: int) -> str:
        """
        获取行为水平等级

        Args:
            behavior: 行为维度 [0-100]

        Returns:
            等级: guided | structured | flexible | self_directed
        """
        if behavior <= 30:
            return "guided"
        elif behavior <= 60:
            return "structured"
        elif behavior <= 80:
            return "flexible"
        else:
            return "self_directed"

    def get_behavior_description(self, behavior: int, language: str = "zh") -> str:
        """获取行为水平描述"""
        level = self.get_behavior_level(behavior)
        descriptions = {
            "zh": {
                "guided": "行为不稳定，需要引导",
                "structured": "行为较稳定，有规律",
                "flexible": "行为稳定，习惯良好",
                "self_directed": "行为非常稳定，高度自律"
            },
            "en": {
                "guided": "Unstable behavior, needs guidance",
                "structured": "Relatively stable behavior, has routine",
                "flexible": "Stable behavior, good habits",
                "self_directed": "Very stable behavior, highly self-disciplined"
            }
        }
        return descriptions[language][level]

    async def generate_initial_graph(
        self,
        cognition: float,
        affect: float,
        behavior: float,
        num_concepts: int = 10
    ) -> List[Dict]:
        """
        根据用户画像生成初始知识图谱

        Args:
            cognition: 认知维度 [0-100]
            affect: 情感维度 [0-100]
            behavior: 行为维度 [0-100]
            num_concepts: 生成概念数量

        Returns:
            概念列表
        """
        # 1. 确定知识深度
        depth_map = {
            "basic": "基础",
            "intermediate": "中等",
            "advanced": "进阶",
            "expert": "专家"
        }
        depth = depth_map[self.get_cognition_level(int(cognition))]

        # 2. 确定知识点类型
        type_map = {
            "low": "有趣",
            "medium": "平衡",
            "high": "挑战",
            "very_high": "探索"
        }
        topic_type = type_map[self.get_affect_level(int(affect))]

        # 3. 确定学习路径
        path_map = {
            "guided": "引导",
            "structured": "结构化",
            "flexible": "灵活",
            "self_directed": "自主"
        }
        path_type = path_map[self.get_behavior_level(int(behavior))]

        # 4. 使用 LLM 生成概念
        prompt = f"""你是一个教育内容设计专家。请根据以下用户画像生成{num_concepts}个初始学习概念。

用户画像：
- 认知水平：{cognition}/100 ({depth})
- 情感状态：{affect}/100 ({topic_type})
- 行为习惯：{behavior}/100 ({path_type})

要求：
1. 概念应该适合用户的认知水平
2. 概念应该有趣或具有挑战性（根据情感状态）
3. 概念之间应该有逻辑关联
4. 每个概念应该包含名称、类别、重要性和相关概念

请以JSON格式返回，格式如下：
```json
{{
  "concepts": [
    {{
      "name": "概念名称",
      "category": "概念类别",
      "importance": 0.8,
      "relatedConcepts": ["相关概念1", "相关概念2"]
    }}
  ]
}}
```
"""

        try:
            response = await self.llm_provider.generate(
                prompt=prompt,
                system_prompt="你是一个教育内容设计专家，擅长根据学习者画像设计个性化的学习内容。"
            )

            # 解析 JSON 响应
            import json
            import re

            # 提取 JSON 部分
            json_match = re.search(r'```json\s*(\{.*\})\s*```', response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                # 尝试直接解析
                json_str = response

            data = json.loads(json_str)
            return data.get("concepts", [])

        except Exception as e:
            logger.error(f"Failed to generate initial graph: {e}", exc_info=True)
            # 返回空列表，让系统从对话中浮现
            return []

    def build_personalized_prompt(
        self,
        user_profile: UserProfile,
        knowledge_graph: List[Dict],
        emotion: str,
        language: str = "zh"
    ) -> str:
        """
        构建个性化系统提示词

        Args:
            user_profile: 用户画像
            knowledge_graph: 知识图谱
            emotion: 当前情感状态
            language: 界面语言

        Returns:
            个性化系统提示词
        """
        # 1. 基础角色定义
        base_role = {
            "zh": "你是一个专业的教育助手，帮助学习者理解和掌握知识。",
            "en": "You are a professional educational assistant helping learners understand and master knowledge."
        }[language]

        # 2. 根据认知维度调整内容深度
        cognition_level = self.get_cognition_level(user_profile.cognition)
        cognition_instruction = {
            "zh": {
                "basic": "使用简单、清晰的语言，避免专业术语，多用类比和例子。",
                "intermediate": "使用中等难度的语言，可以适当使用专业术语，但要解释清楚。",
                "advanced": "可以使用专业术语，提供深入的内容和复杂的概念。",
                "expert": "可以使用高度专业的语言，提供最前沿的知识和深度分析。"
            },
            "en": {
                "basic": "Use simple, clear language. Avoid jargon. Use analogies and examples.",
                "intermediate": "Use moderate language. You can use some technical terms but explain them clearly.",
                "advanced": "Use technical terms. Provide in-depth content and complex concepts.",
                "expert": "Use highly professional language. Provide cutting-edge knowledge and deep analysis."
            }
        }[language][cognition_level]

        # 3. 根据情感维度调整语气
        affect_level = self.get_affect_level(user_profile.affect)
        affect_instruction = {
            "zh": {
                "low": "保持温和、鼓励的语气。多用积极的话语，避免让用户感到压力。",
                "medium": "保持友好、耐心的态度。适当使用鼓励的话语。",
                "high": "保持积极、热情的语气。鼓励用户深入探索。",
                "very_high": "保持挑战性、探索性的语气。鼓励用户创新和独立思考。"
            },
            "en": {
                "low": "Be gentle and encouraging. Use positive words. Avoid making the user feel pressured.",
                "medium": "Be friendly and patient. Use some encouraging words.",
                "high": "Be positive and enthusiastic. Encourage the user to explore deeply.",
                "very_high": "Be challenging and exploratory. Encourage the user to innovate and think independently."
            }
        }[language][affect_level]

        # 4. 根据行为维度调整互动方式
        behavior_level = self.get_behavior_level(user_profile.behavior)
        behavior_instruction = {
            "zh": {
                "guided": "提供明确的指导和建议，帮助用户建立学习习惯。",
                "structured": "提供结构化的学习路径，鼓励用户按照计划学习。",
                "flexible": "提供灵活的学习建议，允许用户按照自己的节奏学习。",
                "self_directed": "尊重用户的自主学习，只在必要时提供建议。"
            },
            "en": {
                "guided": "Provide clear guidance and suggestions to help the user establish learning habits.",
                "structured": "Provide structured learning paths and encourage the user to follow the plan.",
                "flexible": "Provide flexible learning suggestions and allow the user to learn at their own pace.",
                "self_directed": "Respect the user's self-directed learning and only provide suggestions when necessary."
            }
        }[language][behavior_level]

        # 5. 根据知识图谱提供针对性内容
        if knowledge_graph:
            key_concepts = [c["name"] for c in knowledge_graph[:5]]
            concepts_msg = {
                "zh": f"用户当前关注的知识点：{', '.join(key_concepts)}。在对话中，尽量围绕这些知识点展开。",
                "en": f"User's current focus areas: {', '.join(key_concepts)}. Try to center the conversation around these topics."
            }[language]
        else:
            concepts_msg = {
                "zh": "用户的知识图谱尚在构建中，请从对话中识别关键概念并帮助用户构建知识体系。",
                "en": "The user's knowledge graph is still being built. Identify key concepts from the conversation and help the user build their knowledge system."
            }[language]

        # 6. 组合完整的系统提示词
        system_prompt = f"""{base_role}

当前用户画像：
- 认知维度: {user_profile.cognition}/100 ({self.get_cognition_description(user_profile.cognition, language)})
- 情感维度: {user_profile.affect}/100 ({self.get_affect_description(user_profile.affect, language)})
- 行为维度: {user_profile.behavior}/100 ({self.get_behavior_description(user_profile.behavior, language)})

教学指导：
1. 内容深度：{cognition_instruction}
2. 语气调整：{affect_instruction}
3. 互动方式：{behavior_instruction}
4. 知识点：{concepts_msg}

当前情感状态：{emotion}

请根据上述指导，为用户提供个性化的学习支持。
"""

        logger.debug(f"Generated personalized prompt for user with cognition={user_profile.cognition}")

        return system_prompt

    async def update_graph_from_conversation(
        self,
        user_id: str,
        message: str,
        current_graph: List[Dict],
        user_profile: UserProfile
    ) -> List[Dict]:
        """
        根据对话内容更新知识图谱

        Args:
            user_id: 用户 ID
            message: 用户消息
            current_graph: 当前知识图谱
            user_profile: 用户画像

        Returns:
            更新后的知识图谱
        """
        # 1. 分析消息中的概念
        from app.services.text_analyzer import TextAnalyzer
        analyzer = TextAnalyzer()

        analysis = await analyzer.analyze(
            user_message=message,
            recent_messages=[]
        )

        # 2. 如果有检测到新概念，添加到图谱
        if analysis.detectedConcepts:
            # 计算概念重要性
            new_concepts = []
            for concept in analysis.detectedConcepts:
                # 计算重要性（基于用户画像）
                importance = self._calculate_concept_importance(
                    concept,
                    user_profile
                )

                # 查找相关概念
                related = self._find_related_concepts(
                    concept.get("name", ""),
                    current_graph
                )

                new_concepts.append({
                    "name": concept.get("name", ""),
                    "category": concept.get("category", "general"),
                    "importance": importance,
                    "relatedConcepts": related
                })

            # 合并新旧概念（去重）
            updated_graph = self._merge_concepts(current_graph, new_concepts)

            # 保存到数据库
            try:
                await self.graph_service.upsert_concepts(
                    user_id=user_id,
                    concepts=updated_graph
                )
                logger.info(f"Updated knowledge graph for user {user_id} with {len(new_concepts)} new concepts")
            except Exception as e:
                logger.warning(f"Failed to update knowledge graph: {e}")

            return updated_graph

        # 3. 如果没有新概念，返回当前图谱
        return current_graph

    def _calculate_concept_importance(
        self,
        concept: Dict,
        user_profile: UserProfile
    ) -> float:
        """
        计算概念重要性

        基于用户画像调整概念的重要性

        Args:
            concept: 概念对象
            user_profile: 用户画像

        Returns:
            重要性值 [0.0-1.0]
        """
        # 基础重要性（从概念中获取，默认 0.5）
        base_importance = concept.get("importance", 0.5)

        # 根据认知维度调整（认知水平越高，概念的区分度越高）
        cognition_factor = 0.8 + (user_profile.cognition / 100.0) * 0.4

        # 根据情感维度调整（情感积极性越高，概念的重要性越高）
        affect_factor = 0.8 + (user_profile.affect / 100.0) * 0.4

        # 综合计算
        final_importance = base_importance * cognition_factor * affect_factor

        # Clamp to [0.0, 1.0]
        return max(0.0, min(1.0, final_importance))

    def _find_related_concepts(
        self,
        concept_name: str,
        current_graph: List[Dict]
    ) -> List[str]:
        """
        查找相关概念

        Args:
            concept_name: 概念名称
            current_graph: 当前知识图谱

        Returns:
            相关概念名称列表
        """
        related = []

        # 简单实现：查找名称相似的概念
        for concept in current_graph:
            name = concept.get("name", "")
            if name != concept_name and concept_name.lower() in name.lower():
                related.append(name)

        # 最多返回 5 个相关概念
        return related[:5]

    def _merge_concepts(
        self,
        current_graph: List[Dict],
        new_concepts: List[Dict]
    ) -> List[Dict]:
        """
        合并概念列表（去重）

        Args:
            current_graph: 当前知识图谱
            new_concepts: 新概念列表

        Returns:
            合并后的概念列表
        """
        # 创建名称到概念的映射
        concept_map = {c["name"]: c for c in current_graph}

        # 添加新概念（去重）
        for concept in new_concepts:
            name = concept["name"]
            if name not in concept_map:
                concept_map[name] = concept

        # 返回列表
        return list(concept_map.values())
