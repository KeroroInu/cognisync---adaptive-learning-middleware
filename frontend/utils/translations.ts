
export const translations = {
  zh: {
    // Navigation
    dashboard: "总览",
    chat: "对话",
    graph: "知识图谱",
    calibration: "校准与纠偏",
    evidence: "证据日志",
    researchMode: "研究模式",
    systemActive: "系统运行中",
    
    // Dashboard
    cognition: "认知",
    affect: "情感",
    behavior: "行为",
    modelLabel: "模型评估",
    userLabel: "用户自评",
    recentShifts: "近期变化",
    quickActions: "快捷操作",
    startDialogue: "开始对话",
    exploreGraph: "探索图谱",
    calibrateModel: "校准模型",
    
    // Chat
    inputPlaceholder: "输入您的回复...",
    turnAnalysis: "本轮分析",
    detectedIntent: "识别意图",
    emotionState: "情绪状态",
    profileImpact: "画像影响",
    systemStatus: "系统状态",
    trackingConcepts: "概念追踪中",
    
    // Graph
    searchConcept: "搜索知识点...",
    masteryLevel: "掌握程度",
    definition: "定义",
    evidenceSection: "依据",
    disagree: "我认为掌握度不是这样",
    calibrateNode: "校准知识点",
    yourEstimate: "您的评估 (0-100)",
    reason: "理由",
    submit: "提交",
    cancel: "取消",
    flagged: "用户曾纠偏",
    legendWeak: "薄弱",
    legendDeveloping: "发展中",
    legendMastered: "已掌握",

    // Calibration
    modelAlignment: "模型一致性检查",
    compareDesc: "对比AI的评估（紫）与您的自我认知（绿）。",
    totalDisagreement: "总分歧指数",
    highAlignment: "一致性高。模型非常了解您。",
    divergenceDetected: "检测到显著差异。建议进行校准。",
    adjustDimensions: "调整维度",
    whyDiffer: "您认为存在差异的原因？",
    reasonPlaceholder: "例如：我当时分心了，并不是困惑...",
    researchQuestion: "研究问题：“我信任该模型对我学习状态的评估。”",
    stronglyDisagree: "非常不同意",
    stronglyAgree: "非常同意",
    confirmSubmit: "确认并提交校准",
    calibrationRecorded: "校准已记录",
    
    // Evidence
    researchLogs: "研究日志与证据",
    logsDesc: "系统变化与用户校准的时间轴记录。",
    exportJson: "导出 JSON",
    noLogs: "尚无校准记录。请前往校准或知识图谱页面调整模型。",
    trustScore: "信任评分",

    // 认证 - 登录
    login: "登录",
    loginTitle: "登录 CogniSync",
    loginDesc: "欢迎回来！请登录您的账户",
    email: "邮箱地址",
    emailPlaceholder: "your@email.com",
    password: "密码",
    passwordPlaceholder: "输入密码",
    loginButton: "登录",
    loggingIn: "登录中...",
    noAccount: "还没有账户？",
    signUp: "注册",
    loginError: "登录失败",

    // 认证 - 注册
    register: "注册",
    registerTitle: "注册 CogniSync",
    registerDesc: "创建账户，开始您的个性化学习之旅",
    name: "姓名",
    namePlaceholder: "张三",
    registerButton: "注册",
    registering: "注册中...",
    hasAccount: "已有账户？",

    // 注册模式选择
    chooseOnboardingMode: "选择注册方式",
    chooseOnboardingDesc: "我们提供两种方式帮助您建立初始学习画像",
    scaleMode: "量表注册",
    scaleModeDesc: "完成简短的问卷调查（5-10分钟）",
    scaleModeFeatures: [
      "标准化Likert量表",
      "科学心理测量",
      "快速完成",
      "即时生成初始画像"
    ],
    aiMode: "AI引导注册",
    aiModeDesc: "与AI对话，自然探索您的学习特征（10-15分钟）",
    aiModeFeatures: [
      "自然对话体验",
      "深入了解学习习惯",
      "个性化问题",
      "更丰富的初始画像"
    ],
    selectMode: "选择此方式",

    // 量表注册
    scaleOnboarding: "量表注册",
    scaleOnboardingDesc: "请根据您的实际情况回答以下问题",
    scaleInstruction: "1 = 非常不同意，5 = 非常同意",
    questionProgress: "问题 {current} / {total}",
    previous: "上一题",
    next: "下一题",
    submitScale: "提交问卷",
    submittingScale: "提交中...",
    scaleComplete: "问卷完成",
    scaleCompleteDesc: "正在生成您的初始学习画像...",

    // AI 引导注册
    aiOnboarding: "AI 引导注册",
    aiOnboardingDesc: "AI 将通过对话了解您的学习风格和习惯",
    aiThinking: "AI 正在思考...",
    answerPlaceholder: "输入您的回答...",
    sendAnswer: "发送",
    sessionSummary: "对话小结",
    draftProfile: "草稿画像",
    completeOnboarding: "完成注册",
    completingOnboarding: "完成中...",

    // 通用
    loading: "加载中...",
    error: "错误",
    success: "成功",
    welcome: "欢迎",
    logout: "登出",
    continueText: "继续",
    back: "返回"
  },
  en: {
    // Navigation
    dashboard: "Dashboard",
    chat: "Chat",
    graph: "Knowledge Graph",
    calibration: "Calibration",
    evidence: "Evidence",
    researchMode: "Research Mode",
    systemActive: "System Active",
    
    // Dashboard
    cognition: "Cognition",
    affect: "Affect",
    behavior: "Behavior",
    modelLabel: "AI Model",
    userLabel: "Your Self-Assessment",
    recentShifts: "Recent Shifts",
    quickActions: "Quick Actions",
    startDialogue: "Start Dialogue",
    exploreGraph: "Explore Graph",
    calibrateModel: "Calibrate Model",

    // Chat
    inputPlaceholder: "Type your response...",
    turnAnalysis: "Turn Analysis",
    detectedIntent: "Detected Intent",
    emotionState: "Emotion State",
    profileImpact: "Profile Impact",
    systemStatus: "System Status",
    trackingConcepts: "Tracking Concepts",

    // Graph
    searchConcept: "Search concept...",
    masteryLevel: "Mastery Level",
    definition: "Definition",
    evidenceSection: "Evidence",
    disagree: "I disagree with this assessment",
    calibrateNode: "Calibrate Node",
    yourEstimate: "Your Estimate (0-100)",
    reason: "Reason",
    submit: "Submit",
    cancel: "Cancel",
    flagged: "Previously flagged",
    legendWeak: "Weak",
    legendDeveloping: "Developing",
    legendMastered: "Mastered",

    // Calibration
    modelAlignment: "Model Alignment Check",
    compareDesc: "Compare the AI's assessment (Purple) with your own self-perception (Green).",
    totalDisagreement: "Total Disagreement Index",
    highAlignment: "High alignment. The model likely understands you well.",
    divergenceDetected: "Significant divergence detected. Calibration recommended.",
    adjustDimensions: "Adjust Dimensions",
    whyDiffer: "Why do you differ from the model?",
    reasonPlaceholder: "E.g., I was distracted, not confused...",
    researchQuestion: "Research Question: \"I trust this model's assessment of my learning state.\"",
    stronglyDisagree: "Strongly Disagree",
    stronglyAgree: "Strongly Agree",
    confirmSubmit: "Confirm & Submit Calibration",
    calibrationRecorded: "Calibration Recorded",

    // Evidence
    researchLogs: "Research Logs & Evidence",
    logsDesc: "Chronological record of system changes and user calibrations.",
    exportJson: "Export JSON",
    noLogs: "No calibration events recorded yet. Go to Calibration or Knowledge Graph to adjust the model.",
    trustScore: "Trust Score Recorded",

    // Auth - Login
    login: "Login",
    loginTitle: "Login to CogniSync",
    loginDesc: "Welcome back! Please login to your account",
    email: "Email Address",
    emailPlaceholder: "your@email.com",
    password: "Password",
    passwordPlaceholder: "Enter password",
    loginButton: "Login",
    loggingIn: "Logging in...",
    noAccount: "Don't have an account?",
    signUp: "Sign up",
    loginError: "Login failed",

    // Auth - Register
    register: "Register",
    registerTitle: "Register for CogniSync",
    registerDesc: "Create an account to start your personalized learning journey",
    name: "Name",
    namePlaceholder: "John Doe",
    registerButton: "Register",
    registering: "Registering...",
    hasAccount: "Already have an account?",

    // Onboarding Mode Selection
    chooseOnboardingMode: "Choose Onboarding Mode",
    chooseOnboardingDesc: "We offer two ways to help you build your initial learning profile",
    scaleMode: "Scale-based Registration",
    scaleModeDesc: "Complete a short questionnaire (5-10 minutes)",
    scaleModeFeatures: [
      "Standardized Likert scales",
      "Scientific psychometric measurement",
      "Quick completion",
      "Instant initial profile generation"
    ],
    aiMode: "AI-Guided Registration",
    aiModeDesc: "Chat with AI to naturally explore your learning characteristics (10-15 minutes)",
    aiModeFeatures: [
      "Natural conversation experience",
      "Deep understanding of learning habits",
      "Personalized questions",
      "Richer initial profile"
    ],
    selectMode: "Select This Mode",

    // Scale Onboarding
    scaleOnboarding: "Scale-based Registration",
    scaleOnboardingDesc: "Please answer the following questions based on your actual situation",
    scaleInstruction: "1 = Strongly Disagree, 5 = Strongly Agree",
    questionProgress: "Question {current} / {total}",
    previous: "Previous",
    next: "Next",
    submitScale: "Submit Questionnaire",
    submittingScale: "Submitting...",
    scaleComplete: "Questionnaire Complete",
    scaleCompleteDesc: "Generating your initial learning profile...",

    // AI Onboarding
    aiOnboarding: "AI-Guided Registration",
    aiOnboardingDesc: "AI will understand your learning style and habits through conversation",
    aiThinking: "AI is thinking...",
    answerPlaceholder: "Type your answer...",
    sendAnswer: "Send",
    sessionSummary: "Session Summary",
    draftProfile: "Draft Profile",
    completeOnboarding: "Complete Registration",
    completingOnboarding: "Completing...",

    // Common
    loading: "Loading...",
    error: "Error",
    success: "Success",
    welcome: "Welcome",
    logout: "Logout",
    continueText: "Continue",
    back: "Back"
  }
};