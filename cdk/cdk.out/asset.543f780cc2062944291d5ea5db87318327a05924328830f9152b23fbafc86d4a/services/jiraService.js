const axios = require('axios');
const moment = require('moment');
const logger = require('../utils/logger');

class JiraService {
  constructor() {
    this.baseURL = process.env.JIRA_BASE_URL;
    this.personalAccessToken = process.env.JIRA_PERSONAL_ACCESS_TOKEN;
    this.username = process.env.JIRA_USERNAME; // For enterprise instances
    this.password = process.env.JIRA_PASSWORD; // For enterprise instances
    
    if (!this.baseURL) {
      throw new Error('JIRA_BASE_URL is required');
    }

    // Choose authentication method based on available credentials
    let authHeaders = {};
    
    if (this.personalAccessToken) {
      // Personal Access Token (preferred for Cloud)
      authHeaders = {
        'Authorization': `Bearer ${this.personalAccessToken}`
      };
    } else if (this.username && this.password) {
      // Basic authentication (for enterprise/SSO instances)
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      authHeaders = {
        'Authorization': `Basic ${credentials}`
      };
    } else {
      throw new Error('Either JIRA_PERSONAL_ACCESS_TOKEN or JIRA_USERNAME+JIRA_PASSWORD must be provided');
    }

    this.client = axios.create({
      // Using Jira REST API v2 (works with user's instance)
      // User confirmed their curl works with v2: /rest/api/2/
      baseURL: `${this.baseURL}/rest/api/2`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders
      },
      // Handle SSL certificate issues for enterprise instances
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED !== 'false'
      }),
      timeout: 30000 // 30 second timeout
    });
  }

  async getCurrentUser() {
    try {
      const response = await this.client.get('/myself');
      return response.data;
    } catch (error) {
      logger.error('Error getting current user from Jira:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Jira. Please check your Personal Access Token.');
    }
  }

  async getTicketDetails(ticketKey) {
    try {
      const response = await this.client.get(`/issue/${ticketKey}`, {
        params: {
          fields: 'key,summary,status,priority,issuetype,assignee,reporter,created,updated,description'
        }
      });

      const issue = response.data;
      return {
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description?.content?.[0]?.content?.[0]?.text || 'No description',
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'None',
        issueType: issue.fields.issuetype.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        created: issue.fields.created,
        updated: issue.fields.updated
      };
    } catch (error) {
      logger.error('Error getting ticket details from Jira:', error.response?.data || error.message);
      if (error.response?.status === 404) {
        throw new Error(`Ticket ${ticketKey} not found`);
      }
      throw new Error('Failed to fetch ticket details from Jira');
    }
  }

  async logWork(ticketKey, timeSpentSeconds, description, startedDate) {
    try {
      // Convert seconds to Jira time format (e.g., "2h", "30m", "1h 30m")
      const timeSpent = this.formatTimeForJira(timeSpentSeconds);
      
      // Use provided date or default to now
      let workDate;
      if (startedDate) {
        // If startedDate is a moment object or ISO string, use it
        if (typeof startedDate === 'string') {
          workDate = moment(startedDate);
        } else if (moment.isMoment(startedDate)) {
          workDate = startedDate.clone();
        } else {
          workDate = moment();
        }
      } else {
        workDate = moment();
      }

      // Set a reasonable work time (9 AM) for past dates
      if (!workDate.isSame(moment(), 'day')) {
        workDate.hour(9).minute(0).second(0).millisecond(0);
      }
      
      const worklogData = {
        comment: description || 'Time logged via Slack bot',
        timeSpent: timeSpent,
        started: workDate.format('YYYY-MM-DDTHH:mm:ss.SSSZZ')
      };

      const response = await this.client.post(`/issue/${ticketKey}/worklog`, worklogData);
      
      logger.info(`Successfully logged ${timeSpent} to ticket ${ticketKey} for ${workDate.format('YYYY-MM-DD')}`);
      return {
        ...response.data,
        workDate: workDate.format('YYYY-MM-DD'),
        workDateFormatted: this.getDateDisplayText(workDate)
      };
    } catch (error) {
      logger.error('Error logging work to Jira:', error.response?.data || error.message);
      if (error.response?.status === 404) {
        throw new Error(`Ticket ${ticketKey} not found`);
      }
      if (error.response?.status === 403) {
        throw new Error(`Permission denied: Cannot log work to ticket ${ticketKey}`);
      }
      throw new Error('Failed to log work to Jira');
    }
  }

  /**
   * Get human-readable display text for a date
   */
  getDateDisplayText(momentDate) {
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

  async searchTickets(searchQuery, maxResults = 20) {
    try {
      // Search in summary and description
      const jql = `(summary ~ "${searchQuery}" OR description ~ "${searchQuery}") AND resolution = Unresolved ORDER BY updated DESC`;
      
      const response = await this.client.get('/search', {
        params: {
          jql,
          maxResults,
          fields: 'key,summary,status,priority,issuetype,assignee'
        }
      });

      return response.data.issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'None',
        issueType: issue.fields.issuetype.name,
        assignee: issue.fields.assignee?.displayName || 'Unassigned'
      }));
    } catch (error) {
      logger.error('Error searching tickets in Jira:', error.response?.data || error.message);
      throw new Error('Failed to search tickets in Jira');
    }
  }

  async validateTicketAccess(ticketKey) {
    try {
      const ticket = await this.getTicketDetails(ticketKey);
      
      // Check if PAT user has permission to log work (simplified check)
      // In a real implementation, you might want to check project permissions
      return true;
    } catch (error) {
      if (error.message.includes('not found')) {
        return false;
      }
      throw error;
    }
  }

  // Utility function to convert hours to seconds
  hoursToSeconds(hours) {
    return Math.round(hours * 3600);
  }

  // Utility function to format time for Jira API
  formatTimeForJira(seconds) {
    const hours = seconds / 3600;
    if (hours < 1) {
      const minutes = Math.round(seconds / 60);
      return `${minutes}m`;
    } else if (hours % 1 === 0) {
      return `${hours}h`;
    } else {
      const wholeHours = Math.floor(hours);
      const minutes = Math.round((hours - wholeHours) * 60);
      return `${wholeHours}h ${minutes}m`;
    }
  }

  // Utility function to format time for display
  formatTimeSpent(seconds) {
    return this.formatTimeForJira(seconds); // Use same format
  }

  async getMyAssignedTickets(maxResults = 50) {
    try {
      // Get tickets assigned to the PAT user
      const jql = `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`;
      
      const response = await this.client.get('/search', {
        params: {
          jql,
          maxResults,
          fields: 'key,summary,status,priority,issuetype,assignee,reporter,created,updated'
        }
      });

      return response.data.issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority?.name || 'None',
        issueType: issue.fields.issuetype.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
        created: issue.fields.created,
        updated: issue.fields.updated
      }));
    } catch (error) {
      logger.error('Error getting assigned tickets from Jira:', error.response?.data || error.message);
      throw new Error('Failed to fetch assigned tickets from Jira');
    }
  }

  async getMyWorklogs(startDate, endDate) {
    try {
      // Search for issues where current user logged time in the date range
      const jql = `worklogAuthor = currentUser() AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" ORDER BY updated DESC`;
      
      const response = await this.client.get('/search', {
        params: {
          jql,
          maxResults: 100,
          fields: 'key,summary,worklog',
          expand: 'worklog'
        }
      });

      const worklogSummary = [];
      let totalSeconds = 0;

      for (const issue of response.data.issues) {
        const ticketWorklogs = issue.fields.worklog.worklogs.filter(worklog => {
          const worklogDate = moment(worklog.started).format('YYYY-MM-DD');
          
          // JQL already filters for currentUser() worklogs, just check date range
          return worklogDate >= startDate && worklogDate <= endDate;
        });

        if (ticketWorklogs.length > 0) {
          const ticketSeconds = ticketWorklogs.reduce((sum, log) => sum + log.timeSpentSeconds, 0);
          totalSeconds += ticketSeconds;
          
          worklogSummary.push({
            key: issue.key,
            summary: issue.fields.summary,
            timeSpentSeconds: ticketSeconds,
            timeSpentFormatted: this.formatTimeSpent(ticketSeconds),
            worklogCount: ticketWorklogs.length,
            worklogs: ticketWorklogs.map(log => ({
              started: log.started,
              timeSpentSeconds: log.timeSpentSeconds,
              timeSpentFormatted: this.formatTimeSpent(log.timeSpentSeconds),
              comment: log.comment || 'No description'
            }))
          });
        }
      }

      return {
        totalTimeSeconds: totalSeconds,
        totalTimeFormatted: this.formatTimeSpent(totalSeconds),
        tickets: worklogSummary,
        ticketCount: worklogSummary.length,
        startDate,
        endDate
      };
    } catch (error) {
      logger.error('Error getting worklogs:', error.response?.data || error.message);
      throw new Error('Failed to fetch worklogs from Jira');
    }
  }

  async getMyTimeReports() {
    const now = moment();
    
    // Calculate date ranges
    const today = {
      start: now.clone().startOf('day').format('YYYY-MM-DD'),
      end: now.clone().endOf('day').format('YYYY-MM-DD'),
      label: 'Today'
    };

    const thisWeek = {
      start: now.clone().startOf('isoWeek').format('YYYY-MM-DD'), // Monday
      end: now.clone().endOf('day').format('YYYY-MM-DD'),
      label: 'This Week'
    };

    const thisMonth = {
      start: now.clone().startOf('month').format('YYYY-MM-DD'),
      end: now.clone().endOf('day').format('YYYY-MM-DD'),
      label: 'This Month'
    };

    const thisYear = {
      start: now.clone().startOf('year').format('YYYY-MM-DD'),
      end: now.clone().endOf('day').format('YYYY-MM-DD'),
      label: 'This Year'
    };

    // Get reports for all periods
    const [todayReport, weekReport, monthReport, yearReport] = await Promise.all([
      this.getMyWorklogs(today.start, today.end),
      this.getMyWorklogs(thisWeek.start, thisWeek.end),
      this.getMyWorklogs(thisMonth.start, thisMonth.end),
      this.getMyWorklogs(thisYear.start, thisYear.end)
    ]);

    return {
      today: { ...todayReport, label: today.label, period: `${today.start}` },
      week: { ...weekReport, label: thisWeek.label, period: `${thisWeek.start} to ${thisWeek.end}` },
      month: { ...monthReport, label: thisMonth.label, period: `${thisMonth.start} to ${thisMonth.end}` },
      year: { ...yearReport, label: thisYear.label, period: `${thisYear.start} to ${thisYear.end}` }
    };
  }
}

const jiraService = new JiraService();

module.exports = {
  jiraService,
  JiraService
}; 