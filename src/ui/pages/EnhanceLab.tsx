import React, { useState } from 'react';
import { Sparkles, Image as ImageIcon, FileText, Film } from 'lucide-react';
import { LabPageLayout } from '../components/LabPageLayout';
import { ImageEnhancePanel } from './enhance/ImageEnhancePanel';
import { PdfEnhancePanel } from './enhance/PdfEnhancePanel';
import { VideoEnhancePanel } from './enhance/VideoEnhancePanel';
import './EnhanceLab.css';

type LabTab = 'image' | 'pdf' | 'video';

const TABS = [
  { key: 'image', label: '图片增强', icon: <ImageIcon size={14} /> },
  { key: 'pdf', label: 'PDF 增强', icon: <FileText size={14} /> },
  { key: 'video', label: '视频增强', icon: <Film size={14} /> },
];

/**
 * 清晰度提升实验室
 *
 * 与去水印实验室并列，提供图片 / PDF / 视频画质增强能力。
 * 浏览器端本地处理，隐私零上传。
 */
export const EnhanceLab: React.FC = () => {
  const [activeTab, setActiveTab] = useState<LabTab>('image');

  return (
    <LabPageLayout
      icon={<Sparkles size={22} />}
      iconBg="color-mix(in srgb, var(--lab-color-enhance) 10%, transparent)"
      iconColor="var(--lab-color-enhance)"
      title="清晰度提升实验室"
      subtitle="浏览器端本地处理 · 图片 / PDF / 视频画质增强 · 隐私安全零上传"
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(t) => setActiveTab(t as LabTab)}
    >
      {activeTab === 'image' && <ImageEnhancePanel />}
      {activeTab === 'pdf' && <PdfEnhancePanel />}
      {activeTab === 'video' && <VideoEnhancePanel />}
    </LabPageLayout>
  );
};
