import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

interface Props {
  value: string;
  language: string;
  theme: 'light' | 'dark';
  onChange: (value: string) => void;
}

const ResearchCodeEditor: React.FC<Props> = ({ value, language, theme, onChange }) => {
  const extensions = useMemo(() => {
    switch (language.toLowerCase()) {
      case 'python':
        return [python()];
      case 'javascript':
      case 'js':
        return [javascript()];
      case 'typescript':
      case 'ts':
        return [javascript({ typescript: true })];
      default:
        return [];
    }
  }, [language]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={theme === 'dark' ? oneDark : undefined}
      height="100%"
      style={{ height: '100%', fontSize: '13px' }}
    />
  );
};

export default ResearchCodeEditor;
