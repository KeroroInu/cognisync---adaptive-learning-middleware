import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Settings2 } from 'lucide-react';
import { InstallerDownloads } from '../components/InstallerDownloads';
import { StudentAssistantConfig } from '../components/StudentAssistantConfig';
import './Classroom.css';

export function TeacherTools() {
  return <div className="classroom-admin teacher-tools-page">
    <header className="classroom-page-header"><div><h1>工具与设置</h1><p>安装包分发与网页助手配置，按需使用。</p></div>
      <Link to="/classroom" className="teacher-utility-link"><ArrowLeft size={16} aria-hidden="true" />返回课堂</Link>
    </header>
    <div className="teacher-tools-layout">
      <div><div className="teacher-section-label"><Download size={16} aria-hidden="true" />软件分发</div><InstallerDownloads /></div>
      <div><div className="teacher-section-label"><Settings2 size={16} aria-hidden="true" />网页助手</div><StudentAssistantConfig /></div>
    </div>
  </div>;
}
