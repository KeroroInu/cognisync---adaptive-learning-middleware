import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './views/Dashboard';
import { Chat } from './views/Chat';
import { KnowledgeGraph } from './views/KnowledgeGraph';
import { Calibration } from './views/Calibration';
import { Evidence } from './views/Evidence';
import { useAppStore } from './services/store';

function App() {
  const { state, theme, toggleTheme, toggleResearchMode, setLanguage, addMessage, addCalibrationLog, updateNode, updateProfile } = useAppStore();
  const [currentView, setCurrentView] = useState<'dashboard' | 'chat' | 'graph' | 'calibration' | 'evidence'>('dashboard');

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard profile={state.profile} onNavigate={setCurrentView} language={state.language} theme={theme} />;
      case 'chat':
        return (
          <Chat
            messages={state.messages}
            onSendMessage={addMessage}
            onUpdateProfile={updateProfile}
            language={state.language}
            isResearchMode={state.isResearchMode}
            theme={theme}
          />
        );
      case 'graph':
        return (
          <KnowledgeGraph
            nodes={state.nodes}
            edges={state.edges}
            onNodeUpdate={updateNode}
            onLogCalibration={addCalibrationLog}
            language={state.language}
            theme={theme}
          />
        );
      case 'calibration':
        return (
          <Calibration
            profile={state.profile}
            onLogCalibration={addCalibrationLog}
            language={state.language}
            theme={theme}
          />
        );
      case 'evidence':
        return <Evidence logs={state.logs} messages={state.messages} language={state.language} theme={theme} />;
      default:
        return <Dashboard profile={state.profile} onNavigate={setCurrentView} language={state.language} theme={theme} />;
    }
  };

  return (
    <Layout
      currentView={currentView}
      onViewChange={setCurrentView}
      isResearchMode={state.isResearchMode}
      onToggleResearch={toggleResearchMode}
      language={state.language}
      onSetLanguage={setLanguage}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {renderContent()}
    </Layout>
  );
}

export default App;