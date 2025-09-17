import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';

const tools = { ...browserTools };
const toolsMap = new Map(Object.values(tools).map((tool) => [tool.name, tool]));

/**
 * 工具调用参数接口
 */
export interface ToolCallParam {
  name: string;
  args: any;
}

/**
 * 处理工具执行
 */
export const handleCallTool = async (param: ToolCallParam) => {
  const tool = toolsMap.get(param.name);
  if (!tool) {
    return createErrorResponse(`工具 ${param.name} 未找到`);
  }

  try {
    return await tool.execute(param.args);
  } catch (error) {
    console.error(`工具 ${param.name} 执行失败:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
  }
};
