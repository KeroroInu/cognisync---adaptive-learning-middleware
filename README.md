# 🧠 CogniSync - Adaptive Learning Middleware

<div align="center">

**A research prototype for Educational Agent Middleware**
Real-time learner profiling • Knowledge graph visualization • Human-in-the-loop calibration

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb.svg)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[Features](#-features) • [Architecture](#-architecture) • [Installation](#-installation) • [Usage](#-usage) • [Research Context](#-research-context)

</div>

---

## 📖 Overview

CogniSync is an interactive middleware system designed to measure and improve AI-human alignment in educational contexts. It features:

- **Three-dimensional Learner Modeling**: Tracks cognition, affect, and behavior in real-time
- **Dynamic Knowledge Graph**: Visualizes concept mastery and relationships with D3.js
- **User-in-the-Loop Calibration**: Allows learners to dispute AI assessments and log disagreements
- **Research-oriented Design**: Exports structured data for studying model trustworthiness

## ✨ Features

### 🎯 Real-time Learner Profiling
- Multi-dimensional assessment (Cognition / Affect / Behavior)
- Radar chart visualization with comparative overlays
- Automatic profile updates based on conversational interactions

### 🕸️ Interactive Knowledge Graph
- Force-directed graph layout powered by D3.js
- Node size reflects concept frequency
- Color-coded mastery levels (weak/developing/mastered)
- Click-to-calibrate: Users can flag and adjust incorrect assessments

### 💬 Conversational Interface
- Simulated turn-by-turn analysis (intent, emotion, concept detection)
- Real-time delta calculations for profile updates
- Context-aware responses with mock NLP logic

### ⚖️ Calibration & Alignment
- Side-by-side comparison of AI vs. user self-assessment
- Disagreement index calculation
- 5-point Likert trust scale
- Exportable calibration logs (JSON)

### 🌐 Internationalization
- Full support for Chinese (中文) and English
- One-click language switching

---

## 🏗️ Architecture

```
cognisync/
├── components/          # Reusable UI components
│   ├── Layout.tsx       # App shell with navigation
│   └── RadarDisplay.tsx # Radar chart visualization
├── views/               # Main application views
│   ├── Dashboard.tsx    # Overview & metrics
│   ├── Chat.tsx         # Conversational interface
│   ├── KnowledgeGraph.tsx # D3 graph visualization
│   ├── Calibration.tsx  # User calibration panel
│   └── Evidence.tsx     # Research logs & export
├── services/
│   └── store.ts         # Global state management (React Hooks)
├── utils/
│   └── translations.ts  # i18n strings
├── types.ts             # TypeScript type definitions
└── constants.ts         # Initial mock data
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | React 19.2 + TypeScript 5.8 |
| **Build Tool** | Vite 6.2 |
| **Visualization** | D3.js 7 (graphs), Recharts 3.6 (radar charts) |
| **State** | React Hooks (custom store) |
| **Styling** | Tailwind CSS |

---

## 🚀 Installation

### Prerequisites
- Node.js 18+ (recommended: 20.x)
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/cognisync---adaptive-learning-middleware.git
cd cognisync---adaptive-learning-middleware

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run preview  # Preview production build
```

---

## 🎮 Usage

### 1. Dashboard
View the current learner profile with three-dimensional metrics and recent shifts.

### 2. Chat Interface
Interact with the simulated AI tutor. The system will:
- Detect user intent and emotion
- Extract mentioned concepts
- Update the learner profile in real-time

### 3. Knowledge Graph
- **Explore**: Drag nodes, search concepts, view mastery details
- **Calibrate**: Click a node → Adjust mastery → Submit reason → Log disagreement

### 4. Calibration Panel
- Adjust the three profile dimensions (cognition/affect/behavior)
- Compare AI assessment vs. your self-perception
- Rate your trust in the model (1-5 scale)

### 5. Evidence Logs
- Review all calibration events with timestamps
- Export data as JSON for research analysis

---

## 🔬 Research Context

### Design Goals
1. **Measure AI-Human Alignment**: Quantify disagreement between model predictions and user self-assessment
2. **Enable User Agency**: Allow learners to dispute and correct model inferences
3. **Support HCI Research**: Export structured logs for studying trust, calibration patterns, and model explainability

### Data Collection
The system logs:
- `CalibrationLog[]`: User corrections with disagreement indices and trust scores
- `ChatMessage[]`: Conversational turns with analysis metadata
- `Node[]`: Knowledge graph state with flagged concepts

Export via the **Evidence** page or programmatically:
```typescript
import { useAppStore } from './services/store';

const { state } = useAppStore();
const researchData = {
  logs: state.logs,
  messages: state.messages,
  profile: state.profile
};
```

---

## 🛠️ Configuration

### Mock Analysis Logic
The current chat analysis is rule-based (see [views/Chat.tsx](views/Chat.tsx)). To integrate a real AI model:

```typescript
// Replace mock logic in Chat.tsx handleSubmit
const response = await fetch('YOUR_API_ENDPOINT', {
  method: 'POST',
  body: JSON.stringify({ message: input })
});
const { text, analysis } = await response.json();
onSendMessage(text, 'assistant', analysis);
```

### Initial Data
Modify [constants.ts](constants.ts) to customize:
- Initial profile values
- Pre-loaded knowledge concepts
- Sample messages

---

## 📊 Key Concepts

### UserProfile
```typescript
{
  cognition: number,   // 0-100: Knowledge retention & reasoning
  affect: number,      // 0-100: Engagement & frustration
  behavior: number,    // 0-100: Interaction patterns
  lastUpdate: string   // ISO timestamp
}
```

### Node (Knowledge Concept)
```typescript
{
  id: string,
  name: string,
  mastery: number,     // 0-100: Understanding level
  frequency: number,   // 1-10: Mention count (affects size)
  isFlagged: boolean,  // User has disputed this assessment
  description: string
}
```

### CalibrationLog
```typescript
{
  type: 'Profile' | 'Node',
  modelValue: number | UserProfile,
  userValue: number | UserProfile,
  reason: string,
  disagreementIndex: number,  // Absolute difference
  likertTrust?: number        // 1-5 scale
}
```

---

## 🤝 Contributing

We welcome contributions! Areas for improvement:
- [ ] Persistent storage (LocalStorage/IndexedDB)
- [ ] Real AI model integration (OpenAI, Gemini, etc.)
- [ ] Advanced graph analytics (centrality, clustering)
- [ ] Mobile responsive design enhancements
- [ ] Unit tests for state management

Please open an issue first to discuss major changes.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

---

## 🙏 Acknowledgments

- Built with [Vite](https://vitejs.dev/) and [React](https://react.dev/)
- Visualization powered by [D3.js](https://d3js.org/) and [Recharts](https://recharts.org/)
- Icons from [Lucide React](https://lucide.dev/)

---

## 📧 Contact

For research collaborations or questions:
- Open an issue on [GitHub Issues](https://github.com/yourusername/cognisync---adaptive-learning-middleware/issues)
- Email: your.email@example.com

---

<div align="center">
Made with ❤️ for AI-Human Alignment Research
</div>
>>>>>>> 2014a43 (Initial commit)
