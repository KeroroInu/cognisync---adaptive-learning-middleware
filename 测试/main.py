import os
import pandas as pd
from datasets import load_dataset

# 设置国内镜像站加速
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

print("正在构建主流情感计算数据集库...")

# 1. 下载 SemEval-2018 (多标签复杂情绪)
print("-> 加载 SemEval-2018 Task 1...")
semeval_dataset = load_dataset("sem_eval_2018_task_1。", "subtask5.english")
df_semeval = semeval_dataset['train'].to_pandas()
df_semeval.to_csv("semeval_2018_train.csv", index=False, encoding='utf-8-sig')

# 2. 下载 TweetEval (包含了情绪强度、反讽等多种常用 Benchmark)
print("-> 加载 TweetEval (Emotion子集)...")
tweet_emotion = load_dataset("tweet_eval", "emotion")
df_tweet_emo = tweet_emotion['train'].to_pandas()
df_tweet_emo.to_csv("tweet_eval_emotion.csv", index=False, encoding='utf-8-sig')

print("-> 加载 TweetEval (Irony反讽子集)...")
tweet_irony = load_dataset("tweet_eval", "irony")
df_tweet_irony = tweet_irony['train'].to_pandas()
df_tweet_irony.to_csv("tweet_eval_irony.csv", index=False, encoding='utf-8-sig')

print("\n🎉 全部下载完成！你的本地数据维度已全面覆盖顶会标准。")