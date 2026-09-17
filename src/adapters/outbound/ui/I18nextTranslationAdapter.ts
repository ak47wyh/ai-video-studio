/**
 * I18nextTranslationAdapter —— ITranslationPort 的 i18next 实现
 *
 * 把现有 i18next 单例包装为 Port 契约，使 Service 层可调用 t() 函数而不依赖 react-i18next。
 *
 * 关键约束：实现方保证 t(key) 在 key 缺失时返回 key 本身（与 i18next 默认行为一致）。
 */

import i18n from '../../../i18n';
import type { ITranslationPort, LocaleCode } from '../../../domain/ports/UiPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import { BaseEventBus } from '../infrastructure/BaseEventBus';
import { ConsoleLoggerAdapter } from '../infrastructure/ConsoleLoggerAdapter';

type LocaleListener = (locale: LocaleCode) => void;

class LocaleEventBus extends BaseEventBus<LocaleListener> {
  constructor(logger?: ILoggerPort) {
    super({ service: 'I18nextTranslationAdapter' });
    this.setLogger(logger);
  }

  emit(locale: LocaleCode): void {
    this.emitAll(locale);
  }
}

export function createLocaleEventBus(logger?: ILoggerPort): LocaleEventBus {
  return new LocaleEventBus(logger ?? new ConsoleLoggerAdapter({ service: 'I18nextTranslationAdapter' }));
}

export const localeEventBus: LocaleEventBus = createLocaleEventBus();

class I18nextTranslationAdapter implements ITranslationPort {
  private eventBus: LocaleEventBus;
  private logger: ILoggerPort;

  constructor(
    eventBus: LocaleEventBus = localeEventBus,
    logger: ILoggerPort = new ConsoleLoggerAdapter({ service: 'I18nextTranslationAdapter' }),
  ) {
    this.eventBus = eventBus;
    this.logger = logger;
    // i18next 内部变化时转发到事件总线
    i18n.on('languageChanged', (lng: string) => {
      this.eventBus.emit(lng as LocaleCode);
    });
  }

  t(key: string, vars?: Record<string, unknown>): string {
    return i18n.t(key, vars as Record<string, string | number | boolean>);
  }

  getLocale(): LocaleCode {
    return (i18n.language || 'en') as LocaleCode;
  }

  async setLocale(locale: LocaleCode): Promise<void> {
    try {
      await i18n.changeLanguage(locale);
    } catch (err) {
      this.logger.error('[I18nextTranslationAdapter] setLocale failed', err, {
        service: 'I18nextTranslationAdapter',
        locale,
      });
      throw err;
    }
  }

  onChange(listener: (locale: LocaleCode) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  isReady(): boolean {
    return i18n.isInitialized;
  }
}

export function createI18nextTranslationAdapter(logger?: ILoggerPort): ITranslationPort {
  const bus = createLocaleEventBus(logger);
  return new I18nextTranslationAdapter(bus, logger ?? new ConsoleLoggerAdapter({ service: 'I18nextTranslationAdapter' }));
}

export const i18nextTranslationAdapter: ITranslationPort = new I18nextTranslationAdapter();