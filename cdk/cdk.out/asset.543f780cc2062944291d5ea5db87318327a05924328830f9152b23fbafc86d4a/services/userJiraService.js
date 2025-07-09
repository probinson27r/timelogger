const axios = require('axios');
const https = require('https');
const moment = require('moment');
const logger = require('../utils/logger');

class UserJiraService {
  constructor(userConfig) {
    if (!userConfig) {
      throw new Error('User configuration is required');
    }
    
    this.baseUrl = userConfig.jira_base_url;
    this.jiraType = userConfig.jira_type || 'server';
    this.personalAccessToken = userConfig.jira_personal_access_token;
    this.userId = userConfig.jira_user_id;
    this.email = userConfig.jira_email;
    
    if (!this.baseUrl || !this.personalAccessToken) {
      throw new Error('Jira base URL and access token are required');
    }
    
    // Set up authentication headers based on Jira type
    let authHeaders;
    if (this.jiraType === 'cloud') {
      // Jira Cloud uses Basic Auth with email:api_token
      if (!this.email) {
        throw new Error('Email is required for Jira Cloud authentication');
      }
      const credentials = Buffer.from(`${this.email}:${this.personalAccessToken}`).toString('base64');
      authHeaders = {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
    } else {
      // Jira Server/Data Center uses Bearer token
      authHeaders = {
        'Authorization': `Bearer ${this.personalAccessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
    }
    
    // Create axios instance with user-specific configuration
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: authHeaders,
      httpsAgent: new https.Agent({
        rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED !== 'false'
      }),
      timeout: 30000
    });
  }

  /**
   * Test the connection and get current user info
   */
  async testConnection() {
    try {
      const response = await this.axiosInstance.get('/rest/api/2/myself');
      return {
        success: true,
        user: response.data
      };
    } catch (error) {
      logger.error('Jira connection test failed:', error.message);
      
      // Include detailed API error information
      let detailedError = error.message;
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;
        
        detailedError = `HTTP ${status} ${statusText}`;
        
        if (responseData && responseData.errorMessages && responseData.errorMessages.length > 0) {
          detailedError += `: ${responseData.errorMessages.join(', ')}`;
        }
        
        // For common error scenarios, provide helpful guidance
        if (status === 401) {
          detailedError += '. Check your API token - it may be invalid or expired.';
        } else if (status === 403) {
          detailedError += '. Check your API token permissions.';
        } else if (status === 404) {
          detailedError += '. Check your Jira base URL - the server may not be reachable.';
        }
      }
      
      return {
        success: false,
        error: detailedError
      };
    }
  }

  /**
   * Get tickets assigned to the current user
   */
  async getMyAssignedTickets() {
    try {
      const jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
      const response = await this.axiosInstance.get('/rest/api/2/search', {
        params: {
          jql: jql,
          fields: 'key,summary,status,priority,issuetype,assignee,updated',
          maxResults: 50
        }
      });

      return response.data.issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'None',
        issueType: issue.fields.issuetype.name,
        assignee: issue.fields.assignee?.displayName,
        updated: moment(issue.fields.updated).format('YYYY-MM-DD')
      }));
    } catch (error) {
      logger.error('Error fetching assigned tickets:', error.message);
      
      // Include detailed API error information
      let detailedError = `Failed to fetch assigned tickets: ${error.message}`;
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;
        
        detailedError = `Failed to fetch assigned tickets: HTTP ${status} ${statusText}`;
        
        if (responseData && responseData.errorMessages && responseData.errorMessages.length > 0) {
          detailedError += `: ${responseData.errorMessages.join(', ')}`;
        }
        
        // For common error scenarios, provide helpful guidance
        if (status === 401) {
          detailedError += '. Check your authentication credentials.';
        } else if (status === 403) {
          detailedError += '. You may not have permission to search for tickets.';
        }
      }
      
      throw new Error(detailedError);
    }
  }

  /**
   * Get a specific ticket by key
   */
  async getTicket(ticketKey) {
    try {
      const response = await this.axiosInstance.get(`/rest/api/2/issue/${ticketKey}`, {
        params: {
          fields: 'key,summary,status,priority,issuetype,assignee,description'
        }
      });

      const issue = response.data;
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'None',
        issueType: issue.fields.issuetype.name,
        assignee: issue.fields.assignee?.displayName,
        description: issue.fields.description || ''
      };
    } catch (error) {
      logger.error(`Error fetching ticket ${ticketKey}:`, error.message);
      
      // Include detailed API error information
      let detailedError = `Failed to fetch ticket ${ticketKey}: ${error.message}`;
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;
        
        detailedError = `Failed to fetch ticket ${ticketKey}: HTTP ${status} ${statusText}`;
        
        if (responseData) {
          if (responseData.errorMessages && responseData.errorMessages.length > 0) {
            detailedError += `: ${responseData.errorMessages.join(', ')}`;
          }
          
          // For common error scenarios, provide helpful guidance
          if (status === 404) {
            detailedError += '. The ticket may not exist or you may not have permission to view it.';
          } else if (status === 403) {
            detailedError += '. You do not have permission to view this ticket.';
          }
        }
      }
      
      throw new Error(detailedError);
    }
  }

  /**
   * Log work to a Jira ticket
   */
  async logWork(ticketKey, hours, description, workDate = new Date()) {
    try {
      // Convert hours to Jira time format
      const timeSpent = this.convertHoursToJiraFormat(hours);
      
      // Create worklog data - only include started date if it's not today
      const worklogData = {
        comment: description,
        timeSpent: timeSpent
      };
      
      // Only add started date if it's not today (to avoid timezone issues)
      const today = moment().startOf('day');
      const workMoment = moment(workDate).startOf('day');
      
      if (!workMoment.isSame(today)) {
        // For past dates, use ISO format with time set to 9 AM to avoid timezone issues
        const workDateWithTime = moment(workDate).hour(9).minute(0).second(0).millisecond(0);
        worklogData.started = workDateWithTime.format('YYYY-MM-DDTHH:mm:ss.SSSZZ');
      }
      // If it's today, omit the started field and Jira will use current time

      const response = await this.axiosInstance.post(`/rest/api/2/issue/${ticketKey}/worklog`, worklogData);
      
      logger.info(`Successfully logged ${timeSpent} to ${ticketKey}`);
      return {
        success: true,
        worklogId: response.data.id,
        timeSpent: timeSpent
      };
    } catch (error) {
      // Include detailed API error information
      let detailedError = error.message;
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;
        
        detailedError = `HTTP ${status} ${statusText}`;
        
        if (responseData) {
          if (responseData.errorMessages && responseData.errorMessages.length > 0) {
            detailedError += `: ${responseData.errorMessages.join(', ')}`;
          }
          
          if (responseData.errors && Object.keys(responseData.errors).length > 0) {
            const errorDetails = Object.entries(responseData.errors)
              .map(([field, message]) => `${field}: ${message}`)
              .join(', ');
            detailedError += ` (Field errors: ${errorDetails})`;
          }
          
          // For common error scenarios, provide helpful guidance
          if (status === 404) {
            detailedError += '. Check that the ticket key is correct and you have permission to access it.';
          } else if (status === 403) {
            detailedError += '. You may not have permission to log time to this ticket.';
          } else if (status === 400) {
            detailedError += '. Check that the time format and date are valid.';
          }
        }
      }

      // Log the detailed error information
      logger.error(`Error logging work to ${ticketKey}: ${detailedError}`, { 
        error: error.message, 
        status: error.response?.status, 
        statusText: error.response?.statusText,
        responseData: error.response?.data 
      });
      
      return {
        success: false,
        error: detailedError
      };
    }
  }

  /**
   * Get worklogs for the current user
   */
  async getMyWorklogs(startDate = null, endDate = null) {
    try {
      // Use today's date if no dates provided
      if (!startDate) {
        startDate = moment().format('YYYY-MM-DD');
      }
      if (!endDate) {
        endDate = moment().format('YYYY-MM-DD');
      }

      logger.info('[DEBUG] getMyWorklogs called with:', { startDate, endDate, email: this.email });

      // Get worklogs for the user
      const jql = `worklogAuthor = currentUser() AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}"`;
      
      logger.info('[DEBUG] JQL query:', jql);
      
      const response = await this.axiosInstance.get('/rest/api/2/search', {
        params: {
          jql: jql,
          fields: 'key,summary,worklog',
          maxResults: 1000,
          expand: 'worklog'
        }
      });

      logger.info('[DEBUG] Jira API response:', {
        total: response.data.total,
        issuesCount: response.data.issues ? response.data.issues.length : 0
      });

      const worklogs = [];
      response.data.issues.forEach(issue => {
        if (issue.fields.worklog && issue.fields.worklog.worklogs) {
          issue.fields.worklog.worklogs.forEach(worklog => {
            // Filter by current user and date range
            if (worklog.author.emailAddress === this.email) {
              const worklogDate = moment(worklog.started).format('YYYY-MM-DD');
              if (worklogDate >= startDate && worklogDate <= endDate) {
                worklogs.push({
                  ticketKey: issue.key,
                  summary: issue.fields.summary,
                  timeSpent: worklog.timeSpent,
                  timeSpentSeconds: worklog.timeSpentSeconds,
                  description: worklog.comment || '',
                  date: worklogDate,
                  created: worklog.created
                });
              }
            }
          });
        }
      });

      return worklogs;
    } catch (error) {
      logger.error('Error fetching worklogs:', error.message);
      
      // Include detailed API error information
      let detailedError = `Failed to fetch worklogs: ${error.message}`;
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;
        
        detailedError = `Failed to fetch worklogs: HTTP ${status} ${statusText}`;
        
        if (responseData && responseData.errorMessages && responseData.errorMessages.length > 0) {
          detailedError += `: ${responseData.errorMessages.join(', ')}`;
        }
        
        // For common error scenarios, provide helpful guidance
        if (status === 401) {
          detailedError += '. Check your authentication credentials.';
        } else if (status === 400) {
          detailedError += '. The search query may be invalid.';
        }
      }
      
      throw new Error(detailedError);
    }
  }

