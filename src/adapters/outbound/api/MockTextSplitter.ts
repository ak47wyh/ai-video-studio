import type { ITextSplitterPort, SegmentDraft } from '../../../domain/ports/OutboundPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

export class MockTextSplitterAdapter implements ITextSplitterPort {
  private logger?: ILoggerPort;

  constructor(logger?: ILoggerPort) {
    this.logger = logger;
  }
  async splitStoryToSegments(text: string, knownCharacterNames: string[]): Promise<SegmentDraft[]> {
    this.logger?.info('[MockTextSplitterAdapter] Splitting text', { textPrefix: text.substring(0, 50) });

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try splitting by paragraphs first
    let paragraphs = text.split('\n').filter(p => p.trim() !== '');

    // Fallback: if only one paragraph, split by sentences
    if (paragraphs.length <= 1) {
      const sentenceRegex = /[^.!?。！？]+[.!?。！？]+/g;
      const sentences = text.match(sentenceRegex);
      if (sentences && sentences.length > 1) {
        // Group every 2-3 sentences into a segment
        const groupSize = 2;
        paragraphs = [];
        for (let i = 0; i < sentences.length; i += groupSize) {
          paragraphs.push(sentences.slice(i, i + groupSize).join(' ').trim());
        }
      } else {
        // Last resort: split by chunks of ~200 chars at word boundaries
        paragraphs = [];
        const chunkSize = 200;
        let remaining = text;
        while (remaining.length > 0) {
          if (remaining.length <= chunkSize) {
            paragraphs.push(remaining.trim());
            break;
          }
          const cutIndex = remaining.lastIndexOf(' ', chunkSize);
          if (cutIndex <= 0) {
            paragraphs.push(remaining.substring(0, chunkSize).trim());
            remaining = remaining.substring(chunkSize);
          } else {
            paragraphs.push(remaining.substring(0, cutIndex).trim());
            remaining = remaining.substring(cutIndex);
          }
        }
      }
    }

    if (paragraphs.length === 0) return [];

    return paragraphs.map(p => {
      const mentioned = knownCharacterNames.filter(name => p.includes(name));
      return {
        content: p.trim(),
        mentionedCharacters: mentioned
      };
    });
  }
}
