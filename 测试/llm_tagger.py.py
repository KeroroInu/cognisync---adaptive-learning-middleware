import pandas as pd
import ollama

# 1. 加载我们刚下好的数据集
df = pd.read_csv("goemotions_train_clean.csv")

# 2. 为了快速测试，我们随机抽取 20 条数据跑一下，而不是跑几十万条
test_df = df.sample(n=20, random_state=42).reset_index(drop=True)

# 3. 极其严格的 System Prompt (结合了你的 12 维文本特征)
system_prompt = """
你是一个教育心理学与情感计算专家。
请根据以下12维情感状态分类表，分析用户输入的英文文本，并仅输出对应的标签代码。
[C01]好奇探究 (Curious)：提问，探究原因
[C02]困惑迟疑 (Confused)：表达不懂、不确定、迷茫
[C03]顿悟 (Eureka)：恍然大悟，明白道理
[C04]挫败沮丧 (Frustrated)：抱怨难，放弃，做不出
[C05]焦虑恐惧 (Anxious)：害怕，紧张，担忧
[C06]兴奋愉悦 (Excited)：开心，极度赞美，手舞足蹈
[C07]自信骄傲 (Confident)：确信，自豪，炫耀
[C08]深思投入 (Thoughtful)：假设性提问，思考中
[C09]赞赏亲近 (Intimate)：友善，赞美系统，情感依赖
[C10]愤怒不耐 (Anger)：生气，不耐烦，指责
[C11]排斥厌恶 (Disgust)：无聊，反感，拒绝
[C12]质疑抗辩 (Disapproval)：反驳，提出质疑

要求：
1. 不要解释你的理由。
2. 严格只输出方括号和代码，例如：[C02]
3. 如果你认为没有任何情绪，输出：[Neutral]
"""

results = []

print("🚀 开始调用本地大模型进行情感标注测试...\n")

for index, row in test_df.iterrows():
    text = row['text']
    print(f"[{index + 1}/20] 原文: {text}")

    # 这里的 'qwen3:8b' 必须和你软件里下载的名字完全一致
    # 如果你下的是 4b，就改成 qwen3:4b
    try:
        response = ollama.chat(model='qwen3:8b', messages=[
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': text}
        ])

        prediction = response['message']['content'].strip()
        print(f"      🤖 模型预测: {prediction}\n")
        results.append(prediction)
    except Exception as e:
        print(f"调用模型失败: {e}")
        results.append("[ERROR]")

test_df['LLM_Prediction'] = results
test_df.to_csv("llm_test_results.csv", index=False, encoding='utf-8-sig')
print("✅ 测试完成！对比结果已保存到 llm_test_results.csv")