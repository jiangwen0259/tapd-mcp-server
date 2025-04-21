#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const TAPD_API_URL = 'https://api.tapd.cn';
const TAPD_API_KEY = process.env.TAPD_API_KEY;
const TAPD_WORKSPACE_ID = process.env.TAPD_WORKSPACE_ID;
const IMAGE_ANALYSIS_URL ='https://faq.chinahuanong.com.cn/api/chat/v1/chat/completions';
const IMAGE_ANALYSIS_API_KEY = "69d860a781154d4299e2b59c9cf4bd80"
const IMAGE_ANALYSIS_PROMPT = '详细分析这张图片，重点关注以下内容：1. 图片中显示的任何错误信息或错误代码；2. 界面中的URL、API路径或链接；3. 界面中显示的任何报错堆栈；4. 用户操作流程或上下文；5. 任何能帮助理解和修复bug的重要细节。请提供简洁但包含关键信息的描述。';

if (!TAPD_API_KEY || !TAPD_WORKSPACE_ID) {
  throw new Error('TAPD_API_KEY and TAPD_WORKSPACE_ID environment variables are required');
}


interface BugResponse {
  id: string;
  title: string;
  description: string;
  priority: string;
  severity: string;
  status: string;
  reporter: string;
  created: string;
  current_owner: string;
  workspace_id: string;
}

class TapdBugServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: 'tapd-bug-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: TAPD_API_URL,
      headers: {
        'Authorization': `Basic ${TAPD_API_KEY}`
      }
    });

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async getImageDownloadUrl(imagePath: string): Promise<string> {
    try {
      console.error('获取图片下载链接:', imagePath);
      
      // 使用TAPD API获取图片下载链接
      const response = await this.axiosInstance.get('/files/get_image', {
        params: {
          workspace_id: TAPD_WORKSPACE_ID,
          image_path: imagePath
        }
      });
      
      console.error('图片API响应状态:', response.status);
      
      if (!response.data || response.data.status !== 1 || !response.data.data || !response.data.data.Attachment) {
        console.error('获取图片下载链接失败');
        throw new Error('获取图片下载链接失败');
      }
      
      const downloadUrl = response.data.data.Attachment.download_url;
      if (!downloadUrl) {
        console.error('图片下载链接为空');
        throw new Error('获取到的图片下载链接为空');
      }
      
      console.error('获取到图片下载链接:', downloadUrl);
      return downloadUrl;
    } catch (error) {
      console.error('获取图片下载链接错误:', error);
      throw error;
    }
  }

  private async analyzeImage(imageUrl: string): Promise<string> {
    try {
      let actualImageUrl = imageUrl;
      
      // 如果是相对URL，先获取下载链接
      if (imageUrl.startsWith('/')) {
        try {
          actualImageUrl = await this.getImageDownloadUrl(imageUrl);
        } catch (error) {
          console.error('获取图片下载链接失败:', error);
          return '无法获取图片下载链接';
        }
      }
      
      console.error('开始分析图片:', actualImageUrl);
      
      // 调用大模型分析图片
      const analysisResponse = await axios.post(IMAGE_ANALYSIS_URL, {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: IMAGE_ANALYSIS_PROMPT
              },
              {
                type: 'image_url',
                image_url: {
                  url: actualImageUrl
                }
              }
            ]
          }
        ],
        stream: false,
        model: 'deepseek-vl2'
      }, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'api-key': IMAGE_ANALYSIS_API_KEY
        }
      });
      
      console.error('图片分析服务响应状态:', analysisResponse.status);
      
      if (analysisResponse.data && analysisResponse.data.choices && analysisResponse.data.choices[0]) {
        return analysisResponse.data.choices[0].message.content;
      }
      
      return '图片内容无法解析';
    } catch (error) {
      console.error('图片分析错误:', error);
      if (axios.isAxiosError(error)) {
        return '图片分析失败: ' + (error.response?.data?.message || error.message);
      }
      return '图片分析失败: ' + (error instanceof Error ? error.message : '未知错误');
    }
  }

  private async processBugDescription(description: string): Promise<string> {
    try {
      console.error('处理Bug描述...');
      
      if (!description) {
        return '';
      }
      
      // 查找所有图片标签
      const imgRegex = /<img[^>]+src="([^">]+)"/g;
      let processedDescription = description;
      let match;
      
      while ((match = imgRegex.exec(description)) !== null) {
        const imageUrl = match[1];
        console.error('找到图片:', imageUrl);
        
        // 尝试分析图片
        let imageDescription = '图片';
        try {
          imageDescription = await this.analyzeImage(imageUrl);
          console.error('图片分析结果:', imageDescription);
        } catch (error) {
          console.error('图片分析失败:', error);
          imageDescription = '图片分析失败，无法提供描述';
        }
        
        // 替换图片标签为文字描述
        processedDescription = processedDescription.replace(
          new RegExp(`<img[^>]+src="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'g'),
          `[图片描述: ${imageDescription}]`
        );
      }
      
      return processedDescription;
    } catch (error) {
      console.error('处理Bug描述出错:', error);
      return description;
    }
  }

  private async formatBugResponse(bug: any): Promise<BugResponse> {
    // 处理描述中的图片
    const processedDescription = await this.processBugDescription(bug.description || '');
    
    return {
      id: bug.id,
      title: bug.title,
      description: processedDescription,
      priority: bug.priority,
      severity: bug.severity,
      status: bug.status,
      reporter: bug.reporter,
      created: bug.created,
      current_owner: bug.current_owner,
      workspace_id: bug.workspace_id
    };
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_bug_details',
          description: 'Get TAPD bug details by bug ID',
          inputSchema: {
            type: 'object',
            properties: {
              bug_id: {
                type: 'string',
                description: 'TAPD bug ID'
              }
            },
            required: ['bug_id']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'get_bug_details') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      const bugId = request.params.arguments?.bug_id;
      if (!bugId || typeof bugId !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'bug_id parameter is required and must be a string'
        );
      }

      try {
        const response = await this.axiosInstance.get('/bugs', {
          params: {
            workspace_id: TAPD_WORKSPACE_ID,
            id: bugId
          }
        });

        if (!response.data?.data?.[0]?.Bug) {
          return {
            content: [{
              type: 'text',
              text: `未找到ID为${bugId}的bug或API返回数据格式不正确`
            }],
            isError: true
          };
        }

        const formattedBug = await this.formatBugResponse(response.data.data[0].Bug);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(formattedBug, null, 2)
          }]
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          return {
            content: [{
              type: 'text',
              text: `TAPD API错误: ${error.response?.data?.message || error.message}`
            }],
            isError: true
          };
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('TAPD Bug MCP server running on stdio');
  }
}

const server = new TapdBugServer();
server.run().catch(console.error);
