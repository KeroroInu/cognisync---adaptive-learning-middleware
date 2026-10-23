import { ResearchPackagePanel } from '../components/ResearchPackagePanel';
import { StudentAdvicePanel } from '../components/StudentAdvicePanel';
import './Exports.css';

export function Exports() {
  return <div className="exports-page">
    <header><h1>实验数据</h1><p>按课次与班级下载，保留学生每一次提交和已采集的研究记录。</p></header>
    <ResearchPackagePanel />
    <StudentAdvicePanel />
    <p className="exports-footnote">下载不会删除或覆盖数据。建议每节课后下载留存，并另做服务器数据库和文件备份。</p>
  </div>;
}
