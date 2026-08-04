import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Image as ImageIcon, FileText, Film } from 'lucide-react';
import { LabPageLayout } from '../components/LabPageLayout';
import { ImageEnhancePanel } from './enhance/ImageEnhancePanel';
import { PdfEnhancePanel } from './enhance/PdfEnhancePanel';
import { VideoEnhancePanel } from './enhance/VideoEnhancePanel';
import './EnhanceLab.css';

type LabTab = 'image' | 'pdf' | 'video';

const TABS = [
  { key: 'image' as LabTab, labelKey: 'enhanceLab.tabImage', icon: <ImageIcon size={14} /> },
  { key: 'pdf' as LabTab, labelKey: 'enhanceLab.tabPdf', icon: <FileText size={14} /> },
  { key: 'video' as LabTab, labelKey: 'enhanceLab.tabVideo', icon: <Film size={14} /> },
];

/**
 * 清晰度提升实验室
 *
 * 与去水印实验室并列，提供图片 / PDF / 视频画质增强能力。
 * 浏览器端本地处理，隐私零上传。
 */
export const EnhanceLab: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<LabTab>('image');

  const tabs = TABS.map(tab => ({ ...tab, label: t(tab.labelKey) }));

  return (
    <LabPageLayout
      icon={<Sparkles size={22} />}
      iconBg="color-mix(in srgb, var(--lab-color-enhance) 10%, transparent)"
      iconColor="var(--lab-color-enhance)"
      title={t('enhanceLab.title', '清晰度提升实验室')}
      subtitle={t('enhanceLab.subtitle', '浏览器端本地处理 · 图片 / PDF / 视频画质增强 · 隐私安全零上传')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as LabTab)}
    >
      {activeTab === 'image' && <ImageEnhancePanel />}
      {activeTab === 'pdf' && <PdfEnhancePanel />}
      {activeTab === 'video' && <VideoEnhancePanel />}
    </LabPageLayout>
  );
};
