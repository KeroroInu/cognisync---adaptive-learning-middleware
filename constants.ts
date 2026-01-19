import { AppState } from './types';

export const INITIAL_STATE: AppState = {
  isResearchMode: true,
  language: 'zh',
  profile: {
    cognition: 65,
    affect: 42,
    behavior: 78,
    lastUpdate: new Date().toISOString(),
  },
  nodes: [
    { id: '1', name: '神经网络', mastery: 85, frequency: 8, description: '受生物神经网络启发的计算系统。' },
    { id: '2', name: '反向传播', mastery: 45, frequency: 5, description: '用于训练前馈神经网络的算法。' },
    { id: '3', name: '梯度下降', mastery: 60, frequency: 6, description: '用于寻找可微函数局部最小值的优化算法。' },
    { id: '4', name: '激活函数', mastery: 90, frequency: 3, description: '决定神经网络节点输出的函数。' },
    { id: '5', name: '过拟合', mastery: 30, frequency: 7, description: '分析结果与特定数据集对应过于紧密，导致泛化能力差。', isFlagged: true },
    { id: '6', name: 'Python', mastery: 95, frequency: 9, description: '一种高级编程语言。' },
    { id: '7', name: 'TensorFlow', mastery: 50, frequency: 4, description: '用于机器学习的端到端开源平台。' },
  ],
  edges: [
    { source: '1', target: '2' },
    { source: '1', target: '4' },
    { source: '2', target: '3' },
    { source: '5', target: '1' },
    { source: '6', target: '7' },
    { source: '7', target: '1' },
  ],
  messages: [
    {
      id: 'msg_0',
      role: 'assistant',
      text: '你好！我是你的学习伙伴。上次我们讨论到了“过拟合”。我们要继续吗？',
      timestamp: new Date(Date.now() - 100000).toISOString(),
    },
  ],
  logs: [
    {
      id: 'log_init',
      timestamp: new Date(Date.now() - 500000).toISOString(),
      type: 'Profile',
      modelValue: { cognition: 60, affect: 40, behavior: 70, lastUpdate: new Date(Date.now() - 500000).toISOString() },
      userValue: { cognition: 65, affect: 42, behavior: 78, lastUpdate: new Date(Date.now() - 500000).toISOString() },
      reason: "我觉得我比模型评估的要自信一些。",
      disagreementIndex: 15,
      likertTrust: 4
    }
  ]
};