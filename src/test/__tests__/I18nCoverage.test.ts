/**
 * C4 守护：i18n 覆盖一致性
 *
 * 约束：
 * - en 与 zh 必须 0 缺 0 多（新增 UI key 必须 zh/en 双补）
 * - 其它语言缺失 key 数不得超过基线（缺口只允许缩小，不允许扩大）
 *   —— 翻译新 key 后缺口变小，更新基线即可
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'src/locales';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v as Record<string, unknown>, key));
    else out.push(key);
  }
  return out;
}

function load(lang: string): string[] {
  return flatten(JSON.parse(readFileSync(join(BASE, lang, 'translation.json'), 'utf8')));
}

const LANG_BASELINE: Record<string, number> = {
  ja: 0,
  de: 313,
  es: 313,
  fr: 313,
  it: 313,
  ko: 313,
  pt: 313,
  ru: 313,
};

describe('i18n 覆盖一致性', () => {
  const langs = readdirSync(BASE, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  const zhKeys = new Set(load('zh'));

  it('en 与 zh 完全一致（0 缺 0 多）——新增 key 必须 zh/en 双补', () => {
    const enKeys = new Set(load('en'));
    const missing = [...zhKeys].filter(k => !enKeys.has(k));
    const extra = [...enKeys].filter(k => !zhKeys.has(k));
    expect(missing, `en 缺失 ${missing.length} 个 key: ${missing.slice(0, 10).join(', ')}`).toHaveLength(0);
    expect(extra, `en 多余 ${extra.length} 个 key: ${extra.slice(0, 10).join(', ')}`).toHaveLength(0);
  });

  it('各语言缺口不得超过基线（缺口只允许缩小）', () => {
    for (const lang of langs) {
      if (lang === 'zh' || lang === 'en') continue;
      const keys = new Set(load(lang));
      const missing = [...zhKeys].filter(k => !keys.has(k));
      const baseline = LANG_BASELINE[lang] ?? zhKeys.size;
      expect(
        missing.length,
        `${lang} 缺口 ${missing.length} > 基线 ${baseline}，需补 en 或更新基线。缺失样例: ${missing.slice(0, 8).join(', ')}`,
      ).toBeLessThanOrEqual(baseline);
    }
  });
});
