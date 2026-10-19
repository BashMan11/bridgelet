import { apiClient } from '../../utils/apiClient';
import { JOURNEYS, track } from '../../analytics/analytics';

/**
 * Interface for language detection response
 */
export interface LanguageDetectionResult {
  detectedLanguage: string;
  confidence: number; // 0 to 1
  alternatives?: Array<{
    language: string;
    confidence: number;
  }>;
}

/**
 * Minimum confidence threshold for auto-detection
 */
const MIN_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Debounce delay for language detection API calls (in milliseconds)
 */
const DETECTION_DEBOUNCE_DELAY = 500;

/**
 * LanguageDetectionService - Provides real-time language detection for user input
 */
class LanguageDetectionServiceImpl {
  private lastDetectionTime: number = 0;
  private lastDetectedLanguage: string = '';

  /**
   * Detect language from input text
   * Uses API for high-confidence detection with fallback strategy
   */
  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    if (!text || text.trim().length === 0) {
      return {
        detectedLanguage: 'unknown',
        confidence: 0,
      };
    }

    try {
      // For very short text, use simplified detection
      if (text.length < 5) {
        return this.simpleLanguageDetection(text);
      }

      // Call language detection API
      const result = await apiClient<LanguageDetectionResult>(
        '/api/translate/detect',
        {
          method: 'POST',
          body: JSON.stringify({ text }),
        }
      );

      // Store last detected language
      if (result.confidence > MIN_CONFIDENCE_THRESHOLD) {
        this.lastDetectedLanguage = result.detectedLanguage;
        // Only confident detections are recorded: below the threshold the app
        // itself treats the result as unreliable, so reporting it would put
        // noise into the language distribution. The input text is never sent.
        track({
          name: 'Language Detected',
          params: {
            journey: JOURNEYS.shared,
            language: result.detectedLanguage,
            detection_source: 'auto',
            confidence: result.confidence,
          },
        });
      }

      return result;
    } catch (error) {
      console.error('[LanguageDetection] Error detecting language:', error);
      
      // Fallback to simple detection if API fails
      return this.simpleLanguageDetection(text);
    }
  }

  /**
   * Simple language detection based on text patterns
   * Used as fallback when API is unavailable
   */
  private simpleLanguageDetection(text: string): LanguageDetectionResult {
    // Pattern matching for common languages
    // This is a simple fallback - not production quality
    
    const arabicPattern = /[\u0600-\u06FF]/g;
    const cyrillicPattern = /[\u0400-\u04FF]/g;
    const chinesePattern = /[\u4E00-\u9FFF]/g;
    const latinPattern = /[a-zA-Z]/g;

    const arabicMatches = (text.match(arabicPattern) || []).length;
    const cyrillicMatches = (text.match(cyrillicPattern) || []).length;
    const chineseMatches = (text.match(chinesePattern) || []).length;
    const latinMatches = (text.match(latinPattern) || []).length;

    const total = arabicMatches + cyrillicMatches + chineseMatches + latinMatches;

    if (total === 0) {
      return {
        detectedLanguage: 'unknown',
        confidence: 0,
      };
    }

    if (arabicMatches / total > 0.5) {
      return {
        detectedLanguage: 'ar',
        confidence: arabicMatches / total,
      };
    }

    if (cyrillicMatches / total > 0.5) {
      return {
        detectedLanguage: 'ru',
        confidence: cyrillicMatches / total,
      };
    }

    if (chineseMatches / total > 0.5) {
      return {
        detectedLanguage: 'zh',
        confidence: chineseMatches / total,
      };
    }

    // Default to English for Latin characters
    return {
      detectedLanguage: 'en',
      confidence: latinMatches / total,
    };
  }

  /**
   * Check if language detection should be debounced
   */
  shouldDebounce(): boolean {
    const now = Date.now();
    if (now - this.lastDetectionTime < DETECTION_DEBOUNCE_DELAY) {
      return true;
    }
    this.lastDetectionTime = now;
    return false;
  }

  /**
   * Get the last detected language
   */
  getLastDetectedLanguage(): string {
    return this.lastDetectedLanguage;
  }

  /**
   * Reset detection state
   */
  reset(): void {
    this.lastDetectionTime = 0;
    this.lastDetectedLanguage = '';
  }
}

export const languageDetectionService = new LanguageDetectionServiceImpl();
