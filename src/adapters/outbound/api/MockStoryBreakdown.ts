import type { IStoryBreakdownPort, StoryBreakdownResult } from '../../../domain/ports/OutboundPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

/**
 * Mock adapter that simulates AI-powered story breakdown.
 * In production, this would call an LLM API to extract characters, backgrounds, and segments.
 */
export class MockStoryBreakdownAdapter implements IStoryBreakdownPort {
  private logger?: ILoggerPort;

  constructor(logger?: ILoggerPort) {
    this.logger = logger;
  }
  async breakdownStory(text: string): Promise<StoryBreakdownResult> {
    this.logger?.info('[MockStoryBreakdownAdapter] Breaking down story', { textPrefix: text.substring(0, 80) });

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // --- Extract characters by heuristic ---
    // Look for capitalized names that appear multiple times
    const namePattern = /[\u4e00-\u9fa5]{2,4}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g;
    const nameCounts = new Map<string, number>();
    const paragraphs = text.split(/[。\n！？.!?]+/).filter(p => p.trim());

    for (const p of paragraphs) {
      const matches = p.match(namePattern);
      if (matches) {
        for (const m of matches) {
          const name = m.trim();
          // Filter out common non-name words
          if (name.length < 2 || name.length > 8) continue;
          if (/^(他|她|它|我|你|我们|他们|她们|这个|那个|什么|怎么|为什么|但是|因为|所以|如果|虽然|可是|而且|或者|以及|不过|然而|于是|已经|正在|将要|可以|应该|必须|可能|大概|也许|一定|总是|从来|经常|偶尔|突然|渐渐|终于|仍然|依然|其实|当然|显然|毕竟|反而|居然|竟然|果然|简直|差不多|差不多|几乎|差不多)$/.test(name)) continue;
          nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
        }
      }
    }

    // Names appearing 2+ times are likely characters
    const characterNames = [...nameCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);

    // Build character drafts with inferred traits
    const characters = characterNames.map(name => {
      const sentencesMentioning = paragraphs.filter(p => p.includes(name));
      const context = sentencesMentioning.join('。');

      // Simple heuristic: try to infer some traits from context
      let appearance = '';
      let personality = '';
      let charBackground = '';

      if (context.length > 0) {
        // Extract appearance hints
        const appearanceKeywords = ['穿着', '戴着', '长着', '身材', '头发', '眼睛', '脸', '高大', '矮小', '漂亮', '英俊', '美丽', '苍老', '年轻', '穿着', '身披', 'tall', 'short', 'blonde', 'dark hair', 'wearing', 'dressed'];
        const appearanceSentences = sentencesMentioning.filter(s =>
          appearanceKeywords.some(kw => s.includes(kw))
        );
        if (appearanceSentences.length > 0) {
          appearance = appearanceSentences[0].trim().substring(0, 100);
        } else {
          appearance = `A character named ${name}`;
        }

        // Extract personality hints
        const personalityKeywords = ['勇敢', '胆小', '聪明', '善良', '冷酷', '温柔', '暴躁', '冷静', '热情', '沉默', 'brave', 'shy', 'smart', 'kind', 'cold', 'gentle', 'fierce', 'calm'];
        const personalitySentences = sentencesMentioning.filter(s =>
          personalityKeywords.some(kw => s.includes(kw))
        );
        if (personalitySentences.length > 0) {
          personality = personalitySentences[0].trim().substring(0, 80);
        } else {
          personality = 'Determined and resourceful';
        }

        charBackground = context.substring(0, 120).trim();
      }

      return {
        name,
        appearancePrompt: appearance || `A character named ${name}`,
        personalityPrompt: personality || 'Determined and resourceful',
        characterBackground: charBackground || `${name}'s background is yet to be revealed`
      };
    });

    // --- Extract backgrounds by heuristic ---
    // Look for scene-setting phrases
    const bgKeywords = [
      '城市', '森林', '沙漠', '海洋', '山', '村庄', '宫殿', '城堡', '街道', '房间',
      '天空', '地下', '河边', '湖边', '桥', '港口', '战场', '寺庙', '学校', '医院',
      'city', 'forest', 'desert', 'ocean', 'mountain', 'village', 'palace', 'castle',
      'street', 'room', 'sky', 'underground', 'river', 'bridge', 'harbor', 'battlefield',
      'temple', 'school', 'hospital', 'night', 'dawn', 'sunset', 'rain', 'snow'
    ];

    const bgMap = new Map<string, string[]>();
    for (const p of paragraphs) {
      for (const kw of bgKeywords) {
        if (p.includes(kw)) {
          if (!bgMap.has(kw)) bgMap.set(kw, []);
          bgMap.get(kw)!.push(p.trim().substring(0, 80));
        }
      }
    }

    // Merge similar backgrounds, take top 4
    const backgrounds = [...bgMap.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .map(([kw, sentences]) => ({
        name: kw.charAt(0).toUpperCase() + kw.slice(1) + ' Scene',
        environmentPrompt: sentences[0] || `A ${kw} scene`
      }));

    // Fallback: if no backgrounds found, create a generic one
    if (backgrounds.length === 0) {
      backgrounds.push({
        name: 'Default Scene',
        environmentPrompt: 'A generic indoor scene with soft lighting'
      });
    }

    // --- Split into segments ---
    let segmentTexts = text.split('\n').filter(p => p.trim() !== '');

    if (segmentTexts.length <= 1) {
      const sentenceRegex = /[^.!?。！？]+[.!?。！？]+/g;
      const sentences = text.match(sentenceRegex);
      if (sentences && sentences.length > 1) {
        const groupSize = 2;
        segmentTexts = [];
        for (let i = 0; i < sentences.length; i += groupSize) {
          segmentTexts.push(sentences.slice(i, i + groupSize).join(' ').trim());
        }
      } else {
        segmentTexts = [text];
      }
    }

    const segments = segmentTexts.map(p => {
      const mentionedCharacterNames = characterNames.filter(name => p.includes(name));

      // Find the best matching background
      let suggestedBackgroundName = backgrounds[0].name;
      for (const bg of backgrounds) {
        const bgKw = bg.name.replace(' Scene', '').toLowerCase();
        if (p.includes(bgKw)) {
          suggestedBackgroundName = bg.name;
          break;
        }
      }

      return {
        content: p.trim(),
        mentionedCharacterNames,
        suggestedBackgroundName
      };
    });

    return { characters, backgrounds, segments };
  }
}
