import os
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
from datasets import load_dataset
import pandas as pd

print("开始加载本地缓存的 mrm8488/goemotions 数据集...")
dataset = load_dataset("mrm8488/goemotions")
df_train = dataset['train'].to_pandas()

# 我们重点看文本和几个我们关心的情绪维度
print("\n--- 训练集前 5 行数据示例 ---")
print(df_train[['text', 'curiosity', 'confusion', 'anger', 'neutral']].head())

# 把所有情绪的列名提取出来
emotion_columns = ['admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization', 'relief', 'remorse', 'sadness', 'surprise', 'neutral']

# 我们只保留 'text' 和 所有的情绪列，丢掉那些没有用的网页链接、ID等信息
df_clean = df_train[['text'] + emotion_columns]

# 将清洗后的数据保存到本地
output_file = "goemotions_train_clean.csv"
df_clean.to_csv(output_file, index=False, encoding='utf-8-sig')
print(f"\n大功告成！清洗后的数据已成功保存为：{output_file}")