import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import {
  parseISO,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfToday,
  startOfYesterday,
  isValid,
  format,
} from 'date-fns';

interface HistoryToolParams {
  text?: string;
  startTime?: string;
  endTime?: string;
  maxResults?: number;
  excludeCurrentTabs?: boolean;
}

interface HistoryItem {
  id: string;
  url?: string;
  title?: string;
  lastVisitTime?: number; // 时间戳（毫秒）
  visitCount?: number;
  typedCount?: number;
}

interface HistoryResult {
  items: HistoryItem[];
  totalCount: number;
  timeRange: {
    startTime: number;
    endTime: number;
    startTimeFormatted: string;
    endTimeFormatted: string;
  };
  query?: string;
}

class HistoryTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HISTORY;
  private static readonly ONE_DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * 将日期字符串解析为自纪元以来的毫秒数。
   * 如果日期字符串无效则返回 null。
   * 支持：
   *  - ISO 日期字符串（例如，"2023-10-31"、"2023-10-31T14:30:00.000Z"）
   *  - 相对时间："1 day ago"、"2 weeks ago"、"3 months ago"、"1 year ago"
   *  - 特殊关键词："now"、"today"、"yesterday"
   */
  private parseDateString(dateStr: string | undefined | null): number | null {
    if (!dateStr) {
      // 如果传递空字符串或 null，可能意味着“没有特定日期”，
      // 具体取决于你如何处理。返回 null 更安全。
      return null;
    }

    const now = new Date();
    const lowerDateStr = dateStr.toLowerCase().trim();

    if (lowerDateStr === 'now') return now.getTime();
    if (lowerDateStr === 'today') return startOfToday().getTime();
    if (lowerDateStr === 'yesterday') return startOfYesterday().getTime();

    const relativeMatch = lowerDateStr.match(
      /^(\d+)\s+(day|days|week|weeks|month|months|year|years)\s+ago$/,
    );
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2];
      let resultDate: Date;
      if (unit.startsWith('day')) resultDate = subDays(now, amount);
      else if (unit.startsWith('week')) resultDate = subWeeks(now, amount);
      else if (unit.startsWith('month')) resultDate = subMonths(now, amount);
      else if (unit.startsWith('year')) resultDate = subYears(now, amount);
      else return null; // 使用正则表达式时不应该发生
      return resultDate.getTime();
    }

    // 尝试解析为 ISO 或其他常见的日期字符串格式
    // 原生 Date 构造函数对于非标准格式可能不可靠。
    // date-fns 的 parseISO 对 ISO 8601 很好。
    // 对于其他格式，date-fns 的 parse 函数更灵活。
    let parsedDate = parseISO(dateStr); // 处理 "2023-10-31" 或 "2023-10-31T10:00:00"
    if (isValid(parsedDate)) {
      return parsedDate.getTime();
    }

    // 回退到 new Date() 处理其他潜在格式，但要谨慎
    parsedDate = new Date(dateStr);
    if (isValid(parsedDate) && dateStr.includes(parsedDate.getFullYear().toString())) {
      return parsedDate.getTime();
    }

    console.warn(`无法解析日期字符串: ${dateStr}`);
    return null;
  }

  /**
   * 将时间戳格式化为人类可读的日期字符串
   */
  private formatDate(timestamp: number): string {
    // 使用 date-fns 进行一致且可能本地化的格式化
    return format(timestamp, 'yyyy-MM-dd HH:mm:ss');
  }

  async execute(args: HistoryToolParams): Promise<ToolResult> {
    try {
      console.log('执行 HistoryTool，参数:', args);

      const {
        text = '',
        maxResults = 100, // 默认 100 个结果
        excludeCurrentTabs = false,
      } = args;

      const now = Date.now();
      let startTimeMs: number;
      let endTimeMs: number;

      // 解析开始时间
      if (args.startTime) {
        const parsedStart = this.parseDateString(args.startTime);
        if (parsedStart === null) {
          return createErrorResponse(
            `开始时间格式无效: "${args.startTime}"。支持的格式: ISO (YYYY-MM-DD)、"today"、"yesterday"、"X days/weeks/months/years ago"。`,
          );
        }
        startTimeMs = parsedStart;
      } else {
        // 如果未提供开始时间，默认为 24 小时前
        startTimeMs = now - HistoryTool.ONE_DAY_MS;
      }

      // 解析结束时间
      if (args.endTime) {
        const parsedEnd = this.parseDateString(args.endTime);
        if (parsedEnd === null) {
          return createErrorResponse(
            `结束时间格式无效: "${args.endTime}"。支持的格式: ISO (YYYY-MM-DD)、"today"、"yesterday"、"X days/weeks/months/years ago"。`,
          );
        }
        endTimeMs = parsedEnd;
      } else {
        // 如果未提供结束时间，默认为当前时间
        endTimeMs = now;
      }

      // 验证时间范围
      if (startTimeMs > endTimeMs) {
        return createErrorResponse('开始时间不能晚于结束时间。');
      }

      console.log(
        `搜索历史记录，时间范围从 ${this.formatDate(startTimeMs)} 到 ${this.formatDate(endTimeMs)}，查询 "${text}"`,
      );

      const historyItems = await chrome.history.search({
        text,
        startTime: startTimeMs,
        endTime: endTimeMs,
        maxResults,
      });

      console.log(`在过滤当前标签页之前找到 ${historyItems.length} 个历史项目。`);

      let filteredItems = historyItems;
      if (excludeCurrentTabs && historyItems.length > 0) {
        const currentTabs = await chrome.tabs.query({});
        const openUrls = new Set<string>();

        currentTabs.forEach((tab) => {
          if (tab.url) {
            openUrls.add(tab.url);
          }
        });

        if (openUrls.size > 0) {
          filteredItems = historyItems.filter((item) => !(item.url && openUrls.has(item.url)));
          console.log(
            `过滤掉 ${historyItems.length - filteredItems.length} 个当前打开的项目。剩余 ${filteredItems.length} 个项目。`,
          );
        }
      }

      const result: HistoryResult = {
        items: filteredItems.map((item) => ({
          id: item.id,
          url: item.url,
          title: item.title,
          lastVisitTime: item.lastVisitTime,
          visitCount: item.visitCount,
          typedCount: item.typedCount,
        })),
        totalCount: filteredItems.length,
        timeRange: {
          startTime: startTimeMs,
          endTime: endTimeMs,
          startTimeFormatted: this.formatDate(startTimeMs),
          endTimeFormatted: this.formatDate(endTimeMs),
        },
      };

      if (text) {
        result.query = text;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('HistoryTool.execute 中出错:', error);
      return createErrorResponse(
        `检索浏览历史时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const historyTool = new HistoryTool();