  /**
   * Get time reports for different periods
   */
  async getMyTimeReports(period = 'today') {
    try {
      let startDate, endDate;
      
      switch (period.toLowerCase()) {
        case 'today':
          startDate = moment().format('YYYY-MM-DD');
          endDate = moment().format('YYYY-MM-DD');
          break;
        case 'week':
          startDate = moment().startOf('week').format('YYYY-MM-DD');
          endDate = moment().endOf('week').format('YYYY-MM-DD');
          break;
        case 'month':
          startDate = moment().startOf('month').format('YYYY-MM-DD');
          endDate = moment().endOf('month').format('YYYY-MM-DD');
          break;
        case 'year':
          startDate = moment().startOf('year').format('YYYY-MM-DD');
          endDate = moment().endOf('year').format('YYYY-MM-DD');
          break;
        case 'all':
          // For "all", use the last year to avoid overwhelming results
          startDate = moment().subtract(1, 'year').format('YYYY-MM-DD');
          endDate = moment().format('YYYY-MM-DD');
          break;
        default:
          startDate = moment().format('YYYY-MM-DD');
          endDate = moment().format('YYYY-MM-DD');
      }

      const worklogs = await this.getMyWorklogs(startDate, endDate);
      
      // Aggregate worklogs by ticket
      const worklogsByTicket = {};
      let totalSeconds = 0;
      
      worklogs.forEach(worklog => {
        const ticketKey = worklog.ticketKey;
        if (!worklogsByTicket[ticketKey]) {
          worklogsByTicket[ticketKey] = {
            summary: worklog.summary,
            timeSpentSeconds: 0,
            hours: 0,
            worklogs: []
          };
        }
        
        worklogsByTicket[ticketKey].timeSpentSeconds += worklog.timeSpentSeconds;
        worklogsByTicket[ticketKey].worklogs.push(worklog);
        totalSeconds += worklog.timeSpentSeconds;
      });

      // Convert seconds to hours
      Object.keys(worklogsByTicket).forEach(ticketKey => {
        const seconds = worklogsByTicket[ticketKey].timeSpentSeconds;
        worklogsByTicket[ticketKey].hours = Math.round((seconds / 3600) * 100) / 100;
      });

      const totalHours = Math.round((totalSeconds / 3600) * 100) / 100;

      return {
        period,
        startDate,
        endDate,
        totalHours,
        totalSeconds,
        worklogsByTicket
      };
    } catch (error) {
      logger.error('Error generating time report:', error.message);
      
      // Include detailed API error information
      let detailedError = `Failed to generate time report: ${error.message}`;
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;
        
        detailedError = `Failed to generate time report: HTTP ${status} ${statusText}`;
        
        if (responseData && responseData.errorMessages && responseData.errorMessages.length > 0) {
          detailedError += `: ${responseData.errorMessages.join(', ')}`;
        }
        
        // For common error scenarios, provide helpful guidance
        if (status === 401) {
          detailedError += '. Check your authentication credentials.';
        } else if (status === 400) {
          detailedError += '. The date range or search parameters may be invalid.';
        }
      }
      
      throw new Error(detailedError);
    }
  }

  /**
   * Convert hours to Jira time format (e.g., 1.5 -> "1h 30m")
   */
  convertHoursToJiraFormat(hours) {
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    
    if (wholeHours > 0 && remainingMinutes > 0) {
      return `${wholeHours}h ${remainingMinutes}m`;
    } else if (wholeHours > 0) {
      return `${wholeHours}h`;
    } else {
      return `${remainingMinutes}m`;
    }
  }

  /**
   * Parse Jira time format to hours (e.g., "1h 30m" -> 1.5)
   */
  parseJiraTimeToHours(timeString) {
    let totalMinutes = 0;
    
    // Match hours
    const hoursMatch = timeString.match(/(\d+)h/);
    if (hoursMatch) {
      totalMinutes += parseInt(hoursMatch[1]) * 60;
    }
    
    // Match minutes
    const minutesMatch = timeString.match(/(\d+)m/);
    if (minutesMatch) {
      totalMinutes += parseInt(minutesMatch[1]);
    }
    
    return totalMinutes / 60;
  }
}

module.exports = UserJiraService; 