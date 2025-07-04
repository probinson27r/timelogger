const chrono = require('chrono-node');
const moment = require('moment');
const logger = require('./logger');

class DateParser {
  /**
   * Parse natural language date expressions
   * @param {string} dateText - Natural language date like "yesterday", "last Friday", "July 1st"
   * @param {string} timezone - Optional timezone (default: local)
   * @returns {Object} - { date: moment object, formatted: ISO string, isValid: boolean, originalText: string }
   */
  parseDate(dateText, timezone = null) {
    try {
      if (!dateText || typeof dateText !== 'string') {
        return this.createResult(null, false, dateText, 'No date text provided');
      }

      const cleanText = dateText.trim().toLowerCase();
      
      // Handle common relative dates first
      const relativeDate = this.parseRelativeDate(cleanText);
      if (relativeDate) {
        // Reject future dates for time logging
        if (relativeDate.isAfter(moment(), 'day')) {
          return this.createResult(null, false, dateText, 'Future dates not allowed for time logging');
        }
        return this.createResult(relativeDate, true, dateText);
      }

      // Use chrono-node for more complex parsing
      const parsed = chrono.parseDate(dateText, new Date(), { forwardDate: false });
      if (parsed) {
        const momentDate = moment(parsed);
        if (momentDate.isValid()) {
          // Reject future dates for time logging
          if (momentDate.isAfter(moment(), 'day')) {
            return this.createResult(null, false, dateText, 'Future dates not allowed for time logging');
          }
          return this.createResult(momentDate, true, dateText);
        }
      }

      // Try parsing as ISO date (only if it looks like a proper date format)
      if (dateText.match(/^\d{4}-\d{2}-\d{2}$/) || dateText.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const isoDate = moment(dateText);
        if (isoDate.isValid()) {
          return this.createResult(isoDate, true, dateText);
        }
      }

      return this.createResult(null, false, dateText, 'Could not parse date');

    } catch (error) {
      logger.error('Error parsing date:', error);
      return this.createResult(null, false, dateText, error.message);
    }
  }

  /**
   * Parse common relative date expressions
   */
  parseRelativeDate(dateText) {
    const now = moment();

    switch (dateText) {
      case 'today':
        return now.clone();
      case 'yesterday':
        return now.clone().subtract(1, 'day');
      case 'last friday':
      case 'friday':
        return this.getLastWeekday(now, 5); // Friday = 5
      case 'last thursday':
      case 'thursday':
        return this.getLastWeekday(now, 4);
      case 'last wednesday':
      case 'wednesday':
        return this.getLastWeekday(now, 3);
      case 'last tuesday':
      case 'tuesday':
        return this.getLastWeekday(now, 2);
      case 'last monday':
      case 'monday':
        return this.getLastWeekday(now, 1);
      case 'last weekend':
      case 'last saturday':
      case 'saturday':
        return this.getLastWeekday(now, 6); // Saturday = 6
      case 'last sunday':
      case 'sunday':
        return this.getLastWeekday(now, 0); // Sunday = 0
      default:
        // Handle "X days ago", "X weeks ago"
        const daysAgoMatch = dateText.match(/(\d+)\s*days?\s*ago/);
        if (daysAgoMatch) {
          return now.clone().subtract(parseInt(daysAgoMatch[1]), 'days');
        }

        const weeksAgoMatch = dateText.match(/(\d+)\s*weeks?\s*ago/);
        if (weeksAgoMatch) {
          return now.clone().subtract(parseInt(weeksAgoMatch[1]), 'weeks');
        }

        return null;
    }
  }

  /**
   * Get the most recent occurrence of a weekday
   */
  getLastWeekday(fromDate, targetWeekday) {
    const current = fromDate.clone();
    const currentWeekday = current.day();

    if (currentWeekday === targetWeekday) {
      // If today is the target weekday, go back one week
      return current.subtract(1, 'week');
    } else if (currentWeekday > targetWeekday) {
      // Go back to the target weekday in the same week
      return current.subtract(currentWeekday - targetWeekday, 'days');
    } else {
      // Go back to the target weekday in the previous week
      return current.subtract(7 - (targetWeekday - currentWeekday), 'days');
    }
  }

  /**
   * Create a standardized result object
   */
  createResult(momentDate, isValid, originalText, error = null) {
    return {
      date: momentDate,
      formatted: momentDate?.format('YYYY-MM-DD') || null,
      iso: momentDate?.toISOString() || null,
      isValid,
      originalText,
      error,
      // Helper methods
      isToday: momentDate ? momentDate.isSame(moment(), 'day') : false,
      isYesterday: momentDate ? momentDate.isSame(moment().subtract(1, 'day'), 'day') : false,
      isPast: momentDate ? momentDate.isBefore(moment(), 'day') : false,
      displayText: momentDate ? this.getDisplayText(momentDate) : originalText
    };
  }

  /**
   * Get human-readable display text for a date
   */
  getDisplayText(momentDate) {
    const now = moment();
    
    if (momentDate.isSame(now, 'day')) {
      return 'today';
    } else if (momentDate.isSame(now.clone().subtract(1, 'day'), 'day')) {
      return 'yesterday';
    } else if (momentDate.isSame(now, 'week')) {
      return momentDate.format('dddd'); // "Monday", "Tuesday", etc.
    } else if (momentDate.isAfter(now.clone().subtract(7, 'days'))) {
      return `last ${momentDate.format('dddd')}`;
    } else if (momentDate.isSame(now, 'year')) {
      return momentDate.format('MMMM Do'); // "July 1st"
    } else {
      return momentDate.format('MMMM Do, YYYY'); // "July 1st, 2023"
    }
  }

  /**
   * Extract date from time logging text
   * Examples: "log 3 hours yesterday", "I worked 2h on Friday", "log time for July 1st"
   */
  extractDateFromText(text) {
    const datePatterns = [
      // Explicit date indicators
      /(?:for|on|from)\s+(.+?)(?:\s+(?:to|for|working|on)|$)/i,
      // Trailing date
      /\b(yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|last\s+\w+|\d+\s+days?\s+ago|\d+\s+weeks?\s+ago)(?:\s|$)/i,
      // Date in various formats
      /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\b/i
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        const dateText = match[1].trim();
        const parsed = this.parseDate(dateText);
        if (parsed.isValid) {
          return {
            ...parsed,
            extractedText: match[0],
            remainingText: text.replace(match[0], '').trim()
          };
        }
      }
    }

    return null;
  }
}

module.exports = new DateParser(); 