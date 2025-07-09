const OpenAI = require('openai');
const logger = require('../utils/logger');

class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OpenAI API key');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 3000 // 3 second timeout
    });
  }

  // Helper function to add timeout to any promise
  async withTimeout(promise, timeoutMs = 3000) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI request timed out')), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  async parseIntent(userMessage, context = {}) {
    try {
      const systemPrompt = `You are a helpful assistant for a Slack bot that helps users log time to Jira tickets. 
      
Your job is to analyze user messages and extract:
1. Intent (what the user wants to do)
2. Parameters (specific details like hours, ticket keys, descriptions)

Possible intents:
- "get_my_tickets" - User wants to see their assigned tickets
- "log_time" - User wants to log time to a ticket
- "get_time_report" - User wants to see time logged for a period (today, week, month, year)
- "search_tickets" - User wants to search for tickets
- "get_ticket_details" - User wants details about a specific ticket
- "help" - User needs help
- "unclear" - Intent is unclear

For log_time intent, extract:
- hours: number of hours (convert from various formats like "3 hours", "2h", "30 minutes" to decimal hours)
- ticket_key: Jira ticket key (like ABC-123, PROJ-456)
- description: work description
- date: any date mentioned (like "yesterday", "last Friday", "July 1st", "2024-07-01", "3 days ago")

For get_time_report intent, extract:
- period: "today", "week", "month", "year", or "all" (if not specified, default to "all")

For search_tickets intent, extract:
- search_query: what to search for

For get_ticket_details intent, extract:
- ticket_key: specific ticket key

Return a JSON object with:
{
  "intent": "intent_name",
  "confidence": 0.95,
  "parameters": {
    // extracted parameters
  },
  "clarification_needed": "question to ask user if anything is unclear"
}

Examples:
"Show me my tickets" -> {"intent": "get_my_tickets", "confidence": 0.9, "parameters": {}}
"Log 3 hours to ABC-123" -> {"intent": "log_time", "confidence": 0.95, "parameters": {"hours": 3, "ticket_key": "ABC-123"}}
"How many hours did I log today?" -> {"intent": "get_time_report", "confidence": 0.9, "parameters": {"period": "today"}}
"Show me my time report" -> {"intent": "get_time_report", "confidence": 0.9, "parameters": {"period": "all"}}
"Time logged this week" -> {"intent": "get_time_report", "confidence": 0.9, "parameters": {"period": "week"}}
"I worked 2.5 hours on fixing the login bug" -> {"intent": "log_time", "confidence": 0.8, "parameters": {"hours": 2.5, "description": "fixing the login bug"}, "clarification_needed": "Which ticket would you like to log this time to?"}
"Log 4 hours yesterday to ABC-123" -> {"intent": "log_time", "confidence": 0.95, "parameters": {"hours": 4, "ticket_key": "ABC-123", "date": "yesterday"}}
"I worked 3h on Friday on the bug fix" -> {"intent": "log_time", "confidence": 0.9, "parameters": {"hours": 3, "description": "bug fix", "date": "Friday"}}
"Log time for July 1st - 2 hours debugging" -> {"intent": "log_time", "confidence": 0.9, "parameters": {"hours": 2, "description": "debugging", "date": "July 1st"}}
"Log 5 hours 3 days ago" -> {"intent": "log_time", "confidence": 0.9, "parameters": {"hours": 5, "date": "3 days ago"}}`;

      const userPrompt = `User message: "${userMessage}"
      
Context: ${JSON.stringify(context)}

Please analyze this message and return the JSON response:`;

      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 500
        }),
        3000 // 3 second timeout
      );

      const content = response.choices[0].message.content.trim();
      
      // Try to parse JSON response
      try {
        const parsed = JSON.parse(content);
        logger.info('Parsed intent:', { userMessage, intent: parsed });
        return parsed;
      } catch (parseError) {
        logger.error('Error parsing OpenAI response:', parseError);
        // Fallback to unclear intent
        return {
          intent: 'unclear',
          confidence: 0.1,
          parameters: {},
          clarification_needed: 'I\'m not sure what you\'d like to do. You can ask me to show your tickets, log time, or search for tickets.'
        };
      }
    } catch (error) {
      logger.error('Error calling OpenAI:', error);
      
      // If it's a timeout, return a fallback response
      if (error.message.includes('timed out')) {
        logger.warn('OpenAI request timed out, using fallback parsing');
        return this.fallbackParseIntent(userMessage);
      }
      
      throw new Error('Failed to process your message. Please try again.');
    }
  }

  // Fallback intent parsing when OpenAI is unavailable or times out
  fallbackParseIntent(userMessage) {
    const text = userMessage.toLowerCase();
    
    // Simple keyword-based parsing
    if (text.includes('ticket') && (text.includes('show') || text.includes('my') || text.includes('assigned'))) {
      return {
        intent: 'get_my_tickets',
        confidence: 0.7,
        parameters: {}
      };
    }
    
    if (text.includes('report') || text.includes('time logged') || text.includes('hours logged')) {
      return {
        intent: 'get_time_report',
        confidence: 0.7,
        parameters: { period: 'all' }
      };
    }
    
    // Look for time logging patterns
    const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/i);
    const ticketMatch = text.match(/([A-Z]+[-_]\d+)/i);
    
    if (hoursMatch) {
      const params = { hours: parseFloat(hoursMatch[1]) };
      if (ticketMatch) {
        params.ticket_key = ticketMatch[1];
      }
      
      return {
        intent: 'log_time',
        confidence: 0.6,
        parameters: params,
        clarification_needed: !ticketMatch ? 'Which ticket would you like to log this time to?' : ''
      };
    }
    
    // Default to unclear
    return {
      intent: 'unclear',
      confidence: 0.1,
      parameters: {},
      clarification_needed: 'I\'m not sure what you\'d like to do. You can ask me to show your tickets, log time, or search for tickets.'
    };
  }

  async generateTicketSelection(tickets, userQuery) {
    try {
      const systemPrompt = `You are helping a user select the most relevant Jira tickets from their assigned tickets list based on their query. 

Given a list of tickets and a user query, return the tickets ranked by relevance.

Return a JSON array of ticket keys in order of relevance (most relevant first).
Only include tickets that seem relevant to the query.
If no tickets seem relevant, return an empty array.`;

      const userPrompt = `User query: "${userQuery}"

Available tickets:
${tickets.map(ticket => `${ticket.key}: ${ticket.summary}`).join('\n')}

Return JSON array of relevant ticket keys:`;

      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 200
        }),
        2000 // 2 second timeout for this simpler task
      );

      const content = response.choices[0].message.content.trim();
      
      try {
        const ticketKeys = JSON.parse(content);
        return ticketKeys.filter(key => tickets.some(ticket => ticket.key === key));
      } catch (parseError) {
        logger.error('Error parsing ticket selection response:', parseError);
        return [];
      }
    } catch (error) {
      logger.error('Error generating ticket selection:', error);
      return [];
    }
  }

  async generateWorkDescription(ticketKey, hours = null, userInput = '') {
    try {
      const systemPrompt = `Generate a concise work log description for a Jira ticket.

Given:
- Ticket key (like ABC-123)
- Hours worked (optional)
- Optional user input about the work

Generate a professional, concise description (1-2 sentences) that would be appropriate for a work log entry.
Focus on what was accomplished, not just time spent.`;

      const userPrompt = `Ticket: ${ticketKey}
${hours ? `Hours: ${hours}` : ''}
User input: ${userInput}

Generate work description:`;

      const response = await this.withTimeout(
        this.client.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 100
        }),
        2000 // 2 second timeout
      );

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Error generating work description:', error);
      return userInput || `Worked on ${ticketKey}`;
    }
  }

  parseTimeFromText(text) {
    // Extract hours from various formats
    const patterns = [
      /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/i,
      /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)/i,
      /(\d+)\s*hours?\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?)/i,
      /(\d+):(\d+)/i  // HH:MM format
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        if (pattern.source.includes('minutes')) {
          return parseFloat(match[1]) / 60; // Convert minutes to hours
        } else if (pattern.source.includes('hours') && match[2]) {
          // Hours and minutes format
          return parseFloat(match[1]) + parseFloat(match[2]) / 60;
        } else if (pattern.source.includes(':')) {
          // HH:MM format
          return parseFloat(match[1]) + parseFloat(match[2]) / 60;
        } else {
          return parseFloat(match[1]);
        }
      }
    }

    return null;
  }

  extractTicketKey(text) {
    // Extract Jira ticket keys (typically PROJECT-123 format)
    const ticketPattern = /([A-Z]{2,10}-\d+)/i;
    const match = text.match(ticketPattern);
    return match ? match[1].toUpperCase() : null;
  }
}

const openaiService = new OpenAIService();

module.exports = {
  openaiService,
  OpenAIService
}; 