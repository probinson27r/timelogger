const { getUserSetting, setUserSetting } = require('../services/database');
const logger = require('./logger');

/**
 * Icon Configuration for Multi-Tenant Time Logger
 * Provides different icon sizes and styles per user
 */

class IconConfig {
  constructor() {
    // Define all available icon sets
    this.iconSets = {
      current: {
        name: 'current',
        description: 'Standard emojis (default)',
        icons: {
          success: '✅',
          error: '❌',
          warning: '⚠️',
          info: 'ℹ️',
          ticket: '🎫',
          tickets: '🎫',
          status: '📊',
          priority: '🏷️',
          time: '⏱️',
          calendar: '📅',
          reports: '📊',
          summary: '📈',
          details: '📋',
          help: '❓',
          config: '⚙️',
          loading: '⏳',
          cancelled: '🚫'
        }
      },
      
      large: {
        name: 'large',
        description: 'Larger/more prominent emojis',
        icons: {
          success: '🟢✅',
          error: '🔴❌',
          warning: '🟡⚠️',
          info: '🔵ℹ️',
          ticket: '🎫📋',
          tickets: '🎫📚',
          status: '📊📈',
          priority: '🏷️⭐',
          time: '⏰⏱️',
          calendar: '🗓️📅',
          reports: '📈📊',
          summary: '📊✨',
          details: '📋📝',
          help: '❓💡',
          config: '⚙️🔧',
          loading: '⌛⏳',
          cancelled: '🚫❌'
        }
      },
      
      small: {
        name: 'small',
        description: 'Minimal symbols with less visual impact',
        icons: {
          success: '•',
          error: '×',
          warning: '!',
          info: 'i',
          ticket: '•',
          tickets: '▫',
          status: '▪',
          priority: '▸',
          time: '○',
          calendar: '▪',
          reports: '▫',
          summary: '■',
          details: '▹',
          help: '?',
          config: '◦',
          loading: '○',
          cancelled: '×'
        }
      },
      
      minimal: {
        name: 'minimal',
        description: 'Very subtle geometric symbols',
        icons: {
          success: '●',
          error: '●',
          warning: '●',
          info: '●',
          ticket: '■',
          tickets: '■',
          status: '■',
          priority: '▶',
          time: '◦',
          calendar: '▸',
          reports: '■',
          summary: '▪',
          details: '▹',
          help: '?',
          config: '◦',
          loading: '○',
          cancelled: '×'
        }
      },
      
      text: {
        name: 'text',
        description: 'Text-based alternatives in brackets',
        icons: {
          success: '[OK]',
          error: '[ERROR]',
          warning: '[WARN]',
          info: '[INFO]',
          ticket: '[TICKET]',
          tickets: '[TICKETS]',
          status: '[STATUS]',
          priority: '[PRIORITY]',
          time: '[TIME]',
          calendar: '[DATE]',
          reports: '[REPORT]',
          summary: '[SUMMARY]',
          details: '[DETAILS]',
          help: '[HELP]',
          config: '[CONFIG]',
          loading: '[LOADING]',
          cancelled: '[CANCELLED]'
        }
      },
      
      none: {
        name: 'none',
        description: 'No icons (clean text only)',
        icons: {
          success: '',
          error: '',
          warning: '',
          info: '',
          ticket: '',
          tickets: '',
          status: '',
          priority: '',
          time: '',
          calendar: '',
          reports: '',
          summary: '',
          details: '',
          help: '',
          config: '',
          loading: '',
          cancelled: ''
        }
      }
    };
  }

  /**
   * Get user's icon set
   */
  async getIconSet(userId, platform = 'slack') {
    try {
      const setName = await getUserSetting(userId, platform, 'icon_set') || 'current';
      const iconSet = this.iconSets[setName] || this.iconSets.current;
      
      // Add spacing to non-empty icons
      const spacedIcons = {};
      Object.entries(iconSet.icons).forEach(([key, value]) => {
        spacedIcons[key] = value ? `${value} ` : '';
      });
      
      return {
        name: iconSet.name,
        description: iconSet.description,
        ...spacedIcons
      };
    } catch (error) {
      logger.error('Error getting user icon set:', error);
      // Return default set on error
      const defaultSet = this.iconSets.current;
      const spacedIcons = {};
      Object.entries(defaultSet.icons).forEach(([key, value]) => {
        spacedIcons[key] = value ? `${value} ` : '';
      });
      
      return {
        name: defaultSet.name,
        description: defaultSet.description,
        ...spacedIcons
      };
    }
  }

  /**
   * Set user's icon set
   */
  async setIconSet(userId, platform, setName) {
    try {
      if (!this.iconSets[setName]) {
        throw new Error(`Invalid icon set: ${setName}`);
      }
      
      await setUserSetting(userId, platform, 'icon_set', setName);
      return true;
    } catch (error) {
      logger.error('Error setting user icon set:', error);
      return false;
    }
  }

  /**
   * Get available icon sets for configuration
   */
  getAvailableIconSets() {
    return Object.values(this.iconSets).map(set => ({
      name: set.name,
      description: set.description
    }));
  }

  /**
   * Get a preview of an icon set
   */
  getIconSetPreview(setName) {
    const iconSet = this.iconSets[setName];
    if (!iconSet) {
      return null;
    }

    return {
      name: iconSet.name,
      description: iconSet.description,
      examples: {
        success: iconSet.icons.success || '(none)',
        ticket: iconSet.icons.ticket || '(none)',
        reports: iconSet.icons.reports || '(none)',
        time: iconSet.icons.time || '(none)'
      }
    };
  }

  /**
   * Get all available icon sets with previews
   */
  getAllIconSetPreviews() {
    return Object.keys(this.iconSets).map(setName => 
      this.getIconSetPreview(setName)
    );
  }
}

// Convenience functions for easier imports
const iconConfig = new IconConfig();

async function getIconSet(userId, platform = 'slack') {
  return await iconConfig.getIconSet(userId, platform);
}

async function setIconSet(userId, platform, setName) {
  return await iconConfig.setIconSet(userId, platform, setName);
}

function getAvailableIconSets() {
  return iconConfig.getAvailableIconSets();
}

function getIconSetPreview(setName) {
  return iconConfig.getIconSetPreview(setName);
}

function getAllIconSetPreviews() {
  return iconConfig.getAllIconSetPreviews();
}

module.exports = {
  iconConfig,
  getIconSet,
  setIconSet,
  getAvailableIconSets,
  getIconSetPreview,
  getAllIconSetPreviews
}; 